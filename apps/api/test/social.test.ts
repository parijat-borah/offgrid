import type { AuthResponse, CandidateDto, ConversationDto, KycStartResponse, MatchRequestDto, Me, MessageDto, OtpSendResponse, ReportItem } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MockOtpAdapter } from "../src/adapters/identity";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = loadConfig({ NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(48).toString("base64"), PII_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

let db: Db;
let app: ReturnType<typeof createApp>;
let n = 0;
let phoneSeq = 0;

beforeEach(async () => {
  db = await openDb(":memory:");
  app = createApp({ db, config, content });
});

type U = { id: string; auth: Record<string, string> };

async function user(o: { birthYear?: number; phone?: boolean } = {}): Promise<U> {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .send({ email: `m${++n}@example.com`, password: "correct horse battery", displayName: `Traveller ${n}`, birthYear: o.birthYear ?? 2000, acceptTerms: true, confirmAdult: true })
    .expect(201);
  const body = res.body as AuthResponse;
  const u = { id: body.me.id, auth: { Authorization: `Bearer ${body.accessToken}` } };
  if (o.phone !== false) await verifyPhone(u);
  return u;
}

async function verifyPhone(u: U, phone = `98${String(++phoneSeq).padStart(8, "0")}`) {
  const sent = (await request(app).post("/api/v1/verification/phone/send").set(u.auth).send({ phone }).expect(200)).body as OtpSendResponse;
  await request(app).post("/api/v1/verification/phone/verify").set(u.auth).send({ code: sent.devCode }).expect(200);
}

const kycCode = (o: { gender: string; yearOfBirth: number; approved?: boolean }) =>
  Buffer.from(JSON.stringify({ approved: true, name: "Asha Kumari", ...o })).toString("base64url");

async function verifyId(u: U, gender: "woman" | "man" = "woman", yearOfBirth = 2000) {
  const start = (await request(app).post("/api/v1/verification/kyc/start").set(u.auth).send({ consent: true }).expect(200)).body as KycStartResponse;
  const state = new URL(start.url, "http://x").searchParams.get("state")!;
  return request(app).post("/api/v1/verification/kyc/complete").set(u.auth).send({ state, code: kycCode({ gender, yearOfBirth }) });
}

async function trip(u: U, startDate = "2026-11-02", o: { days?: number; looking?: boolean; placeId?: string } = {}) {
  const id = randomUUID();
  await request(app)
    .put(`/api/v1/trips/${id}`)
    .set(u.auth)
    .send({ placeId: o.placeId ?? "hampta-pass", startDate, plannerInput: { budgetPerPerson: 20000, days: o.days ?? 4, month: 11, fitness: 2, groupSize: 1, vibes: ["adventure", "camping"] } })
    .expect(201);
  if (o.looking !== false) await request(app).post(`/api/v1/match/trips/${id}/looking`).set(u.auth).send({ looking: true }).expect(200);
  return id;
}

const candidates = async (u: U, tripId: string) => (await request(app).get(`/api/v1/match/candidates?tripId=${tripId}`).set(u.auth).expect(200)).body as CandidateDto[];
const me = async (u: U) => (await request(app).get("/api/v1/me").set(u.auth).expect(200)).body as Me;

describe("phone and email verification (mock OTP)", () => {
  it("verifies a phone with a one-time code and adds trust", async () => {
    const a = await user({ phone: false });
    await request(app).post("/api/v1/verification/phone/send").set(a.auth).send({ phone: "12345" }).expect(400);
    const sent = (await request(app).post("/api/v1/verification/phone/send").set(a.auth).send({ phone: "+91 98765 43210" }).expect(200)).body as OtpSendResponse;
    expect(sent.devCode).toMatch(/^\d{6}$/);
    const wrong = sent.devCode === "000000" ? "111111" : "000000";
    await request(app).post("/api/v1/verification/phone/verify").set(a.auth).send({ code: wrong }).expect(400);
    const after = (await request(app).post("/api/v1/verification/phone/verify").set(a.auth).send({ code: sent.devCode }).expect(200)).body as Me;
    expect(after.verifications.find((v) => v.tier === "phone")).toMatchObject({ verified: true, detail: "+91 ••••• 210" });
    expect(after.trust).toBe(25);
    // The number is stored encrypted, never in plain text.
    const row = await db.selectFrom("users").select(["phone_enc"]).where("id", "=", a.id).executeTakeFirstOrThrow();
    expect(row.phone_enc).not.toContain("98765");
  });

  it("won't put one number on two accounts, and throttles code requests", async () => {
    const a = await user({ phone: false });
    await verifyPhone(a, "9000000001");
    const b = await user({ phone: false });
    await request(app).post("/api/v1/verification/phone/send").set(b.auth).send({ phone: "9000000001" }).expect(409);
    for (let i = 0; i < 3; i++) await request(app).post("/api/v1/verification/phone/send").set(b.auth).send({ phone: "9000000002" }).expect(200);
    await request(app).post("/api/v1/verification/phone/send").set(b.auth).send({ phone: "9000000002" }).expect(429);
  });

  it("locks a code after too many wrong guesses", async () => {
    const a = await user({ phone: false });
    const sent = (await request(app).post("/api/v1/verification/phone/send").set(a.auth).send({ phone: "9111111111" })).body as OtpSendResponse;
    const wrong = sent.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post("/api/v1/verification/phone/verify").set(a.auth).send({ code: wrong }).expect(400);
    await request(app).post("/api/v1/verification/phone/verify").set(a.auth).send({ code: sent.devCode }).expect(429);
  });

  it("verifies email", async () => {
    const a = await user();
    const sent = (await request(app).post("/api/v1/verification/email/send").set(a.auth).expect(200)).body as OtpSendResponse;
    const after = (await request(app).post("/api/v1/verification/email/verify").set(a.auth).send({ code: sent.devCode }).expect(200)).body as Me;
    expect(after.trust).toBe(35);
  });

  it("never exposes the code when the adapter isn't a mock", async () => {
    const otp = new MockOtpAdapter();
    otp.exposesCode = false;
    const real = createApp({ db, config, content, identity: { otp, kyc: { name: "x", simulated: false, authorizeUrl: () => "", exchange: async () => { throw new Error(); } }, liveness: { name: "x", simulated: false, check: async () => ({ passed: false, reason: null }) } } });
    const res = await request(real).post("/api/v1/auth/signup").send({ email: "real@example.com", password: "correct horse battery", displayName: "Real", birthYear: 2000, acceptTerms: true, confirmAdult: true });
    const sent = await request(real).post("/api/v1/verification/phone/send").set({ Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` }).send({ phone: "9222222222" }).expect(200);
    expect(sent.body.devCode).toBeUndefined();
    expect(otp.sent).toHaveLength(1);
  });
});

describe("ID verification (mock DigiLocker) and selfie", () => {
  it("needs phone first and explicit consent, then stores only the minimum", async () => {
    const a = await user({ phone: false });
    await request(app).post("/api/v1/verification/kyc/start").set(a.auth).send({ consent: true }).expect(409);
    await verifyPhone(a);
    await request(app).post("/api/v1/verification/kyc/start").set(a.auth).send({ consent: false }).expect(400);
    const res = await verifyId(a, "woman");
    expect(res.status).toBe(200);
    const after = res.body as Me;
    expect(after.genderVerified).toBe(true);
    expect(after.gender).toBe("woman");
    const v = after.verifications.find((x) => x.tier === "gov_id")!;
    expect(v.detail).toMatch(/^Aadhaar ••\d{4} via DigiLocker \(simulated\)$/);
    expect(after.trust).toBe(55);
    // The legal name is never stored anywhere.
    const dump = JSON.stringify(await db.selectFrom("verifications").selectAll().execute()) + JSON.stringify(await db.selectFrom("users").selectAll().execute());
    expect(dump).not.toContain("Asha Kumari");
    const consent = await db.selectFrom("consents").selectAll().where("purpose", "=", "kyc").execute();
    expect(consent).toHaveLength(1);
  });

  it("rejects replayed or foreign state, and IDs that don't match the profile", async () => {
    const a = await user();
    const b = await user();
    const start = (await request(app).post("/api/v1/verification/kyc/start").set(a.auth).send({ consent: true })).body as KycStartResponse;
    const state = new URL(start.url, "http://x").searchParams.get("state")!;
    await request(app).post("/api/v1/verification/kyc/complete").set(b.auth).send({ state, code: kycCode({ gender: "man", yearOfBirth: 2000 }) }).expect(400);
    await request(app).post("/api/v1/verification/kyc/complete").set(a.auth).send({ state, code: kycCode({ gender: "woman", yearOfBirth: 1980 }) }).expect(400);
    // The state was used up by the failed attempt, so it can't be replayed.
    await request(app).post("/api/v1/verification/kyc/complete").set(a.auth).send({ state, code: kycCode({ gender: "woman", yearOfBirth: 2000 }) }).expect(400);
  });

  it("locks gender once verified, and unlocks it when consent is withdrawn", async () => {
    const a = await user();
    await verifyId(a, "man");
    await request(app).patch("/api/v1/me").set(a.auth).send({ gender: "woman" }).expect(409);
    const after = (await request(app).delete("/api/v1/verification/kyc").set(a.auth).expect(200)).body as Me;
    expect(after.genderVerified).toBe(false);
    expect(after.verifications.find((v) => v.tier === "gov_id")!.verified).toBe(false);
    await request(app).patch("/api/v1/me").set(a.auth).send({ gender: "nonbinary" }).expect(200);
  });

  it("runs the selfie check only after ID, in memory", async () => {
    const a = await user();
    const selfie = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#c49a7a" } }).jpeg().toBuffer();
    await request(app).post("/api/v1/verification/liveness").set(a.auth).attach("selfie", selfie, "s.jpg").expect(409);
    await verifyId(a);
    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    await request(app).post("/api/v1/verification/liveness").set(a.auth).attach("selfie", tiny, "s.png").expect(400);
    const after = (await request(app).post("/api/v1/verification/liveness").set(a.auth).attach("selfie", selfie, "s.jpg").expect(200)).body as Me;
    expect(after.trust).toBe(65);
  });
});

describe("traveller type", () => {
  it("scores the quiz and saves the type", async () => {
    const a = await user();
    const after = (await request(app).post("/api/v1/me/traveller-type").set(a.auth).send({ answers: [0, 2, 0, 0, 0, 0] }).expect(200)).body as Me;
    expect(after.travellerType).toBe("summit-chaser");
    await request(app).post("/api/v1/me/traveller-type").set(a.auth).send({ answers: [0] }).expect(400);
  });
});

describe("buddy matching", () => {
  it("finds travellers on the same trip and dates, with reasons and no private details", async () => {
    const a = await user();
    const b = await user({ birthYear: 1997 });
    const aTrip = await trip(a, "2026-11-02");
    await trip(b, "2026-11-03");
    await trip(await user(), "2026-12-20"); // dates too far apart
    await trip(await user(), "2026-11-02", { placeId: "triund" }); // different place
    await trip(await user(), "2026-11-02", { looking: false }); // not looking
    const list = await candidates(a, aTrip);
    expect(list.map((c) => c.userId)).toEqual([b.id]);
    expect(list[0]!.reasons).toContain("Same destination");
    expect(list[0]!.ageBand).toBe("25–29");
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/email|birth|phone_|gender/i);
  });

  it("requires a verified phone to look, and a start date", async () => {
    const a = await user({ phone: false });
    const id = await trip(a, "2026-11-02", { looking: false });
    await request(app).post(`/api/v1/match/trips/${id}/looking`).set(a.auth).send({ looking: true }).expect(409);
    await request(app).get(`/api/v1/match/candidates?tripId=${id}`).set(a.auth).expect(409);
  });

  it("only lets ID-verified women use women-only, and then shows only verified women", async () => {
    const man = await user();
    await request(app).put("/api/v1/match/prefs").set(man.auth).send({ womenOnly: true, sameGender: false, verifiedOnly: false, ageMin: 18, ageMax: 120, visible: true }).expect(400);

    const asha = await user();
    await verifyId(asha, "woman");
    await request(app).put("/api/v1/match/prefs").set(asha.auth).send({ womenOnly: true, sameGender: false, verifiedOnly: false, ageMin: 18, ageMax: 120, visible: true }).expect(200);
    const ashaTrip = await trip(asha);

    const verifiedWoman = await user();
    await verifyId(verifiedWoman, "woman");
    await trip(verifiedWoman);
    const selfDeclared = await user();
    await request(app).patch("/api/v1/me").set(selfDeclared.auth).send({ gender: "woman" }).expect(200);
    await trip(selfDeclared);
    await trip(man);

    expect((await candidates(asha, ashaTrip)).map((c) => c.userId)).toEqual([verifiedWoman.id]);
    // And the man can't see Asha either: her preference applies in both directions.
    const manTrip = (await request(app).get("/api/v1/trips").set(man.auth)).body[0].id as string;
    expect((await candidates(man, manTrip)).map((c) => c.userId)).not.toContain(asha.id);
  });

  it("runs the request → accept → chat flow with contact details masked until both share", async () => {
    const a = await user();
    const b = await user();
    const aTrip = await trip(a);
    const bTrip = await trip(b);

    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip, message: "Hi! WhatsApp me on 98765 43210" }).expect(201);
    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip }).expect(409);
    const incoming = ((await request(app).get("/api/v1/match/requests").set(b.auth)).body as MatchRequestDto[])[0]!;
    expect(incoming).toMatchObject({ direction: "incoming", status: "pending" });
    expect(incoming.message).toBe("Hi! WhatsApp me on [contact hidden]");
    await request(app).post(`/api/v1/match/requests/${incoming.id}/accept`).set(a.auth).expect(404); // only the recipient can accept
    const accepted = (await request(app).post(`/api/v1/match/requests/${incoming.id}/accept`).set(b.auth).expect(200)).body as { conversationId: string };
    const conv = accepted.conversationId;

    let msgs = (await request(app).get(`/api/v1/conversations/${conv}/messages`).set(a.auth)).body as MessageDto[];
    expect(msgs[0]!.system).toBe(true);
    expect(msgs[0]!.body).toMatch(/Keep chatting here/);

    const sent = (await request(app).post(`/api/v1/conversations/${conv}/messages`).set(b.auth).send({ body: "Sure, I'm on insta: b.treks" }).expect(201)).body as MessageDto;
    expect(sent).toMatchObject({ body: "Sure, I'm on [contact hidden]", masked: true });

    await request(app).post(`/api/v1/conversations/${conv}/share-contact`).set(a.auth).expect(200);
    let view = (await request(app).get(`/api/v1/conversations/${conv}`).set(b.auth)).body as ConversationDto;
    expect(view).toMatchObject({ theyShared: true, iShared: false });
    expect(view.other.phone).toBeNull();
    await request(app).post(`/api/v1/conversations/${conv}/share-contact`).set(b.auth).expect(200);
    view = (await request(app).get(`/api/v1/conversations/${conv}`).set(b.auth)).body as ConversationDto;
    expect(view.other.phone).toMatch(/^\+9198/);

    const free = (await request(app).post(`/api/v1/conversations/${conv}/messages`).set(a.auth).send({ body: "Great, call 98765 43210" }).expect(201)).body as MessageDto;
    expect(free.masked).toBe(false);

    // Strangers can't read the conversation.
    const c = await user();
    await request(app).get(`/api/v1/conversations/${conv}/messages`).set(c.auth).expect(404);
    msgs = (await request(app).get(`/api/v1/conversations/${conv}/messages`).set(a.auth)).body as MessageDto[];
    expect(msgs.length).toBeGreaterThanOrEqual(5);
  });

  it("streams new messages over server-sent events", async () => {
    const a = await user();
    const b = await user();
    const aTrip = await trip(a);
    const bTrip = await trip(b);
    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip });
    const reqId = ((await request(app).get("/api/v1/match/requests").set(b.auth)).body as MatchRequestDto[])[0]!.id;
    const { conversationId } = (await request(app).post(`/api/v1/match/requests/${reqId}/accept`).set(b.auth)).body as { conversationId: string };

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const received = await new Promise<string>((resolve, reject) => {
      // Browsers always send Accept-Encoding: gzip; the stream must still arrive unbuffered.
      const req = http.get({ port, path: `/api/v1/conversations/${conversationId}/stream`, headers: { ...a.auth, "Accept-Encoding": "gzip" } }, (res) => {
        expect(res.headers["content-encoding"]).toBeUndefined();
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          if (buf.includes("event: message")) {
            req.destroy();
            resolve(buf);
          }
        });
        // Supertest only fires on .end() / await.
        setTimeout(() => request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(b.auth).send({ body: "See you at the bus stand" }).end(() => undefined), 50);
      });
      req.on("error", (e) => (e.message.includes("aborted") || (e as NodeJS.ErrnoException).code === "ECONNRESET" ? undefined : reject(e)));
      setTimeout(() => reject(new Error("no event")), 3000);
    });
    server.close();
    expect(received).toContain("See you at the bus stand");
  });

  it("blocking closes the chat, declines requests and hides both from each other", async () => {
    const a = await user();
    const b = await user();
    const aTrip = await trip(a);
    const bTrip = await trip(b);
    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip });
    const reqId = ((await request(app).get("/api/v1/match/requests").set(b.auth)).body as MatchRequestDto[])[0]!.id;
    const { conversationId } = (await request(app).post(`/api/v1/match/requests/${reqId}/accept`).set(b.auth)).body as { conversationId: string };

    await request(app).post(`/api/v1/safety/blocks/${a.id}`).set(b.auth).expect(204);
    await request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(a.auth).send({ body: "hello?" }).expect(409);
    expect(await candidates(a, aTrip)).toEqual([]);
    expect(await candidates(b, bTrip)).toEqual([]);
    expect(((await request(app).get(`/api/v1/conversations/${conversationId}`).set(a.auth)).body as ConversationDto).closed).toBe(true);
  });

  it("reports go to moderators, and upheld reports cost trust", async () => {
    const a = await user();
    const b = await user();
    const mod = await user();
    await db.updateTable("users").set({ role: "moderator" }).where("id", "=", mod.id).execute();
    const aTrip = await trip(a);
    const bTrip = await trip(b);
    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip });
    const reqId = ((await request(app).get("/api/v1/match/requests").set(b.auth)).body as MatchRequestDto[])[0]!.id;
    const { conversationId } = (await request(app).post(`/api/v1/match/requests/${reqId}/accept`).set(b.auth)).body as { conversationId: string };
    const msg = (await request(app).post(`/api/v1/conversations/${conversationId}/messages`).set(b.auth).send({ body: "Send ₹5,000 advance for the jeep or no trip" })).body as MessageDto;

    const outsider = await user();
    await request(app).post("/api/v1/safety/reports").set(outsider.auth).send({ targetType: "message", targetId: msg.id, reason: "scam_or_money" }).expect(404);
    await request(app).post("/api/v1/safety/reports").set(a.auth).send({ targetType: "message", targetId: msg.id, reason: "scam_or_money", details: "Asked for money upfront", block: true }).expect(201);

    await request(app).get("/api/v1/moderation/reports").set(a.auth).expect(403);
    const queue = (await request(app).get("/api/v1/moderation/reports").set(mod.auth).expect(200)).body as ReportItem[];
    expect(queue[0]).toMatchObject({ reason: "scam_or_money", messageBody: "Send ₹5,000 advance for the jeep or no trip" });
    expect(queue[0]!.reported.id).toBe(b.id);

    const before = (await me(b)).trust;
    await request(app).post(`/api/v1/moderation/reports/${queue[0]!.id}`).set(mod.auth).send({ action: "uphold" }).expect(200);
    const after = await me(b);
    expect(after.trust).toBe(Math.max(0, before - 15));
    expect(after.trustParts.some((p) => p.label.startsWith("Reports upheld"))).toBe(true);
  });
});
