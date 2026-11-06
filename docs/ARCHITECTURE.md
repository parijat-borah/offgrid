# OFFGRID: Architecture (Phase 0)

> SIH 2026 · PS 26216 · AICTE / MIC Student Innovation · **Category: Hardware** · Theme: Miscellaneous
> Sector angle: Hospitality, tourism and travel, plus local-economy (retail) and events (entertainment).

---

## 0. A decision you must make before Phase 1

**PS 26216 is listed under the *Hardware* category.** SIH judges Hardware entries on a working
physical prototype. The master prompt calls the SOS beacon "optional (only if Hardware is required)".
It is required. So this plan promotes it:

| Before | After |
|---|---|
| Phase 7, optional | **Core pillar.** Firmware + BOM + simulator built in parallel from Phase 1, demoed live |
| App is the product | **App + OFFGRID Beacon** together are the product. The beacon is the answer to "no network in the hills"; the app is what makes the beacon useful (trip plan, trusted contacts, hazards) |

The rest of the app stays, but the pitch leads with: *"Offline-first safety for travellers where phones stop working."*
Gamification, matching and hidden places become the reasons people keep the app installed, which is why the beacon is there when needed.

---

## 1. System overview

```
                        ┌────────────────────────────────────────────────────────┐
                        │                 CLIENT  (PWA, mobile-first)            │
                        │  React + Vite + Tailwind  ·  Leaflet/OSM               │
                        │                                                        │
                        │  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐ │
                        │  │ UI screens   │→ │ @offgrid/core  │  │ Beacon link │ │
                        │  │ (feature     │  │ (pure TS: score│  │ Web Bluetooth│ │
                        │  │  folders)    │  │  itinerary, XP,│  │ or simulator│ │
                        │  └──────┬───────┘  │  settle-up,    │  └──────┬──────┘ │
                        │         │          │  matching)     │         │        │
                        │  ┌──────▼──────────┴────────────────┴─────────▼──────┐ │
                        │  │ Local store: IndexedDB (Dexie)                    │ │
                        │  │  - region data packs (places, POIs, hazards)      │ │
                        │  │  - user state, trips, drafts                      │ │
                        │  │  - OUTBOX queue (writes made offline)             │ │
                        │  └──────────────────────┬────────────────────────────┘ │
                        │  Service worker (Workbox): app shell + OSM tile cache  │
                        └─────────────────────────┼──────────────────────────────┘
                                                  │ HTTPS / JSON  (sync when online)
                        ┌─────────────────────────▼──────────────────────────────┐
                        │                 API  (Node 22 + Express + TypeScript)  │
                        │  auth · trips · places · moderation · matching · chat  │
                        │  leaderboard · alerts · beacon relay · sync            │
                        │  zod validation · rate limit · helmet · JWT            │
                        │                                                        │
                        │  Adapters (interface + mock + real):                   │
                        │   WeatherAdapter  → Open-Meteo (real, free) / mock     │
                        │   OtpAdapter      → mock (console)  / MSG91, Twilio    │
                        │   KycAdapter      → mock            / DigiLocker       │
                        │   LivenessAdapter → mock            / vendor SDK       │
                        │   NotifyAdapter   → in-app / Web Push / SMS            │
                        │   StorageAdapter  → local disk / S3-compatible         │
                        └──────────┬─────────────────────────────┬───────────────┘
                                   │                             │
                     ┌─────────────▼─────────────┐   ┌───────────▼──────────────┐
                     │ SQLite (MVP, one file)    │   │ uploads/ (images,        │
                     │ → Postgres + PostGIS      │   │  EXIF-stripped, resized) │
                     │   (prod, same schema)     │   └──────────────────────────┘
                     └───────────────────────────┘

   ┌──────────────────── HARDWARE ─────────────────────┐
   │ OFFGRID Beacon: ESP32-S3 + SX1262 LoRa + GPS      │
   │  - BLE to the phone (pairing, trip id, contacts)  │
   │  - LoRa ping to any other beacon / base gateway   │
   │  - SOS button → store-and-forward until a phone   │
   │    or gateway with internet relays it to the API  │
   │ Simulator: `apps/beacon-sim` (Node) speaks the    │
   │ same packet format, so the demo works without kit │
   └───────────────────────────────────────────────────┘
```

### Why this shape
- **Shared pure logic (`@offgrid/core`)**: the recommender, itinerary, budget, XP, settle-up and matching score are plain TypeScript functions with no I/O. They run in the browser (so planning works with zero network) *and* on the server (so XP and leaderboards can't be faked from the client). One source of truth, one set of unit tests.
- **Server is authoritative for anything that earns XP or trust.** The client may *show* predicted XP, but only the API awards it.
- **Region data packs** are versioned JSON bundles (`region-hp@2026.10.1.json`) the client downloads and caches. Adding Uttarakhand means adding a data pack, not code. This is the scalability story.
- **Outbox pattern for offline writes**: submissions, trip check-ins and hazard reports made offline go into an IndexedDB queue with a client-generated UUID, and replay on reconnect. The UUID makes replays idempotent.

---

## 2. Tech stack and justification

| Layer | Choice | Why (1–2 lines) | Swapped from prompt? |
|---|---|---|---|
| Language | **TypeScript everywhere** | One language for web, API, core and the beacon simulator. Shared types for API contracts remove a whole class of bugs. | Chose Node over FastAPI |
| Frontend | React 18 + Vite + Tailwind | As suggested. Vite builds are fast; Tailwind keeps a consistent design system via tokens. | — |
| Routing / data | React Router + TanStack Query | Query gives caching, retry and offline-pause out of the box. | added |
| PWA | `vite-plugin-pwa` (Workbox) | Precaches app shell; runtime-caches OSM tiles for downloaded regions. | — |
| Local DB | IndexedDB via **Dexie** | Indexed queries over thousands of POIs offline; localStorage is too small and synchronous. | added |
| Maps | Leaflet + OpenStreetMap tiles | No API key. **Note:** OSM's tile policy forbids bulk pre-download; for offline regions we use a small bounded tile cache or self-host tiles (see DECISIONS). | — |
| API | Express 4 + zod | Simple, well-known; zod schemas shared with the client for validation. | — |
| Query builder / DB | **Kysely + SQLite (better-sqlite3)** for MVP; Postgres + PostGIS for prod | Zero-install DB for judges and teammates. Kysely writes the same typed queries for both dialects, and migrations live in code. Geo queries go through one module, so swapping in PostGIS `ST_DWithin` stays local. | SQLite first, as allowed |
| Geo (MVP) | Bounding-box prefilter in SQL + haversine in JS | Accurate enough for "within 10 km" on a regional dataset (< 50k rows). | — |
| Auth | Argon2id password hash, short-lived JWT access (15 min) + rotating refresh token in httpOnly cookie | Standard and safe; refresh rotation lets us revoke sessions. | — |
| Realtime chat | **Server-Sent Events + POST** (MVP), Socket.IO later | SSE survives proxies and needs no extra lib; chat volume is low. | — |
| Images | `sharp`: re-encode, resize, strip EXIF (GPS!) | EXIF stripping matters: a photo of a sacred site can leak its exact coordinates. | — |
| PII encryption | AES-256-GCM, app-level, key from env (KMS in prod) | Encrypt ID numbers, DOB, phone at rest; store only a hash for lookups. | — |
| Tests | Vitest (core + API), Playwright (one smoke e2e) | Vitest shares Vite config; fast. | — |
| Firmware | Arduino-ESP32 + RadioLib + TinyGPS++ | Most students can flash this; RadioLib covers SX1262. | — |

---

## 3. Folder structure (npm workspaces monorepo)

```
offgrid/
├─ package.json                  # workspaces + root scripts (dev, test, lint, seed)
├─ tsconfig.base.json
├─ .env.example                  # every env var, documented, no secrets
├─ README.md                     # problem, personas, how to run (Phase 8)
├─ IMPACT.md                     # feature → metric → measurement (Phase 8)
├─ docs/
│  ├─ ARCHITECTURE.md            # this file
│  ├─ DATA_MODEL.md              # ER diagram + table definitions
│  ├─ API.md                     # endpoint list
│  ├─ DECISIONS.md               # trade-offs, mocks, legal/privacy flags
│  ├─ PRIVACY.md                 # DPDP Act 2023 mapping (Phase 5)
│  └─ HARDWARE.md                # BOM, wiring, packet format (Phase 7, started early)
│
├─ packages/
│  └─ core/                      # @offgrid/core — PURE functions, no I/O, 100% unit tested
│     ├─ src/
│     │  ├─ types.ts             # Place, Trip, PlannerInput, ScoredPlace, ...
│     │  ├─ recommender/
│     │  │  ├─ filters.ts        # hard eliminations: season, difficulty, budget, days
│     │  │  ├─ score.ts          # weighted soft score + human-readable reasons
│     │  │  └─ index.ts          # recommend(input, places, rules) → top N
│     │  ├─ itinerary.ts         # day-by-day builder + "overpacked" check
│     │  ├─ budget.ts            # breakdown, 10% buffer, per person / group
│     │  ├─ packing.ts           # rule-driven list from packing-rules.json
│     │  ├─ fitness.ts           # 5-question quiz → level 1..3
│     │  ├─ season.ts            # month → open/closed/risk flags
│     │  ├─ xp.ts                # level = floor(xp/100)+1, badge evaluation
│     │  ├─ mascot.ts            # level → stage
│     │  ├─ settle.ts            # greedy settle-up
│     │  ├─ match.ts             # companion compatibility score
│     │  ├─ trust.ts             # trust score formula
│     │  ├─ geo.ts               # haversine, bbox, distance formatting
│     │  └─ plausibility.ts      # anti-cheat: speed/time/elevation checks
│     └─ test/*.test.ts
│
├─ data/                         # ALL content lives here — regions added by data
│  │                             # (validated by the zod schemas in packages/core/src/schemas.ts
│  │                             #  plus cross-field checks; run `npm run validate:data`)
│  ├─ regions/
│  │  └─ himachal/
│  │     ├─ region.json          # id, name, bbox, emergency numbers, version
│  │     ├─ places.json          # 22 treks/destinations with day plans, costs, seasons
│  │     ├─ passes.json          # road/pass closures by month (Gramphu–Batal, Kunzum)
│  │     ├─ pois.json            # curated: HPTDC stays, annual fairs (with criteria notes)
│  │     ├─ pois.osm.json        # generated by scripts/import-osm.mjs (© OSM contributors, ODbL)
│  │     ├─ hazards.json         # curated landslide/wildlife/river/lightning zones, by month
│  │     └─ hospitals.json       # 20 hospitals with level and 24 h emergency flag
│  ├─ safety-rules.json          # weather warning thresholds, hazard report expiry by kind
│  ├─ safety-guide.json          # altitude sickness guide (WMS-based), "tell someone" checklist
│  ├─ badges.json                # badge rules: {metric, op, value}, no badge logic in code
│  ├─ mascots.json               # Wanderling stages by level + species
│  ├─ xp-rules.json              # XP per level, validation multipliers, GPS plausibility thresholds
│  ├─ moderation-rules.json      # duplicate radius/similarity, vote weights, verify/flag thresholds, fuzz grid
│  ├─ traveller-types.json       # (Phase 5) quiz questions + type definitions
│  ├─ fitness-quiz.json          # 5-question fitness self-check
│  ├─ packing-rules.json
│  └─ scoring-rules.json         # weights for the recommender (tunable, not code)
│
├─ apps/
│  ├─ web/                       # PWA
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  ├─ public/                 # icons, manifest, mascot SVGs
│  │  └─ src/
│  │     ├─ main.tsx, App.tsx, routes.tsx
│  │     ├─ design/              # tokens, Button, Card, Badge, EmptyState, Skeleton, ErrorState
│  │     ├─ lib/                 # api client, db (Dexie), outbox, auth, i18n
│  │     ├─ features/
│  │     │  ├─ planner/          # inputs, results, itinerary, budget, compare, export
│  │     │  ├─ profile/          # stats, feed, badges, level-up
│  │     │  ├─ mascot/           # Wanderling SVG + animations
│  │     │  ├─ nearby/           # map + list + filters
│  │     │  ├─ places/           # hidden-place submit, detail, moderation queue
│  │     │  ├─ safety/           # weather, hazards, safety card, SOS
│  │     │  ├─ companions/       # quiz, matches, chat, report/block
│  │     │  ├─ verify/           # OTP, KYC (mock), trust
│  │     │  ├─ leaderboard/
│  │     │  ├─ expenses/
│  │     │  └─ beacon/           # pairing flow (Web Bluetooth) + simulator link
│  │     └─ sw/                  # custom service-worker hooks (sync on reconnect)
│  │
│  ├─ api/                       # Express API
│  │  ├─ src/
│  │  │  ├─ server.ts, app.ts, env.ts
│  │  │  ├─ db/                  # drizzle schema.ts, migrations/, seed.ts
│  │  │  ├─ middleware/          # auth, validate(zod), rateLimit, errors, upload
│  │  │  ├─ adapters/            # weather/, otp/, kyc/, liveness/, notify/, storage/
│  │  │  │                       #   each: interface.ts, mock.ts, <real>.ts
│  │  │  ├─ modules/             # one folder per domain: routes.ts + service.ts + repo.ts
│  │  │  │  ├─ auth/  users/  trips/  places/  moderation/  nearby/
│  │  │  │  ├─ alerts/  matching/  chat/  verification/  leaderboard/
│  │  │  │  ├─ expenses/  beacon/  sync/  regions/
│  │  │  └─ lib/                 # crypto (PII), jwt, ids, logger
│  │  └─ test/
│  │
│  └─ beacon-sim/                # Node CLI that emulates beacons + a LoRa gateway
│
└─ hardware/
   ├─ firmware/offgrid_beacon/offgrid_beacon.ino
   ├─ wiring.md
   └─ bom.csv
```

**Why feature folders, not type folders:** each phase adds one or two feature folders and touches little else, which keeps phases reviewable and lets teammates work in parallel without merge conflicts.

> ⚠️ **OneDrive warning.** This project sits in `OneDrive\Desktop`. OneDrive will try to sync `node_modules` (hundreds of thousands of files) and can lock files mid-install, causing random `EPERM` errors. Move the project to something like `C:\dev\offgrid` before Phase 1, or exclude the folder from sync. Use git + GitHub for backup instead.

---

## 4. Key flows

### 4.1 Plan a trip (works fully offline)
1. Client has the Himachal data pack in IndexedDB (downloaded on first open).
2. User fills planner → `recommend()` from `@offgrid/core` runs locally → top 3 with reasons.
3. Pick one → `buildItinerary()` + `budgetBreakdown()` + `packingList()` → saved locally as a *draft trip*.
4. When online, draft syncs to `POST /trips` (idempotent by client UUID).

### 4.2 Complete a trip and earn XP (anti-cheat)
1. User starts the trip → app records GPS breadcrumbs sparsely (every 5 min, battery-friendly) while open, or beacon pings.
2. User ends the trip → `POST /trips/:id/complete` with the track.
3. Server runs `plausibility.ts`: max speed between points, total duration vs. the trek's typical days, distance to the trailhead, elevation gain vs. DEM estimate. Result is `verified`, `partial` or `manual`.
4. XP awarded: verified 100%, partial 50%, manual capped (max 2 manual trips/month, 25% XP).
5. Badge rules re-evaluated server-side; level-up event returned to the client → mascot animation.

### 4.3 Hidden place submission
`submit (outbox if offline)` → server: EXIF strip, duplicate check (name trigram similarity + within 150 m) → status `pending` → community votes weighted by voter trust score → auto-verify at weighted score ≥ threshold, or admin review → contributor gets XP **only when verified**. Places marked *sensitive* show a ~2 km fuzzed circle instead of a pin.

### 4.4 SOS with no network
1. Beacon button held 3 s, or the app's SOS button (which also writes to the beacon over BLE).
2. Beacon broadcasts LoRa packets: `{beaconId, seq, lat, lon, battery, flags=SOS}` every 30 s, signed with an HMAC key set at pairing.
3. Any OFFGRID beacon or gateway (homestay, dhaba, forest check-post) in range stores and rebroadcasts once (TTL 3 hops).
4. The first node with internet (a gateway, or any phone running the app that receives via BLE) posts to `POST /beacons/relay`.
5. API verifies HMAC, de-duplicates by `(beaconId, seq)`, and notifies the trusted contacts with the last location, the trip plan and the nearest hospital.

---

## 5. Non-functional targets

| Concern | Target | How |
|---|---|---|
| First load on 3G | < 3 s to interactive, JS < 250 KB gz | Route-level code splitting; Leaflet lazy-loaded; no UI kit |
| Offline | Planner, nearby, safety card, packing list work with airplane mode | Data packs + SW precache |
| Data pack size | HP pack < 1.5 MB gz (without tiles) | Compact JSON; images as URLs, fetched lazily |
| Accessibility | WCAG 2.1 AA contrast, 44 px tap targets, full keyboard nav, `prefers-reduced-motion` respected by mascot | Design tokens + lint (`eslint-plugin-jsx-a11y`) |
| Security | OWASP basics | zod on every input, rate limits (auth 5/min, writes 30/min), helmet, CORS allow-list, upload MIME sniff + size cap 5 MB |
| Privacy | DPDP Act 2023 | Consent records, data minimisation, encrypted PII, export & delete endpoints (see DECISIONS) |
| Languages | English + Hindi strings | `i18n` JSON files from day one, so it is cheap to add Pahadi/other later |

---

## 6. Rough cost (for the Feasibility criterion)

| Item | MVP / pilot (1 region, ~5k users) | Scale (5 regions, ~200k users) |
|---|---|---|
| Hosting (API + DB) | ₹0 (Render/Fly free tier) – ₹800/mo small VPS | ₹8–15k/mo (managed Postgres + 2 app instances) |
| Map tiles | ₹0 (OSM, light use) | ₹3–6k/mo (MapTiler/Stadia) or self-hosted tiles on object storage |
| Weather | ₹0 (Open-Meteo non-commercial) | Open-Meteo commercial plan or IMD partnership |
| SMS OTP | ~₹0.15–0.25 per SMS | ~₹30–50k/mo at scale; push email/WhatsApp OTP to reduce |
| eKYC (DigiLocker via a licensed partner) | ₹0 mocked | ~₹3–15 per verification via a KYC vendor |
| Beacon unit (BOM) | ≈ ₹2,450–3,350 per unit at retail (detailed in HARDWARE.md) | ≈ ₹1,200 at 1k units |
| Gateway (homestay rooftop) | ≈ ₹3,500 each | Funded by tourism dept / panchayat / homestay listing fee |

All numbers are **estimates** to be re-verified before the pitch; sources go in IMPACT.md.

---

## 7. Phase map (revised)

| Phase | Delivers | Demo-able result |
|---|---|---|
| 1 | Seed data (20+ HP places), `@offgrid/core` recommender + itinerary + budget + packing, unit tests, planner UI | Plan a 3-day trip offline |
| 2 | Auth, profile, XP/levels/badges, mascots, trip history, persistence | Complete a trip → level up → mascot evolves |
| 3 | Nearby, hidden places + moderation, offline data packs | Add a hidden café offline, it syncs and gets voted on |
| 4 | Weather, hazards, safety card | 7-day forecast + landslide warning on the Hampta route |
| 5 | Traveller types, matching, chat, verification (mock KYC), trust | Two verified users match for Kheerganga |
| 6 | Leaderboards + anti-cheat, expense splitter, compare | Settle-up for 4 friends in 3 payments |
| **7 → runs alongside 1–6** | Beacon firmware, BOM, simulator, pairing UI | **Press SOS with Wi-Fi off → contact gets an alert** |
| 8 | Polish, README, IMPACT.md, pitch outline, 3-min demo script | Final rehearsal |
