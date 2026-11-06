import {
  findDuplicates,
  tallyVotes,
  type DuplicateCandidate,
  type ModerationItem,
  type Poi,
  type PoiCategory,
  type PoiTag,
  type SubmissionDto,
  type SubmissionStatus,
} from "@offgrid/core";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import type { SubmissionsTable } from "../../db/types";
import { nowIso } from "../../lib/time";
import { setContributionXp, syncXpAndBadges, userTrust } from "../xp/service";

export const photoUrl = (file: string) => `/api/v1/uploads/${file}`;

export async function photosFor(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await db.selectFrom("submission_photos").select(["submission_id", "file"]).where("submission_id", "in", ids).orderBy("created_at").execute();
  for (const r of rows) out.set(r.submission_id, [...(out.get(r.submission_id) ?? []), photoUrl(r.file)]);
  return out;
}

export function toDto(row: SubmissionsTable, viewerId: string | null, photos: string[], myVote: 1 | -1 | null): SubmissionDto {
  const mine = viewerId === row.user_id;
  return {
    id: row.id,
    name: row.name,
    category: row.category as PoiCategory,
    // The contributor sees their own exact pin; everyone else gets the public (possibly fuzzed) one.
    lat: mine ? row.lat : row.public_lat,
    lon: mine ? row.lon : row.public_lon,
    approximate: row.approximate === 1,
    tips: row.tips,
    tags: JSON.parse(row.tags) as PoiTag[],
    seasonality: row.seasonality ? (JSON.parse(row.seasonality) as number[]) : null,
    priceBand: row.price_band as 1 | 2 | 3 | null,
    status: row.status as SubmissionStatus,
    photos,
    upvotes: row.upvotes,
    flags: row.flags,
    score: row.score,
    myVote,
    mine,
    duplicateCandidates: JSON.parse(row.duplicate_candidates) as DuplicateCandidate[],
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

export async function dtos(db: Db, rows: SubmissionsTable[], viewerId: string | null): Promise<SubmissionDto[]> {
  const ids = rows.map((r) => r.id);
  const photos = await photosFor(db, ids);
  const votes =
    viewerId && ids.length
      ? await db.selectFrom("submission_votes").select(["submission_id", "value"]).where("user_id", "=", viewerId).where("submission_id", "in", ids).execute()
      : [];
  const myVotes = new Map(votes.map((v) => [v.submission_id, v.value as 1 | -1]));
  return rows.map((r) => toDto(r, viewerId, photos.get(r.id) ?? [], myVotes.get(r.id) ?? null));
}

/** Verified community places, shaped like any other POI, for region packs. */
export async function communityPois(db: Db, regionId: string): Promise<Poi[]> {
  const rows = await db.selectFrom("submissions").selectAll().where("region_id", "=", regionId).where("status", "=", "verified").execute();
  const photos = await photosFor(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: `community-${r.id}`,
    region_id: r.region_id,
    name: r.name,
    category: r.category as PoiCategory,
    lat: r.public_lat,
    lon: r.public_lon,
    description: r.tips,
    price_band: r.price_band as 1 | 2 | 3 | null,
    tags: JSON.parse(r.tags) as PoiTag[],
    hours: null,
    event_months: null,
    source: "community" as const,
    approximate: r.approximate === 1,
    seasonality: r.seasonality ? (JSON.parse(r.seasonality) as number[]) : null,
    photos: photos.get(r.id) ?? [],
  }));
}

/** Everything a new submission could be a duplicate of: known POIs and other live submissions. */
export async function duplicateCheck(ctx: Ctx, sub: { id: string; name: string; lat: number; lon: number; region_id: string }) {
  const others = await ctx.db
    .selectFrom("submissions")
    .select(["id", "name", "lat", "lon", "status"])
    .where("region_id", "=", sub.region_id)
    .where("id", "!=", sub.id)
    .where("status", "in", ["pending", "verified", "flagged"])
    .execute();
  const pool = [
    ...ctx.content.pois.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, source: p.source })),
    ...others.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lon: o.lon, source: `community-${o.status}` })),
  ];
  return findDuplicates(sub, pool, ctx.content.moderation);
}

/**
 * Move a submission to a new status and settle the contributor's XP to match:
 * verified pays the contribution XP (and may unlock Explorer); anything else pays nothing.
 */
export async function transition(trx: Db, ctx: Ctx, row: SubmissionsTable, status: SubmissionStatus, review?: { by: string; note: string | null }) {
  const now = nowIso();
  await trx
    .updateTable("submissions")
    .set({
      status,
      updated_at: now,
      ...(review ? { reviewed_by: review.by, reviewed_at: now, review_note: review.note } : {}),
    })
    .where("id", "=", row.id)
    .execute();
  await setContributionXp(trx, row.user_id, row.id, status === "verified" ? ctx.content.moderation.contribution_xp : 0, now);
  await syncXpAndBadges(trx, ctx, row.user_id, now);
}

/** Recount votes and apply the automatic rules. Once a moderator has decided, votes no longer move it. */
export async function retally(trx: Db, ctx: Ctx, id: string): Promise<SubmissionStatus | null> {
  const row = await trx.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const votes = await trx.selectFrom("submission_votes").select(["value", "weight"]).where("submission_id", "=", id).execute();
  const tally = tallyVotes(
    votes.map((v) => ({ value: v.value as 1 | -1, weight: v.weight })),
    ctx.content.moderation,
  );
  await trx
    .updateTable("submissions")
    .set({ score: tally.score, upvotes: tally.upvotes, flags: tally.flags, updated_at: nowIso() })
    .where("id", "=", id)
    .execute();
  if (row.reviewed_by) return null;
  if (tally.decision === "flag" && row.status !== "flagged") {
    await transition(trx, ctx, row, "flagged");
    return "flagged";
  }
  if (tally.decision === "verify" && row.status === "pending") {
    await transition(trx, ctx, row, "verified");
    return "verified";
  }
  return null;
}

export async function moderationItems(ctx: Ctx, rows: SubmissionsTable[]): Promise<ModerationItem[]> {
  const base = await dtos(ctx.db, rows, null);
  const ids = rows.map((r) => r.id);
  const votes = ids.length
    ? await ctx.db.selectFrom("submission_votes").selectAll().where("submission_id", "in", ids).orderBy("created_at").execute()
    : [];
  const users = ids.length
    ? await ctx.db.selectFrom("users").select(["id", "display_name"]).where("id", "in", rows.map((r) => r.user_id)).execute()
    : [];
  return Promise.all(
    rows.map(async (r, i) => ({
      ...base[i]!,
      exactLat: r.lat,
      exactLon: r.lon,
      submittedBy: {
        id: r.user_id,
        displayName: users.find((u) => u.id === r.user_id)?.display_name ?? "Unknown",
        trust: await userTrust(ctx.db, r.user_id),
      },
      votes: votes
        .filter((v) => v.submission_id === r.id)
        .map((v) => ({ value: v.value as 1 | -1, weight: v.weight, reason: v.reason, createdAt: v.created_at })),
    })),
  );
}
