import { fuzzLocation, haversineKm, POI_CATEGORIES, POI_TAGS, voteWeight, type SubmitResponse, type VoteResponse } from "@offgrid/core";
import { Router } from "express";
import { sql } from "kysely";
import multer from "multer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Ctx } from "../../context";
import { badRequest, conflict, HttpError, notFound, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { userTrust } from "../xp/service";
import { dtos, duplicateCheck, photoUrl, retally } from "./service";

const Id = z.uuid();
const Month = z.number().int().min(1).max(12);
const MAX_PHOTOS = 3;
const FLAG_REASONS = ["not_real", "wrong_location", "unsafe", "private_property", "fragile_or_sacred", "duplicate", "other"] as const;

const SubmitSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters.").max(80),
  // Events come from curated data; travellers add places.
  category: z.enum(POI_CATEGORIES).exclude(["event"]),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  tips: z.string().trim().max(1000).default(""),
  tags: z.array(z.enum(POI_TAGS)).max(6).default([]),
  seasonality: z.array(Month).max(12).nullable().default(null),
  priceBand: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
  approximate: z.boolean().default(false),
});

const VoteSchema = z
  .object({ value: z.union([z.literal(1), z.literal(-1)]), reason: z.enum(FLAG_REASONS).optional() })
  .refine((v) => v.value === 1 || v.reason, { message: "Say why you're flagging it.", path: ["reason"] });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("photo");

export function submissionRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  const { moderation, planner } = ctx.content;

  r.get("/mine", async (_req, res) => {
    const rows = await ctx.db.selectFrom("submissions").selectAll().where("user_id", "=", userIdOf(res)).orderBy("created_at", "desc").execute();
    res.json(await dtos(ctx.db, rows, userIdOf(res)));
  });

  // Places waiting for community review near a point (never your own: you can't vote on those).
  r.get("/", async (req, res) => {
    const q = parse(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
        radius_km: z.coerce.number().min(0.5).max(100).default(25),
      }),
      req.query,
    );
    const rows = await ctx.db
      .selectFrom("submissions")
      .selectAll()
      .where("status", "=", "pending")
      .where("user_id", "!=", userIdOf(res))
      .orderBy("created_at", "desc")
      .limit(500)
      .execute();
    const near = rows.filter((r) => haversineKm(q, { lat: r.public_lat, lon: r.public_lon }) <= q.radius_km).slice(0, 50);
    res.json(await dtos(ctx.db, near, userIdOf(res)));
  });

  // Idempotent create/update keyed by the client's UUID, so the offline outbox can retry safely.
  r.put("/:id", limiter(ctx, 30), async (req, res) => {
    const id = parse(Id, req.params.id);
    const body = parse(SubmitSchema, req.body);
    const [minLon, minLat, maxLon, maxLat] = planner.region.bbox;
    if (body.lon < minLon || body.lon > maxLon || body.lat < minLat || body.lat > maxLat) {
      throw badRequest(`That pin is outside ${planner.region.name}.`, { lat: "Outside the region" });
    }
    const userId = userIdOf(res);
    const existing = await ctx.db.selectFrom("submissions").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
    if (existing && existing.user_id !== userId) throw badRequest("Submission id already in use.");
    if (existing && existing.status !== "pending" && existing.status !== "duplicate") throw conflict("Only pending submissions can be edited.");

    if (!existing) {
      const today = await ctx.db
        .selectFrom("submissions")
        .select(sql<number>`count(*)`.as("n"))
        .where("user_id", "=", userId)
        .where("created_at", ">=", new Date(Date.now() - 86_400_000).toISOString())
        .executeTakeFirstOrThrow();
      if (Number(today.n) >= moderation.submissions_per_day) {
        throw new HttpError(429, "RATE_LIMITED", `You can add up to ${moderation.submissions_per_day} places a day. Thanks for contributing!`);
      }
    }

    const dups = await duplicateCheck(ctx, { id, name: body.name, lat: body.lat, lon: body.lon, region_id: planner.region.id });
    const certain = dups.find((d) => d.certain);
    const pub = body.approximate ? fuzzLocation(body, moderation.approx_grid_deg) : { lat: body.lat, lon: body.lon };
    const now = nowIso();
    const values = {
      name: body.name,
      category: body.category,
      lat: body.lat,
      lon: body.lon,
      public_lat: pub.lat,
      public_lon: pub.lon,
      approximate: body.approximate ? 1 : 0,
      tips: body.tips,
      tags: JSON.stringify([...new Set(body.tags)]),
      seasonality: body.seasonality?.length ? JSON.stringify([...new Set(body.seasonality)].sort((a, b) => a - b)) : null,
      price_band: body.priceBand,
      status: certain ? "duplicate" : "pending",
      duplicate_of: certain?.id ?? null,
      duplicate_candidates: JSON.stringify(dups.slice(0, 5)),
      updated_at: now,
    };
    if (existing) await ctx.db.updateTable("submissions").set(values).where("id", "=", id).execute();
    else
      await ctx.db
        .insertInto("submissions")
        .values({ id, user_id: userId, region_id: planner.region.id, ...values, score: 0, upvotes: 0, flags: 0, reviewed_by: null, reviewed_at: null, review_note: null, created_at: now })
        .execute();

    const row = await ctx.db.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const body2: SubmitResponse = { submission: (await dtos(ctx.db, [row], userId))[0]!, possibleDuplicates: dups };
    res.status(existing ? 200 : 201).json(body2);
  });

  // Photos are re-encoded server-side: this strips EXIF (including GPS, which would leak the exact
  // location of an "approximate" place), defeats polyglot files, and caps size for slow connections.
  r.put("/:id/photos/:photoId", limiter(ctx, 20), upload, async (req, res) => {
    const id = parse(Id, req.params.id);
    const photoId = parse(Id, req.params.photoId);
    const sub = await ctx.db.selectFrom("submissions").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
    if (!sub || sub.user_id !== userIdOf(res)) throw notFound("Submission not found.");
    if (sub.status !== "pending") throw conflict("Photos can only be added while the place is pending.");

    const existing = await ctx.db.selectFrom("submission_photos").select("file").where("id", "=", photoId).executeTakeFirst();
    if (existing) {
      res.json({ url: photoUrl(existing.file) });
      return;
    }
    const count = await ctx.db.selectFrom("submission_photos").select(sql<number>`count(*)`.as("n")).where("submission_id", "=", id).executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_PHOTOS) throw conflict(`Up to ${MAX_PHOTOS} photos per place.`);
    if (!req.file) throw badRequest("Attach an image as the 'photo' field.", { photo: "Missing" });

    let output: { data: Buffer; info: sharp.OutputInfo };
    try {
      const meta = await sharp(req.file.buffer).metadata();
      if (!meta.format || !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format)) throw new Error("format");
      output = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw badRequest("That file isn't a supported image (JPEG, PNG, WebP or HEIC).", { photo: "Not an image" });
    }
    await mkdir(ctx.config.uploadDir, { recursive: true });
    const file = `${photoId}.webp`;
    await writeFile(join(ctx.config.uploadDir, file), output.data);
    await ctx.db
      .insertInto("submission_photos")
      .values({ id: photoId, submission_id: id, file, width: output.info.width, height: output.info.height, created_at: nowIso() })
      .execute();
    res.status(201).json({ url: photoUrl(file) });
  });

  r.delete("/:id", async (req, res) => {
    const id = parse(Id, req.params.id);
    const sub = await ctx.db.selectFrom("submissions").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
    if (!sub || sub.user_id !== userIdOf(res)) throw notFound("Submission not found.");
    if (sub.status !== "pending" && sub.status !== "duplicate") throw conflict("Only pending places can be withdrawn.");
    await ctx.db.updateTable("submissions").set({ status: "withdrawn", updated_at: nowIso() }).where("id", "=", id).execute();
    res.status(204).end();
  });

  r.post("/:id/vote", limiter(ctx, 60), async (req, res) => {
    const id = parse(Id, req.params.id);
    const body = parse(VoteSchema, req.body);
    const userId = userIdOf(res);
    const sub = await ctx.db.selectFrom("submissions").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
    if (!sub) throw notFound("Submission not found.");
    if (sub.user_id === userId) throw conflict("You can't vote on your own place.");
    if (sub.status !== "pending" && sub.status !== "verified") throw conflict("This place isn't open for votes.");

    const weight = voteWeight(await userTrust(ctx.db, userId), moderation);
    let transitioned: VoteResponse["transitioned"] = null;
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("submission_votes")
        .values({ submission_id: id, user_id: userId, value: body.value, weight, reason: body.reason ?? null, created_at: nowIso() })
        .onConflict((oc) => oc.columns(["submission_id", "user_id"]).doUpdateSet({ value: body.value, weight, reason: body.reason ?? null }))
        .execute();
      transitioned = await retally(trx, ctx, id);
    });
    const row = await ctx.db.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    const out: VoteResponse = { submission: (await dtos(ctx.db, [row], userId))[0]!, transitioned };
    res.json(out);
  });

  return r;
}
