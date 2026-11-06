import {
  challengeProgress,
  computeStats,
  isTrek,
  levelForXp,
  newlyEarned,
  streakMonths,
  streakXp,
  type Badge,
  type CompletedTrip,
  type SeasonMetric,
  type Validation,
} from "@offgrid/core";
import { sql } from "kysely";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import { newId } from "../../lib/crypto";
import { seasonOf } from "../../lib/time";
import { trustFor } from "../verification/service";

export async function completedTrips(db: Db, userId: string): Promise<CompletedTrip[]> {
  const rows = await db
    .selectFrom("trips")
    .select(["place_id", "validation", "distance_km", "actual_spend_pp", "completed_at"])
    .where("owner_id", "=", userId)
    .where("status", "=", "completed")
    .execute();
  return rows.map((r) => ({
    placeId: r.place_id,
    validation: (r.validation ?? "manual") as Validation,
    distanceKm: r.distance_km,
    actualSpendPp: r.actual_spend_pp,
    completedAt: r.completed_at ?? "",
  }));
}

export async function contributionsVerified(db: Db, userId: string): Promise<number> {
  const row = await db
    .selectFrom("submissions")
    .select(sql<number>`count(*)`.as("n"))
    .where("user_id", "=", userId)
    .where("status", "=", "verified")
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Trust 0–100 from verifications, GPS-verified trips and upheld reports. */
export async function userTrust(db: Db, userId: string): Promise<number> {
  return (await trustFor(db, userId)).score;
}

/** This month's numbers for challenges. Season = "YYYY-MM" (UTC), the same key the XP ledger uses. */
export async function seasonMetrics(db: Db, ctx: Ctx, userId: string, season: string): Promise<Record<SeasonMetric, number>> {
  const verified = await db
    .selectFrom("trips")
    .select(["place_id"])
    .where("owner_id", "=", userId)
    .where("status", "=", "completed")
    .where("validation", "=", "verified")
    // Challenges feed the XP leaderboard, so they use the same fair-play bar (no simulated or overlapping tracks).
    .where("leaderboard_eligible", "=", 1)
    .where("completed_at", "like", `${season}%`)
    .execute();
  const contributions = await db
    .selectFrom("submissions")
    .select(sql<number>`count(*)`.as("n"))
    .where("user_id", "=", userId)
    .where("status", "=", "verified")
    .where("updated_at", "like", `${season}%`)
    .executeTakeFirstOrThrow();
  const hazardActions = await db
    .selectFrom("hazard_actions")
    .select(sql<number>`count(*)`.as("n"))
    .where("user_id", "=", userId)
    .where("created_at", "like", `${season}%`)
    .executeTakeFirstOrThrow();
  return {
    season_verified_trips: verified.length,
    season_verified_treks: verified.filter((t) => {
      const p = ctx.content.place(t.place_id);
      return p ? isTrek(p) : false;
    }).length,
    season_contributions: Number(contributions.n),
    season_hazard_actions: Number(hazardActions.n),
  };
}

/** Months ("YYYY-MM") in which the user completed a GPS-verified trip that passed fair play. */
export async function verifiedMonths(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom("trips")
    .select(sql<string>`substr(completed_at, 1, 7)`.as("m"))
    .where("owner_id", "=", userId)
    .where("status", "=", "completed")
    .where("validation", "=", "verified")
    .where("leaderboard_eligible", "=", 1)
    .groupBy(sql`substr(completed_at, 1, 7)`)
    .execute();
  return new Set(rows.map((r) => r.m));
}

/** Pay challenge and streak XP for the current month. Unique ledger keys make it safe to call any number of times. */
async function payChallengesAndStreak(trx: Db, ctx: Ctx, userId: string, now: string) {
  const season = seasonOf(new Date(now));
  const metrics = await seasonMetrics(trx, ctx, userId, season);
  const pay = async (reason: string, ref: string, amount: number) => {
    if (amount <= 0) return;
    await trx
      .insertInto("xp_events")
      .values({ id: newId(), user_id: userId, amount, reason, ref_id: ref, season, created_at: now })
      .onConflict((oc) => oc.columns(["user_id", "reason", "ref_id"]).doNothing())
      .execute();
  };
  for (const c of challengeProgress(ctx.content.challenges, metrics)) {
    if (c.done) await pay("challenge", `${c.id}:${season}`, c.xp);
  }
  // A streak is two or more consecutive months with a verified trip; the bonus grows with it, up to a cap.
  const months = streakMonths(await verifiedMonths(trx, userId), season);
  if (months >= 2) await pay("streak", season, streakXp(months, ctx.content.challenges));
}

/**
 * Re-evaluate badges from current stats, pay any new badge XP, then recompute the cached
 * XP and level from the ledger. Call it inside the same transaction as whatever changed the stats.
 */
export async function syncXpAndBadges(trx: Db, ctx: Ctx, userId: string, now: string): Promise<Badge[]> {
  const { game, planner } = ctx.content;
  await payChallengesAndStreak(trx, ctx, userId, now);
  const stats = computeStats(await completedTrips(trx, userId), planner.places, ctx.content.stateOf, await contributionsVerified(trx, userId));
  const held = await trx.selectFrom("user_badges").select("badge_id").where("user_id", "=", userId).execute();
  const earned = newlyEarned(game.badges, stats.metrics, held.map((h) => h.badge_id));
  for (const badge of earned) {
    await trx.insertInto("user_badges").values({ user_id: userId, badge_id: badge.id, awarded_at: now }).execute();
    if (badge.xp > 0) {
      await trx
        .insertInto("xp_events")
        .values({ id: newId(), user_id: userId, amount: badge.xp, reason: "badge", ref_id: badge.id, season: seasonOf(), created_at: now })
        .execute();
    }
  }
  const total = await trx
    .selectFrom("xp_events")
    .select(sql<number>`coalesce(sum(amount), 0)`.as("xp"))
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  const xp = Math.max(0, Number(total.xp));
  await trx.updateTable("users").set({ xp, level: levelForXp(xp, game.xp), updated_at: now }).where("id", "=", userId).execute();
  return earned;
}

/**
 * Bring the net contribution XP for one submission to `target` (the award, or 0 if it's later
 * rejected). The ledger stays append-only: corrections are new rows, never edits.
 */
export async function setContributionXp(trx: Db, userId: string, submissionId: string, target: number, now: string) {
  const net = await trx
    .selectFrom("xp_events")
    .select(sql<number>`coalesce(sum(amount), 0)`.as("n"))
    .where("user_id", "=", userId)
    .where("reason", "in", ["contribution_verified", "contribution_revoked"])
    .where("ref_id", "like", `${submissionId}:%`)
    .executeTakeFirstOrThrow();
  const delta = target - Number(net.n);
  if (delta === 0) return;
  await trx
    .insertInto("xp_events")
    .values({
      id: newId(),
      user_id: userId,
      amount: delta,
      reason: delta > 0 ? "contribution_verified" : "contribution_revoked",
      ref_id: `${submissionId}:${now}`,
      season: seasonOf(),
      created_at: now,
    })
    .execute();
}
