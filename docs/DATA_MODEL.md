# OFFGRID: Data Model (Phase 0)

Two kinds of data:

1. **Content** (places, POIs, hazards, seasons, badges, rules) lives in `data/**/*.json`, validated by JSON Schema, versioned per region, and **loaded into the DB by `seed.ts`**. The client also caches it as a data pack. Editing content never needs a code change.
2. **User-generated** (users, trips, submissions, votes, chats, expenses, beacon events) lives only in the DB.

Conventions: `id` is a UUIDv7 (time-sortable, generated client-side for offline writes). All timestamps are UTC ISO strings. 🔒 = encrypted at rest (AES-256-GCM). `#` = indexed.

---

## 1. ER diagram (text)

```
                           ┌──────────────┐
                           │   regions    │
                           └──────┬───────┘
                 1..*  ┌──────────┼────────────┬──────────────┐
                       ▼          ▼            ▼              ▼
                 ┌──────────┐ ┌────────┐ ┌───────────┐ ┌────────────┐
                 │  places  │ │  pois  │ │  hazards  │ │ hospitals  │
                 │ (treks / │ │ (food, │ │ (curated +│ └────────────┘
                 │  destin.)│ │ stay,  │ │ crowd,    │
                 └────┬─────┘ │ wc...) │ │ expiring) │
                      │       └───┬────┘ └─────┬─────┘
                      │           │ 0..1       │ reported_by 0..1
                      │           │ from       │
                      │      ┌────▼──────────────┐
                      │      │ place_submissions │◄──── submission_votes ────┐
                      │      │ (hidden places)   │      (user, weight)       │
                      │      └────▲──────────────┘                           │
                      │           │ submitted_by                              │
 ┌──────────┐  1  ┌───┴───────────┴──────────────────────────────────────────┴──┐
 │ sessions ├────►│                            users                            │
 └──────────┘     │  profile · traveller_type · xp · level · trust_score        │
                  └─┬──────┬──────────┬───────────┬────────────┬──────────┬─────┘
          1..*      │      │          │           │            │          │
        ┌───────────▼┐ ┌───▼──────┐ ┌─▼─────────┐ ┌▼──────────┐ ┌▼────────┐ ┌▼──────────────┐
        │   trips    │ │user_badges│ │verifications│ │xp_events  │ │ trusted_│ │match_prefs    │
        │ (planned / │ │          │ │(otp/email/ │ │(ledger,   │ │ contacts│ │(1:1)          │
        │  active /  │ └──────────┘ │ kyc/selfie)│ │ source of │ └─────────┘ └───────────────┘
        │  completed)│              └────────────┘ │ truth)    │
        └──┬──────┬──┘                             └───────────┘
           │      │
   ┌───────▼──┐ ┌─▼───────────┐     ┌───────────────┐      ┌─────────────────┐
   │trip_points│ │trip_members │◄────┤ expense_groups├─────►│ expenses        │
   │(GPS track)│ │(user, role) │     │ (1 per trip)  │      │ + expense_shares│
   └──────────┘ └─────────────┘     └───────────────┘      └─────────────────┘

   users ──< match_requests >── users       (from, to, trip context, status)
   match_requests (accepted) ── 1 ── conversations ──< messages
   users ──< reports  (target: user | message | submission | hazard)
   users ──< blocks
   users ──< peer_ratings >── users  (after a shared completed trip only)
   users ──< beacons ──< beacon_events   (SOS, ping, battery)
   users ──< consents  (DPDP: purpose, granted_at, withdrawn_at)
   leaderboard_snapshots (season, scope, metric, rank, user)  ← materialised nightly
```

---

## 2. Content tables (seeded from `data/`)

### `regions`
| col | type | notes |
|---|---|---|
| id | text PK | `himachal` |
| name | text | |
| bbox | json `[minLon,minLat,maxLon,maxLat]` | for offline tile/POI scope |
| emergency | json | `{police:"112", ambulance:"108", disaster:"1070", tourist_helpline:"1363"}` |
| pack_version | text | `2026.10.1`; client re-downloads when it changes |

### `places` (treks and destinations, ≥ 20 for HP)
| col | type | notes |
|---|---|---|
| id | text PK | `triund` |
| region_id # | FK regions | |
| name, slug | text | |
| type | enum | `trek`, `town`, `valley`, `lake`, `pass`, `camp` |
| lat, lon # | real | trailhead / centre |
| difficulty | int 1–3 | |
| days_min, days_max | int | |
| max_altitude_m | int | drives packing + AMS warnings |
| distance_km, elevation_gain_m | real | for XP and plausibility |
| good_months | json int[] | `[3,4,5,9,10,11]` |
| risky_months | json `{month:int, reason:string}[]` | monsoon landslides etc. |
| vibes | json string[] | `["camping","sunset","beginner","party","spiritual"]` |
| cost (json) | `stay, food, local_transport, activities` ₹ pp/day (twin sharing); `activities_once, transport_roundtrip, permit` ₹ pp/trip | **all labelled estimate** (`is_estimate: true`) |
| plan, extras | json | base day plan (length = days_min) + optional days (`acclimatise` / `side_trip` / `rest`, inserted after `after_day`), each with `trek_km`, `sleep_alt_m` |
| access_via | json string[] | refs into `passes.json`; a closed pass closes the place that month |
| cost_source | text | URL or "field survey, Oct 2026" |
| cost_last_verified | date | shown in UI as "prices checked Oct 2026" |
| base_xp | int | |
| hazards | json string[] | refs into `hazards.id` |
| safety_notes | json string[] | |
| permits | json | e.g. Spiti ILP rules, Rohtang permit |
| nearest_hospital_id | FK hospitals | |
| sensitive | bool | fuzz location (sacred / fragile) |

### `pois` (nearby: food, stays, restrooms, water, events)
| col | type | notes |
|---|---|---|
| id | text PK | |
| region_id #, lat #, lon # | | bbox prefilter index on (lat, lon) |
| category # | enum | `food`, `stay`, `restroom`, `water`, `fuel`, `atm`, `pharmacy`, `guide`, `event`, `viewpoint`, `camp` |
| name, description | text | |
| price_band | int 1–3 | ₹ / ₹₹ / ₹₹₹ |
| tags | json | `veg`, `vegan`, `women_safe`, `family`, `wheelchair`, `upi` |
| hours | json | OSM `opening_hours` string, parsed by `opening_hours` lib for "open now" |
| event_start, event_end | ts nullable | for events (Kullu Dussehra, Bir billing open) |
| source | enum | `curated`, `osm`, `community` |
| submission_id | FK nullable | if promoted from a hidden-place submission |
| verified_at | ts | |

### `hazards`
| col | type | notes |
|---|---|---|
| id | text PK | |
| region_id #, kind # | | `landslide`, `bear`, `leopard`, `snake`, `river_crossing`, `avalanche`, `road_closure`, `flash_flood` |
| geometry | json | point + radius_m (MVP) → GeoJSON polygon with PostGIS |
| severity | int 1–3 | |
| months | json int[] | when active |
| source | enum | `curated`, `community`, `official` |
| reported_by | FK users nullable | |
| expires_at # | ts nullable | community reports expire (default 72 h); curated don't |
| confirmations | int | other users confirming extends expiry |

> **As implemented (Phase 4):** curated hazards live in `data/regions/himachal/hazards.json` (`months`, `place_ids`, `radius_m`, `source_note`). Traveller reports are in the DB tables `hazard_reports (id = client UUID, kind, severity, description, lat, lon, radius_m, status, confirmations, clears, created_at, expires_at)` and `hazard_actions (report_id, user_id, action: confirm | clear)`. Both are merged into the region pack in the same `Hazard` shape.

### `hospitals`, `badges`, `mascots`, `traveller_types`
Straight from JSON. `badges.rule` is a small declarative rule, e.g.
`{"metric":"treks_completed","op":">=","value":3}` or `{"metric":"trip_total_cost_pp","op":"<","value":5000}`, evaluated by `core/xp.ts`. No badge logic is hardcoded.

---

## 3. User tables

### `users`
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| email # unique | text | lower-cased |
| phone_hash # unique | text | HMAC-SHA256 of E.164 phone, for lookup |
| phone_enc 🔒 | blob | only decrypted for OTP send |
| password_hash | text | Argon2id |
| display_name, avatar_url, bio, home_city | text | |
| gender | enum nullable | `woman`, `man`, `nonbinary`, `prefer_not` (self-declared; used only for match filters the user opts into) |
| birth_year 🔒 | int | **year only** (data minimisation). 18+ enforced at signup |
| style_tags | json | |
| traveller_type | text FK traveller_types | from quiz |
| fitness_level | int 1–3 | |
| xp | int | cache; `xp_events` is the source of truth |
| level | int | `floor(xp/100)+1`, cached |
| mascot_species | enum | `snow_leopard`, `monal`, `red_panda` |
| trust_score | real 0–100 | recomputed on events |
| leaderboard_opt_in | bool default false | fair-play: opt-in |
| role | enum | `user`, `moderator`, `admin` |
| created_at, updated_at | ts | Deletion is an immediate hard delete that cascades (DECISIONS D16) |

### `sessions`
`id, user_id #, family_id #, token_hash, user_agent, created_at, expires_at, revoked_at, replaced_by`. The refresh token is rotated on every use; reusing an old token revokes the whole family.

> **Implemented in Phase 2:** `users`, `sessions`, `consents`, `trips`, `trip_points`, `xp_events`, `user_badges` (see `apps/api/src/db/migrations.ts`). `trips` also stores `validation_reasons` (JSON) and `xp_awarded`; itinerary and budget are recomputed from `planner_input`, not stored. `trip_points` is keyed by `(trip_id, ts)`, so re-uploading buffered points is harmless.

### `verifications`
| col | type | notes |
|---|---|---|
| id, user_id # | | |
| tier | enum | `phone`, `email`, `gov_id`, `liveness` |
| status | enum | `pending`, `verified`, `failed`, `expired` |
| provider | text | `mock`, `digilocker`, ... |
| ref_token 🔒 | blob | provider's reference, **not** the ID number |
| id_last4 | text nullable | e.g. last 4 of Aadhaar for display. Full number is never stored |
| name_match | bool | KYC name ≈ display name |
| verified_at, expires_at | ts | |

### `consents` (DPDP Act 2023)
`id, user_id #, purpose (kyc|location|matching|marketing), notice_version, granted_at, withdrawn_at`

### Place media (static data, in the region pack)
- `data/regions/himachal/photos.json`: `{source, generated, photos: {placeId: [{file, url, width, height, author, license, license_url, source_url, caption}]}}`. Built by `scripts/import-photos.mjs`.
- `data/regions/himachal/trails.json`: `{source: "OpenStreetMap", license: "ODbL-1.0", attribution, note, trails: [{place_id, start, end, length_km, trail_share, way_names, coords: [[lat, lon], …]}]}`. Built by `scripts/import-trails.mjs`.
- Both are optional and validated in `@offgrid/core`:
  - every place they mention must exist;
  - each line must reach its named destination;
  - the destination must be within 10 km of the place;
  - photo licences must be free.

### `trusted_contacts` (migration 006)
`id, user_id #, name, phone_enc 🔒, phone_last3, created_at`. At most 5 per user; SMS only (overdue and trip-start alerts are later work).

### `trips`
| col | type | notes |
|---|---|---|
| id | uuid PK (client-generated) | idempotent sync |
| owner_id # | FK users | |
| place_id # | FK places | |
| status # | enum | `draft`, `planned`, `active`, `completed`, `cancelled` |
| start_date, end_date | date | |
| group_size | int | |
| planner_input | json | exactly what the user entered (reproducible) |
| itinerary | json | output of `buildItinerary` |
| budget | json | output of `budgetBreakdown` |
| actual_spend_pp | int nullable | for "money saved" impact metric |
| validation | enum | `verified`, `partial`, `manual` |
| distance_km, elevation_gain_m | real | computed from track |
| notes, photos | text, json | |
| share_token # | text nullable | for shareable links (random, revocable) |
| overdue_at | ts | end_date + grace → trusted-contact alert |
| completed_at | ts | |

### `trip_points`
`trip_id #, ts, lat, lon, alt, accuracy_m, source (gps|beacon|manual)`. Kept 90 days then summarised (privacy).

### `trip_members`
`trip_id, user_id, role (owner|member)`, PK (trip_id, user_id).

### `xp_events` (append-only ledger)
`id, user_id #, amount, reason (trip_complete|challenge|contribution_verified|streak|badge), ref_id, created_at, season #`.
User XP = `SUM(amount)`. Leaderboards and anti-cheat audits read from here, so XP can always be re-derived.

### `user_badges`
`user_id, badge_id, awarded_at`, PK (user_id, badge_id).

### `place_submissions` (hidden / underground places)
| col | type | notes |
|---|---|---|
| id | uuid PK (client-generated) | |
| user_id # | FK | |
| region_id #, lat, lon | | |
| name, category, tips | text | |
| seasonality | json int[] | |
| photos | json | stored URLs (EXIF-stripped) |
| location_precision | enum | `exact`, `approximate` (fuzzed ~2 km) |
| status # | enum | `pending`, `verified`, `rejected`, `duplicate` |
| duplicate_of | FK nullable | |
| weighted_score | real | Σ(vote × voter_trust/100) |
| reviewed_by, reviewed_at | | admin |

> **As implemented (Phase 3):** `submissions` stores the exact `lat/lon` *and* `public_lat/public_lon` (fuzzed when `approximate`), `duplicate_candidates` (JSON), and `score`/`upvotes`/`flags`. `status` ∈ pending, verified, flagged, rejected, duplicate, withdrawn. Photos live in `submission_photos (id = client UUID, submission_id, file, width, height)`. Contribution XP goes through the same append-only `xp_events` ledger, with correction rows when a place is later rejected.

### `submission_votes`
`submission_id, user_id, value (+1 upvote, -1 flag), reason, weight, created_at`, PK (submission_id, user_id). Can't vote on your own.

### `match_prefs` (1:1 with users)
`user_id PK, women_only bool, same_gender bool, verified_only bool, age_min, age_max, pace (1–3), budget_band (1–3), smoking, drinking, visible bool`.

### `match_requests`
`id, from_user #, to_user #, trip_id nullable, place_id, date_from, date_to, score, status (pending|accepted|declined|expired), created_at`.

### `conversations` / `messages`
`conversations: id, request_id, created_at, closed_at`.
`messages: id, conversation_id #, sender_id, body (≤1000 chars), created_at, flagged bool`.
A server-side filter masks phone numbers/emails/UPI IDs in messages until both users tap "share contact".

### `reports`, `blocks`, `peer_ratings`
- `reports: id, reporter_id, target_type, target_id, reason, details, status, created_at`
- `blocks: blocker_id, blocked_id` PK both. Blocks hide each other everywhere (matches, chat, leaderboards).
- `peer_ratings: rater_id, ratee_id, conversation_id, stars 1–5, tags (JSON), created_at`, PK (rater, ratee, conversation). Allowed only once the rater's trip from that buddy request has ended (completed, or past start date + days) and the chat isn't closed.

### Expenses (on the device, not in SQLite)
IndexedDB table `ledgers` (Dexie schema v3), one document per trip: `{tripId, members: [{id, name, upi?}], expenses: [{id, description, amountPaise, paidBy, split: {type: "equal", among} | {type: "exact", shares}, createdAt}], updatedAt}`.
Money is stored as **integer paise**, never floats. See D32.

### `trips` fair-play columns (migration 005)
`leaderboard_eligible 0|1` and `fairplay_reasons` (a JSON array of plain-language reasons), set when a trip is completed.

### `beacons` / `beacon_events` (migration 006)
- `beacons: id (8 hex, PK), owner_id, name, key_enc 🔒, highest_seq, battery, last_lat, last_lon, last_at, last_seen_at, paired_at`
- `beacon_events: beacon_id, seq, kind (ping|sos|cancel), lat, lon, gps_time, battery, hops_left, relay_id, received_at`; PK (beacon_id, seq) is the de-duplication key.

### `sos_incidents` / `sos_points` / `sos_notifications` (migration 006)
- `sos_incidents: id (client UUID for app SOS), user_id, source (app|beacon), beacon_id?, trip_id?, status (active|cancelled|resolved), battery, token_hash (unique), token_enc 🔒, started_at, ended_at`. At most one active per user.
- `sos_points: incident_id, lat, lon, at, via (app|beacon)`
- `sos_notifications: id, incident_id, contact_id?, to_label (masked), kind (start|end), body, status (sent|demo|failed), created_at`

### Leaderboards (computed, no table)
Built on request from `xp_events` (by `season`), eligible completed `trips` and verified `submissions`, then cached in memory for 60 s per scope, metric and season (the friends board is never cached). A nightly snapshot table is only worth adding at much larger scale.

---

## 4. Core formulas (implemented in `@offgrid/core`, tuned via `data/*.json`)

| Name | Formula (initial) |
|---|---|
| Level | `level = floor(xp / 100) + 1` |
| Mascot stage | 1–2 Rookie Wanderer · 3–4 Trail Hunter · 5–7 Summit Seeker · 8+ Legend of the Hills |
| Recommender hard filters | drop if month ∉ good_months, difficulty > fitness + 0 (or +1 if group has an experienced member), est. cost pp > budget × 1.10, days_min > days |
| Recommender soft score (0–100) | `40·vibeOverlap + 20·budgetFit + 15·daysFit + 15·seasonQuality + 10·novelty(not visited)`; each term returns a reason string |
| Budget | `pp = Σ(stay,food,activities,transport)·days + permit`; `buffer = 10%`; `group = pp × size` (stay shared per room is a Phase 1 stretch) |
| Trust score (0–100) | `25·phone + 10·email + 30·gov_id + 10·liveness + min(15, 3·verifiedTrips) + 10·(avgRating−3)/2 − 15·upheldReports`, clamped |
| Match score (0–100) | `25·dateOverlap + 20·sameDestination + 15·paceDiff + 15·budgetDiff + 10·fitnessDiff + 15·vibeJaccard`; hard filters first (blocks, gender/verified/age prefs on **both** sides, 18+) |
| Settle-up | greedy: sort net balances; biggest debtor pays biggest creditor `min(|d|,c)`; repeat. ≤ n−1 payments |
