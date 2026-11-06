import { decodePacket, forwardPacket, toHex } from "@offgrid/core";

/**
 * A chain of radio links: beacon → relay 1 → … → gateway. Each link drops a packet with probability
 * `loss`. Every node does what the firmware does: de-duplicate by (beacon, seq), then rebroadcast
 * with one hop fewer. Returns what reached the gateway and a log of the journey.
 */
export interface MeshOptions {
  relays: number;
  loss: number;
  /** Each node retransmits this many times (the firmware sends one copy; SOS packets repeat every 30 s anyway). */
  copies?: number;
  random?: () => number;
}

export interface Delivery {
  delivered: Uint8Array | null;
  log: string[];
}

export function sendThroughMesh(packet: Uint8Array, opts: MeshOptions): Delivery {
  const rnd = opts.random ?? Math.random;
  const copies = opts.copies ?? 1;
  const log: string[] = [];
  const d = decodePacket(packet);
  const label = d.ok ? `${d.packet.kind.toUpperCase()} #${d.packet.seq}` : "packet";
  let current: Uint8Array | null = packet;

  // Node 0 is the beacon itself; nodes 1..relays are relays; the last hop lands at the gateway.
  for (let hop = 0; hop <= opts.relays; hop++) {
    const to = hop === opts.relays ? "gateway" : `relay ${hop + 1}`;
    let heard = false;
    for (let c = 0; c < copies && !heard; c++) heard = rnd() >= opts.loss;
    if (!heard) {
      log.push(`  ✗ ${label} lost on the way to ${to}`);
      return { delivered: null, log };
    }
    if (to === "gateway") {
      log.push(`  → ${to} heard ${label}`);
      return { delivered: current, log };
    }
    const next = forwardPacket(current!);
    if (!next) {
      log.push(`  ✗ ${label} out of hops at ${to}`);
      return { delivered: null, log };
    }
    log.push(`  → ${to} heard ${label}, rebroadcasting (${next[23]} hops left)`);
    current = next;
  }
  return { delivered: null, log };
}

export const hex = toHex;
