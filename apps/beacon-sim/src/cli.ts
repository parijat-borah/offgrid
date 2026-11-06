#!/usr/bin/env -S npx tsx
// OFFGRID beacon simulator. Plays the part of a real beacon, the LoRa relays between it and the
// nearest homestay gateway, and that gateway's internet uplink, so the whole SOS path can be
// demonstrated with no hardware. Everything on the wire is real: signed v1 packets, real hops, the real API.
//
//   npm start -w @offgrid/beacon-sim -- --pair "PAIR 0a1b2c3d <key>" --place triund
//
// Keys while it runs:  s = SOS   c = cancel ("I'm safe")   p = ping now   q = quit

import { encodePacket, fromHex, MAX_HOPS, type BeaconKind } from "@offgrid/core";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { sendThroughMesh } from "./mesh";

const { values: args } = parseArgs({
  options: {
    pair: { type: "string" },
    api: { type: "string", default: "http://localhost:4000/api/v1" },
    place: { type: "string", default: "triund" },
    relays: { type: "string", default: "2" },
    loss: { type: "string", default: "0.15" },
    tick: { type: "string", default: "5" },
    "sos-after": { type: "string" },
    "no-fix": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help || !args.pair) {
  console.log(`OFFGRID beacon simulator

  --pair "PAIR <id> <key>"  the line the app shows after pairing (Profile → SOS beacon)   [required]
  --api <url>               OFFGRID API base             (default http://localhost:4000/api/v1)
  --place <id>              where the walk ends          (default triund)
  --relays <n>              LoRa relays before the gateway, 0–3 (default 2)
  --loss <0..1>             chance each radio hop drops a packet (default 0.15)
  --tick <seconds>          time between packets; real beacons ping every 5 min (default 5)
  --sos-after <seconds>     raise an SOS automatically after this long
  --no-fix                  pretend the GPS has no fix (packets carry no location)

Keys: s = SOS, c = cancel, p = ping, q = quit`);
  process.exit(args.pair ? 0 : 1);
}

const m = /^PAIR\s+([0-9a-f]{8})\s+([0-9a-f]{32})$/i.exec(args.pair.trim());
if (!m) {
  console.error('--pair must look like "PAIR 0a1b2c3d 00112233445566778899aabbccddeeff"');
  process.exit(1);
}
const beaconId = m[1]!.toLowerCase();
const key = fromHex(m[2]!)!;
const relays = Math.max(0, Math.min(MAX_HOPS, Number(args.relays)));
const loss = Math.max(0, Math.min(0.9, Number(args.loss)));
const tickMs = Math.max(1, Number(args.tick)) * 1000;
const api = args.api!.replace(/\/$/, "");

const places = JSON.parse(readFileSync(new URL("../../../data/regions/himachal/places.json", import.meta.url), "utf8")) as { id: string; name: string; lat: number; lon: number }[];
const place = places.find((p) => p.id === args.place);
if (!place) {
  console.error(`Unknown place "${args.place}". Try one of: ${places.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

// Walk in from ~4 km south-west, like simulateTrack, one step per tick.
const start = { lat: place.lat - 0.025, lon: place.lon - 0.025 };
let step = 0;
const STEPS = 40;
let seq = Math.floor(Date.now() / 1000) % 1_000_000; // fresh seqs each run, comfortably above the last one
let sos = false;
let battery = 92;

function position() {
  const f = Math.min(1, step / STEPS);
  return { lat: start.lat + (place!.lat - start.lat) * f, lon: start.lon + (place!.lon - start.lon) * f };
}

async function emit(kind: BeaconKind) {
  const pos = position();
  const fix = !args["no-fix"];
  const buf = await encodePacket(
    { beaconId, kind, seq: ++seq, lat: fix ? pos.lat : null, lon: fix ? pos.lon : null, gpsTime: fix ? Date.now() : null, battery: Math.round(battery), hopsLeft: MAX_HOPS },
    key,
  );
  const where = fix ? `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : "no GPS fix";
  console.log(`\n📡 beacon ${beaconId} sends ${kind.toUpperCase()} #${seq} (${where}, battery ${Math.round(battery)}%)`);
  const { delivered, log } = sendThroughMesh(buf, { relays, loss });
  log.forEach((l) => console.log(l));
  if (!delivered) return;
  try {
    const res = await fetch(`${api}/beacons/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayId: "sim-gateway", packets: [Buffer.from(delivered).toString("hex")] }),
    });
    const body = (await res.json()) as { results?: { status: string; reason?: string }[]; error?: { message: string } };
    const r = body.results?.[0];
    console.log(`  ☁  gateway → API: ${r ? r.status + (r.reason ? ` (${r.reason})` : "") : `HTTP ${res.status} ${body.error?.message ?? ""}`}`);
  } catch {
    console.log("  ☁  gateway has no internet right now (API unreachable). A real gateway keeps the packet and retries.");
  }
}

async function tick() {
  step++;
  battery = Math.max(5, battery - (sos ? 0.6 : 0.2));
  await emit(sos ? "sos" : "ping");
}

async function raise() {
  if (sos) return;
  sos = true;
  console.log("\n🆘 SOS button held for 3 seconds. Sending SOS every tick.");
  await emit("sos");
}

async function cancel() {
  if (!sos) return;
  sos = false;
  console.log("\n✅ SOS cancelled. Sending 'I'm safe' three times, like the firmware.");
  for (let i = 0; i < 3; i++) await emit("cancel");
}

console.log(`OFFGRID beacon simulator: beacon ${beaconId} walking to ${place.name}`);
console.log(`Radio path: beacon → ${relays} relay(s) → gateway → ${api} · ${Math.round(loss * 100)}% loss per hop`);
console.log("Keys: s = SOS, c = cancel, p = ping, q = quit");

const timer = setInterval(() => void tick(), tickMs);
if (args["sos-after"]) setTimeout(() => void raise(), Number(args["sos-after"]) * 1000);
void emit("ping");

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (d) => {
    const k = d.toString().toLowerCase();
    if (k === "s") void raise();
    else if (k === "c") void cancel();
    else if (k === "p") void emit(sos ? "sos" : "ping");
    else if (k === "q" || k === "\u0003") {
      clearInterval(timer);
      process.exit(0);
    }
  });
}
