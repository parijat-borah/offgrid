import { parseRegionPack, type AuthResponse, type Me, type ModerationItem, type SubmissionDto, type SubmitResponse, type VoteResponse } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadContent } from "../src/content";
import { openDb, type Db } from "../src/db";
import { loadConfig } from "../src/env";

const content = loadContent();
const config = {
  ...loadConfig({ NODE_ENV: "test", JWT_ACCESS_SECRET: randomBytes(48).toString("base64"), PII_ENCRYPTION_KEY: randomBytes(32).toString("base64") }),
  uploadDir: mkdtempSync(join(tmpdir(), "offgrid-uploads-")),
};

let db: Db;
let app: ReturnType<typeof createApp>;
let n = 0;

beforeEach(async () => {
  db = await openDb(":memory:");
  app = createApp({ db, config, content });
});

async function user(role?: "moderator") {
  const res = await request(app)
    .post("/api/v1/auth/signup")
    .send({ email: `u${++n}@example.com`, password: "correct horse battery", displayName: `User ${n}`, birthYear: 2000, acceptTerms: true, confirmAdult: true })
    .expect(201);
  const body = res.body as AuthResponse;
  if (role) await db.updateTable("users").set({ role }).where("id", "=", body.me.id).execute();
  return { id: body.me.id, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

// A quiet spot near Triund, far from any OSM point with a similar name.
const SPOT = { name: "Hidden Waterfall Pool", category: "viewpoint", lat: 32.2601, lon: 76.3511, tips: "Follow the stream 200 m past the last chai shop." };

async function submit(auth: Record<string, string>, body: object = SPOT) {
  const id = randomUUID();
  const res = await request(app).put(`/api/v1/submissions/${id}`).set(auth).send(body);
  return { id, res };
}

describe("region pack", () => {
  it("serves a valid offline pack with real OSM points and supports ETag revalidation", async () => {
    const res = await request(app).get("/api/v1/regions/himachal/pack").expect(200);
    const pack = parseRegionPack(res.body);
    expect(pack.pois.length).toBeGreaterThan(800);
    expect(pack.pois.some((p) => p.source === "osm")).toBe(true);
    expect(pack.planner.places.length).toBeGreaterThanOrEqual(20);
    const etag = res.headers.etag!;
    await request(app).get("/api/v1/regions/himachal/pack").set("If-None-Match", etag).expect(304);
  });

  it("gzips the pack", async () => {
    const res = await request(app).get("/api/v1/regions/himachal/pack").set("Accept-Encoding", "gzip").expect(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });
});

describe("submitting hidden places", () => {
  it("creates a pending place, idempotently", async () => {
    const a = await user();
    const { id, res } = await submit(a.auth);
    expect(res.status).toBe(201);
    const body = res.body as SubmitResponse;
    expect(body.submission.status).toBe("pending");
    expect(body.possibleDuplicates).toEqual([]);
    const again = await request(app).put(`/api/v1/submissions/${id}`).set(a.auth).send({ ...SPOT, tips: "Updated tip" }).expect(200);
    expect((again.body as SubmitResponse).submission.tips).toBe("Updated tip");
  });

  it("marks a near-identical copy of a known place as a duplicate", async () => {
    const a = await user();
    const known = content.pois.find((p) => p.source === "osm" && p.category === "food" && p.name.length > 6)!;
    const { res } = await submit(a.auth, { name: known.name, category: "food", lat: known.lat + 0.0002, lon: known.lon });
    const body = res.body as SubmitResponse;
    expect(body.submission.status).toBe("duplicate");
    expect(body.possibleDuplicates[0]!.id).toBe(known.id);
  });

  it("rejects pins outside the region and bad input", async () => {
    const a = await user();
    expect((await submit(a.auth, { ...SPOT, lat: 28.6, lon: 77.2 })).res.status).toBe(400); // Delhi
    expect((await submit(a.auth, { ...SPOT, category: "event" })).res.status).toBe(400);
    expect((await submit(a.auth, { ...SPOT, name: "x" })).res.status).toBe(400);
  });

  it("hides the exact location of approximate places from everyone but the contributor", async () => {
    const a = await user();
    const b = await user();
    const { res } = await submit(a.auth, { ...SPOT, approximate: true });
    const mine = (res.body as SubmitResponse).submission;
    expect(mine.lat).toBe(SPOT.lat);
    const list = await request(app).get(`/api/v1/submissions?lat=${SPOT.lat}&lon=${SPOT.lon}`).set(b.auth).expect(200);
    const seen = (list.body as SubmissionDto[])[0]!;
    expect(seen.approximate).toBe(true);
    expect(seen.lat).not.toBe(SPOT.lat);
    expect(Math.abs(seen.lat - SPOT.lat)).toBeLessThan(0.02);
  });

  it("limits submissions per day", async () => {
    const a = await user();
    for (let i = 0; i < 5; i++) expect((await submit(a.auth, { ...SPOT, name: `Spot number ${i}`, lat: SPOT.lat + i * 0.01 })).res.status).toBe(201);
    expect((await submit(a.auth, { ...SPOT, name: "One too many", lat: 32.1 })).res.status).toBe(429);
  });

  it("lets the contributor withdraw a pending place", async () => {
    const a = await user();
    const { id } = await submit(a.auth);
    await request(app).delete(`/api/v1/submissions/${id}`).set(a.auth).expect(204);
    const mine = await request(app).get("/api/v1/submissions/mine").set(a.auth).expect(200);
    expect((mine.body as SubmissionDto[])[0]!.status).toBe("withdrawn");
  });
});

describe("photos", () => {
  it("re-encodes to WebP and strips EXIF metadata", async () => {
    const a = await user();
    const { id } = await submit(a.auth);
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 30, g: 120, b: 80 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-gps-would-be-here" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const photoId = randomUUID();
    const up = await request(app).put(`/api/v1/submissions/${id}/photos/${photoId}`).set(a.auth).attach("photo", jpeg, { filename: "p.jpg", contentType: "image/jpeg" }).expect(201);
    const file = await request(app).get(up.body.url as string).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(1600);

    // Retrying the same photo id is harmless.
    await request(app).put(`/api/v1/submissions/${id}/photos/${photoId}`).set(a.auth).attach("photo", jpeg, "p.jpg").expect(200);
  });

  it("rejects files that aren't images, and caps photos per place", async () => {
    const a = await user();
    const { id } = await submit(a.auth);
    await request(app).put(`/api/v1/submissions/${id}/photos/${randomUUID()}`).set(a.auth).attach("photo", Buffer.from("<script>alert(1)</script>"), "evil.jpg").expect(400);
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ffffff" } }).png().toBuffer();
    for (let i = 0; i < 3; i++) await request(app).put(`/api/v1/submissions/${id}/photos/${randomUUID()}`).set(a.auth).attach("photo", png, "a.png").expect(201);
    await request(app).put(`/api/v1/submissions/${id}/photos/${randomUUID()}`).set(a.auth).attach("photo", png, "a.png").expect(409);
  });

  it("only lets the contributor add photos", async () => {
    const a = await user();
    const b = await user();
    const { id } = await submit(a.auth);
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ffffff" } }).png().toBuffer();
    await request(app).put(`/api/v1/submissions/${id}/photos/${randomUUID()}`).set(b.auth).attach("photo", png, "a.png").expect(404);
  });
});

describe("community verification", () => {
  it("verifies after enough weighted upvotes, pays XP and unlocks Explorer, and publishes it in the pack", async () => {
    const owner = await user();
    const { id } = await submit(owner.auth);

    await request(app).post(`/api/v1/submissions/${id}/vote`).set(owner.auth).send({ value: 1 }).expect(409);

    // New accounts weigh 0.3 each; 2.0 is needed, so the 7th upvote verifies it.
    let last: VoteResponse | null = null;
    for (let i = 0; i < 7; i++) {
      const v = await user();
      last = (await request(app).post(`/api/v1/submissions/${id}/vote`).set(v.auth).send({ value: 1 }).expect(200)).body as VoteResponse;
      if (i < 6) expect(last.transitioned).toBeNull();
    }
    expect(last!.transitioned).toBe("verified");

    const me = (await request(app).get("/api/v1/me").set(owner.auth).expect(200)).body as Me;
    expect(me.badges.find((b) => b.id === "explorer")?.earned).toBe(true);
    // 50 contribution XP + 50 Explorer badge XP + 30 "Local knowledge" monthly challenge.
    expect(me.level.xp).toBe(130);

    const pack = parseRegionPack((await request(app).get("/api/v1/regions/himachal/pack").expect(200)).body);
    expect(pack.pois.find((p) => p.id === `community-${id}`)?.source).toBe("community");
  });

  it("requires a reason to flag, and flags send a place to moderators and revoke contribution XP", async () => {
    const owner = await user();
    const { id } = await submit(owner.auth);
    const v1 = await user();
    await request(app).post(`/api/v1/submissions/${id}/vote`).set(v1.auth).send({ value: -1 }).expect(400);
    await request(app).post(`/api/v1/submissions/${id}/vote`).set(v1.auth).send({ value: -1, reason: "not_real" }).expect(200);
    const v2 = await user();
    const res = await request(app).post(`/api/v1/submissions/${id}/vote`).set(v2.auth).send({ value: -1, reason: "unsafe" }).expect(200);
    expect((res.body as VoteResponse).transitioned).toBe("flagged");
    // Flagged places can't be voted on until a moderator decides.
    const v3 = await user();
    await request(app).post(`/api/v1/submissions/${id}/vote`).set(v3.auth).send({ value: 1 }).expect(409);
  });
});

describe("moderation", () => {
  it("is for moderators only", async () => {
    const a = await user();
    await request(app).get("/api/v1/moderation/queue").set(a.auth).expect(403);
  });

  it("shows flagged items first with exact locations, and approves or rejects with XP settled", async () => {
    const owner = await user();
    const mod = await user("moderator");
    const { id: first } = await submit(owner.auth, { ...SPOT, approximate: true });
    const { id: second } = await submit(owner.auth, { ...SPOT, name: "Old stone bridge", lat: 32.27 });
    for (let i = 0; i < 2; i++) await request(app).post(`/api/v1/submissions/${second}/vote`).set((await user()).auth).send({ value: -1, reason: "wrong_location" });

    const queue = (await request(app).get("/api/v1/moderation/queue").set(mod.auth).expect(200)).body as ModerationItem[];
    expect(queue.map((q) => q.id)).toEqual([second, first]);
    expect(queue[1]!.exactLat).toBe(SPOT.lat);
    expect(queue[0]!.votes).toHaveLength(2);

    await request(app).post(`/api/v1/moderation/submissions/${first}`).set(mod.auth).send({ action: "approve", note: "Checked on the ground" }).expect(200);
    let me = (await request(app).get("/api/v1/me").set(owner.auth)).body as Me;
    expect(me.level.xp).toBe(130);

    await request(app).post(`/api/v1/moderation/submissions/${first}`).set(mod.auth).send({ action: "reject", note: "Turned out to be private land" }).expect(200);
    me = (await request(app).get("/api/v1/me").set(owner.auth)).body as Me;
    // Contribution XP is revoked; the Explorer badge and the month's challenge (already paid) stay.
    expect(me.level.xp).toBe(80);

    await request(app).post(`/api/v1/moderation/submissions/${second}`).set(mod.auth).send({ action: "duplicate" }).expect(400);
  });

  it("stops moderators from approving their own places", async () => {
    const mod = await user("moderator");
    const { id } = await submit(mod.auth);
    await request(app).post(`/api/v1/moderation/submissions/${id}`).set(mod.auth).send({ action: "approve" }).expect(403);
  });
});
