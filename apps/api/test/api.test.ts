import { simulateTrack, type AuthResponse, type CompleteTripResponse, type Me, type TripDto } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = loadConfig({
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("base64"),
  PII_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
});

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await openDb(":memory:");
  app = createApp({ db, config, content });
});

const plannerInput = { budgetPerPerson: 8000, days: 2, month: 10, fitness: 1, groupSize: 2, vibes: ["camping"] };
const signupBody = (email = "asha@example.com") => ({
  email,
  password: "correct horse battery",
  displayName: "Asha",
  birthYear: 2000,
  acceptTerms: true,
  confirmAdult: true,
});

async function signup(email?: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/signup").send(signupBody(email)).expect(201);
  const body = res.body as AuthResponse;
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  return { agent, cookie, token: body.accessToken, me: body.me, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

async function plannedTrip(auth: Record<string, string>, placeId = "triund") {
  const id = randomUUID();
  await request(app).put(`/api/v1/trips/${id}`).set(auth).send({ placeId, plannerInput }).expect(201);
  return id;
}

describe("signup", () => {
  it("creates an account at level 1 with a Rookie mascot", async () => {
    const { me } = await signup();
    expect(me.level.level).toBe(1);
    expect(me.stage.id).toBe("rookie");
    expect(me.birthYear).toBe(2000);
    expect(me.badges.every((b) => !b.earned)).toBe(true);
  });

  it("rejects anyone who might be under 18", async () => {
    const year = new Date().getUTCFullYear() - 17;
    const res = await request(app).post("/api/v1/auth/signup").send({ ...signupBody(), birthYear: year }).expect(400);
    expect(res.body.error.fields.birthYear).toMatch(/18/);
  });

  it("requires consent and the adult confirmation", async () => {
    const res = await request(app).post("/api/v1/auth/signup").send({ ...signupBody(), acceptTerms: false }).expect(400);
    expect(res.body.error.fields.acceptTerms).toBeDefined();
  });

  it("rejects short passwords and duplicate emails", async () => {
    await request(app).post("/api/v1/auth/signup").send({ ...signupBody(), password: "short" }).expect(400);
    await signup("dup@example.com");
    await request(app).post("/api/v1/auth/signup").send(signupBody("DUP@example.com")).expect(409);
  });

  it("stores the birth year encrypted and the password hashed", async () => {
    await signup();
    const row = await db.selectFrom("users").selectAll().executeTakeFirstOrThrow();
    expect(row.birth_year_enc).not.toContain("2000");
    expect(row.birth_year_enc.startsWith("v1:")).toBe(true);
    expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
    const consent = await db.selectFrom("consents").selectAll().executeTakeFirstOrThrow();
    expect(consent.purpose).toBe("account");
  });
});

describe("login and sessions", () => {
  it("logs in with the right password only, with the same error for unknown emails", async () => {
    await signup();
    const wrong = await request(app).post("/api/v1/auth/login").send({ email: "asha@example.com", password: "nope nope nope" }).expect(401);
    const unknown = await request(app).post("/api/v1/auth/login").send({ email: "who@example.com", password: "nope nope nope" }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const ok = await request(app).post("/api/v1/auth/login").send({ email: "ASHA@example.com", password: "correct horse battery" }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.headers["set-cookie"]?.[0]).toMatch(/og_rt=.*HttpOnly.*SameSite=Strict/i);
  });

  it("protects /me", async () => {
    await request(app).get("/api/v1/me").expect(401);
    await request(app).get("/api/v1/me").set({ Authorization: "Bearer not-a-token" }).expect(401);
  });

  it("rotates refresh tokens and kills the family when an old one is reused", async () => {
    const { agent, cookie: original } = await signup();
    // The agent rotates the signup token, so `original` is now spent.
    const first = await agent.post("/api/v1/auth/refresh").expect(200);
    expect(first.body.me.displayName).toBe("Asha");

    // An attacker replays the spent token from a different client.
    await request(app).post("/api/v1/auth/refresh").set("Cookie", original).expect(401);
    // The legitimate client's current token is now revoked too.
    await agent.post("/api/v1/auth/refresh").expect(401);
  });

  it("logs out", async () => {
    const { agent } = await signup();
    await agent.post("/api/v1/auth/logout").expect(204);
    await agent.post("/api/v1/auth/refresh").expect(401);
  });
});

describe("profile", () => {
  it("updates allowed fields and rejects unknown ones", async () => {
    const { auth } = await signup();
    const res = await request(app)
      .patch("/api/v1/me")
      .set(auth)
      .send({ bio: "Chai and ridgelines", mascotSpecies: "red_panda", styleTags: ["solo", "budget"], avatar: "🧭" })
      .expect(200);
    const me = res.body as Me;
    expect(me.mascotSpecies).toBe("red_panda");
    expect(me.styleTags).toEqual(["solo", "budget"]);
    await request(app).patch("/api/v1/me").set(auth).send({ xp: 99999 }).expect(400);
    await request(app).patch("/api/v1/me").set(auth).send({ styleTags: ["hacker"] }).expect(400);
  });
});

describe("trips and XP", () => {
  it("plans, starts, records GPS and completes a verified trip", async () => {
    const { auth } = await signup();
    const id = await plannedTrip(auth);

    const listed = await request(app).get("/api/v1/trips?status=planned").set(auth).expect(200);
    expect((listed.body as TripDto[]).map((t) => t.id)).toEqual([id]);
    expect((listed.body as TripDto[])[0]!.budgetPp).toBeGreaterThan(0);

    await request(app).post(`/api/v1/trips/${id}/start`).set(auth).expect(200);
    const triund = content.place("triund")!;
    const points = simulateTrack(triund, Date.now());
    const pts = await request(app).post(`/api/v1/trips/${id}/points`).set(auth).send({ points, source: "simulated" }).expect(200);
    expect(pts.body).toEqual({ accepted: 14, rejected: 0 });

    const res = await request(app).post(`/api/v1/trips/${id}/complete`).set(auth).send({ actualSpendPp: 4200 }).expect(200);
    const body = res.body as CompleteTripResponse;
    expect(body.validation).toBe("verified");
    expect(body.xpAwarded).toBe(80);
    const badgeIds = body.newBadges.map((b) => b.id);
    expect(badgeIds).toEqual(expect.arrayContaining(["first-steps", "budget-hero"]));
    // 80 trip XP + 20 First Steps + 30 Budget Hero = 130 → level 2. A simulated track earns no monthly challenge.
    expect(body.me.level.xp).toBe(130);
    expect(body.levelUp).toEqual({ from: 1, to: 2 });
    expect(body.stageChange).toBeNull();
    expect(body.trip.route.length).toBeGreaterThan(2);
    expect(body.me.stats.tripsCompleted).toBe(1);

    // The ledger matches the cached total.
    const ledger = await db.selectFrom("xp_events").select("amount").execute();
    expect(ledger.reduce((s, e) => s + e.amount, 0)).toBe(130);

    await request(app).post(`/api/v1/trips/${id}/complete`).set(auth).send({}).expect(409);
  });

  it("evolves the mascot when a big trip crosses level 3", async () => {
    const { auth } = await signup();
    const id = await plannedTrip(auth, "hampta-pass");
    await request(app).post(`/api/v1/trips/${id}/start`).set(auth).expect(200);
    const hampta = content.place("hampta-pass")!;
    await request(app).post(`/api/v1/trips/${id}/points`).set(auth).send({ points: simulateTrack(hampta, Date.now()) }).expect(200);
    const res = await request(app).post(`/api/v1/trips/${id}/complete`).set(auth).send({}).expect(200);
    const body = res.body as CompleteTripResponse;
    // 220 + First Steps 20 + Thin Air 40 + Pass Crosser 40 = 320 → level 4.
    expect(body.me.level.level).toBe(4);
    expect(body.stageChange?.from.id).toBe("rookie");
    expect(body.stageChange?.to.id).toBe("trail-hunter");
  });

  it("gives manual completions a small, capped amount of XP and no badges", async () => {
    const { auth } = await signup();
    const xps: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await plannedTrip(auth);
      const res = await request(app).post(`/api/v1/trips/${id}/complete`).set(auth).send({}).expect(200);
      xps.push((res.body as CompleteTripResponse).xpAwarded);
      expect((res.body as CompleteTripResponse).newBadges).toEqual([]);
    }
    expect(xps).toEqual([20, 20, 0]);
  });

  it("drops GPS points from the future and refuses points for trips that aren't active", async () => {
    const { auth } = await signup();
    const id = await plannedTrip(auth);
    const point = { ts: Date.now(), lat: 32.25, lon: 76.34 };
    await request(app).post(`/api/v1/trips/${id}/points`).set(auth).send({ points: [point] }).expect(409);
    await request(app).post(`/api/v1/trips/${id}/start`).set(auth).expect(200);
    const res = await request(app)
      .post(`/api/v1/trips/${id}/points`)
      .set(auth)
      .send({ points: [point, { ...point, ts: Date.now() + 86_400_000 }] })
      .expect(200);
    expect(res.body).toEqual({ accepted: 1, rejected: 1 });
  });

  it("hides other people's trips", async () => {
    const a = await signup("a@example.com");
    const b = await signup("b@example.com");
    const id = await plannedTrip(a.auth);
    await request(app).get(`/api/v1/trips/${id}`).set(b.auth).expect(404);
    await request(app).post(`/api/v1/trips/${id}/complete`).set(b.auth).send({}).expect(404);
    await request(app).put(`/api/v1/trips/${id}`).set(b.auth).send({ placeId: "triund", plannerInput }).expect(400);
  });

  it("validates inputs", async () => {
    const { auth } = await signup();
    await request(app).put("/api/v1/trips/not-a-uuid").set(auth).send({ placeId: "triund", plannerInput }).expect(400);
    await request(app).put(`/api/v1/trips/${randomUUID()}`).set(auth).send({ placeId: "atlantis", plannerInput }).expect(400);
    await request(app)
      .put(`/api/v1/trips/${randomUUID()}`)
      .set(auth)
      .send({ placeId: "triund", plannerInput: { ...plannerInput, budgetPerPerson: -1 } })
      .expect(400);
  });
});

describe("your data (DPDP)", () => {
  it("exports everything except secrets", async () => {
    const { auth } = await signup();
    await plannedTrip(auth);
    const res = await request(app).get("/api/v1/me/export").set(auth).expect(200);
    const text = JSON.stringify(res.body);
    expect(res.body.trips).toHaveLength(1);
    expect(res.body.consents).toHaveLength(1);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("token_hash");
  });

  it("deletes the account and all its data, with the password", async () => {
    const { auth } = await signup();
    await plannedTrip(auth);
    await request(app).delete("/api/v1/me").set(auth).send({ password: "wrong password!" }).expect(401);
    await request(app).delete("/api/v1/me").set(auth).send({ password: "correct horse battery" }).expect(204);
    await request(app).get("/api/v1/me").set(auth).expect(401);
    expect(await db.selectFrom("trips").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("sessions").selectAll().execute()).toEqual([]);
    await request(app).post("/api/v1/auth/login").send({ email: "asha@example.com", password: "correct horse battery" }).expect(401);
  });
});
