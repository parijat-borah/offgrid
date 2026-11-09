# OFFGRID

**Trek further, stay found.** An offline-first, gamified trek and travel companion for young Indian travellers,
with a ₹2,500 LoRa SOS beacon for the places where phones stop working.

*SIH 2026 · PS 26216 (AICTE / MIC Student Innovation) · Hardware category · Hospitality and tourism. Himachal Pradesh first.*

📄 [Impact and metrics](IMPACT.md) · [3-minute demo](docs/DEMO.md) · [Pitch deck outline](docs/PITCH.md) · [Hardware](docs/HARDWARE.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [API](docs/API.md) · [Decisions and legal flags](docs/DECISIONS.md) · [Privacy (DPDP)](docs/PRIVACY.md)

---

## The problem

- Himachal received **1.80 crore tourists in 2024**.
- In the July 2023 monsoon, **873 roads were blocked in one day** and **over 2,000 stranded tourists** were
  evacuated from Kasol alone.
- In a 2024 survey of 1,214 Indian women, **~59% had faced harassment while travelling** and **~90% put safety
  first** when choosing where to go.

Sources for all three are in [IMPACT.md](IMPACT.md#1-the-problem-in-numbers-sourced).

For young and solo travellers that adds up to five concrete problems:

1. **Unsafe or unverified companions.** Trek buddies come from WhatsApp groups of strangers.
2. **No offline, trustworthy local info.** Where to eat, rest, find a toilet or water, and the homestay that
   isn't on any map.
3. **Poor hazard awareness.** Landslides, snow, lightning, bear zones and river crossings.
4. **Bad planning and budgeting.** The wrong season, a trek too hard for you, overspending.
5. **Invisible local businesses.** Homestays, dhabas and guides off mainstream maps miss the income.

**Hypotheses we'll measure.** Where no public data exists (overspending, how people find buddies, local
discovery), [IMPACT.md](IMPACT.md) labels the claim a hypothesis and says how a 4-week pilot will measure it.

## Who it's for (illustrative personas)

| Persona | Need | OFFGRID gives them |
|---|---|---|
| **Asha, 21**, student, weekend trekker | A trek that fits ₹8,000, her fitness and October | Planner with reasons, budget, packing, weather and hazards, offline |
| **Riya, 24**, solo woman traveller | A buddy she can trust | Trip-scoped matching, ID-verified women-only option, masked contact details, ratings |
| **Dorje, 38**, homestay owner, Kareri | Guests who can find him | Community-verified hidden places, approximate locations for fragile sites |
| **Maa**, Asha's mother | To know Asha is OK | An SOS that works with no signal, an SMS, and a live map, with no app needed |

## How OFFGRID meets the SIH criteria

| Criterion | Where to see it |
|---|---|
| **1. Real problem** | Sourced numbers above; personas; [IMPACT.md](IMPACT.md) |
| **2. Technology** | Rule-based scoring with reasons (`packages/core/src/recommender`); GPS plausibility and fair-play **anomaly checks**; duplicate detection and trust-weighted moderation; contact-detail masking; **geospatial** nearby, hazard-radius and nearest-hospital queries; **offline sync** (IndexedDB pack + idempotent outbox); **IoT beacon** with HMAC-signed LoRa mesh packets |
| **3. Novelty** | Trip-scoped *verified* buddy matching; crowdsourced **offgrid** places with ecology safeguards; gamification that rewards **safe** behaviour (XP only for verified trips, challenges for confirming hazards); SOS with **no network at all** |
| **4. Feasibility** | 268 automated tests; no paid APIs (OpenStreetMap, Open-Meteo); SQLite on one small server; every external service behind an adapter with a mock; BOM and wiring in [HARDWARE.md](docs/HARDWARE.md) |
| **5. Measurable impact** | Each feature mapped to a metric, a measurement method and a pilot target in [IMPACT.md](IMPACT.md) |
| **6. Scalability** | A new region is **data, not code**: a folder under `data/regions/`, validated by `npm run validate:data`. Every beacon is also a relay |

---

## Run it on your own computer (VS Code)

Follow these steps on any Windows, macOS or Linux computer. You don't need an ESP32, a paid API key or a separate
database: the database is a SQLite file that the app creates for you.

### 1. Install the tools

| Tool | Version | Download |
|---|---|---|
| **Node.js** (includes npm) | 22 or newer | <https://nodejs.org> |
| **Git** | Any recent version | <https://git-scm.com/downloads> |
| **VS Code** | Any recent version | <https://code.visualstudio.com> |

Then open a new terminal and check that they work. The first command should print `v22` or higher:

```bash
node --version
```

```bash
git --version
```

### 2. Download the project

Choose a folder **outside OneDrive, Dropbox or iCloud** (for example `C:\dev` on Windows), because sync tools lock
files inside `node_modules`. Open a terminal in that folder and run:

```bash
git clone https://github.com/sameeksha0002-sys/offgrid.git
```

### 3. Open it in VS Code

In VS Code, choose **File → Open Folder…** and select the `offgrid` folder you just downloaded. Then open the
built-in terminal with **Terminal → New Terminal** and run all the remaining commands there.

### 4. Install the dependencies

This takes a few minutes the first time:

```bash
npm install
```

### 5. Create the demo data

This creates `apps/api/.env` with fresh random secrets, then builds a database with demo travellers, trips, places,
a hazard report and a paired beacon:

```bash
npm run demo
```

### 6. Start the app

```bash
npm run dev
```

Keep this terminal open while you use the app. It starts two servers:

- **Web app:** <http://localhost:5173> (open this one in your browser)
- **API:** <http://localhost:4000/api/v1/health> (should show `"ok":true`)

### 7. Log in

Open `apps/api/demo-accounts.local.txt` in VS Code. The file lists the email and random password for each demo
account, and is never committed. Log in as **Asha**, then follow the walkthrough in [docs/DEMO.md](docs/DEMO.md).
Log in as **Meera** to see the moderator tools.

To stop the app, click the terminal and press `Ctrl+C`.

### Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app |
| `npm run demo` | **Deletes the local database** and rebuilds the demo data with new passwords. Stop `npm run dev` first |
| `npm test` | Runs all 268 tests (core logic, API, beacon simulator) |
| `npm run typecheck` | Checks the TypeScript types |
| `npm run build` | Builds the production PWA into `apps/web/dist` |
| `npm run validate:data` | Runs only the seed-data and game-rule checks |

**Try the SOS beacon without hardware:** open a second terminal while the app is running, then paste the simulator
command from `apps/api/demo-accounts.local.txt`. Press `s` to send an SOS and `c` to cancel it.

### Troubleshooting

| Problem | Fix |
|---|---|
| `npm` is blocked with "running scripts is disabled" (Windows) | In VS Code's terminal, click the **˅** beside **+**, choose **Command Prompt**, and run the command there |
| `JWT_ACCESS_SECRET is not set` | Run `npm run demo` or `npm run dev` from the project's root folder. Either one creates `apps/api/.env` |
| `Email or password is wrong` with a demo login | Each `npm run demo` creates new passwords, so copy them from the file again. If that fails, see the next row |
| `Port 5173 is in use`, or the app shows old data | Another copy of OFFGRID is still running, possibly in a different VS Code window or terminal. Stop it with `Ctrl+C`, then run `npm run dev` again |
| `Couldn't delete ...offgrid.db` | `npm run dev` is still running. Stop it, then run `npm run demo` again |
| `Too many requests` | The login rate limit was reached. Wait a minute and try again |
| `EPERM` or `EBUSY` during `npm install` | The project is probably in a synced folder. Move it out of OneDrive, then delete `node_modules` and run `npm install` again |
| `better-sqlite3` fails to install | Check `node --version` is 22 or newer. If it still fails, install C++ build tools (Windows: "Desktop development with C++" in Visual Studio Installer; macOS: `xcode-select --install`; Linux: `build-essential`) |
| Weather doesn't load | The forecast needs internet. For offline demos, set `WEATHER_MODE=mock` in `apps/api/.env` and restart |

## What's real and what's mocked ⚠️

| Part | Status |
|---|---|
| Planner, itinerary, budget, packing, compare, expense splitter | **Real.** Runs on the phone, offline |
| XP, badges, mascot, challenges, leaderboards, GPS plausibility, fair play | **Real** |
| Region pack (22 places, 821 OpenStreetMap points, 15 hazards, 20 hospitals) | **Real data**. Costs are estimates, each with a source and a date |
| Place photos (65 photos, all 22 places) | **Real**, from Wikimedia Commons. Every one is freely licensed (CC0, public domain, CC BY, CC BY-SA) and credited on screen |
| Trail lines (7 treks) | **Real**, routed on OpenStreetMap footpaths between named trailheads and destinations. Treks where OSM is incomplete show a pin rather than a guessed line |
| Hidden places, moderation, hazard reports, buddy matching, chat, ratings, trust | **Real** |
| Weather | **Real** (Open-Meteo); `WEATHER_MODE=mock` for offline demos |
| Phone and email OTP | **Mock**: the code is shown on screen in demo mode |
| Government ID (DigiLocker) and selfie check | **Mock**, behind adapters, with clearly labelled simulated consent screens |
| SOS SMS to contacts | **Mock**: the app shows the exact SMS text. Real delivery needs a DLT-registered sender |
| Beacon packets, relay, pairing, SOS to contacts' live page | **Real**, tested end to end with the simulator |
| Beacon firmware | **Written, not yet compiled** (no ESP32 toolchain here). Run `SELFTEST` after the first flash |
| "Simulated GPS track" button | **Demo only.** Labelled in the UI, kept off leaderboards, refused by the server in production |

Every mock is refused in production (`NODE_ENV=production` won't start with mock OTP, KYC, liveness or SMS).

---

## Feature tour, phase by phase

### Phase 1: planner
- **Trip planner:** you enter budget, days, month, fitness, group size and vibes, and get the top 3 places.
  - Every pick comes with reasons.
  - A "why not the others" list explains what was ruled out.
  - Suggestions show what would unlock more places.
- **Plan view:**
  - A day-by-day itinerary with warnings for altitude sickness and overpacked days.
  - A budget breakdown per person and per group.
  - A rule-driven packing list you can tick off.
  - A safety tab.
  - Download as `.txt`, or copy a share link.
- **Seed data:** 22 Himachal places. Every cost is labelled as an estimate, with a source and a date.

### Phase 2: profile, XP and mascots
- **Accounts:**
  - Sign-up is for 18+ only, with recorded consent.
  - Passwords are hashed with Argon2id, and the birth year is encrypted with AES-256-GCM.
  - Sessions use rotating refresh tokens, and a stolen token is detected the first time it's reused.
- **Trips:**
  - Save a plan, start the trip, record GPS (buffered on the phone when there's no signal), then finish it.
  - The server grades the track:
    - **GPS-verified:** 100% XP.
    - **Partly verified:** 50%.
    - **Manual:** 25%, and only 2 a month.
- **XP and levels:**
  - `level = floor(xp / 100) + 1`.
  - XP is kept in an append-only ledger, so it can always be recalculated.
  - The same trip or badge can never pay out twice.
- **Badges:** 9 badges, defined in `data/badges.json` as data rules rather than code. Progress bars and "explore more" nudges show what's next.
- **Wanderling mascot:**
  - 3 species: snow leopard, Himalayan monal and red panda.
  - 4 stages, with gear added at each one: cap, then backpack, then a prayer-flag scarf and flag.
  - An idle animation and a level-up "evolve" animation, both turned off for reduced-motion users.
- **Profile:** stats, badges, a journey timeline with route drawings, and profile editing.
- **Your data:** download all your data, or delete the account immediately (DPDP Act 2023).

### Phase 3: nearby, hidden places and offline
- **Nearby:** 836 real points of interest, made up of:
  - 821 from OpenStreetMap: food, stays, camping, restrooms, water, ATMs, medical and viewpoints;
  - 15 curated: government-run HPTDC stays and the big annual fairs.
  - **Filters:** category, veg/vegan, women-friendly, family, free, price, open now and distance, plus "along my route" during an active trip.
  - **Views:** a list (the primary, accessible view) and a Leaflet/OSM map.
- **Opening hours:** a small parser for OpenStreetMap's opening-hours format. It understands more than 80% of the real data and reports "unknown" rather than guessing.
- **Hidden places:**
  - **Adding:** pin on a map or use your location, tips, tags, price, seasonal months, and up to 3 photos.
  - **Photos:** shrunk on the phone, then re-encoded on the server, which removes location data.
  - **Sensitive places:** sacred or fragile sites can be shown only as an approximate ~2 km area.
  - **Duplicates:** checked by name similarity within 150 m.
- **Community moderation:**
  - Trust-weighted upvotes verify a place; flags send it to a moderator.
  - Moderators see the exact pin and can approve, reject or mark it a duplicate.
  - A verified place earns +50 XP and the 🧭 Explorer badge. If it's later rejected, that XP is taken back.
- **Offline:**
  - **Region pack:** downloaded to IndexedDB, about 42 KB gzipped, and checked for updates with an ETag.
  - **First launch with no signal:** the app falls back to the built-in copy.
  - **Writes:** submissions and photos queue in an outbox and upload when there's signal.
  - **App shell:** a service worker (vite-plugin-pwa) precaches it, and the map tiles you view are cached.

Refresh the OSM data with `node scripts/import-osm.mjs himachal 3000`. To make someone a moderator, run
`npm run set-role -w @offgrid/api -- someone@example.com moderator`.

### Phase 4: weather, hazards and safety
- **Weather tab:**
  - A live 7-day forecast from Open-Meteo at two heights: the base town and the trip's highest point.
  - Warnings tied to the route, grouped by kind so they stay readable (for example, "Hard frost, 7 days, worst −17 °C").
  - The forecast is saved on the phone and shows its age when you're offline.
- **Safety card:**
  - Emergency numbers you can tap to call.
  - The nearest hospitals, with 24-hour emergency flags and directions.
  - Hazards for the trip's month.
  - An altitude-sickness guide based on the Wilderness Medical Society guidelines.
  - A "tell someone" checklist, plus "Share my plan" through the share sheet or WhatsApp.
- **Hazards:**
  - 15 curated risk zones, including the Malling Nallah slide, Parvati flash floods, bear and leopard areas, and lightning-exposed ridges.
  - Traveller reports go live immediately, expire on their own, can be confirmed ("Still there") or cleared ("It's gone"), and work offline through the outbox.
- **Trip alerts:**
  - The 🔔 icon in the header lists alerts for your planned and active trips, computed on the phone so they work offline.
  - It can also send a notification on this device for serious alerts.
- **Trips:** now have a start date. Weather alerts start 7 days before you go.

Set `WEATHER_MODE=mock` in `apps/api/.env` for demos without internet.

### Phase 5: travel buddies, verification and trust
- **Verification:**
  - Phone and email by one-time code. In demo mode the code is shown on screen.
  - Government ID through a **simulated DigiLocker** consent screen. Only the document type, its last 4 characters and gender are kept; the name and number are discarded.
  - A selfie check that is simulated, done in memory and never stored.
  - Each step adds to a 0–100 **trust score** that you can see broken down point by point. Upheld reports subtract from it.
- **Traveller-type quiz:** 6 questions sort you into one of 6 types (Summit Chaser, Slow Wanderer, Foodie Nomad, Budget Backpacker, Photographer, Spiritual Seeker).
- **Travel buddies:**
  - Matching is trip-scoped: other travellers going to the same place on overlapping dates who opted that trip in.
  - Each match is scored on dates, destination, pace, budget, fitness and vibes, with plain reasons.
  - A match shows only first name, emoji avatar, age band, traveller type, trust and badges.
  - Filters for women-only, same gender, ID-verified only, age range and visibility apply in both directions.
- **Chat:**
  - Requests, then chat inside OFFGRID with live updates.
  - Phone numbers, emails, UPI IDs and social handles stay hidden until **both** people tap "Share contact".
  - Report and block are one tap away, and moderators review reports.
- **Privacy:** see [docs/PRIVACY.md](docs/PRIVACY.md) for the DPDP Act 2023 mapping.

### Phase 6: leaderboards, challenges, expenses and compare
- **Leaderboards** (Profile → 🏆):
  - Monthly seasons, ranked by XP, distance, height climbed or verified places added.
  - Scopes: everyone, Himachal and your buddies.
  - Opt-in only. Only your name, avatar and level are shown, and blocked users are hidden.
- **Fair play:**
  - Trips with simulated GPS, overlapping tracks, more than 2 finishes in a day or no track stay off the boards.
  - They still count towards your own level, and the board tells you which of your trips were left out and why.
- **Monthly challenges and streaks:**
  - Four challenges a month (data in `data/challenges.json`), plus bonus XP for verified trips in consecutive months.
  - Only trips that pass fair play count.
- **Buddy ratings:**
  - Once your trip has ended you can give your buddy 1–5 stars and tags.
  - They see only their average, and good ratings add up to 10 trust points.
- **Group expense splitter** (trip → Split):
  - Equal or exact splits, live balances and the fewest payments to settle up.
  - "Pay via UPI" opens the payer's UPI app with the amount filled in. **OFFGRID never handles money.**
  - Everything stays on the phone (IndexedDB) and works offline.
- **Compare mode:** compares two places side by side for your own budget, month and fitness, with a tick on whichever is better for you. Open it from Results or from "Compare with…" on any plan.

### Phase 7: SOS beacon
- **SOS from the app** (red **SOS** button in the header, always visible):
  - 112 and other helplines come first, then a 5-second countdown you can cancel.
  - Your location goes to your **emergency contacts** by SMS, with a live-status link.
  - With no signal, the SOS waits in the outbox and sends itself as soon as any network appears.
- **Emergency contacts** (Profile → SOS beacon): up to 5. You confirm each person agreed.
- **Live-status page for contacts** (no login): a map with the track, battery, the trip plan, the nearest hospitals and call buttons. It refreshes every 20 s and expires 72 h after the SOS ends.
- **OFFGRID Beacon** (ESP32-S3 + SX1262 LoRa + GPS, about ₹2,500–3,400):
  - Hold its button 3 s for an SOS.
  - Other beacons relay it up to 3 hops, and a Wi-Fi gateway or any phone running OFFGRID (over Bluetooth) uploads it.
  - Packets are HMAC-signed and replay-protected.
- **Firmware** in [`firmware/offgrid_beacon`](firmware/offgrid_beacon). **Not compiled yet**: run `SELFTEST` after the first flash.
- **Hardware guide:** [docs/HARDWARE.md](docs/HARDWARE.md) has the bill of materials, wiring, flashing, pairing, gateway setup and India radio rules.
- **No hardware?** The simulator sends real signed packets through simulated LoRa relays to the API:
  ```
  npm start -w @offgrid/beacon-sim -- --pair "PAIR <id> <key>"
  ```
  Press `s` for SOS and `c` to cancel. The pairing screen shows the exact command in demo mode.
- **Mocks:** SMS is mocked (`SMS_MODE=mock`); the app shows the exact message each contact would get. Real SMS needs a DLT-registered sender.

### Photos and trail maps
- **Photos:**
  - every place has freely licensed photos from Wikimedia Commons, with the author and licence shown on each one;
  - they appear on search-result cards, in a swipeable gallery on the plan, in Compare, on trips and in Nearby;
  - they're cached after the first view so they work offline, with a clear placeholder if never seen offline.
- **Trail maps:** 7 treks (Triund, Kheerganga, Tosh, Hampta Pass, Beas Kund, Serolsar Lake, Churdhar) have their
  real OpenStreetMap trail line.
  - **Results:** a mini trail shape on the card.
  - **Plan:** a full map in the plan's **Route** tab, with trailhead and destination markers and hazards near the
    line, plus "Directions to the trailhead" (Google Maps), "Open in OpenStreetMap" and a **GPX download** for
    offline map apps.
  - **Trips:** your recorded GPS track drawn over the trail.
  - **SOS page:** your contacts see the planned trail.
  - **Nearby:** "Search along the Triund trail" finds water, food and toilets on the way.
- **Honest gaps:** Kareri Lake, Bhrigu Lake, Indrahar Pass, Chandrakhani Pass, Prashar Lake, Chandratal and Pin
  Parvati show a destination pin, not a line. OSM is missing a section there, and the importer rejects routes
  that would detour.

### Responsive app layout
- **Laptops and desktops (≥1024 px):**
  - a fixed sidebar with every destination, a large SOS button and the offline status, plus a top bar showing
    where you are, sync state and your level;
  - content uses up to 1280 px.
- **Multi-column screens:**
  - **Results:** a card grid with full-bleed photos.
  - **Plan:** content on the left and a sticky summary panel with Save and Share.
  - **Nearby:** results beside a full-height map.
  - **Trip detail:** actions beside the route map.
  - **Profile:** identity beside activity.
- **Phones:** the same screens stack in reading order, with a thumb-reach bottom bar and sticky main buttons.
  Tablets get the photo mosaic and two-column grids.
- **Look and feel:** self-hosted Inter and Plus Jakarta Sans fonts (precached for offline use), Lucide icons in
  the navigation, and softer card shadows. axe-core finds no WCAG 2.1 AA violations at laptop or phone width.

### Phase 8: polish and demo
- **`npm run demo`:** one command builds the demo world through the real API, so every XP, fair-play and
  moderation rule applies.
  - Five GPS-verified trips spread over the month, and a pending buddy request.
  - A chat with a masked phone number, and a verified hidden homestay plus one awaiting votes.
  - A live landslide report, an emergency contact and a paired beacon.
- **Accessibility:** an automated axe-core (WCAG 2.1 AA) audit of 19 screens at phone width found **zero
  violations** after these fixes:
  - darker accent orange for contrast;
  - heading order in the planner;
  - valid list markup in the chat.
- **Anti-cheat hardening:**
  - the phone can no longer label its own GPS points as "beacon" (only signed relay packets can);
  - simulated tracks are refused in production.
- **Docs:** [IMPACT.md](IMPACT.md), [docs/DEMO.md](docs/DEMO.md) (3-minute script, fallbacks, likely judge
  questions) and [docs/PITCH.md](docs/PITCH.md) (10-slide outline).

### Demo tip
On an active trip, the **🧪 Add a simulated GPS track** button (dev mode only, or with `VITE_DEMO_MODE=true`) lets you
show the whole flow indoors: start a trip, add the simulated track, finish, and the level-up screen appears.

### Add or edit content
- **Places:** `data/regions/himachal/places.json`.
- **Badges, mascots and XP rules:** `data/badges.json`, `data/mascots.json` and `data/xp-rules.json`.
- **Photos:** pick freely licensed Commons files in `scripts/photo-picks.json`, then run
  `node scripts/import-photos.mjs`. Use `--candidates` to browse options.
- **Trails:** add the trailhead and destination to `scripts/import-trails.mjs`, then run
  `node scripts/import-trails.mjs`. It downloads OSM tiles politely and caches them in `scripts/.osm-cache`.
- After any edit, run `npm run validate:data`. A new region is a new folder under `data/regions/`; no code change is needed.

### Not yet (after the hackathon)
- Photos on completed trips (the upload pipeline exists now; wiring it into trips is small).
- Downloading a whole region's map tiles in advance. OSM's tile policy forbids bulk downloads, so this needs self-hosted tiles.
- Syncing the expense splitter between friends' phones (today one phone keeps the ledger and shares a summary).
- Real SMS delivery (DLT registration), an "overdue trip" alert to contacts, and Web Push.
- Beacon power saving (duty-cycled receive) for multi-day battery life.


## Repository Structure

The project is organized into the following directories:

- - `.claude/` — Claude Code configuration
`apps/` – Application code
- `data/` – Project data
- `docs/` – Project documentation
- `firmware/` – SOS beacon firmware
- `packages/` – Shared code packages
- `scripts/` – Utility scripts