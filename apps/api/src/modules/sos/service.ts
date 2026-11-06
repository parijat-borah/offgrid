import { nearestHospitals, type SosIncidentDto, type SosPoint, type SosPublicDto, type SosStatus } from "@offgrid/core";
import { smsAdapterFor } from "../../adapters/sms";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import { decrypt, encrypt, newId, randomToken, sha256 } from "../../lib/crypto";
import { nowIso } from "../../lib/time";

export const MAX_CONTACTS = 5;
/** The contacts' status link keeps working this long after the SOS ends, so they can see it was resolved. */
const PUBLIC_AFTER_END_MS = 72 * 3_600_000;

type Via = SosPoint["via"];
type Incident = Awaited<ReturnType<typeof activeIncident>>;

export const smsFor = (ctx: Ctx) => ctx.sms ?? smsAdapterFor(ctx.config.smsMode);
const statusUrl = (ctx: Ctx, token: string) => `${ctx.config.publicWebUrl}/?view=sos-status&token=${token}`;
const osmLink = (p: { lat: number; lon: number }) => `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lon.toFixed(5)}#map=15/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}`;
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

export function activeIncident(db: Db, userId: string) {
  return db.selectFrom("sos_incidents").selectAll().where("user_id", "=", userId).where("status", "=", "active").executeTakeFirst();
}

async function lastPoint(db: Db, incidentId: string): Promise<SosPoint | null> {
  const p = await db.selectFrom("sos_points").selectAll().where("incident_id", "=", incidentId).orderBy("at", "desc").limit(1).executeTakeFirst();
  return p ? { lat: p.lat, lon: p.lon, at: p.at, via: p.via as Via } : null;
}

/** The trip the traveller is most likely on: active, or planned and started within the last two weeks. */
async function currentTrip(db: Db, userId: string) {
  return db
    .selectFrom("trips")
    .select(["id", "place_id", "start_date", "planner_input"])
    .where("owner_id", "=", userId)
    .where("status", "in", ["active", "planned"])
    .orderBy(({ fn, ref }) => fn("coalesce", [ref("started_at"), ref("created_at")]), "desc")
    .executeTakeFirst();
}

/**
 * Start an SOS, or add to the one already running. Contacts are messaged once, when it starts; later
 * locations go to the live status page, not to more SMS (an SMS every 30 s would bury the important one).
 */
export async function raiseSos(
  ctx: Ctx,
  input: { userId: string; source: Via; id?: string; beaconId?: string | null; point?: { lat: number; lon: number; at?: string } | null; battery?: number | null },
): Promise<{ incident: NonNullable<Incident>; created: boolean }> {
  const now = nowIso();
  const created = await ctx.db.transaction().execute(async (trx) => {
    let inc = await activeIncident(trx, input.userId);
    let isNew = false;
    if (!inc) {
      const token = randomToken(24);
      const trip = await currentTrip(trx, input.userId);
      const row = {
        id: input.id ?? newId(),
        user_id: input.userId,
        source: input.source,
        beacon_id: input.beaconId ?? null,
        trip_id: trip?.id ?? null,
        status: "active" as SosStatus,
        battery: input.battery ?? null,
        token_hash: sha256(token),
        token_enc: encrypt(token, ctx.config.piiKey),
        started_at: now,
        ended_at: null,
      };
      await trx.insertInto("sos_incidents").values(row).execute();
      inc = row;
      isNew = true;
    } else if (input.battery !== undefined && input.battery !== null) {
      await trx.updateTable("sos_incidents").set({ battery: input.battery }).where("id", "=", inc.id).execute();
    }
    if (input.point) {
      await trx.insertInto("sos_points").values({ incident_id: inc.id, lat: input.point.lat, lon: input.point.lon, at: input.point.at ?? now, via: input.source }).execute();
    }
    return { inc, isNew };
  });
  if (created.isNew) await notifyContacts(ctx, created.inc.id, "start");
  return { incident: created.inc, created: created.isNew };
}

export async function endSos(ctx: Ctx, incidentId: string, status: Exclude<SosStatus, "active">) {
  const res = await ctx.db.updateTable("sos_incidents").set({ status, ended_at: nowIso() }).where("id", "=", incidentId).where("status", "=", "active").executeTakeFirst();
  if (Number(res.numUpdatedRows) > 0) await notifyContacts(ctx, incidentId, "end");
}

async function notifyContacts(ctx: Ctx, incidentId: string, kind: "start" | "end") {
  const inc = await ctx.db
    .selectFrom("sos_incidents")
    .innerJoin("users", "users.id", "sos_incidents.user_id")
    .select(["sos_incidents.id", "sos_incidents.user_id", "sos_incidents.source", "sos_incidents.token_enc", "users.display_name"])
    .where("sos_incidents.id", "=", incidentId)
    .executeTakeFirstOrThrow();
  const contacts = await ctx.db.selectFrom("trusted_contacts").selectAll().where("user_id", "=", inc.user_id).execute();
  const last = await lastPoint(ctx.db, incidentId);
  const url = statusUrl(ctx, decrypt(inc.token_enc, ctx.config.piiKey));
  const name = inc.display_name;
  const body =
    kind === "start"
      ? `OFFGRID SOS: ${name} pressed SOS${inc.source === "beacon" ? " on their beacon" : ""}. ` +
        (last ? `Last location ${ist(last.at)}: ${osmLink(last)} ` : "No location yet. ") +
        `Live status: ${url} Try calling them. If you can't reach them, call 112 and share this location.`
      : `OFFGRID: ${name} has marked themselves safe. The SOS is over. ${url}`;
  const sms = smsFor(ctx);
  for (const c of contacts) {
    let status = sms.demo ? "demo" : "sent";
    try {
      await sms.send(decrypt(c.phone_enc, ctx.config.piiKey), body);
    } catch (e) {
      status = "failed";
      console.error(`SOS SMS to contact ${c.id} failed:`, e instanceof Error ? e.message : e);
    }
    await ctx.db
      .insertInto("sos_notifications")
      .values({ id: newId(), incident_id: incidentId, contact_id: c.id, to_label: `${c.name} (+91 ••••• ${c.phone_last3})`, kind, body, status, created_at: nowIso() })
      .execute();
  }
}

export async function incidentDto(ctx: Ctx, inc: NonNullable<Incident>): Promise<SosIncidentDto> {
  const notes = await ctx.db.selectFrom("sos_notifications").select(["to_label", "body", "status", "created_at"]).where("incident_id", "=", inc.id).orderBy("created_at").execute();
  return {
    id: inc.id,
    status: inc.status as SosStatus,
    source: inc.source as Via,
    beaconId: inc.beacon_id,
    startedAt: inc.started_at,
    endedAt: inc.ended_at,
    last: await lastPoint(ctx.db, inc.id),
    contactsNotified: new Set(notes.filter((n) => n.status !== "failed").map((n) => n.to_label)).size,
    statusUrl: statusUrl(ctx, decrypt(inc.token_enc, ctx.config.piiKey)),
    demoMessages: smsFor(ctx).demo ? notes.map((n) => ({ to: n.to_label, body: n.body, at: n.created_at })) : null,
  };
}

/** For the contacts' status page. Returns null for unknown tokens and for links that have expired. */
export async function publicView(ctx: Ctx, token: string): Promise<SosPublicDto | null> {
  const inc = await ctx.db
    .selectFrom("sos_incidents")
    .innerJoin("users", "users.id", "sos_incidents.user_id")
    .select(["sos_incidents.id", "sos_incidents.status", "sos_incidents.started_at", "sos_incidents.ended_at", "sos_incidents.battery", "sos_incidents.trip_id", "users.display_name"])
    .where("sos_incidents.token_hash", "=", sha256(token))
    .executeTakeFirst();
  if (!inc) return null;
  if (inc.ended_at && Date.now() - Date.parse(inc.ended_at) > PUBLIC_AFTER_END_MS) return null;

  const pts = await ctx.db.selectFrom("sos_points").selectAll().where("incident_id", "=", inc.id).orderBy("at").execute();
  const track = pts.map((p) => ({ lat: p.lat, lon: p.lon, at: p.at, via: p.via as Via }));
  const last = track.at(-1) ?? null;
  const trip = inc.trip_id ? await ctx.db.selectFrom("trips").select(["place_id", "start_date", "planner_input"]).where("id", "=", inc.trip_id).executeTakeFirst() : undefined;
  const place = trip ? ctx.content.place(trip.place_id) : undefined;
  // Without a GPS fix, point the contact at hospitals near the planned destination instead.
  const anchor = last ?? (place ? { lat: place.lat, lon: place.lon } : null);
  return {
    displayName: inc.display_name,
    status: inc.status as SosStatus,
    startedAt: inc.started_at,
    endedAt: inc.ended_at,
    last,
    track: track.slice(-200),
    battery: inc.battery,
    trip: trip && place ? { placeId: place.id, placeName: place.name, startDate: trip.start_date, days: (JSON.parse(trip.planner_input) as { days: number }).days } : null,
    hospitals: anchor
      ? nearestHospitals(anchor, ctx.content.hospitals, 3).map((h) => ({
          name: h.hospital.name,
          distanceKm: Math.round(h.distanceKm * 10) / 10,
          lat: h.hospital.lat,
          lon: h.hospital.lon,
          emergency24h: h.hospital.emergency_24h,
        }))
      : [],
    emergency: ctx.content.planner.region.emergency,
  };
}
