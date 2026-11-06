import { HAZARD_KINDS, haversineKm } from "@offgrid/core";
import { Router } from "express";
import { sql } from "kysely";
import { z } from "zod";
import type { Ctx } from "../../context";
import { badRequest, conflict, HttpError, notFound, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { optionalAuth, requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { syncXpAndBadges } from "../xp/service";
import { activeReports, reportDtos } from "./service";

const ReportSchema = z.object({
  kind: z.enum(HAZARD_KINDS),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  description: z.string().trim().min(10, "Say what you saw (at least 10 characters).").max(500),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const hours = (h: number) => h * 3_600_000;

/**
 * Traveller hazard reports: live the moment they're posted (a warning should never wait for
 * review), labelled unverified, and they expire on their own unless others confirm them.
 */
export function hazardRoutes(ctx: Ctx): Router {
  const r = Router();
  const rules = ctx.content.safety.hazard_reports;
  const region = ctx.content.planner.region;

  r.get("/", optionalAuth(ctx), async (req, res) => {
    const q = parse(
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
        radius_km: z.coerce.number().min(0.5).max(200).default(25),
      }),
      req.query,
    );
    const rows = (await activeReports(ctx.db, region.id)).filter((h) => haversineKm(q, h) <= q.radius_km);
    res.json(await reportDtos(ctx.db, rows, res.locals.userId as string | undefined));
  });

  // Idempotent by client UUID so a report made with no signal can sit in the outbox and retry.
  r.put("/:id", requireAuth(ctx), limiter(ctx, 20), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const body = parse(ReportSchema, req.body);
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    if (body.lon < minLon || body.lon > maxLon || body.lat < minLat || body.lat > maxLat) {
      throw badRequest(`That location is outside ${region.name}.`, { lat: "Outside the region" });
    }
    const userId = userIdOf(res);
    const existing = await ctx.db.selectFrom("hazard_reports").select("user_id").where("id", "=", id).executeTakeFirst();
    if (existing) {
      if (existing.user_id !== userId) throw badRequest("Report id already in use.");
      const [row] = await reportDtos(ctx.db, [await ctx.db.selectFrom("hazard_reports").selectAll().where("id", "=", id).executeTakeFirstOrThrow()], userId);
      res.json(row);
      return;
    }
    const today = await ctx.db
      .selectFrom("hazard_reports")
      .select(sql<number>`count(*)`.as("n"))
      .where("user_id", "=", userId)
      .where("created_at", ">=", new Date(Date.now() - 86_400_000).toISOString())
      .executeTakeFirstOrThrow();
    if (Number(today.n) >= rules.reports_per_day) throw new HttpError(429, "RATE_LIMITED", "That's a lot of reports today. Thanks for looking out for everyone!");

    const now = Date.now();
    await ctx.db
      .insertInto("hazard_reports")
      .values({
        id,
        user_id: userId,
        region_id: region.id,
        kind: body.kind,
        severity: body.severity,
        description: body.description,
        lat: body.lat,
        lon: body.lon,
        radius_m: rules.radius_m,
        status: "active",
        confirmations: 0,
        clears: 0,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + hours(rules.default_ttl_hours[body.kind])).toISOString(),
      })
      .execute();
    const [row] = await reportDtos(ctx.db, [await ctx.db.selectFrom("hazard_reports").selectAll().where("id", "=", id).executeTakeFirstOrThrow()], userId);
    res.status(201).json(row);
  });

  // "Still there" extends the report; "it's gone" clears it after enough people agree.
  r.post("/:id/:action", requireAuth(ctx), limiter(ctx, 60), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const action = parse(z.enum(["confirm", "clear"]), req.params.action);
    const userId = userIdOf(res);
    await ctx.db.transaction().execute(async (trx) => {
      const report = await trx.selectFrom("hazard_reports").selectAll().where("id", "=", id).executeTakeFirst();
      if (!report) throw notFound("Report not found.");
      const now = Date.now();
      if (report.status !== "active" || Date.parse(report.expires_at) <= now) throw conflict("This report has already expired.");
      const own = report.user_id === userId;
      if (own && action === "confirm") throw conflict("You can't confirm your own report.");

      const previous = await trx.selectFrom("hazard_actions").select("action").where("report_id", "=", id).where("user_id", "=", userId).executeTakeFirst();
      if (previous?.action === action) return;
      await trx
        .insertInto("hazard_actions")
        .values({ report_id: id, user_id: userId, action, created_at: nowIso() })
        .onConflict((oc) => oc.columns(["report_id", "user_id"]).doUpdateSet({ action, created_at: nowIso() }))
        .execute();

      const confirmations = report.confirmations + (action === "confirm" ? 1 : 0) - (previous?.action === "confirm" ? 1 : 0);
      const clears = report.clears + (action === "clear" ? 1 : 0) - (previous?.action === "clear" ? 1 : 0);
      // Confirmations push expiry out, but never beyond the cap from the original report time.
      const cap = Date.parse(report.created_at) + hours(rules.max_ttl_hours);
      const extended = action === "confirm" ? Math.min(cap, Math.max(Date.parse(report.expires_at), now) + hours(rules.confirm_extends_hours)) : Date.parse(report.expires_at);
      const cleared = (own && action === "clear") || clears >= rules.clears_to_expire;
      await trx
        .updateTable("hazard_reports")
        .set({
          confirmations,
          clears,
          status: cleared ? "cleared" : "active",
          expires_at: new Date(cleared ? now : extended).toISOString(),
        })
        .where("id", "=", id)
        .execute();
    });
    // Helping keep warnings accurate counts toward the monthly "Trail guardian" challenge.
    await ctx.db.transaction().execute((trx) => syncXpAndBadges(trx, ctx, userId, nowIso()));
    const row = await ctx.db.selectFrom("hazard_reports").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    res.json((await reportDtos(ctx.db, [row], userId))[0]);
  });

  return r;
}
