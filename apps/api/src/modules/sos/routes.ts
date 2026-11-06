import type { TrustedContactDto } from "@offgrid/core";
import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../../context";
import { encrypt, newId } from "../../lib/crypto";
import { badRequest, conflict, notFound, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { normalizeIndianMobile } from "../verification/routes";
import { activeIncident, endSos, incidentDto, MAX_CONTACTS, publicView, raiseSos } from "./service";

const Point = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

/** People who get an SMS with your location if you raise an SOS. */
export function contactRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));

  const list = async (userId: string): Promise<TrustedContactDto[]> =>
    (await ctx.db.selectFrom("trusted_contacts").selectAll().where("user_id", "=", userId).orderBy("created_at").execute()).map((c) => ({
      id: c.id,
      name: c.name,
      phoneMasked: `+91 ••••• ${c.phone_last3}`,
      createdAt: c.created_at,
    }));

  r.get("/", async (_req, res) => {
    res.json(await list(userIdOf(res)));
  });

  r.post("/", limiter(ctx, 10), async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(40),
        phone: z.string().max(20),
        // DPDP: the contact's number is their personal data; the user confirms they agreed to be listed.
        theyAgreed: z.literal(true, { error: "Ask them first, then tick the box." }),
      }),
      req.body,
    );
    const e164 = normalizeIndianMobile(body.phone);
    if (!e164) throw badRequest("Enter a 10-digit Indian mobile number.", { phone: "Invalid number" });
    const userId = userIdOf(res);
    const existing = await ctx.db.selectFrom("trusted_contacts").select(["id", "phone_last3"]).where("user_id", "=", userId).execute();
    if (existing.length >= MAX_CONTACTS) throw conflict(`You can have up to ${MAX_CONTACTS} emergency contacts.`);
    await ctx.db
      .insertInto("trusted_contacts")
      .values({ id: newId(), user_id: userId, name: body.name, phone_enc: encrypt(e164, ctx.config.piiKey), phone_last3: e164.slice(-3), created_at: nowIso() })
      .execute();
    res.status(201).json(await list(userId));
  });

  r.delete("/:id", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    await ctx.db.deleteFrom("trusted_contacts").where("id", "=", id).where("user_id", "=", userIdOf(res)).execute();
    res.json(await list(userIdOf(res)));
  });

  return r;
}

export function sosRoutes(ctx: Ctx): Router {
  const r = Router();

  // Public, for trusted contacts opening the link from the SMS. The 32-character token is the only key.
  r.get("/public/:token", limiter(ctx, 60), async (req, res) => {
    const token = parse(z.string().regex(/^[A-Za-z0-9_-]{20,64}$/), req.params.token);
    const view = await publicView(ctx, token);
    if (!view) throw notFound("This SOS link has expired or doesn't exist.");
    res.setHeader("Cache-Control", "no-store");
    res.json(view);
  });

  r.use(requireAuth(ctx));

  r.get("/active", async (_req, res) => {
    const inc = await activeIncident(ctx.db, userIdOf(res));
    res.json(inc ? await incidentDto(ctx, inc) : null);
  });

  // Idempotent by the id the phone generated, so a retry from the outbox can't raise a second SOS.
  // Calling it again while an SOS is active adds the phone's latest location to it.
  r.put("/:id", limiter(ctx, 30), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const body = parse(z.object({ point: Point.nullable().default(null), battery: z.number().int().min(0).max(100).nullable().default(null) }), req.body);
    const userId = userIdOf(res);
    const other = await ctx.db.selectFrom("sos_incidents").select(["user_id", "status"]).where("id", "=", id).executeTakeFirst();
    if (other && other.user_id !== userId) throw conflict("That id is already in use.");
    if (other && other.status !== "active") {
      // A queued retry for an SOS that's already over must not start a new one.
      const inc = await ctx.db.selectFrom("sos_incidents").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      res.json(await incidentDto(ctx, inc));
      return;
    }
    const { incident, created } = await raiseSos(ctx, { userId, source: "app", id, point: body.point, battery: body.battery });
    res.status(created ? 201 : 200).json(await incidentDto(ctx, incident));
  });

  r.get("/:id", async (req, res) => {
    const inc = await ctx.db.selectFrom("sos_incidents").selectAll().where("id", "=", parse(z.uuid(), req.params.id)).where("user_id", "=", userIdOf(res)).executeTakeFirst();
    if (!inc) throw notFound("No such SOS.");
    res.json(await incidentDto(ctx, inc));
  });

  r.post("/:id/cancel", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const inc = await ctx.db.selectFrom("sos_incidents").selectAll().where("id", "=", id).where("user_id", "=", userIdOf(res)).executeTakeFirst();
    if (!inc) throw notFound("No such SOS.");
    await endSos(ctx, id, "cancelled");
    res.json(await incidentDto(ctx, (await ctx.db.selectFrom("sos_incidents").selectAll().where("id", "=", id).executeTakeFirst())!));
  });

  return r;
}
