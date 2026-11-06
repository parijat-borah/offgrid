// OFFGRID Beacon radio packet, v1. The same layout is implemented in firmware/offgrid_beacon (C++),
// so any change here must change there too, and the shared test vector in test/beacon.test.ts.
//
// 34 bytes, little-endian, small enough for one LoRa frame at SF9 (~0.3 s airtime at 125 kHz):
//
//  off size field
//   0   1   version (1)
//   1   1   kind: 1 ping, 2 SOS, 3 cancel ("I'm safe")
//   2   4   beacon id (uint32, printed on the unit as 8 hex digits)
//   6   4   seq (uint32, stored in flash, only ever goes up)
//  10   4   lat × 1e6 (int32)
//  14   4   lon × 1e6 (int32)
//  18   4   GPS time, unix seconds (uint32, 0 = no fix yet)
//  22   1   battery % (0–100)
//  23   1   hops left (TTL). Relays decrement it, so it is NOT covered by the MAC
//  24  10   MAC: first 10 bytes of HMAC-SHA256(key, bytes 0..22)
//
// No encryption: the content (a location and an SOS flag) must be readable by any relay so it can
// prioritise SOS, and the MAC stops anyone forging or altering a packet. Replays are stopped by seq.

export const PACKET_VERSION = 1;
export const PACKET_LENGTH = 34;
export const MAC_LENGTH = 10;
export const MAX_HOPS = 3;
const SIGNED_LENGTH = 23;
const HOPS_OFFSET = 23;
const NO_FIX = 0;

export type BeaconKind = "ping" | "sos" | "cancel";
const KIND_CODE: Record<BeaconKind, number> = { ping: 1, sos: 2, cancel: 3 };
const KIND_NAME: Record<number, BeaconKind> = { 1: "ping", 2: "sos", 3: "cancel" };

export interface BeaconPacket {
  beaconId: string;
  kind: BeaconKind;
  seq: number;
  /** null when the GPS has no fix yet. */
  lat: number | null;
  lon: number | null;
  /** Milliseconds since epoch from GPS, or null without a fix. */
  gpsTime: number | null;
  battery: number;
  hopsLeft: number;
}

export type DecodeResult = { ok: true; packet: BeaconPacket; signed: Uint8Array; mac: Uint8Array } | { ok: false; error: string };

/** "0a1b2c3d": 8 lowercase hex digits. */
export const BEACON_ID = /^[0-9a-f]{8}$/;

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Copies give plain ArrayBuffer-backed views, which WebCrypto's types accept in both Node and the browser.
  const k = await crypto.subtle.importKey("raw", new Uint8Array(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new Uint8Array(data)));
}

/** Builds and signs a packet. Used by the simulator and tests; the real beacon does the same in C++. */
export async function encodePacket(p: BeaconPacket, key: Uint8Array): Promise<Uint8Array> {
  if (!BEACON_ID.test(p.beaconId)) throw new Error("beaconId must be 8 hex digits");
  const buf = new Uint8Array(PACKET_LENGTH);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PACKET_VERSION);
  v.setUint8(1, KIND_CODE[p.kind]);
  v.setUint32(2, parseInt(p.beaconId, 16), true);
  v.setUint32(6, p.seq >>> 0, true);
  const fix = p.lat !== null && p.lon !== null;
  // With no fix, lat/lon are 0 and the time is 0; decode turns them back into nulls.
  v.setInt32(10, fix ? Math.round(p.lat! * 1e6) : 0, true);
  v.setInt32(14, fix ? Math.round(p.lon! * 1e6) : 0, true);
  v.setUint32(18, fix && p.gpsTime ? Math.floor(p.gpsTime / 1000) : NO_FIX, true);
  v.setUint8(22, Math.max(0, Math.min(100, Math.round(p.battery))));
  v.setUint8(HOPS_OFFSET, Math.max(0, Math.min(MAX_HOPS, p.hopsLeft)));
  buf.set((await hmac(key, buf.subarray(0, SIGNED_LENGTH))).subarray(0, MAC_LENGTH), 24);
  return buf;
}

/** Parses without checking the MAC (relays and the server look up the key by beacon id first). */
export function decodePacket(buf: Uint8Array): DecodeResult {
  if (buf.length !== PACKET_LENGTH) return { ok: false, error: `Packet must be ${PACKET_LENGTH} bytes, got ${buf.length}.` };
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint8(0) !== PACKET_VERSION) return { ok: false, error: `Unknown packet version ${v.getUint8(0)}.` };
  const kind = KIND_NAME[v.getUint8(1)];
  if (!kind) return { ok: false, error: `Unknown packet kind ${v.getUint8(1)}.` };
  const t = v.getUint32(18, true);
  const latRaw = v.getInt32(10, true);
  const lonRaw = v.getInt32(14, true);
  const fix = t !== NO_FIX;
  const lat = latRaw / 1e6;
  const lon = lonRaw / 1e6;
  if (fix && (Math.abs(lat) > 90 || Math.abs(lon) > 180)) return { ok: false, error: "Coordinates out of range." };
  const battery = v.getUint8(22);
  if (battery > 100) return { ok: false, error: "Battery out of range." };
  return {
    ok: true,
    packet: {
      beaconId: v.getUint32(2, true).toString(16).padStart(8, "0"),
      kind,
      seq: v.getUint32(6, true),
      lat: fix ? lat : null,
      lon: fix ? lon : null,
      gpsTime: fix ? t * 1000 : null,
      battery,
      hopsLeft: v.getUint8(HOPS_OFFSET),
    },
    signed: buf.slice(0, SIGNED_LENGTH),
    mac: buf.slice(24),
  };
}

/** Constant-time check of the truncated HMAC. */
export async function verifyPacket(decoded: Extract<DecodeResult, { ok: true }>, key: Uint8Array): Promise<boolean> {
  const expected = (await hmac(key, decoded.signed)).subarray(0, MAC_LENGTH);
  let diff = 0;
  for (let i = 0; i < MAC_LENGTH; i++) diff |= expected[i]! ^ decoded.mac[i]!;
  return diff === 0;
}

/** What a relay does before rebroadcasting: one hop fewer. Null when the packet has used up its hops. */
export function forwardPacket(buf: Uint8Array): Uint8Array | null {
  if (buf.length !== PACKET_LENGTH || buf[HOPS_OFFSET]! === 0) return null;
  const next = buf.slice();
  next[HOPS_OFFSET] = buf[HOPS_OFFSET]! - 1;
  return next;
}

/**
 * Replay window: the server accepts a seq it hasn't seen if it's no more than this far behind the
 * highest seq so far. Mesh hops can deliver packets out of order, but an old captured packet can't be replayed.
 */
export const SEQ_WINDOW = 64;

export function seqAcceptable(seq: number, highestSeen: number | null): boolean {
  return highestSeen === null || seq > highestSeen - SEQ_WINDOW;
}
