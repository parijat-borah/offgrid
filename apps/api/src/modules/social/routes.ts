import {
  canUseSameGender,
  canUseWomenOnly,
  compatibility,
  ineligible,
  MASK,
  maskContacts,
  MatchPrefsSchema,
  RATING_TAGS,
  type MatchRequestDto,
} from "@offgrid/core";
import { Router, type Request, type Response } from "express";
import { sql } from "kysely";
import { z } from "zod";
import type { Ctx } from "../../context";
import { newId } from "../../lib/crypto";
import { badRequest, conflict, HttpError, notFound, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { ownedTrip } from "../trips/service";
import { blockedEitherWay, canRate, chatBus, conversationDto, findCandidates, isMember, loadPrefs, matchProfile, matchTrip, messageDto, personLite } from "./service";

const Id = z.uuid();
export const REPORT_REASONS = ["harassment", "unsafe_behaviour", "fake_profile", "scam_or_money", "inappropriate", "underage", "other"] as const;

const SAFETY_INTRO =
  "You're connected! Keep chatting here until you've met in person: report and block are one tap away, and contact details stay hidden until you both choose to share. " +
  "Meet first in a busy public place, tell someone your plans (Safety tab → Share my plan), and never send money to someone you haven't met.";

async function systemMessage(ctx: Ctx, conversationId: string, body: string) {
  const m = { id: newId(), conversation_id: conversationId, sender_id: null, body, masked: 0, created_at: nowIso() };
  await ctx.db.insertInto("messages").values(m).execute();
  chatBus.emit(`conv:${conversationId}`, m);
}

/** Trip-scoped buddy finding: you look for people for one specific trip, never just browse people. */
export function matchRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  const rules = ctx.content.matching;

  r.get("/prefs", async (_req, res) => {
    res.json(await loadPrefs(ctx.db, userIdOf(res)));
  });

  r.put("/prefs", limiter(ctx, 20), async (req, res) => {
    const prefs = parse(MatchPrefsSchema, req.body);
    if (prefs.ageMin > prefs.ageMax) throw badRequest("Minimum age can't be above maximum.", { ageMin: "Too high" });
    const me = await matchProfile(ctx, userIdOf(res));
    if (prefs.womenOnly && !canUseWomenOnly(me)) {
      throw badRequest("Women-only matching is for women who have verified their ID, so it can't be misused to find women.", { womenOnly: "Verify your ID first" });
    }
    if (prefs.sameGender && !canUseSameGender(me)) throw badRequest("Same-gender matching needs a verified ID.", { sameGender: "Verify your ID first" });
    await ctx.db
      .insertInto("match_prefs")
      .values({ user_id: userIdOf(res), prefs: JSON.stringify(prefs) })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ prefs: JSON.stringify(prefs) }))
      .execute();
    res.json(prefs);
  });

  r.post("/trips/:id/looking", limiter(ctx, 30), async (req, res) => {
    const { looking } = parse(z.object({ looking: z.boolean() }), req.body);
    const trip = await ownedTrip(ctx.db, userIdOf(res), parse(Id, req.params.id));
    if (looking) {
      if (trip.status !== "planned" && trip.status !== "active") throw conflict("Only upcoming trips can look for buddies.");
      if (!trip.start_date) throw badRequest("Set a start date first, so buddies know when you're going.", { startDate: "Required" });
      const me = await matchProfile(ctx, userIdOf(res));
      if (!me.phoneVerified) throw conflict("Verify your phone number to look for travel buddies.");
    }
    await ctx.db.updateTable("trips").set({ looking_for_companions: looking ? 1 : 0, updated_at: nowIso() }).where("id", "=", trip.id).execute();
    res.json({ looking });
  });

  r.get("/candidates", limiter(ctx, 60), async (req, res) => {
    const tripId = parse(Id, req.query.tripId);
    const trip = await ownedTrip(ctx.db, userIdOf(res), tripId);
    if (!trip.start_date) throw badRequest("Set a start date for this trip first.", { startDate: "Required" });
    const me = await matchProfile(ctx, userIdOf(res));
    if (!me.phoneVerified) throw conflict("Verify your phone number to see travel buddies.");
    res.json(await findCandidates(ctx, me, matchTrip(ctx, trip, me.typeId)));
  });

  r.get("/requests", async (_req, res) => {
    const userId = userIdOf(res);
    // Pending requests expire quietly rather than piling up.
    await ctx.db
      .updateTable("match_requests")
      .set({ status: "expired" })
      .where("status", "=", "pending")
      .where("created_at", "<", new Date(Date.now() - rules.request_expiry_days * 86_400_000).toISOString())
      .execute();
    const rows = await ctx.db
      .selectFrom("match_requests")
      .selectAll()
      .where((eb) => eb.or([eb("from_user", "=", userId), eb("to_user", "=", userId)]))
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
    const out: MatchRequestDto[] = [];
    for (const m of rows) {
      const incoming = m.to_user === userId;
      const otherId = incoming ? m.from_user : m.to_user;
      if (incoming && (await blockedEitherWay(ctx.db, userId, otherId))) continue;
      const myTrip = await ctx.db.selectFrom("trips").select(["place_id"]).where("id", "=", incoming ? m.to_trip : m.from_trip).executeTakeFirst();
      const theirTrip = await ctx.db.selectFrom("trips").select(["start_date"]).where("id", "=", incoming ? m.from_trip : m.to_trip).executeTakeFirst();
      out.push({
        id: m.id,
        direction: incoming ? "incoming" : "outgoing",
        status: m.status as MatchRequestDto["status"],
        placeId: myTrip?.place_id ?? "",
        myTripId: incoming ? m.to_trip : m.from_trip,
        theirStartDate: theirTrip?.start_date ?? null,
        other: await personLite(ctx, otherId),
        message: m.message,
        createdAt: m.created_at,
        conversationId: m.conversation_id,
      });
    }
    res.json(out);
  });

  r.post("/requests", limiter(ctx, 20), async (req, res) => {
    const body = parse(z.object({ fromTripId: Id, toTripId: Id, message: z.string().trim().max(300).default("") }), req.body);
    const userId = userIdOf(res);
    const mine = await ownedTrip(ctx.db, userId, body.fromTripId);
    const theirs = await ctx.db.selectFrom("trips").selectAll().where("id", "=", body.toTripId).executeTakeFirst();
    if (!theirs || theirs.owner_id === userId || theirs.looking_for_companions !== 1 || !mine.start_date || !theirs.start_date) {
      throw notFound("That trip isn't looking for buddies.");
    }

    const sent = await ctx.db
      .selectFrom("match_requests")
      .select(sql<number>`count(*)`.as("n"))
      .where("from_user", "=", userId)
      .where("created_at", ">=", new Date(Date.now() - 86_400_000).toISOString())
      .executeTakeFirstOrThrow();
    if (Number(sent.n) >= rules.requests_per_day) throw new HttpError(429, "RATE_LIMITED", `You can send ${rules.requests_per_day} requests a day.`);

    const existing = await ctx.db
      .selectFrom("match_requests")
      .select("status")
      .where((eb) =>
        eb.or([
          eb.and([eb("from_trip", "=", mine.id), eb("to_trip", "=", theirs.id)]),
          eb.and([eb("from_trip", "=", theirs.id), eb("to_trip", "=", mine.id)]),
        ]),
      )
      .where("status", "in", ["pending", "accepted", "declined"])
      .executeTakeFirst();
    if (existing) throw conflict(existing.status === "declined" ? "They've declined a request for this trip." : "There's already a request between these trips.");

    // Same rules as the candidate list, so a crafted request can't get round anyone's preferences.
    const me = await matchProfile(ctx, userId);
    const them = await matchProfile(ctx, theirs.owner_id);
    if (!me.phoneVerified) throw conflict("Verify your phone number to send requests.");
    const typeNames = Object.fromEntries(ctx.content.travellerTypes.types.map((t) => [t.id, t.name]));
    const c = compatibility({ profile: me, trip: matchTrip(ctx, mine, me.typeId) }, { profile: them, trip: matchTrip(ctx, theirs, them.typeId) }, typeNames, rules);
    if (ineligible(me, them) || !c) throw notFound("That trip isn't looking for buddies.");

    const id = newId();
    // Before a match is accepted, every message is masked, whatever anyone's sharing settings.
    await ctx.db
      .insertInto("match_requests")
      .values({ id, from_user: userId, to_user: theirs.owner_id, from_trip: mine.id, to_trip: theirs.id, message: maskContacts(body.message).text, status: "pending", created_at: nowIso(), decided_at: null, conversation_id: null })
      .execute();
    res.status(201).json({ id, status: "pending" });
  });

  const decide = (action: "accept" | "decline" | "cancel") => async (req: Request, res: Response) => {
    const id = parse(Id, req.params.id);
    const userId = userIdOf(res);
    const m = await ctx.db.selectFrom("match_requests").selectAll().where("id", "=", id).executeTakeFirst();
    const allowed = action === "cancel" ? m?.from_user === userId : m?.to_user === userId;
    if (!m || !allowed) throw notFound("Request not found.");
    if (m.status !== "pending") throw conflict(`This request is already ${m.status}.`);
    if (action !== "accept") {
      await ctx.db.updateTable("match_requests").set({ status: action === "decline" ? "declined" : "cancelled", decided_at: nowIso() }).where("id", "=", id).execute();
      res.json({ id, status: action === "decline" ? "declined" : "cancelled" });
      return;
    }
    if (await blockedEitherWay(ctx.db, m.from_user, m.to_user)) throw conflict("This request can't be accepted.");
    const trip = await ctx.db.selectFrom("trips").select("place_id").where("id", "=", m.to_trip).executeTakeFirstOrThrow();
    const conversationId = newId();
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("conversations")
        .values({ id: conversationId, user_a: m.from_user, user_b: m.to_user, request_id: m.id, place_id: trip.place_id, a_shared: 0, b_shared: 0, a_read_at: null, b_read_at: null, closed_at: null, created_at: nowIso() })
        .execute();
      await trx.updateTable("match_requests").set({ status: "accepted", decided_at: nowIso(), conversation_id: conversationId }).where("id", "=", id).execute();
    });
    await systemMessage(ctx, conversationId, SAFETY_INTRO);
    if (m.message) {
      await ctx.db
        .insertInto("messages")
        .values({ id: newId(), conversation_id: conversationId, sender_id: m.from_user, body: m.message, masked: m.message.includes(MASK) ? 1 : 0, created_at: nowIso() })
        .execute();
    }
    res.json({ id, status: "accepted", conversationId });
  };
  r.post("/requests/:id/accept", decide("accept"));
  r.post("/requests/:id/decline", decide("decline"));
  r.post("/requests/:id/cancel", decide("cancel"));

  return r;
}

export function conversationRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  const maxChars = ctx.content.matching.message_max_chars;

  async function member(req: Request, res: Response) {
    const c = await ctx.db.selectFrom("conversations").selectAll().where("id", "=", parse(Id, req.params.id)).executeTakeFirst();
    if (!c || !isMember(c, userIdOf(res))) throw notFound("Conversation not found.");
    return c;
  }

  r.get("/", async (_req, res) => {
    const userId = userIdOf(res);
    const rows = await ctx.db
      .selectFrom("conversations")
      .selectAll()
      .where((eb) => eb.or([eb("user_a", "=", userId), eb("user_b", "=", userId)]))
      .orderBy("created_at", "desc")
      .execute();
    res.json(await Promise.all(rows.map((c) => conversationDto(ctx, c, userId))));
  });

  r.get("/:id", async (req, res) => {
    res.json(await conversationDto(ctx, await member(req, res), userIdOf(res)));
  });

  r.get("/:id/messages", async (req, res) => {
    const c = await member(req, res);
    const after = typeof req.query.after === "string" ? req.query.after : "";
    const rows = await ctx.db.selectFrom("messages").selectAll().where("conversation_id", "=", c.id).where("created_at", ">", after).orderBy("created_at").limit(200).execute();
    res.json(rows.map((m) => messageDto(m, userIdOf(res))));
  });

  r.post("/:id/messages", limiter(ctx, 30), async (req, res) => {
    const c = await member(req, res);
    if (c.closed_at) throw conflict("This conversation is closed.");
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(maxChars) }), req.body);
    const bothShared = c.a_shared === 1 && c.b_shared === 1;
    const masked = bothShared ? { text: body, masked: false } : maskContacts(body);
    const m = { id: newId(), conversation_id: c.id, sender_id: userIdOf(res), body: masked.text, masked: masked.masked ? 1 : 0, created_at: nowIso() };
    await ctx.db.insertInto("messages").values(m).execute();
    chatBus.emit(`conv:${c.id}`, m);
    res.status(201).json(messageDto(m, userIdOf(res)));
  });

  r.post("/:id/read", async (req, res) => {
    const c = await member(req, res);
    const col = c.user_a === userIdOf(res) ? "a_read_at" : "b_read_at";
    await ctx.db.updateTable("conversations").set({ [col]: nowIso() }).where("id", "=", c.id).execute();
    res.status(204).end();
  });

  // Each person opts in separately; numbers appear only when both have.
  r.post("/:id/share-contact", async (req, res) => {
    const c = await member(req, res);
    if (c.closed_at) throw conflict("This conversation is closed.");
    const me = await ctx.db.selectFrom("users").select("phone_enc").where("id", "=", userIdOf(res)).executeTakeFirstOrThrow();
    if (!me.phone_enc) throw conflict("Verify your phone number first.");
    const col = c.user_a === userIdOf(res) ? "a_shared" : "b_shared";
    await ctx.db.updateTable("conversations").set({ [col]: 1 }).where("id", "=", c.id).execute();
    const updated = await ctx.db.selectFrom("conversations").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
    const name = (await personLite(ctx, userIdOf(res))).displayName;
    await systemMessage(ctx, c.id, updated.a_shared && updated.b_shared ? "You've both shared contact details. Phone numbers are now visible at the top of this chat." : `${name} is happy to share phone numbers. They'll appear once you both agree.`);
    res.json(await conversationDto(ctx, updated, userIdOf(res)));
  });

  // Ratings feed trust. Only possible after your own trip from this match has ended, once per chat
  // (re-rating replaces your earlier rating). Bad experiences belong in a report, not a 1-star.
  r.post("/:id/rate", limiter(ctx, 10), async (req, res) => {
    const c = await member(req, res);
    const body = parse(z.object({ stars: z.number().int().min(1).max(5), tags: z.array(z.enum(RATING_TAGS)).max(6).default([]) }), req.body);
    if (!(await canRate(ctx.db, c, userIdOf(res)))) throw conflict("You can rate your buddy once your trip has ended.");
    const ratee = c.user_a === userIdOf(res) ? c.user_b : c.user_a;
    await ctx.db
      .insertInto("peer_ratings")
      .values({ rater_id: userIdOf(res), ratee_id: ratee, conversation_id: c.id, stars: body.stars, tags: JSON.stringify([...new Set(body.tags)]), created_at: nowIso() })
      .onConflict((oc) => oc.columns(["rater_id", "ratee_id", "conversation_id"]).doUpdateSet({ stars: body.stars, tags: JSON.stringify([...new Set(body.tags)]), created_at: nowIso() }))
      .execute();
    res.json(await conversationDto(ctx, c, userIdOf(res)));
  });

  // Server-sent events: the client keeps one request open and gets messages as they're posted.
  r.get("/:id/stream", async (req, res) => {
    const c = await member(req, res);
    const userId = userIdOf(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      // no-transform stops the compression middleware buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    const send = (m: Parameters<typeof messageDto>[0]) => res.write(`event: message\ndata: ${JSON.stringify(messageDto(m, userId))}\n\n`);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    chatBus.on(`conv:${c.id}`, send);
    req.on("close", () => {
      clearInterval(heartbeat);
      chatBus.off(`conv:${c.id}`, send);
    });
  });

  return r;
}

export function safetyRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));

  r.get("/blocks", async (_req, res) => {
    const rows = await ctx.db.selectFrom("blocks").select(["blocked_id", "created_at"]).where("blocker_id", "=", userIdOf(res)).execute();
    res.json(await Promise.all(rows.map(async (b) => ({ ...(await personLite(ctx, b.blocked_id)), blockedAt: b.created_at }))));
  });

  /** Blocking is instant and silent: chats close, pending requests are declined, and you vanish from each other's results. */
  async function block(blocker: string, blocked: string) {
    if (blocker === blocked) throw badRequest("You can't block yourself.");
    const exists = await ctx.db.selectFrom("users").select("id").where("id", "=", blocked).executeTakeFirst();
    if (!exists) throw notFound("Traveller not found.");
    const now = nowIso();
    await ctx.db.transaction().execute(async (trx) => {
      await trx.insertInto("blocks").values({ blocker_id: blocker, blocked_id: blocked, created_at: now }).onConflict((oc) => oc.doNothing()).execute();
      await trx
        .updateTable("conversations")
        .set({ closed_at: now })
        .where("closed_at", "is", null)
        .where((eb) => eb.or([eb.and([eb("user_a", "=", blocker), eb("user_b", "=", blocked)]), eb.and([eb("user_a", "=", blocked), eb("user_b", "=", blocker)])]))
        .execute();
      await trx
        .updateTable("match_requests")
        .set({ status: "declined", decided_at: now })
        .where("status", "=", "pending")
        .where((eb) => eb.or([eb.and([eb("from_user", "=", blocker), eb("to_user", "=", blocked)]), eb.and([eb("from_user", "=", blocked), eb("to_user", "=", blocker)])]))
        .execute();
    });
  }

  r.post("/blocks/:userId", async (req, res) => {
    await block(userIdOf(res), parse(Id, req.params.userId));
    res.status(204).end();
  });

  r.delete("/blocks/:userId", async (req, res) => {
    await ctx.db.deleteFrom("blocks").where("blocker_id", "=", userIdOf(res)).where("blocked_id", "=", parse(Id, req.params.userId)).execute();
    res.status(204).end();
  });

  r.post("/reports", limiter(ctx, 10), async (req, res) => {
    const body = parse(
      z.object({
        targetType: z.enum(["user", "message", "conversation"]),
        targetId: Id,
        reason: z.enum(REPORT_REASONS),
        details: z.string().trim().max(1000).default(""),
        block: z.boolean().default(false),
      }),
      req.body,
    );
    const userId = userIdOf(res);
    let targetUser: string | null = null;
    if (body.targetType === "user") targetUser = body.targetId;
    if (body.targetType === "message") {
      const m = await ctx.db.selectFrom("messages").innerJoin("conversations", "conversations.id", "messages.conversation_id").select(["messages.sender_id", "conversations.user_a", "conversations.user_b"]).where("messages.id", "=", body.targetId).executeTakeFirst();
      // You can only report messages from conversations you're in.
      if (m && (m.user_a === userId || m.user_b === userId)) targetUser = m.sender_id;
    }
    if (body.targetType === "conversation") {
      const c = await ctx.db.selectFrom("conversations").selectAll().where("id", "=", body.targetId).executeTakeFirst();
      if (c && isMember(c, userId)) targetUser = c.user_a === userId ? c.user_b : c.user_a;
    }
    if (!targetUser || targetUser === userId) throw notFound("Nothing to report.");
    const exists = await ctx.db.selectFrom("users").select("id").where("id", "=", targetUser).executeTakeFirst();
    if (!exists) throw notFound("Nothing to report.");

    await ctx.db
      .insertInto("reports")
      .values({ id: newId(), reporter_id: userId, target_type: body.targetType, target_id: body.targetId, target_user_id: targetUser, reason: body.reason, details: body.details, status: "open", created_at: nowIso(), resolved_by: null, resolved_at: null, resolution_note: null })
      .execute();
    if (body.block) await block(userId, targetUser);
    res.status(201).json({ ok: true, blocked: body.block });
  });

  return r;
}
