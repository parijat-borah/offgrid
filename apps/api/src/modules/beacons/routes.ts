import { BEACON_ID, decodePacket, fromHex, seqAcceptable, toHex, verifyPacket, type BeaconDto, type BeaconPairResponse, type RelayResult } from "@offgrid/core";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "../../context";
import type { Db } from "../../db";
import { decrypt, encrypt } from "../../lib/crypto";
import { conflict, notFound, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { activeIncident, endSos, raiseSos } from "../sos/service";

type BeaconRow = Awaited<ReturnType<typeof beaconRow>>;
const beaconRow = (db: Db, id: string) => db.selectFrom("beacons").selectAll().where("id", "=", id).executeTakeFirst();

function beaconDto(b: NonNullable<BeaconRow>): BeaconDto {
  return {
    id: b.id,
    name: b.name,
    pairedAt: b.paired_at,
    lastSeenAt: b.last_seen_at,
    battery: b.battery,
    last: b.last_lat !== null && b.last_lon !== null && b.last_at ? { lat: b.last_lat, lon: b.last_lon, at: b.last_at } : null,
  };
}

export function beaconRoutes(ctx: Ctx): Router {
  const r = Router();

  /**
   * Gateways and phones forward packets they heard over LoRa or Bluetooth. No login: a relay can be a
   * stranger's phone or a homestay gateway. Each packet carries its own HMAC, so a relay can pass
   * packets on but can't forge or change them.
   */
  r.post("/relay", limiter(ctx, 120), async (req, res) => {
    const body = parse(
      z.object({
        relayId: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/).nullable().default(null),
        packets: z.array(z.string().regex(/^[0-9a-fA-F]+$/).max(200)).min(1).max(50),
      }),
      req.body,
    );
    const results: RelayResult[] = [];
    for (const [index, hex] of body.packets.entries()) results.push({ index, ...(await ingest(hex.toLowerCase(), body.relayId)) });
    res.json({ results });
  });

  async function ingest(hex: string, relayId: string | null): Promise<Omit<RelayResult, "index">> {
    const d = decodePacket(fromHex(hex)!);
    if (!d.ok) return { status: "rejected", reason: d.error };
    const p = d.packet;
    const b = await beaconRow(ctx.db, p.beaconId);
    // Same message for unknown beacons and bad MACs, so the endpoint can't be used to find paired ids.
    if (!b || !(await verifyPacket(d, fromHex(decrypt(b.key_enc, ctx.config.piiKey))!))) return { status: "rejected", reason: "Unknown beacon or bad signature." };
    if (!seqAcceptable(p.seq, b.highest_seq)) return { status: "rejected", reason: "Old packet (possible replay)." };

    const now = nowIso();
    const at = p.gpsTime && p.gpsTime < Date.now() + 5 * 60_000 ? new Date(p.gpsTime).toISOString() : now;
    const fresh = await ctx.db
      .insertInto("beacon_events")
      .values({ beacon_id: b.id, seq: p.seq, kind: p.kind, lat: p.lat, lon: p.lon, gps_time: p.gpsTime ? at : null, battery: p.battery, hops_left: p.hopsLeft, relay_id: relayId, received_at: now })
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    if (Number(fresh.numInsertedOrUpdatedRows ?? 0) === 0) return { status: "duplicate" };

    const newest = b.highest_seq === null || p.seq > b.highest_seq;
    await ctx.db
      .updateTable("beacons")
      .set({
        highest_seq: newest ? p.seq : b.highest_seq,
        last_seen_at: now,
        ...(newest ? { battery: p.battery } : {}),
        ...(newest && p.lat !== null && p.lon !== null ? { last_lat: p.lat, last_lon: p.lon, last_at: at } : {}),
      })
      .where("id", "=", b.id)
      .execute();

    const point = p.lat !== null && p.lon !== null ? { lat: p.lat, lon: p.lon, at } : null;
    if (p.kind === "sos") {
      await raiseSos(ctx, { userId: b.owner_id, source: "beacon", beaconId: b.id, point, battery: p.battery });
    } else if (p.kind === "cancel") {
      // Only a cancel newer than the SOS ends it, so a late, out-of-order cancel can't hide a new SOS.
      const inc = await activeIncident(ctx.db, b.owner_id);
      if (inc && inc.beacon_id === b.id && (await sosSeqBefore(b.id, p.seq))) await endSos(ctx, inc.id, "cancelled");
    } else if (point) {
      // Pings during an active trip become part of its track (signed by the beacon, so harder to fake).
      const inc = await activeIncident(ctx.db, b.owner_id);
      if (inc) await raiseSos(ctx, { userId: b.owner_id, source: "beacon", beaconId: b.id, point, battery: p.battery });
      const trip = await ctx.db.selectFrom("trips").select("id").where("owner_id", "=", b.owner_id).where("status", "=", "active").executeTakeFirst();
      if (trip) await ctx.db.insertInto("trip_points").values({ trip_id: trip.id, ts: Date.parse(at), lat: point.lat, lon: point.lon, alt: null, accuracy: null, source: "beacon" }).execute();
    }
    return { status: "accepted" };
  }

  async function sosSeqBefore(beaconId: string, cancelSeq: number) {
    const newerSos = await ctx.db.selectFrom("beacon_events").select("seq").where("beacon_id", "=", beaconId).where("kind", "=", "sos").where("seq", ">", cancelSeq).executeTakeFirst();
    return !newerSos;
  }

  r.use(requireAuth(ctx));

  r.get("/", async (_req, res) => {
    const rows = await ctx.db.selectFrom("beacons").selectAll().where("owner_id", "=", userIdOf(res)).orderBy("paired_at").execute();
    res.json(rows.map(beaconDto));
  });

  /** Pairing (or re-pairing) issues a fresh key. Any key the beacon had before stops working. */
  r.post("/pair", limiter(ctx, 10), async (req, res) => {
    const body = parse(z.object({ id: z.string().trim().toLowerCase().regex(BEACON_ID, "The beacon id is 8 characters, 0–9 and a–f."), name: z.string().trim().min(1).max(30).default("My beacon") }), req.body);
    const userId = userIdOf(res);
    const existing = await beaconRow(ctx.db, body.id);
    if (existing && existing.owner_id !== userId) throw conflict("This beacon is paired to another account. Its owner must unpair it first.");
    const key = randomBytes(16);
    const row = { id: body.id, owner_id: userId, name: body.name, key_enc: encrypt(toHex(key), ctx.config.piiKey), paired_at: nowIso() };
    if (existing) await ctx.db.updateTable("beacons").set({ ...row, highest_seq: null }).where("id", "=", body.id).execute();
    else await ctx.db.insertInto("beacons").values({ ...row, highest_seq: null, battery: null, last_lat: null, last_lon: null, last_at: null, last_seen_at: null }).execute();
    // Old events would block the beacon's seq, which restarts from 0 when the new key is written.
    if (existing) await ctx.db.deleteFrom("beacon_events").where("beacon_id", "=", body.id).execute();
    const keyHex = toHex(key);
    const out: BeaconPairResponse = { beacon: beaconDto((await beaconRow(ctx.db, body.id))!), keyHex, serialCommand: `PAIR ${body.id} ${keyHex}` };
    res.setHeader("Cache-Control", "no-store");
    res.status(existing ? 200 : 201).json(out);
  });

  r.patch("/:id", async (req, res) => {
    const id = parse(z.string().regex(BEACON_ID), req.params.id);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(30) }), req.body);
    const done = await ctx.db.updateTable("beacons").set({ name }).where("id", "=", id).where("owner_id", "=", userIdOf(res)).executeTakeFirst();
    if (!Number(done.numUpdatedRows)) throw notFound("No such beacon.");
    res.json(beaconDto((await beaconRow(ctx.db, id))!));
  });

  r.delete("/:id", async (req, res) => {
    const id = parse(z.string().regex(BEACON_ID), req.params.id);
    await ctx.db.deleteFrom("beacons").where("id", "=", id).where("owner_id", "=", userIdOf(res)).execute();
    res.status(204).end();
  });

  return r;
}
