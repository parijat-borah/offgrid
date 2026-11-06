import { rank, type LeaderboardDto, type LeaderboardEntry, type LeaderboardMetric, type LeaderboardScope } from "@offgrid/core";
import { Router } from "express";
import { sql } from "kysely";
import { z } from "zod";
import type { Ctx } from "../../context";
import { parse } from "../../lib/errors";
import { seasonOf } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";

type Row = { userId: string; value: number };

/**
 * Monthly leaderboards. Only travellers who opted in appear (activity can reveal where someone is).
 * XP from trips that failed the fair-play checks (simulated GPS, overlapping tracks, too many in a day,
 * no GPS at all) is left off the boards, though it still counts towards the traveller's level.
 */
export function leaderboardRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  const cfg = ctx.content.challenges.leaderboard;
  const cache = new Map<string, { at: number; rows: Row[] }>();

  async function valuesFor(metric: LeaderboardMetric, season: string, regionOnly: boolean): Promise<Row[]> {
    const db = ctx.db;
    // Users with at least one counted trip in this region this season ("region" scope).
    const regionUsers = regionOnly
      ? new Set(
          (
            await db
              .selectFrom("trips")
              .select("owner_id")
              .where("status", "=", "completed")
              .where("leaderboard_eligible", "=", 1)
              .where("completed_at", "like", `${season}%`)
              .where("place_id", "in", ctx.content.planner.places.map((p) => p.id))
              .execute()
          ).map((t) => t.owner_id),
        )
      : null;

    let rows: Row[];
    if (metric === "xp") {
      const res = await db
        .selectFrom("xp_events")
        .leftJoin("trips", (j) => j.onRef("trips.id", "=", "xp_events.ref_id").on("xp_events.reason", "=", "trip_complete"))
        .select(["xp_events.user_id as userId", sql<number>`sum(xp_events.amount)`.as("value")])
        .where("xp_events.season", "=", season)
        // Trip XP counts only when that trip passed fair play; badges, places, challenges and streaks always count.
        .where((eb) => eb.or([eb("xp_events.reason", "!=", "trip_complete"), eb("trips.leaderboard_eligible", "=", 1)]))
        .groupBy("xp_events.user_id")
        .execute();
      rows = res.map((x) => ({ userId: x.userId, value: Number(x.value) }));
    } else if (metric === "km" || metric === "elevation") {
      const col = metric === "km" ? "distance_km" : "elevation_gain_m";
      const res = await db
        .selectFrom("trips")
        .select(["owner_id as userId", sql<number>`sum(${sql.ref(col)})`.as("value")])
        .where("status", "=", "completed")
        .where("leaderboard_eligible", "=", 1)
        .where("completed_at", "like", `${season}%`)
        .groupBy("owner_id")
        .execute();
      rows = res.map((x) => ({ userId: x.userId, value: metric === "km" ? Math.round(Number(x.value) * 10) / 10 : Math.round(Number(x.value)) }));
    } else {
      const res = await db
        .selectFrom("submissions")
        .select(["user_id as userId", sql<number>`count(*)`.as("value")])
        .where("status", "=", "verified")
        .where("updated_at", "like", `${season}%`)
        .groupBy("user_id")
        .execute();
      rows = res.map((x) => ({ userId: x.userId, value: Number(x.value) }));
    }
    rows = rows.filter((x) => x.value > 0);
    return regionUsers ? rows.filter((x) => regionUsers.has(x.userId)) : rows;
  }

  /** People you've actually connected with: accepted buddy chats that neither of you has blocked. */
  async function friendIds(userId: string): Promise<Set<string>> {
    const convs = await ctx.db
      .selectFrom("conversations")
      .select(["user_a", "user_b"])
      .where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
      .where("closed_at", "is", null)
      .execute();
    return new Set([userId, ...convs.map((c) => (c.user_a === userId ? c.user_b : c.user_a))]);
  }

  r.get("/seasons", (_req, res) => {
    const now = new Date();
    res.json(Array.from({ length: 6 }, (_, i) => seasonOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))));
  });

  r.get("/", limiter(ctx, 60), async (req, res) => {
    const q = parse(
      z.object({
        scope: z.enum(["global", "region", "friends"]).default("global"),
        metric: z.enum(["xp", "km", "elevation", "contributions"]).default("xp"),
        season: z.string().regex(/^\d{4}-\d{2}$/).default(seasonOf()),
      }),
      req.query,
    );
    const userId = userIdOf(res);
    const key = `${q.scope}:${q.metric}:${q.season}`;
    let rows: Row[];
    const hit = cache.get(key);
    if (q.scope !== "friends" && hit && Date.now() - hit.at < cfg.cache_seconds * 1000) rows = hit.rows;
    else {
      rows = await valuesFor(q.metric, q.season, q.scope === "region");
      if (q.scope !== "friends") cache.set(key, { at: Date.now(), rows });
    }

    const users = await ctx.db.selectFrom("users").select(["id", "display_name", "avatar", "level", "leaderboard_opt_in"]).execute();
    const byId = new Map(users.map((u) => [u.id, u]));
    const blocks = await ctx.db.selectFrom("blocks").select(["blocker_id", "blocked_id"]).where((eb) => eb.or([eb("blocker_id", "=", userId), eb("blocked_id", "=", userId)])).execute();
    const hidden = new Set(blocks.map((b) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)));
    const friends = q.scope === "friends" ? await friendIds(userId) : null;

    const visible = rows.filter((x) => byId.get(x.userId)?.leaderboard_opt_in === 1 && !hidden.has(x.userId) && (!friends || friends.has(x.userId)));
    const ranked = rank(visible, (x) => x.value, (x) => x.userId);
    const entries: LeaderboardEntry[] = ranked.slice(0, cfg.top_n).map((e) => {
      const u = byId.get(e.item.userId)!;
      return { rank: e.rank, userId: u.id, displayName: u.display_name, avatar: u.avatar, level: u.level, value: e.value, isMe: u.id === userId };
    });
    const mine = ranked.find((e) => e.item.userId === userId);
    const myValue = rows.find((x) => x.userId === userId)?.value ?? 0;

    const excluded = await ctx.db
      .selectFrom("trips")
      .select(["id", "fairplay_reasons"])
      .where("owner_id", "=", userId)
      .where("status", "=", "completed")
      .where("leaderboard_eligible", "=", 0)
      .where("completed_at", "like", `${q.season}%`)
      .execute();

    const body: LeaderboardDto = {
      scope: q.scope as LeaderboardScope,
      metric: q.metric as LeaderboardMetric,
      season: q.season,
      entries,
      me: { optedIn: byId.get(userId)?.leaderboard_opt_in === 1, rank: mine?.rank ?? null, value: myValue },
      excludedTrips: excluded.map((t) => ({ tripId: t.id, reasons: JSON.parse(t.fairplay_reasons) as string[] })).filter((t) => t.reasons.length > 0),
    };
    res.json(body);
  });

  return r;
}
