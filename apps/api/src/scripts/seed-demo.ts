// Builds a realistic demo world in the local database, using the real API (in-process), so everything
// goes through the same validation, XP and fair-play rules as the app.
//
//   npm run demo:seed -w @offgrid/api            add demo data to the current database
//   npm run demo:seed -w @offgrid/api -- --reset  start from an empty database first (stop `npm run dev` before this)
//
// Passwords are random and written to apps/api/demo-accounts.local.txt (git-ignored), never printed in docs.

import { simulateTrack, type AuthResponse, type BeaconPairResponse, type MatchRequestDto, type OtpSendResponse } from "@offgrid/core";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { MockSmsAdapter } from "../adapters/sms";
import { createApp } from "../app";
import { loadContent } from "../content";
import { openDb } from "../db";
import { loadConfig } from "../env";

try {
  process.loadEnvFile(".env");
} catch {
  /* rely on real env vars */
}

const config = loadConfig();
if (config.env === "production") {
  console.error("Refusing to seed demo data into a production database.");
  process.exit(1);
}
// Seeding signs up several accounts in a second; the per-IP limits would (rightly) stop that.
config.rateLimit = false;

if (process.argv.includes("--reset")) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = config.databaseFile + suffix;
    try {
      if (existsSync(f)) rmSync(f);
    } catch {
      console.error(`Couldn't delete ${f}. Stop \`npm run dev\` first (the server keeps the database open), then run this again.`);
      process.exit(1);
    }
  }
  console.log("Database reset.");
}

const db = await openDb(config.databaseFile);
const content = loadContent();
const app = createApp({ db, config, content, sms: new MockSmsAdapter() });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

async function call<T = unknown>(token: string | null, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const day = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOfMonth = new Date().getUTCDate();
// Keep every completed trip inside this month, so this month's leaderboard and challenges have something in them.
const daysAgo = (n: number) => Math.min(n, dayOfMonth - 1);

interface Person {
  name: string;
  email: string;
  password: string;
  token: string;
  id: string;
}
const people: Person[] = [];
let phoneSeq = 0;

async function person(name: string, avatar: string, opts: { phone?: boolean; quiz?: number[]; bio?: string; city?: string } = {}): Promise<Person> {
  const email = `${name.toLowerCase()}.demo@offgrid.test`;
  const password = randomBytes(9).toString("base64url");
  const auth = await call<AuthResponse>(null, "/auth/signup", "POST", { email, password, displayName: name, birthYear: 2001, acceptTerms: true, confirmAdult: true });
  const p = { name, email, password, token: auth.accessToken, id: auth.me.id };
  await call(p.token, "/me", "PATCH", { avatar, leaderboardOptIn: true, bio: opts.bio ?? "", homeCity: opts.city ?? "" });
  if (opts.phone !== false) {
    // 9000000001… are obviously fake numbers; the OTP adapter is the mock in demo mode.
    const sent = await call<OtpSendResponse>(p.token, "/verification/phone/send", "POST", { phone: `90000000${String(++phoneSeq).padStart(2, "0")}` });
    await call(p.token, "/verification/phone/verify", "POST", { code: sent.devCode });
  }
  if (opts.quiz) await call(p.token, "/me/traveller-type", "POST", { answers: opts.quiz });
  people.push(p);
  return p;
}

/**
 * A finished, GPS-verified trip that appears `ago` days back. The API (rightly) refuses GPS points older
 * than a day, so the track is recorded as "now" through the real endpoints, and then the finished trip is
 * moved back in time directly in the database, so the next trip's track doesn't overlap it.
 */
async function finishedTrip(p: Person, placeId: string, ago: number, spendPp: number) {
  const place = content.place(placeId)!;
  const id = randomUUID();
  const shift = daysAgo(ago) * day;
  await call(p.token, `/trips/${id}`, "PUT", {
    placeId,
    startDate: iso(new Date(Date.now() - shift - place.days_min * day)),
    plannerInput: { budgetPerPerson: spendPp + 2000, days: place.days_min, month: new Date().getMonth() + 1, fitness: 2, groupSize: 2, vibes: [] },
  });
  await call(p.token, `/trips/${id}/start`, "POST");
  await call(p.token, `/trips/${id}/points`, "POST", { points: simulateTrack(place, Date.now() - 60_000), source: "gps" });
  await call(p.token, `/trips/${id}/complete`, "POST", { actualSpendPp: spendPp, notes: "Seeded demo trip." });
  const t = await db.selectFrom("trips").select(["started_at", "completed_at"]).where("id", "=", id).executeTakeFirstOrThrow();
  const back = (s: string | null) => (s ? new Date(Date.parse(s) - shift).toISOString() : null);
  await db.updateTable("trips").set({ started_at: back(t.started_at), completed_at: back(t.completed_at) }).where("id", "=", id).execute();
  await db.updateTable("trip_points").set((eb) => ({ ts: eb("ts", "-", shift) })).where("trip_id", "=", id).execute();
  return id;
}

async function plannedTrip(p: Person, placeId: string, inDays: number, looking: boolean) {
  const place = content.place(placeId)!;
  const id = randomUUID();
  const start = new Date(Date.now() + inDays * day);
  await call(p.token, `/trips/${id}`, "PUT", {
    placeId,
    startDate: iso(start),
    plannerInput: { budgetPerPerson: 9000, days: place.days_min, month: start.getMonth() + 1, fitness: 1, groupSize: 2, vibes: [] },
  });
  if (looking) await call(p.token, `/match/trips/${id}/looking`, "POST", { looking: true });
  return id;
}

console.log("Seeding the OFFGRID demo…");

// --- People ---
const asha = await person("Asha", "🧭", { quiz: [0, 2, 0, 0, 0, 0], bio: "Weekend trekker from Chandigarh. Chai at every summit.", city: "Chandigarh" });
const bilal = await person("Bilal", "🧗", { quiz: [1, 1, 1, 1, 1, 1], city: "Delhi" });
const chen = await person("Chen", "🦅", { quiz: [2, 0, 2, 2, 2, 2], city: "Pune" });
const meera = await person("Meera", "🏕️", { city: "Shimla" });
await db.updateTable("users").set({ role: "moderator" }).where("id", "=", meera.id).execute();

// --- Trips (all GPS-verified, so they count on the leaderboard) ---
await finishedTrip(asha, "triund", 9, 4200);
await finishedTrip(asha, "kareri-lake", 3, 6500);
await finishedTrip(bilal, "hampta-pass", 12, 11800);
await finishedTrip(bilal, "bhrigu-lake", 5, 7600);
await finishedTrip(chen, "bir-billing", 7, 5400);

// --- Travel buddies: Bilal wants to join Asha at Prashar Lake (pending, for the demo to accept) ---
const ashaPrashar = await plannedTrip(asha, "prashar-lake", 9, true);
const bilalPrashar = await plannedTrip(bilal, "prashar-lake", 9, true);
await call(bilal.token, "/match/requests", "POST", { fromTripId: bilalPrashar, toTripId: ashaPrashar, message: "Hi! Same dates as you. I've done Hampta and Bhrigu, happy to split a cab from Mandi." });

// --- …and Asha already chats with Chen about Kheerganga ---
const ashaKg = await plannedTrip(asha, "kheerganga", 20, true);
const chenKg = await plannedTrip(chen, "kheerganga", 20, true);
await call(chen.token, "/match/requests", "POST", { fromTripId: chenKg, toTripId: ashaKg });
const req = (await call<MatchRequestDto[]>(asha.token, "/match/requests")).find((r) => r.direction === "incoming" && r.other.displayName === "Chen")!;
const { conversationId } = await call<{ conversationId: string }>(asha.token, `/match/requests/${req.id}/accept`, "POST");
await call(chen.token, `/conversations/${conversationId}/messages`, "POST", { body: "Hey Asha! Shall we start from Barshaini at 8? My number is 98765 43210" });
await call(asha.token, `/conversations/${conversationId}/messages`, "POST", { body: "8 works. Let's keep chatting here until we meet." });

// --- Hidden places: one verified by the moderator, one waiting for community votes ---
const homestay = randomUUID();
await call(chen.token, `/submissions/${homestay}`, "PUT", {
  name: "Kareri Village Slate Homestay",
  category: "stay",
  lat: 32.2792,
  lon: 76.2788,
  tips: "Family-run, slate-roof house. Ask for rajma-chawal. ₹900 a night with dinner.",
});
await call(meera.token, `/moderation/submissions/${homestay}`, "POST", { action: "approve", note: "Called the family; it's real." });
await call(bilal.token, `/submissions/${randomUUID()}`, "PUT", {
  name: "Hidden Waterfall Pool",
  category: "viewpoint",
  lat: 32.2601,
  lon: 76.3511,
  tips: "Follow the stream 200 m past the last chai shop. Slippery after rain.",
});

// --- A fresh traveller hazard report on the way to Triund ---
await call(chen.token, `/hazards/${randomUUID()}`, "PUT", { kind: "landslide", severity: 2, description: "Loose rocks on the Galu temple stretch after last night's rain. Passable on foot with care.", lat: 32.2452, lon: 76.3397 });

// --- Safety: Asha's emergency contact and paired beacon ---
await call(asha.token, "/contacts", "POST", { name: "Maa", phone: "9000000099", theyAgreed: true });
const beacon = await call<BeaconPairResponse>(asha.token, "/beacons/pair", "POST", { id: "0ff6a1d0", name: "Asha's beacon" });

server.close();
await db.destroy();

const simCommand = `npm start -w @offgrid/beacon-sim -- --pair "${beacon.serialCommand}" --place triund --relays 2`;
const lines = [
  "OFFGRID demo accounts (local only, regenerate with npm run demo)",
  "",
  ...people.map((p) => `${p.name.padEnd(6)} ${p.email.padEnd(26)} ${p.password}${p.name === "Meera" ? "   (moderator)" : p.name === "Asha" ? "   (main demo user)" : ""}`),
  "",
  "Beacon simulator for Asha's beacon:",
  simCommand,
  "",
];
writeFileSync("demo-accounts.local.txt", lines.join("\n"));

console.log(`
Done. Demo world:
  • 4 travellers (Asha, Bilal, Chen, Meera the moderator) on this month's leaderboard
  • 5 GPS-verified trips, a pending buddy request (Bilal → Asha) and a chat (Asha ↔ Chen)
  • 1 verified hidden homestay, 1 place waiting for votes, 1 live landslide report near Triund
  • Asha has an emergency contact and a paired beacon (0ff6a1d0)

Logins and the simulator command: apps/api/demo-accounts.local.txt
Next: npm run dev, log in as Asha, and follow docs/DEMO.md.`);
