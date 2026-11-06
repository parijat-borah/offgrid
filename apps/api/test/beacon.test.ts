import { encodePacket, forwardPacket, fromHex, toHex, type AuthResponse, type BeaconPacket, type BeaconPairResponse, type RelayResult, type SosIncidentDto, type SosPublicDto, type TrustedContactDto } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MockSmsAdapter } from "../src/adapters/sms";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = loadConfig({ NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(48).toString("base64"), PII_ENCRYPTION_KEY: randomBytes(32).toString("base64") });

let db: Db;
let sms: MockSmsAdapter;
let app: ReturnType<typeof createApp>;
let n = 0;

beforeEach(async () => {
  db = await openDb(":memory:");
  sms = new MockSmsAdapter();
  app = createApp({ db, config, content, sms });
});

type U = { id: string; auth: Record<string, string> };
async function user(): Promise<U> {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .send({ email: `b${++n}@example.com`, password: "correct horse battery", displayName: `Trekker${n}`, birthYear: 1999, acceptTerms: true, confirmAdult: true })
    .expect(201);
  const body = res.body as AuthResponse;
  return { id: body.me.id, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

async function withContact(u: U, phone = "9876543210") {
  return (await request(app).post("/api/v1/contacts").set(u.auth).send({ name: "Maa", phone, theyAgreed: true }).expect(201)).body as TrustedContactDto[];
}

async function pair(u: U, id = "0a1b2c3d") {
  return (await request(app).post("/api/v1/beacons/pair").set(u.auth).send({ id, name: "Blue beacon" }).expect(201)).body as BeaconPairResponse;
}

const triund = { lat: 32.2559, lon: 76.3476 };
let seq = 0;
async function packet(p: BeaconPairResponse, kind: BeaconPacket["kind"], extra: Partial<BeaconPacket> = {}) {
  const buf = await encodePacket({ beaconId: p.beacon.id, kind, seq: ++seq, lat: triund.lat, lon: triund.lon, gpsTime: Date.now() - 1000, battery: 80, hopsLeft: 3, ...extra }, fromHex(p.keyHex)!);
  return toHex(buf);
}
const relay = async (packets: string[], relayId = "gateway-mcleodganj") =>
  ((await request(app).post("/api/v1/beacons/relay").send({ relayId, packets }).expect(200)).body as { results: RelayResult[] }).results;
const active = async (u: U) => (await request(app).get("/api/v1/sos/active").set(u.auth).expect(200)).body as SosIncidentDto | null;

describe("trusted contacts", () => {
  it("needs the contact's agreement, stores the number encrypted and caps the list", async () => {
    const u = await user();
    await request(app).post("/api/v1/contacts").set(u.auth).send({ name: "Maa", phone: "9876543210" }).expect(400);
    await request(app).post("/api/v1/contacts").set(u.auth).send({ name: "Maa", phone: "12345", theyAgreed: true }).expect(400);
    const list = await withContact(u);
    expect(list).toEqual([expect.objectContaining({ name: "Maa", phoneMasked: "+91 ••••• 210" })]);
    const row = await db.selectFrom("trusted_contacts").selectAll().executeTakeFirstOrThrow();
    expect(row.phone_enc).not.toContain("9876543210");
    for (let i = 0; i < 4; i++) await withContact(u, `98765432${10 + i}`);
    await request(app).post("/api/v1/contacts").set(u.auth).send({ name: "One more", phone: "9000000000", theyAgreed: true }).expect(409);
  });
});

describe("pairing", () => {
  it("issues a key once, and a beacon can't be taken over by another account", async () => {
    const a = await user();
    const b = await user();
    const p = await pair(a);
    expect(p.keyHex).toMatch(/^[0-9a-f]{32}$/);
    expect(p.serialCommand).toBe(`PAIR 0a1b2c3d ${p.keyHex}`);
    const stored = await db.selectFrom("beacons").select("key_enc").executeTakeFirstOrThrow();
    expect(stored.key_enc).not.toContain(p.keyHex);
    await request(app).post("/api/v1/beacons/pair").set(b.auth).send({ id: "0a1b2c3d" }).expect(409);
    await request(app).post("/api/v1/beacons/pair").set(a.auth).send({ id: "XYZ" }).expect(400);
    const mine = (await request(app).get("/api/v1/beacons").set(a.auth).expect(200)).body as unknown[];
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain(p.keyHex);
  });

  it("re-pairing rotates the key, so packets signed with the old key are rejected", async () => {
    const a = await user();
    const old = await pair(a);
    const fresh = (await request(app).post("/api/v1/beacons/pair").set(a.auth).send({ id: "0a1b2c3d" }).expect(200)).body as BeaconPairResponse;
    expect(fresh.keyHex).not.toBe(old.keyHex);
    expect((await relay([await packet(old, "ping")]))[0]).toMatchObject({ status: "rejected" });
    expect((await relay([await packet(fresh, "ping")]))[0]).toMatchObject({ status: "accepted" });
  });
});

describe("relay and SOS from a beacon", () => {
  it("raises one SOS, texts contacts once, de-duplicates hops and ends on cancel", async () => {
    const u = await user();
    await withContact(u);
    const p = await pair(u);

    const sosHex = await packet(p, "sos");
    // The same packet heard by three relays, one of them after a hop.
    const results = [...(await relay([sosHex])), ...(await relay([sosHex], "phone-1")), ...(await relay([toHex(forwardPacket(fromHex(sosHex)!)!)], "gw-2"))];
    expect(results.map((r) => r.status)).toEqual(["accepted", "duplicate", "duplicate"]);

    let inc = await active(u);
    expect(inc).toMatchObject({ status: "active", source: "beacon", beaconId: "0a1b2c3d", contactsNotified: 1 });
    expect(inc!.last).toMatchObject({ lat: triund.lat, lon: triund.lon, via: "beacon" });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.to).toBe("+919876543210");
    expect(sms.sent[0]!.body).toMatch(/pressed SOS on their beacon.*openstreetmap.*view=sos-status&token=.*112/s);
    expect(inc!.demoMessages).toHaveLength(1);

    // More SOS packets update the location but don't send more SMS.
    await relay([await packet(p, "sos", { lat: 32.26, lon: 76.35, battery: 61 })]);
    inc = await active(u);
    expect(inc!.last).toMatchObject({ lat: 32.26, lon: 76.35 });
    expect(sms.sent).toHaveLength(1);

    await relay([await packet(p, "cancel")]);
    expect(await active(u)).toBeNull();
    expect(sms.sent).toHaveLength(2);
    expect(sms.sent[1]!.body).toMatch(/marked themselves safe/);
  });

  it("rejects forged, tampered, replayed and unknown packets with one vague message", async () => {
    const u = await user();
    const p = await pair(u);
    const forged = await packet({ ...p, keyHex: "ff".repeat(16) }, "sos");
    const good = fromHex(await packet(p, "sos"))!;
    good[10] = good[10]! ^ 1; // move the location
    const unknown = await packet({ ...p, beacon: { ...p.beacon, id: "deadbeef" } }, "sos");
    const res = await relay([forged, toHex(good), unknown, "00ff"]);
    expect(res.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(res[0]!.reason).toBe(res[2]!.reason);
    expect(await active(u)).toBeNull();

    // A packet far behind the newest seq is a replay, even if the server never saw it.
    await relay([await packet(p, "ping", { seq: 500 })]);
    expect((await relay([await packet(p, "sos", { seq: 100 })]))[0]).toMatchObject({ status: "rejected", reason: expect.stringMatching(/replay/) });
  });

  it("ignores a cancel older than the SOS it would end", async () => {
    const u = await user();
    const p = await pair(u);
    const staleCancel = await packet(p, "cancel");
    await relay([await packet(p, "sos")]);
    await relay([staleCancel]);
    expect(await active(u)).not.toBeNull();
  });

  it("won't take 'beacon' points from the phone, or simulated points in production", async () => {
    const u = await user();
    const tripId = randomUUID();
    await request(app).put(`/api/v1/trips/${tripId}`).set(u.auth).send({ placeId: "triund", startDate: null, plannerInput: { budgetPerPerson: 9000, days: 2, month: 10, fitness: 1, groupSize: 1, vibes: [] } }).expect(201);
    await request(app).post(`/api/v1/trips/${tripId}/start`).set(u.auth).expect(200);
    const pts = [{ ts: Date.now(), lat: triund.lat, lon: triund.lon }];
    await request(app).post(`/api/v1/trips/${tripId}/points`).set(u.auth).send({ points: pts, source: "beacon" }).expect(400);

    const prod = createApp({ db, config: { ...config, env: "production" }, content, sms });
    await request(prod).post(`/api/v1/trips/${tripId}/points`).set(u.auth).send({ points: pts, source: "simulated" }).expect(400);
    await request(prod).post(`/api/v1/trips/${tripId}/points`).set(u.auth).send({ points: pts, source: "gps" }).expect(200);
  });

  it("adds beacon pings to an active trip's track", async () => {
    const u = await user();
    const p = await pair(u);
    const tripId = randomUUID();
    await request(app).put(`/api/v1/trips/${tripId}`).set(u.auth).send({ placeId: "triund", startDate: null, plannerInput: { budgetPerPerson: 9000, days: 2, month: 10, fitness: 1, groupSize: 1, vibes: [] } }).expect(201);
    await request(app).post(`/api/v1/trips/${tripId}/start`).set(u.auth).expect(200);
    await relay([await packet(p, "ping")]);
    const pts = await db.selectFrom("trip_points").selectAll().where("trip_id", "=", tripId).execute();
    expect(pts).toEqual([expect.objectContaining({ source: "beacon", lat: triund.lat })]);
    const b = (await request(app).get("/api/v1/beacons").set(u.auth)).body as { battery: number; last: unknown }[];
    expect(b[0]).toMatchObject({ battery: 80, last: expect.objectContaining({ lat: triund.lat }) });
  });
});

describe("SOS from the app and the contacts' status page", () => {
  it("is idempotent, shows a live page to contacts, and the link dies 72 h after it ends", async () => {
    const u = await user();
    await withContact(u);
    const tripId = randomUUID();
    await request(app).put(`/api/v1/trips/${tripId}`).set(u.auth).send({ placeId: "triund", startDate: "2026-10-24", plannerInput: { budgetPerPerson: 9000, days: 2, month: 10, fitness: 1, groupSize: 1, vibes: [] } }).expect(201);

    const id = randomUUID();
    const first = (await request(app).put(`/api/v1/sos/${id}`).set(u.auth).send({ point: triund, battery: 40 }).expect(201)).body as SosIncidentDto;
    await request(app).put(`/api/v1/sos/${id}`).set(u.auth).send({ point: { lat: 32.257, lon: 76.348 } }).expect(200);
    expect(sms.sent).toHaveLength(1);

    const token = new URL(first.statusUrl!).searchParams.get("token")!;
    const view = (await request(app).get(`/api/v1/sos/public/${token}`).expect(200)).body as SosPublicDto;
    expect(view).toMatchObject({ status: "active", battery: 40, trip: { placeId: "triund", placeName: "Triund", days: 2 } });
    expect(view.track).toHaveLength(2);
    expect(view.hospitals.length).toBeGreaterThan(0);
    expect(view.emergency.map((e) => e.number)).toContain("112");
    // Nothing that identifies the person beyond their display name.
    expect(JSON.stringify(view)).not.toMatch(/@example\.com|9876543210/);

    await request(app).post(`/api/v1/sos/${id}/cancel`).set(u.auth).expect(200);
    // A queued retry of the same request arriving late must not restart it.
    await request(app).put(`/api/v1/sos/${id}`).set(u.auth).send({ point: triund }).expect(200);
    expect(await active(u)).toBeNull();
    expect(((await request(app).get(`/api/v1/sos/public/${token}`).expect(200)).body as SosPublicDto).status).toBe("cancelled");

    await db.updateTable("sos_incidents").set({ ended_at: new Date(Date.now() - 73 * 3_600_000).toISOString() }).execute();
    await request(app).get(`/api/v1/sos/public/${token}`).expect(404);
    await request(app).get(`/api/v1/sos/public/${"x".repeat(32)}`).expect(404);
  });

  it("still opens an SOS with no contacts and no location", async () => {
    const u = await user();
    const inc = (await request(app).put(`/api/v1/sos/${randomUUID()}`).set(u.auth).send({}).expect(201)).body as SosIncidentDto;
    expect(inc).toMatchObject({ contactsNotified: 0, last: null });
  });

  it("deletes everything with the account and leaves the key out of the export", async () => {
    const u = await user();
    await withContact(u);
    const p = await pair(u);
    await relay([await packet(p, "sos")]);
    const exp = (await request(app).get("/api/v1/me/export").set(u.auth).expect(200)).text;
    expect(exp).toContain("sosIncidents");
    expect(exp).not.toContain(p.keyHex);
    await request(app).delete("/api/v1/me").set(u.auth).send({ password: "correct horse battery" }).expect(204);
    for (const t of ["beacons", "trusted_contacts", "sos_incidents", "sos_points", "beacon_events"] as const) {
      expect(await db.selectFrom(t).selectAll().execute()).toEqual([]);
    }
  });
});
