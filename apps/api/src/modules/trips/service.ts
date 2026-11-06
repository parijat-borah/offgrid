import {
  checkTrack,
  downsample,
  levelForXp,
  stageForLevel,
  tripAnomalies,
  type TripWindow,
  tripXp,
  type Badge,
  type CompleteTripResponse,
  type LatLon,
  type PlannerInput,
  type TripDto,
  type TripStatus,
  type Validation,
} from "@offgrid/core";
import { sql } from "kysely";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import type { Selectable } from "kysely";
import type { TripsTable as TripsRow } from "../../db/types";

type TripsTable = Selectable<TripsRow>;
import { newId } from "../../lib/crypto";
import { conflict, notFound } from "../../lib/errors";
import { monthStartIso, nowIso, seasonOf } from "../../lib/time";
import { buildMe } from "../me/service";
import { syncXpAndBadges } from "../xp/service";

const ROUTE_PREVIEW_POINTS = 40;

export function toDto(row: TripsTable, pointsCount: number, route: LatLon[]): TripDto {
  return {
    id: row.id,
    placeId: row.place_id,
    status: row.status as TripStatus,
    startDate: row.start_date,
    plannerInput: JSON.parse(row.planner_input) as PlannerInput,
    budgetPp: row.budget_pp,
    actualSpendPp: row.actual_spend_pp,
    validation: row.validation as Validation | null,
    validationReasons: JSON.parse(row.validation_reasons) as string[],
    distanceKm: row.distance_km,
    elevationGainM: row.elevation_gain_m,
    notes: row.notes,
    xpAwarded: row.xp_awarded,
    lookingForCompanions: row.looking_for_companions === 1,
    pointsCount,
    route,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

/** Loads trips with their point counts and route previews in two queries, whatever the number of trips. */
export async function tripDtos(db: Db, rows: TripsTable[]): Promise<TripDto[]> {
  if (rows.length === 0) return [];
  const points = await db
    .selectFrom("trip_points")
    .select(["trip_id", "lat", "lon"])
    .where(
      "trip_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("trip_id")
    .orderBy("ts")
    .execute();
  const byTrip = new Map<string, LatLon[]>();
  for (const p of points) {
    const list = byTrip.get(p.trip_id) ?? [];
    list.push({ lat: p.lat, lon: p.lon });
    byTrip.set(p.trip_id, list);
  }
  return rows.map((r) => {
    const track = byTrip.get(r.id) ?? [];
    return toDto(r, track.length, downsample(track, ROUTE_PREVIEW_POINTS));
  });
}

export async function ownedTrip(db: Db, userId: string, id: string): Promise<TripsTable> {
  const row = await db.selectFrom("trips").selectAll().where("id", "=", id).where("owner_id", "=", userId).executeTakeFirst();
  if (!row) throw notFound("Trip not found.");
  return row;
}

/** GPS windows of the user's other completed trips, for the overlap and per-day checks. */
async function tripWindows(db: Db, userId: string, exceptId: string): Promise<TripWindow[]> {
  const rows = await db
    .selectFrom("trips")
    .leftJoin("trip_points", "trip_points.trip_id", "trips.id")
    .select(["trips.id", "trips.completed_at", sql<number | null>`min(trip_points.ts)`.as("first"), sql<number | null>`max(trip_points.ts)`.as("last")])
    .where("trips.owner_id", "=", userId)
    .where("trips.status", "=", "completed")
    .where("trips.id", "!=", exceptId)
    .groupBy(["trips.id", "trips.completed_at"])
    .execute();
  return rows.map((r) => ({ id: r.id, completedAt: Date.parse(r.completed_at ?? ""), firstPoint: r.first, lastPoint: r.last, simulated: false }));
}

/**
 * Completing a trip is the only way to earn trip XP. Everything runs in one transaction:
 * grade the GPS track, pay XP into the ledger, award any badges the new stats unlock,
 * then recompute the cached XP and level from the ledger (the ledger is the source of truth).
 */
export async function completeTrip(
  ctx: Ctx,
  userId: string,
  tripId: string,
  input: { actualSpendPp?: number | undefined; notes?: string | undefined },
): Promise<CompleteTripResponse> {
  const { game } = ctx.content;
  const before = await ctx.db.selectFrom("users").select(["xp"]).where("id", "=", userId).executeTakeFirstOrThrow();
  const levelBefore = levelForXp(before.xp, game.xp);
  let awarded = { xp: 0, note: "" };
  let check!: ReturnType<typeof checkTrack>;
  let newBadges: Badge[] = [];

  await ctx.db.transaction().execute(async (trx) => {
    const trip = await ownedTrip(trx, userId, tripId);
    if (trip.status === "completed") throw conflict("This trip is already completed.");
    if (trip.status === "cancelled") throw conflict("This trip was cancelled.");
    const place = ctx.content.place(trip.place_id);
    if (!place) throw notFound("This trip's place is no longer in the data pack.");

    const points = await trx.selectFrom("trip_points").selectAll().where("trip_id", "=", tripId).orderBy("ts").execute();
    check = checkTrack(place, points, game.xp);

    const manualThisMonth = await trx
      .selectFrom("trips")
      .select(sql<number>`count(*)`.as("n"))
      .where("owner_id", "=", userId)
      .where("validation", "=", "manual")
      .where("completed_at", ">=", monthStartIso())
      .executeTakeFirstOrThrow();
    awarded = tripXp(place, check.validation, game.xp, Number(manualThisMonth.n));

    const now = nowIso();
    // Leaderboard fair play, separate from XP: a flagged trip still levels you up but stays off the boards.
    const others = await tripWindows(trx, userId, tripId);
    const fairplay = tripAnomalies(
      {
        id: tripId,
        completedAt: Date.parse(now),
        firstPoint: points[0]?.ts ?? null,
        lastPoint: points.at(-1)?.ts ?? null,
        simulated: points.length > 0 && points.every((p) => p.source === "simulated"),
      },
      others,
      ctx.content.challenges,
    );
    if (check.validation === "manual") fairplay.push("Trips without a GPS track don't count on leaderboards.");
    await trx
      .updateTable("trips")
      .set({
        status: "completed",
        validation: check.validation,
        validation_reasons: JSON.stringify(check.reasons),
        leaderboard_eligible: fairplay.length === 0 ? 1 : 0,
        fairplay_reasons: JSON.stringify(fairplay),
        distance_km: check.distanceKm,
        elevation_gain_m: check.elevationGainM,
        actual_spend_pp: input.actualSpendPp ?? null,
        notes: input.notes ?? trip.notes,
        xp_awarded: awarded.xp,
        completed_at: now,
        updated_at: now,
      })
      .where("id", "=", tripId)
      .execute();

    if (awarded.xp > 0) {
      await trx
        .insertInto("xp_events")
        .values({ id: newId(), user_id: userId, amount: awarded.xp, reason: "trip_complete", ref_id: tripId, season: seasonOf(), created_at: now })
        .execute();
    }
    newBadges = await syncXpAndBadges(trx, ctx, userId, now);
  });

  const me = await buildMe(ctx, userId);
  const [trip] = await tripDtos(ctx.db, [await ownedTrip(ctx.db, userId, tripId)]);
  const levelAfter = me.level.level;
  const stageBefore = stageForLevel(game.mascots.stages, levelBefore);
  return {
    trip: trip!,
    xpAwarded: awarded.xp,
    xpNote: awarded.note,
    validation: check.validation,
    reasons: check.reasons,
    levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null,
    stageChange: me.stage.id !== stageBefore.id ? { from: stageBefore, to: me.stage } : null,
    newBadges,
    me,
  };
}
