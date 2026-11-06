import { describe, expect, it } from "vitest";
import {
  decodePacket,
  encodePacket,
  forwardPacket,
  fromHex,
  MAX_HOPS,
  PACKET_LENGTH,
  seqAcceptable,
  toHex,
  verifyPacket,
  type BeaconPacket,
} from "../src/beacon/packet";

const key = fromHex("000102030405060708090a0b0c0d0e0f")!;
const sos: BeaconPacket = {
  beaconId: "0a1b2c3d",
  kind: "sos",
  seq: 42,
  lat: 32.256012,
  lon: 76.348734,
  gpsTime: Date.UTC(2026, 9, 24, 6, 30, 0),
  battery: 87,
  hopsLeft: MAX_HOPS,
};

/**
 * Shared test vector. firmware/offgrid_beacon runs the same input through its own encoder on the
 * `selftest` serial command and must print exactly this hex. (Cross-checked with Python struct + hmac.)
 */
const VECTOR = "01023d2c1b0a2a0000000c30ec013efd8c046850dc6a5703b917e56dc29ee86b682e";

describe("beacon packet", () => {
  it("round-trips and matches the shared firmware test vector", async () => {
    const buf = await encodePacket(sos, key);
    expect(buf.length).toBe(PACKET_LENGTH);
    expect(toHex(buf)).toBe(VECTOR);
    const d = decodePacket(buf);
    if (!d.ok) throw new Error(d.error);
    expect(d.packet).toEqual(sos);
    expect(await verifyPacket(d, key)).toBe(true);
  });

  it("rejects a wrong key or any altered byte", async () => {
    const buf = await encodePacket(sos, key);
    const d = decodePacket(buf);
    if (!d.ok) throw new Error(d.error);
    expect(await verifyPacket(d, fromHex("ff".repeat(16))!)).toBe(false);
    for (const i of [1, 6, 10, 14, 22, 30]) {
      const bad = buf.slice();
      bad[i] = bad[i]! ^ 1;
      const bd = decodePacket(bad);
      if (bd.ok) expect(await verifyPacket(bd, key)).toBe(false);
    }
  });

  it("lets relays spend hops without breaking the MAC", async () => {
    let buf: Uint8Array | null = await encodePacket(sos, key);
    let hops = 0;
    while ((buf = forwardPacket(buf!))) {
      hops++;
      const d = decodePacket(buf);
      if (!d.ok) throw new Error(d.error);
      expect(await verifyPacket(d, key)).toBe(true);
      if (d.packet.hopsLeft === 0) break;
    }
    expect(hops).toBe(MAX_HOPS);
  });

  it("encodes 'no GPS fix' as nulls", async () => {
    const d = decodePacket(await encodePacket({ ...sos, lat: null, lon: null, gpsTime: null }, key));
    expect(d.ok && d.packet).toMatchObject({ lat: null, lon: null, gpsTime: null });
  });

  it("rejects malformed packets", () => {
    expect(decodePacket(new Uint8Array(10)).ok).toBe(false);
    const wrongVersion = new Uint8Array(PACKET_LENGTH);
    wrongVersion[0] = 9;
    expect(decodePacket(wrongVersion)).toMatchObject({ ok: false });
    expect(fromHex("zz")).toBeNull();
  });

  it("accepts out-of-order packets but not old replays", () => {
    expect(seqAcceptable(5, null)).toBe(true);
    expect(seqAcceptable(99, 100)).toBe(true);
    expect(seqAcceptable(30, 100)).toBe(false);
  });
});
