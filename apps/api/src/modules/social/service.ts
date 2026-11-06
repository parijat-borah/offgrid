import {
  ageBand,
  ageFromYear,
  compatibility,
  DEFAULT_MATCH_PREFS,
  ineligible,
  MatchPrefsSchema,
  type CandidateDto,
  type ConversationDto,
  type Gender,
  type MatchPrefs,
  type MatchProfile,
  type MatchTrip,
  type MessageDto,
  type PersonLite,
  type PlannerInput,
} from "@offgrid/core";
import { EventEmitter } from "node:events";
import { sql, type Selectable } from "kysely";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import type { ConversationsTable, MessagesTable, TripsTable } from "../../db/types";
import { decrypt } from "../../lib/crypto";
import { verifiedTiers } from "../verification/service";
import { userTrust } from "../xp/service";

/** In-process pub/sub for live chat. One API instance today; Redis pub/sub would replace it when scaling out. */
export const chatBus = new EventEmitter();
chatBus.setMaxListeners(1000);

export async function loadPrefs(db: Db, userId: string): Promise<MatchPrefs> {
  const row = await db.selectFrom("match_prefs").select("prefs").where("user_id", "=", userId).executeTakeFirst();
  if (!row) return DEFAULT_MATCH_PREFS;
  const parsed = MatchPrefsSchema.safeParse({ ...DEFAULT_MATCH_PREFS, ...(JSON.parse(row.prefs) as object) });
  return parsed.success ? parsed.data : DEFAULT_MATCH_PREFS;
}

export async function blockedSet(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.selectFrom("blocks").select("blocked_id").where("blocker_id", "=", userId).execute();
  return new Set(rows.map((r) => r.blocked_id));
}

/** Whether either person has blocked the other. */
export async function blockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const row = await db
    .selectFrom("blocks")
    .select("blocker_id")
    .where((eb) => eb.or([eb.and([eb("blocker_id", "=", a), eb("blocked_id", "=", b)]), eb.and([eb("blocker_id", "=", b), eb("blocked_id", "=", a)])]))
    .executeTakeFirst();
  return !!row;
}

export async function matchProfile(ctx: Ctx, userId: string): Promise<MatchProfile> {
  const u = await ctx.db.selectFrom("users").select(["birth_year_enc", "gender", "gender_verified", "traveller_type"]).where("id", "=", userId).executeTakeFirstOrThrow();
  const tiers = await verifiedTiers(ctx.db, userId);
  const type = ctx.content.travellerTypes.types.find((t) => t.id === u.traveller_type);
  return {
    userId,
    age: ageFromYear(Number(decrypt(u.birth_year_enc, ctx.config.piiKey))),
    gender: u.gender as Gender,
    genderVerified: u.gender_verified === 1 && tiers.has("gov_id"),
    idVerified: tiers.has("gov_id"),
    phoneVerified: tiers.has("phone"),
    pace: type?.pace ?? 2,
    typeId: type?.id ?? null,
    prefs: await loadPrefs(ctx.db, userId),
    blocked: await blockedSet(ctx.db, userId),
  };
}

export function matchTrip(ctx: Ctx, t: Selectable<TripsTable>, typeId: string | null): MatchTrip {
  const input = JSON.parse(t.planner_input) as PlannerInput;
  const typeVibes = ctx.content.travellerTypes.types.find((x) => x.id === typeId)?.vibes ?? [];
  return {
    tripId: t.id,
    placeId: t.place_id,
    startDate: t.start_date!,
    days: input.days,
    budgetPp: t.budget_pp,
    fitness: input.fitness,
    vibes: [...new Set([...input.vibes, ...typeVibes])],
  };
}

export async function personLite(ctx: Ctx, userId: string): Promise<PersonLite> {
  const u = await ctx.db.selectFrom("users").select(["display_name", "avatar", "traveller_type"]).where("id", "=", userId).executeTakeFirst();
  const tiers = await verifiedTiers(ctx.db, userId);
  const type = ctx.content.travellerTypes.types.find((t) => t.id === u?.traveller_type);
  return {
    userId,
    displayName: u?.display_name ?? "Deleted traveller",
    avatar: u?.avatar ?? "🥾",
    idVerified: tiers.has("gov_id"),
    trust: u ? await userTrust(ctx.db, userId) : 0,
    rating: await ratingOf(ctx.db, userId),
    travellerType: type ? { id: type.id, name: type.name, icon: type.icon } : null,
  };
}

export async function ratingOf(db: Db, userId: string): Promise<{ avg: number; count: number } | null> {
  const r = await db.selectFrom("peer_ratings").select([sql<number | null>`avg(stars)`.as("avg"), sql<number>`count(*)`.as("n")]).where("ratee_id", "=", userId).executeTakeFirstOrThrow();
  return Number(r.n) > 0 ? { avg: Math.round(Number(r.avg) * 10) / 10, count: Number(r.n) } : null;
}

/** You can rate a buddy once your own trip from that match has ended (completed, or past its last day). */
export async function canRate(db: Db, c: Selectable<ConversationsTable>, viewerId: string): Promise<boolean> {
  if (c.closed_at) return false;
  const req = await db.selectFrom("match_requests").select(["from_user", "from_trip", "to_trip"]).where("id", "=", c.request_id).executeTakeFirst();
  if (!req) return false;
  const myTripId = req.from_user === viewerId ? req.from_trip : req.to_trip;
  const t = await db.selectFrom("trips").select(["status", "start_date", "planner_input"]).where("id", "=", myTripId).executeTakeFirst();
  if (!t) return false;
  if (t.status === "completed") return true;
  if (!t.start_date) return false;
  const days = (JSON.parse(t.planner_input) as PlannerInput).days;
  return Date.parse(`${t.start_date}T00:00:00Z`) + days * 86_400_000 <= Date.now();
}

/**
 * Candidates for one of my trips: other travellers heading to the same place on overlapping dates who
 * opted that trip into buddy-finding, filtered by both people's preferences and blocks, best first.
 */
export async function findCandidates(ctx: Ctx, me: MatchProfile, myTrip: MatchTrip): Promise<CandidateDto[]> {
  const rules = ctx.content.matching;
  const typeNames = Object.fromEntries(ctx.content.travellerTypes.types.map((t) => [t.id, t.name]));
  const trips = await ctx.db
    .selectFrom("trips")
    .selectAll()
    .where("place_id", "=", myTrip.placeId)
    .where("owner_id", "!=", me.userId)
    .where("status", "in", ["planned", "active"])
    .where("looking_for_companions", "=", 1)
    .where("start_date", "is not", null)
    .limit(300)
    .execute();

  const requests = await ctx.db
    .selectFrom("match_requests")
    .select(["from_trip", "to_trip", "status"])
    .where((eb) => eb.or([eb("from_trip", "=", myTrip.tripId), eb("to_trip", "=", myTrip.tripId)]))
    .execute();
  const requestFor = (tripId: string) => requests.find((r) => r.from_trip === tripId || r.to_trip === tripId)?.status ?? null;

  const out: CandidateDto[] = [];
  const profiles = new Map<string, MatchProfile>();
  for (const t of trips) {
    const them = profiles.get(t.owner_id) ?? (await matchProfile(ctx, t.owner_id));
    profiles.set(t.owner_id, them);
    if (!them.phoneVerified) continue; // only phone-verified travellers can be found
    if (ineligible(me, them)) continue;
    const theirTrip = matchTrip(ctx, t, them.typeId);
    const c = compatibility({ profile: me, trip: myTrip }, { profile: them, trip: theirTrip }, typeNames, rules);
    if (!c || c.score < rules.min_score) continue;

    const u = await ctx.db.selectFrom("users").select(["display_name", "avatar", "level", "mascot_species", "style_tags"]).where("id", "=", t.owner_id).executeTakeFirstOrThrow();
    const done = await ctx.db.selectFrom("trips").select("id").where("owner_id", "=", t.owner_id).where("status", "=", "completed").execute();
    const type = ctx.content.travellerTypes.types.find((x) => x.id === them.typeId);
    const status = requestFor(t.id);
    out.push({
      userId: t.owner_id,
      tripId: t.id,
      displayName: u.display_name,
      avatar: u.avatar,
      ageBand: ageBand(them.age, rules),
      travellerType: type ? { id: type.id, name: type.name, icon: type.icon } : null,
      level: u.level,
      mascotSpecies: u.mascot_species,
      idVerified: them.idVerified,
      phoneVerified: them.phoneVerified,
      trust: await userTrust(ctx.db, t.owner_id),
      tripsCompleted: done.length,
      styleTags: JSON.parse(u.style_tags) as string[],
      startDate: theirTrip.startDate,
      days: theirTrip.days,
      score: c.score,
      reasons: c.reasons,
      requestStatus: status === "pending" || status === "accepted" || status === "declined" ? status : null,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.trust - a.trust).slice(0, 30);
}

export function isMember(c: Selectable<ConversationsTable>, userId: string) {
  return c.user_a === userId || c.user_b === userId;
}

export function messageDto(m: Selectable<MessagesTable>, viewerId: string): MessageDto {
  return { id: m.id, conversationId: m.conversation_id, mine: m.sender_id === viewerId, system: m.sender_id === null, body: m.body, masked: m.masked === 1, createdAt: m.created_at };
}

export async function conversationDto(ctx: Ctx, c: Selectable<ConversationsTable>, viewerId: string): Promise<ConversationDto> {
  const iAmA = c.user_a === viewerId;
  const otherId = iAmA ? c.user_b : c.user_a;
  const iShared = (iAmA ? c.a_shared : c.b_shared) === 1;
  const theyShared = (iAmA ? c.b_shared : c.a_shared) === 1;
  const readAt = (iAmA ? c.a_read_at : c.b_read_at) ?? "";
  const last = await ctx.db.selectFrom("messages").selectAll().where("conversation_id", "=", c.id).orderBy("created_at", "desc").executeTakeFirst();
  const unread = await ctx.db
    .selectFrom("messages")
    .select("id")
    .where("conversation_id", "=", c.id)
    .where("created_at", ">", readAt)
    .where((eb) => eb.or([eb("sender_id", "is", null), eb("sender_id", "!=", viewerId)]))
    .execute();
  let phone: string | null = null;
  // Numbers are revealed only when both people have chosen to share, and only verified ones.
  if (iShared && theyShared && !c.closed_at) {
    const other = await ctx.db.selectFrom("users").select("phone_enc").where("id", "=", otherId).executeTakeFirst();
    phone = other?.phone_enc ? decrypt(other.phone_enc, ctx.config.piiKey) : null;
  }
  return {
    id: c.id,
    placeId: c.place_id,
    other: { ...(await personLite(ctx, otherId)), phone },
    iShared,
    theyShared,
    closed: !!c.closed_at,
    unread: unread.length,
    lastMessage: last ? { body: last.body, mine: last.sender_id === viewerId, createdAt: last.created_at } : null,
    createdAt: c.created_at,
    canRate: await canRate(ctx.db, c, viewerId),
    myRating:
      (await ctx.db.selectFrom("peer_ratings").select("stars").where("rater_id", "=", viewerId).where("conversation_id", "=", c.id).executeTakeFirst())?.stars ?? null,
  };
}
