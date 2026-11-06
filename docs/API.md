# OFFGRID: API List (Phase 0)

Base URL `/api/v1`. JSON in and out. Every request body and query is validated by a zod schema exported from `apps/api/src/modules/<x>/schema.ts` (and reused by the web client).

**Auth legend:** 🌐 public · 🔑 logged in · 🪪 ID-verified (trust tier ≥ gov_id) · 🛡️ moderator/admin
**Rate-limit legend:** `A` auth 5/min/IP · `W` writes 30/min/user · `R` reads 120/min/user · `U` uploads 10/hour/user

> **Implemented in Phase 2:** `/health`, all of `/auth/*` except OTP/email, `GET/PATCH/DELETE /me`, `GET /me/export`, and `/trips` (list, get, PUT upsert, start, points, complete, delete). `/me` returns the whole derived profile (level progress, mascot stage, stats, badge progress and nudges), and `POST /trips/:id/complete` returns XP, level-up, stage change and new badges. Response types live in `packages/core/src/apiTypes.ts`, shared by both sides.

> **Implemented in Phase 3:**
> - `GET /regions`, and `GET /regions/:id/pack` (ETag, gzip, about 42 KB).
> - Submissions:
>   - `PUT /submissions/:id` (idempotent; returns `possibleDuplicates`).
>   - `PUT /submissions/:id/photos/:photoId` (multipart, re-encoded to WebP).
>   - `GET /submissions?lat&lon&radius_km` (pending places to review) and `GET /submissions/mine`.
>   - `DELETE /submissions/:id` (withdraw) and `POST /submissions/:id/vote`.
> - Moderation: `GET /moderation/queue` and `POST /moderation/submissions/:id`, for moderators only.
> - `/uploads/*` serves photos.
>
> **Design change:** "nearby" is computed in the client from the offline pack (`findNearby` in `@offgrid/core`), so there's no `/nearby` endpoint. It works with no signal, and the server sees no location queries.
> To make someone a moderator, run `npm run set-role -w @offgrid/api -- email moderator`.

> **Implemented in Phase 4:**
> - `GET /weather/place/:id`: 7 days at the base and the highest point, cached for 1 hour, with a stale copy served if the provider fails.
> - Hazards:
>   - `GET /hazards?lat&lon&radius_km` (public; logged-in users also see their own actions).
>   - `PUT /hazards/:id` (idempotent report).
>   - `POST /hazards/:id/confirm|clear`.
> - The region pack now also carries the curated hazards, active traveller reports, hospitals, safety rules and the altitude guide.
>
> **Design change:** alerts are computed on the phone (`tripAlerts` in `@offgrid/core`), so there's no `/alerts` endpoint.

> **Implemented in Phase 5:**
> - Verification:
>   - `POST /verification/phone/send|verify` and `/email/send|verify`.
>   - `POST /verification/kyc/start` (needs `{consent: true}`) and `POST /verification/kyc/complete {state, code}`.
>   - `DELETE /verification/kyc` (withdraw consent).
>   - `POST /verification/liveness` (multipart `selfie`).
> - `POST /me/traveller-type {answers}`. `PATCH /me` now accepts `gender` (refused once it comes from an ID).
> - Matching:
>   - `GET|PUT /match/prefs`, `POST /match/trips/:id/looking`, `GET /match/candidates?tripId=`.
>   - `GET|POST /match/requests`, `POST /match/requests/:id/accept|decline|cancel`.
> - Conversations:
>   - `GET /conversations`, `GET /conversations/:id`, `GET|POST /conversations/:id/messages`.
>   - `POST /conversations/:id/read`, `POST /conversations/:id/share-contact`.
>   - `GET /conversations/:id/stream` (server-sent events).
> - Safety:
>   - `POST|DELETE /safety/blocks/:userId`, `GET /safety/blocks`.
>   - `POST /safety/reports` (optionally `block: true`).
> - Moderation: `GET /moderation/reports` and `POST /moderation/reports/:id {action: uphold|dismiss}`.
>
> **Path changes from the plan above:** blocks and reports live under `/safety/*` (not `/blocks` and `/reports`), requests can also be cancelled by the sender, and peer ratings come in Phase 6.

Error shape (everywhere): `{ "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": {...} } }`

---

## Health and data packs
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | 🌐 | liveness + DB check |
| GET | `/regions` | 🌐 | list regions with `pack_version`, size |
| GET | `/regions/:id/pack` | 🌐 | full offline pack (places, POIs, hazards, seasons, hospitals). `ETag` + gzip; client sends `If-None-Match` |
| GET | `/content/static` | 🌐 | badges, mascots, traveller types, packing rules, scoring rules |

## Auth (`A`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | 🌐 | email, password, display name, birth year (18+), consents |
| POST | `/auth/login` | 🌐 | → access token (body) + refresh cookie |
| POST | `/auth/refresh` | 🌐 (cookie) | rotate refresh token |
| POST | `/auth/logout` | 🔑 | revoke session |
| POST | `/auth/otp/send` | 🔑 | phone OTP (OtpAdapter; **mock logs code to console**) |
| POST | `/auth/otp/verify` | 🔑 | |
| POST | `/auth/email/send`, `/auth/email/verify` | 🔑 | magic-code email verification |

## Me / profile
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me` | 🔑 | profile, xp, level, mascot stage, trust, badges |
| PATCH | `/me` | 🔑 `W` | edit profile, mascot species, leaderboard opt-in |
| GET | `/users/:id` | 🔑 | public profile (respects blocks, visibility) |
| GET | `/users/:id/feed` | 🔑 | completed trips timeline |
| GET | `/me/stats` | 🔑 | treks, km, altitude, states, money spent |
| GET | `/me/xp-events` | 🔑 | XP ledger (transparency) |
| GET | `/me/export` | 🔑 | **DPDP**: download all my data (JSON) |
| DELETE | `/me` | 🔑 | **DPDP**: delete account (soft now, purge after 30 d) |
| GET/POST/DELETE | `/me/consents` | 🔑 | view / grant / withdraw consent per purpose |
| CRUD | `/me/trusted-contacts` | 🔑 `W` | |

## Planner (mostly client-side; server mirrors for share links and validation)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/planner/recommend` | 🌐 `R` | same as `core.recommend()`; used when the client has no pack yet |
| POST | `/planner/itinerary` | 🌐 `R` | itinerary + budget + packing for one place |
| POST | `/planner/compare` | 🌐 `R` | two place ids → side-by-side |
| POST | `/planner/fitness` | 🌐 | 5 answers → level 1–3 |

## Trips
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/trips` | 🔑 | my trips (filter by status) |
| PUT | `/trips/:id` | 🔑 `W` | **upsert by client UUID** (idempotent offline sync) |
| GET | `/trips/:id` | 🔑 | |
| DELETE | `/trips/:id` | 🔑 | cancel |
| POST | `/trips/:id/start` | 🔑 | status → active; notify trusted contacts if opted |
| POST | `/trips/:id/points` | 🔑 `W` | batch GPS breadcrumbs (≤ 500/request) |
| POST | `/trips/:id/complete` | 🔑 | plausibility check → XP + badges; returns `{xpAwarded, levelUp, newBadges, validation}` |
| POST | `/trips/:id/share` | 🔑 | create/revoke share token |
| GET | `/share/:token` | 🌐 | read-only trip view (no PII, no live location) |
| GET | `/trips/:id/export.txt` | 🔑 | plain-text plan |
| POST | `/trips/:id/members` | 🔑 | add member (by invite code) |

## Nearby
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/nearby?lat&lon&radius_km&category&veg&vegan&women_safe&open_now&price_max` | 🌐 `R` | POIs sorted by distance, with `open_now` computed server-side for the region's timezone |
| GET | `/nearby/route?trip_id&corridor_km` | 🔑 `R` | POIs along a trip's route corridor |

## Hidden places + moderation
| Method | Path | Auth | Purpose |
|---|---|---|---|
| PUT | `/submissions/:id` | 🔑 `W` | submit (client UUID); returns `possibleDuplicates[]` |
| POST | `/submissions/:id/photos` | 🔑 `U` | multipart, ≤ 5 MB, JPEG/PNG/WebP sniffed; re-encoded + EXIF stripped |
| GET | `/submissions?region&status&near` | 🔑 | browse pending (to vote) / verified |
| POST | `/submissions/:id/vote` | 🔑 `W` | `{value: 1 | -1, reason?}`; weighted by voter trust |
| GET | `/moderation/queue` | 🛡️ | pending + flagged items |
| POST | `/moderation/submissions/:id` | 🛡️ | approve / reject / mark duplicate |

## Weather, hazards, safety
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/weather?lat&lon` | 🌐 `R` | 7-day forecast via WeatherAdapter (Open-Meteo, cached 1 h) + derived warnings |
| GET | `/weather/route?trip_id` | 🔑 `R` | forecast at trailhead, summit, camp points |
| GET | `/hazards?region&lat&lon&radius_km` | 🌐 `R` | active (non-expired) hazards |
| POST | `/hazards` | 🔑 `W` | community report (expires in 72 h by default) |
| POST | `/hazards/:id/confirm` | 🔑 `W` | still there → extend expiry |
| GET | `/alerts` | 🔑 | my alerts (weather/hazard on my planned/active trips) |
| GET | `/safety-card?place_id` | 🌐 | emergency numbers, nearest hospital, AMS guide, checklist (also in pack) |

## Companions
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/traveller-types/quiz` | 🌐 | questions |
| POST | `/traveller-types/quiz` | 🔑 | answers → type |
| GET/PUT | `/match/prefs` | 🔑 | |
| GET | `/match/candidates?place_id&from&to` | 🔑 `R` | ranked list with score breakdown (no exact age, no phone) |
| POST | `/match/requests` | 🔑 `W` | send request (limit 10/day) |
| POST | `/match/requests/:id/accept` · `/decline` | 🔑 | accept opens a conversation |
| GET | `/conversations` | 🔑 | |
| GET | `/conversations/:id/messages?before` | 🔑 | paginated |
| POST | `/conversations/:id/messages` | 🔑 `W` | contact info auto-masked until both share |
| GET | `/conversations/:id/stream` | 🔑 | SSE stream of new messages |
| POST | `/conversations/:id/share-contact` | 🔑 | both must call it before numbers are revealed |
| POST | `/reports` | 🔑 `W` | report user / message / submission / hazard |
| POST/DELETE | `/blocks/:userId` | 🔑 | |
| POST | `/trips/:id/ratings` | 🔑 | peer rating, only after a shared completed trip |

## Verification and trust
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/verification` | 🔑 | my tiers + trust score breakdown |
| POST | `/verification/kyc/start` | 🔑 | KycAdapter → `{redirectUrl}` (**mock**: local page simulating DigiLocker consent) |
| GET | `/verification/kyc/callback` | 🌐 | provider callback → stores ref token + last4 only |
| POST | `/verification/liveness` | 🔑 `U` | selfie → LivenessAdapter (**mock**); image deleted after check |

## Leaderboard
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/leaderboard?scope=global|region|friends&metric=xp|km|elevation|contributions&season=2026-10` | 🔑 `R` | top 50 (competition ranking, so ties share a rank) + `me {optedIn, rank, value}` + `excludedTrips` (my trips this season that failed fair play, with reasons). Opted-in users only; blocked users hidden; boards other than friends cached 60 s |
| GET | `/leaderboard/seasons` | 🔑 | the last 6 seasons, newest first |
| POST | `/conversations/:id/rate` | 🔑 | `{stars 1–5, tags?: [punctual|safe|fun|fair_with_money|good_navigator|respectful]}` → ConversationDto. Upsert; **409** until the rater's trip has ended |

`GET /me` also returns `challenges` (this month's progress) and `streakMonths`.

## Expenses
**No endpoints (decision D32).** The splitter is local-first: members and expenses live in IndexedDB on the phone
(`ledgers` table), and balances, settle-up and UPI links come from `@offgrid/core` (`game/settle.ts`). A server-synced
ledger is a possible later stretch.

## Beacon, emergency contacts and SOS (Phase 7)
Packet format, pairing and radio details: [HARDWARE.md](HARDWARE.md).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/contacts` | 🔑 | my emergency contacts (phone masked) |
| POST | `/contacts` | 🔑 | `{name, phone, theyAgreed: true}`; Indian mobile only; max 5; phone stored AES-GCM encrypted |
| DELETE | `/contacts/:id` | 🔑 | |
| GET | `/beacons` | 🔑 | my beacons: battery, last seen, last location (never the key) |
| POST | `/beacons/pair` | 🔑 | `{id: 8 hex, name?}` → `{beacon, keyHex, serialCommand}`. Key shown **once**; re-pairing rotates it and clears old events. **409** if another account owns the beacon |
| PATCH | `/beacons/:id` | 🔑 | rename |
| DELETE | `/beacons/:id` | 🔑 | unpair; its packets are rejected from then on |
| POST | `/beacons/relay` | 🌐 rate-limited | `{relayId?, packets: [hex] (1–50)}` from a gateway or phone → `{results: [{index, status: accepted|duplicate|rejected, reason?}]}`. Each packet is checked against its beacon's HMAC; unknown beacons and bad MACs get the same message; seq replay window 64 |
| GET | `/sos/active` | 🔑 | my active SOS or `null` |
| PUT | `/sos/:id` | 🔑 | raise an SOS from the phone, `{point?, battery?}`. **Idempotent by client id** (outbox retries are safe); while active, adds a location; never restarts an ended SOS |
| GET | `/sos/:id` | 🔑 | `SosIncidentDto`; includes `statusUrl` and, in demo mode, `demoMessages` (the SMS text) |
| POST | `/sos/:id/cancel` | 🔑 | "I'm safe": ends it and tells the contacts |
| GET | `/sos/public/:token` | 🌐 token | the contacts' live-status page: name, status, track, battery, trip, 3 nearest hospitals, emergency numbers. 404 after 72 h from the end |

Contacts get **one SMS when the SOS starts** and one when it ends. Later locations go to the live page only.

## Sync
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/sync` | 🔑 | replay an outbox batch `[{op, path, body, clientId}]`; returns per-item result so the client can drop or retry each |
