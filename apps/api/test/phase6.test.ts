import { simulateTrack, type AuthResponse, type ConversationDto, type LeaderboardDto, type MatchRequestDto, type Me, type OtpSendResponse } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = loadConfig({ NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(48).toString("base64"), PII_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

let db: Db;
let app: ReturnType<typeof createApp>;
let n = 0;

beforeEach(async () => {
  db = await openDb(":memory:");
  app = createApp({ db, config, content });
});

type U = { id: string; auth: Record<string, string> };

async function user(o: { optIn?: boolean; name?: string } = {}): Promise<U> {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .send({ email: `p${++n}@example.com`, password: "correct horse battery", displayName: o.name ?? `P${n}`, birthYear: 2000, acceptTerms: true, confirmAdult: true })
    .expect(201);
  const u = { id: (res.body as AuthResponse).me.id, auth: { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` } };
  if (o.optIn !== false) await request(app).patch("/api/v1/me").set(u.auth).send({ leaderboardOptIn: true }).expect(200);
  return u;
}

/** Plan → start → GPS → complete. `endTs` places the GPS track in time; `source` "simulated" marks a demo track. */
async function doTrip(u: U, o: { placeId?: string; endTs?: number; source?: "gps" | "simulated"; gps?: boolean; startDate?: string } = {}) {
  const id = randomUUID();
  const placeId = o.placeId ?? "triund";
  await request(app)
    .put(`/api/v1/trips/${id}`)
    .set(u.auth)
    .send({ placeId, startDate: o.startDate ?? null, plannerInput: { budgetPerPerson: 20000, days: 2, month: 10, fitness: 2, groupSize: 2, vibes: [] } })
    .expect(201);
  if (o.gps !== false) {
    await request(app).post(`/api/v1/trips/${id}/start`).set(u.auth).expect(200);
    const pts = simulateTrack(content.place(placeId)!, o.endTs ?? Date.now());
    await request(app).post(`/api/v1/trips/${id}/points`).set(u.auth).send({ points: pts, source: o.source ?? "gps" }).expect(200);
  }
  await request(app).post(`/api/v1/trips/${id}/complete`).set(u.auth).send({}).expect(200);
  return id;
}

/** Moves a trip's GPS track into the past, so a later trip's track doesn't overlap it. */
const backdate = (tripId: string, ms: number) => db.updateTable("trip_points").set((eb) => ({ ts: eb("ts", "-", ms) })).where("trip_id", "=", tripId).execute();

const board = async (u: U, q = "") => (await request(app).get(`/api/v1/leaderboard${q}`).set(u.auth).expect(200)).body as LeaderboardDto;
const me = async (u: U) => (await request(app).get("/api/v1/me").set(u.auth).expect(200)).body as Me;

describe("leaderboards", () => {
  it("shows only opted-in travellers, ranked, with my own position", async () => {
    const a = await user({ name: "Asha" });
    const b = await user({ name: "Bilal" });
    const shy = await user({ name: "Shy", optIn: false });
    await doTrip(a, { placeId: "hampta-pass" });
    await doTrip(b);
    await doTrip(shy);

    const xp = await board(a);
    expect(xp.entries.map((e) => e.displayName)).toEqual(["Asha", "Bilal"]);
    expect(xp.entries[0]).toMatchObject({ rank: 1, isMe: true });
    expect(xp.me).toMatchObject({ optedIn: true, rank: 1 });

    const mine = await board(shy);
    expect(mine.me.optedIn).toBe(false);
    expect(mine.me.rank).toBeNull();
    expect(mine.me.value).toBeGreaterThan(0);

    const km = await board(a, "?metric=km");
    expect(km.entries.every((e) => e.value > 0)).toBe(true);
  });

  it("keeps simulated, manual and overlapping trips off the boards but not off your level", async () => {
    const a = await user();
    await doTrip(a, { source: "simulated" });
    await doTrip(a, { gps: false });
    const lb = await board(a, "?metric=km");
    expect(lb.entries).toEqual([]);
    const reasons = lb.excludedTrips.flatMap((t) => t.reasons).join(" ");
    expect(reasons).toMatch(/Simulated GPS/);
    expect(reasons).toMatch(/without a GPS track/);
    // Badge XP still counts on the XP board; trip XP from flagged trips doesn't.
    const xp = await board(a);
    const levelXp = (await me(a)).level.xp;
    expect(xp.me.value).toBeGreaterThan(0);
    expect(xp.me.value).toBeLessThan(levelXp);
  });

  it("flags a second trip whose GPS track overlaps the first", async () => {
    const a = await user();
    const t = Date.now();
    await doTrip(a, { endTs: t });
    const second = await doTrip(a, { placeId: "kareri-lake", endTs: t - 3_600_000 });
    const lb = await board(a, "?metric=km");
    expect(lb.excludedTrips.find((x) => x.tripId === second)?.reasons.join(" ")).toMatch(/overlaps/);
    expect(lb.entries).toHaveLength(1);
  });

  it("friends scope shows only people you've connected with", async () => {
    const a = await user();
    const b = await user();
    const stranger = await user();
    for (const u of [a, b, stranger]) await doTrip(u);
    const conv = randomUUID();
    await db
      .insertInto("conversations")
      .values({ id: conv, user_a: a.id, user_b: b.id, request_id: randomUUID(), place_id: "triund", a_shared: 0, b_shared: 0, a_read_at: null, b_read_at: null, closed_at: null, created_at: new Date().toISOString() })
      .execute();
    const f = await board(a, "?scope=friends");
    expect(f.entries.map((e) => e.userId).sort()).toEqual([a.id, b.id].sort());
    expect((await board(a)).entries).toHaveLength(3);
  });

  it("lists recent seasons and validates input", async () => {
    const a = await user();
    const seasons = (await request(app).get("/api/v1/leaderboard/seasons").set(a.auth).expect(200)).body as string[];
    expect(seasons).toHaveLength(6);
    expect(seasons[0]).toMatch(/^\d{4}-\d{2}$/);
    await request(app).get("/api/v1/leaderboard?metric=money").set(a.auth).expect(400);
  });
});

describe("challenges and streaks", () => {
  it("pays each monthly challenge once", async () => {
    const a = await user();
    await backdate(await doTrip(a), 3 * 86_400_000);
    let m = await me(a);
    expect(m.challenges.find((c) => c.id === "out-there")?.done).toBe(true);
    expect(m.challenges.find((c) => c.id === "double-up")).toMatchObject({ done: false, current: 1 });
    await doTrip(a, { placeId: "kareri-lake" });
    m = await me(a);
    expect(m.challenges.find((c) => c.id === "double-up")?.done).toBe(true);
    const challengeXp = await db.selectFrom("xp_events").select(["ref_id", "amount"]).where("user_id", "=", a.id).where("reason", "=", "challenge").execute();
    expect(challengeXp.map((c) => c.ref_id?.split(":")[0]).sort()).toEqual(["double-up", "out-there"]);
  });

  it("doesn't pay challenges for trips that failed fair play", async () => {
    const a = await user();
    await doTrip(a, { source: "simulated" });
    expect((await me(a)).challenges.find((c) => c.id === "out-there")).toMatchObject({ done: false, current: 0 });
    const paid = await db.selectFrom("xp_events").select("id").where("user_id", "=", a.id).where("reason", "=", "challenge").execute();
    expect(paid).toEqual([]);
  });

  it("rewards a streak of consecutive months with verified trips", async () => {
    const a = await user();
    const first = await doTrip(a);
    // Pretend the first trip happened last month.
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();
    await db.updateTable("trips").set({ completed_at: lastMonth }).where("id", "=", first).execute();
    await backdate(first, 3 * 86_400_000);
    await doTrip(a, { placeId: "kareri-lake" });
    const m = await me(a);
    expect(m.streakMonths).toBe(2);
    const streak = await db.selectFrom("xp_events").select("amount").where("user_id", "=", a.id).where("reason", "=", "streak").execute();
    expect(streak.map((s) => s.amount)).toEqual([20]);
  });

  it("counts hazard confirmations towards Trail guardian", async () => {
    const reporter = await user();
    const helper = await user();
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      await request(app).put(`/api/v1/hazards/${id}`).set(reporter.auth).send({ kind: "landslide", severity: 2, description: "Debris across the road after rain", lat: 32.0 + i * 0.01, lon: 77.3 }).expect(201);
      await request(app).post(`/api/v1/hazards/${id}/confirm`).set(helper.auth).expect(200);
    }
    expect((await me(helper)).challenges.find((c) => c.id === "trail-guardian")?.done).toBe(true);
  });
});

describe("buddy ratings", () => {
  async function verifiedUser() {
    const u = await user();
    const sent = (await request(app).post("/api/v1/verification/phone/send").set(u.auth).send({ phone: `97${String(++n).padStart(8, "0")}` })).body as OtpSendResponse;
    await request(app).post("/api/v1/verification/phone/verify").set(u.auth).send({ code: sent.devCode }).expect(200);
    return u;
  }
  async function planned(u: U, startDate: string) {
    const id = randomUUID();
    await request(app).put(`/api/v1/trips/${id}`).set(u.auth).send({ placeId: "triund", startDate, plannerInput: { budgetPerPerson: 9000, days: 2, month: 11, fitness: 1, groupSize: 1, vibes: [] } }).expect(201);
    await request(app).post(`/api/v1/match/trips/${id}/looking`).set(u.auth).send({ looking: true }).expect(200);
    return id;
  }

  it("opens after the trip ends, feeds trust and shows on profiles", async () => {
    const a = await verifiedUser();
    const b = await verifiedUser();
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const aTrip = await planned(a, future);
    const bTrip = await planned(b, future);
    await request(app).post("/api/v1/match/requests").set(a.auth).send({ fromTripId: aTrip, toTripId: bTrip }).expect(201);
    const reqId = ((await request(app).get("/api/v1/match/requests").set(b.auth)).body as MatchRequestDto[])[0]!.id;
    const { conversationId } = (await request(app).post(`/api/v1/match/requests/${reqId}/accept`).set(b.auth)).body as { conversationId: string };

    let view = (await request(app).get(`/api/v1/conversations/${conversationId}`).set(a.auth)).body as ConversationDto;
    expect(view.canRate).toBe(false);
    await request(app).post(`/api/v1/conversations/${conversationId}/rate`).set(a.auth).send({ stars: 5 }).expect(409);

    const trustBefore = (await me(b)).trust;
    await request(app).post(`/api/v1/trips/${aTrip}/complete`).set(a.auth).send({}).expect(200);
    view = (await request(app).post(`/api/v1/conversations/${conversationId}/rate`).set(a.auth).send({ stars: 5, tags: ["punctual", "safe"] }).expect(200)).body as ConversationDto;
    expect(view.myRating).toBe(5);
    await request(app).post(`/api/v1/conversations/${conversationId}/rate`).set(a.auth).send({ stars: 7 }).expect(400);

    const after = await me(b);
    expect(after.trust).toBe(trustBefore + 10);
    expect(after.trustParts.find((p) => p.label.startsWith("Ratings"))?.points).toBe(10);
    const seenByB = (await request(app).get(`/api/v1/conversations/${conversationId}`).set(b.auth)).body as ConversationDto;
    expect(seenByB.other.rating).toBeNull(); // b sees a, who nobody has rated yet
    const seenByA = (await request(app).get(`/api/v1/conversations/${conversationId}`).set(a.auth)).body as ConversationDto;
    expect(seenByA.other.rating).toEqual({ avg: 5, count: 1 });
  });
});
