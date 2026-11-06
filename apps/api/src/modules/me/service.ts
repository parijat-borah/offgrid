import {
  challengeProgress,
  streakMonths,
  badgeProgress,
  computeStats,
  levelProgress,
  nextStage,
  nudges,
  stageForLevel,
  type Avatar,
  type Gender,
  type Me,
  type MascotSpecies,
  type TravelStyle,
} from "@offgrid/core";
import type { Ctx } from "../../context";
import { decrypt } from "../../lib/crypto";
import { unauthorized } from "../../lib/errors";
import { trustFor, verificationStatuses } from "../verification/service";
import { seasonOf } from "../../lib/time";
import { completedTrips, contributionsVerified, seasonMetrics, verifiedMonths } from "../xp/service";

/** The full profile: stored fields plus everything derived (level, mascot stage, stats, badges, nudges). */
export async function buildMe(ctx: Ctx, userId: string): Promise<Me> {
  const user = await ctx.db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
  // A valid token for a deleted account is treated as logged out.
  if (!user) throw unauthorized();

  const { game, planner } = ctx.content;
  const trips = await completedTrips(ctx.db, userId);
  const held = await ctx.db.selectFrom("user_badges").selectAll().where("user_id", "=", userId).execute();
  const awardedAt = new Map(held.map((b) => [b.badge_id, b.awarded_at]));
  const stats = computeStats(trips, planner.places, ctx.content.stateOf, await contributionsVerified(ctx.db, userId));
  const level = levelProgress(user.xp, game.xp);
  const { metrics, ...statsView } = stats;
  const trust = await trustFor(ctx.db, userId);

  return {
    id: user.id,
    email: user.email,
    role: user.role as Me["role"],
    trust: trust.score,
    trustParts: trust.parts,
    gender: user.gender as Gender,
    genderVerified: user.gender_verified === 1,
    travellerType: user.traveller_type,
    verifications: await verificationStatuses(ctx.db, userId),
    challenges: challengeProgress(ctx.content.challenges, await seasonMetrics(ctx.db, ctx, userId, seasonOf())),
    streakMonths: streakMonths(await verifiedMonths(ctx.db, userId), seasonOf()),
    birthYear: Number(decrypt(user.birth_year_enc, ctx.config.piiKey)),
    createdAt: user.created_at,
    displayName: user.display_name,
    avatar: user.avatar as Avatar,
    bio: user.bio,
    homeCity: user.home_city,
    styleTags: JSON.parse(user.style_tags) as TravelStyle[],
    mascotSpecies: user.mascot_species as MascotSpecies,
    fitnessLevel: user.fitness_level as 1 | 2 | 3,
    leaderboardOptIn: user.leaderboard_opt_in === 1,
    level,
    stage: stageForLevel(game.mascots.stages, level.level),
    nextStage: nextStage(game.mascots.stages, level.level),
    stats: statsView,
    badges: badgeProgress(game.badges, metrics, awardedAt.keys()).map((p) => ({
      ...p.badge,
      earned: p.earned,
      awardedAt: awardedAt.get(p.badge.id) ?? null,
      progress: p.progress,
      remaining: p.remaining,
    })),
    nudges: nudges(game, user.xp, metrics, awardedAt.keys()),
  };
}

/** DPDP Act: the right to a copy of your data. Excludes secrets (password hash, session tokens). */
export async function exportData(ctx: Ctx, userId: string) {
  const me = await buildMe(ctx, userId);
  const [consents, trips, points, xpEvents, ratingsGiven, contacts, beacons, sos] = await Promise.all([
    ctx.db.selectFrom("consents").select(["purpose", "notice_version", "granted_at", "withdrawn_at"]).where("user_id", "=", userId).execute(),
    ctx.db.selectFrom("trips").selectAll().where("owner_id", "=", userId).execute(),
    ctx.db
      .selectFrom("trip_points")
      .innerJoin("trips", "trips.id", "trip_points.trip_id")
      .select(["trip_points.trip_id", "trip_points.ts", "trip_points.lat", "trip_points.lon", "trip_points.alt", "trip_points.source"])
      .where("trips.owner_id", "=", userId)
      .execute(),
    ctx.db.selectFrom("xp_events").select(["amount", "reason", "ref_id", "season", "created_at"]).where("user_id", "=", userId).execute(),
    // Ratings you gave. Ratings you received appear only as the average in your trust breakdown, so the export can't reveal who rated you.
    ctx.db.selectFrom("peer_ratings").select(["conversation_id", "stars", "tags", "created_at"]).where("rater_id", "=", userId).execute(),
    ctx.db.selectFrom("trusted_contacts").select(["name", "phone_last3", "created_at"]).where("user_id", "=", userId).execute(),
    // Never the HMAC key: the export may be shared, and the key would let anyone forge SOS packets.
    ctx.db.selectFrom("beacons").select(["id", "name", "paired_at", "last_seen_at", "battery", "last_lat", "last_lon", "last_at"]).where("owner_id", "=", userId).execute(),
    ctx.db.selectFrom("sos_incidents").select(["id", "source", "status", "started_at", "ended_at"]).where("user_id", "=", userId).execute(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: me,
    consents,
    trips: trips.map(({ owner_id: _owner, ...t }) => ({ ...t, planner_input: JSON.parse(t.planner_input) as unknown })),
    gpsPoints: points,
    xpLedger: xpEvents,
    ratingsGiven: ratingsGiven.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] })),
    emergencyContacts: contacts.map((c) => ({ name: c.name, phone: `+91 ••••• ${c.phone_last3}`, addedAt: c.created_at })),
    beacons,
    sosIncidents: await Promise.all(
      sos.map(async (i) => ({ ...i, points: await ctx.db.selectFrom("sos_points").select(["lat", "lon", "at", "via"]).where("incident_id", "=", i.id).orderBy("at").execute() })),
    ),
  };
}
