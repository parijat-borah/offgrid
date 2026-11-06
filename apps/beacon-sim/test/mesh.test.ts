import { decodePacket, encodePacket, fromHex, verifyPacket } from "@offgrid/core";
import { describe, expect, it } from "vitest";
import { sendThroughMesh } from "../src/mesh";

const key = fromHex("00112233445566778899aabbccddeeff")!;
const pkt = () => encodePacket({ beaconId: "0a1b2c3d", kind: "sos", seq: 7, lat: 32.25, lon: 76.34, gpsTime: Date.now(), battery: 70, hopsLeft: 3 }, key);

describe("mesh", () => {
  it("spends one hop per relay and still verifies at the gateway", async () => {
    const { delivered, log } = sendThroughMesh(await pkt(), { relays: 2, loss: 0 });
    const d = decodePacket(delivered!);
    expect(d.ok && d.packet.hopsLeft).toBe(1);
    expect(d.ok && (await verifyPacket(d, key))).toBe(true);
    expect(log).toHaveLength(3);
  });

  it("drops packets on a lossy link", async () => {
    expect(sendThroughMesh(await pkt(), { relays: 1, loss: 0.5, random: () => 0.1 }).delivered).toBeNull();
  });

  it("can't go further than the hop limit", async () => {
    const { delivered, log } = sendThroughMesh(await pkt(), { relays: 4, loss: 0 });
    expect(delivered).toBeNull();
    expect(log.at(-1)).toMatch(/out of hops/);
  });
});
