# OFFGRID: pitch deck outline

**Format:** 10 slides plus an appendix, about 6 minutes with the live demo. One idea per slide, big type, real
screenshots (from the demo data), and no stock photos of mountains with lens flare.

**Design:**
- Colours: pine green `#17613f`, sun orange `#b5530f`, paper white.
- Font: the app's own, so the deck and the app feel like one product.

---

### 1. Title
- **OFFGRID:** trek further, stay found.
- *Team name, college, SIH 2026 · PS 26216 (AICTE / MIC Student Innovation) · Hardware · Hospitality & tourism.*
- **Visual:** the Wanderling mascot in its four stages along a ridge line.

### 2. The problem
Three numbers, each with a source in small print. All are in [IMPACT.md](../IMPACT.md).
- **1.80 crore** tourists in Himachal in 2024.
- **873 roads** blocked in a single day in July 2023, and **2,000+** tourists evacuated from Kasol.
- **~59%** of Indian women surveyed have faced harassment while travelling, and **~90%** say safety comes first
  when choosing a destination.
- One line underneath: *"And on many high trails, your phone shows No Service."*

### 3. Who we built for (illustrative personas, to be validated in the pilot survey)
- **Asha, 21, Chandigarh:** a weekend trekker on a student budget who wants Triund without overspending or
  getting caught by rain.
- **Riya, 24, Pune:** a solo woman traveller looking for a *verified* buddy, not a stranger from a WhatsApp group.
- **Dorje, 38, Kareri village:** runs a slate-roof homestay that isn't on Google Maps.
- **Maa, at home in Ludhiana:** wants to know Asha is OK, without installing anything.

### 4. What OFFGRID does
Four columns, each with a phone screenshot:
1. **Plan:** season- and budget-aware picks with reasons, itinerary, packing, budget.
2. **Explore offline:** 821 mapped points plus community-verified hidden places, and a region pack on the phone.
3. **Travel together, safely:** trip-scoped buddies, ID-verified women-only, masked contact details,
   report and block.
4. **Get help with no signal:** the OFFGRID Beacon, LoRa mesh to SMS, plus a live map for your family.

### 5. Live demo (3 minutes)
Follow [DEMO.md](DEMO.md). Plan → level-up → buddy request → **SOS in aeroplane mode** → "I'm safe".

### 6. The beacon (hardware)
- A photo of the unit next to a ₹10 coin, plus the path diagram: beacon → relay → gateway/phone → API → SMS.
- **ESP32-S3 + SX1262 LoRa + GPS, ≈ ₹2,500–3,400 at retail** (≈ ₹1,200 at 1,000 units).
- **866 MHz, licence-exempt in India, 2–10 km per hop**, signed and replay-proof packets, up to 3 hops, and any
  phone with OFFGRID can relay.
- Be honest: "works in our simulator end to end; field range tests are part of the pilot."

### 7. Technology (judging criterion: technology)
One diagram plus one line each:
- **Rule-based scoring + plausibility checks + anomaly detection.** Fair-play flags for GPS, duplicate and
  near-duplicate detection for places, contact-detail masking in chat.
- **Geospatial:** haversine nearby search, hazard radius checks, nearest hospital, approximate locations for
  fragile sites.
- **Offline-first PWA:** IndexedDB region pack, an outbox with idempotent retries, a service worker.
- **Security:** Argon2id passwords, AES-256-GCM encryption for personal data, rotating sessions, rate limits,
  EXIF stripping.
- **IoT:** HMAC-SHA256 radio packets, mesh relay, Web Serial pairing, Web Bluetooth relay.

### 8. Why it's new (novelty)
Comparison table: OFFGRID vs AllTrails, Wanderlog, WhatsApp groups and satellite messengers, across:
- works with no signal;
- verified, trip-scoped buddies;
- hidden local places;
- Indian seasons and budget;
- cost.

Only OFFGRID gets a tick in every row. **Gamification rewards safe behaviour**: XP only for GPS-verified
trips, challenges for confirming hazard reports.

### 9. Impact and how we'll prove it
- Four metrics from IMPACT.md, with **pilot targets clearly labelled as targets**:
  - budget within ±15%;
  - 50 verified local businesses;
  - median SOS-to-alert time under 2 minutes;
  - fewer than 1 report per 100 chats.
- The 4-week pilot in Kangra and Kullu, with college clubs, 15 homestays and 10 beacons.

### 10. Feasibility, scale and ask
**Feasibility:**
- 268 automated tests;
- 22 places, 821 OSM points, 15 hazards and 20 hospitals as data;
- 65 credited photos and 7 OpenStreetMap trail lines;
- no paid APIs;
- runs on one small server.

**Scale:**
- a new state is a data folder: Uttarakhand → Ladakh → Sikkim;
- every beacon is also a relay;
- homestays host gateways.

**Revenue (later):**
- featured listings for verified homestays and guides;
- beacon sales and rental at trailheads;
- B2B safety dashboards for trek operators.

**Ask:** pilot partners (HP Tourism, college trekking clubs) and mentoring on radio certification.

---

### Appendix (backup slides, only if asked)
- **A1 · Privacy and law:**
  - DPDP Act 2023 mapping;
  - 18+ only;
  - DigiLocker consent (no Aadhaar numbers stored);
  - export and erasure;
  - SOS links expire after 72 h.
- **A2 · Anti-cheat:** the GPS plausibility rules, manual-trip caps and leaderboard fair-play flags.
- **A3 · What's mocked:**
  - SMS, OTP, DigiLocker and the selfie check sit behind adapters;
  - the path to real providers is DLT SMS, MeriPehchaan OAuth and a liveness vendor.
- **A4 · Beacon BOM, wiring and radio rules** (from HARDWARE.md).
- **A5 · Architecture and data model** (from ARCHITECTURE.md and DATA_MODEL.md).
- **A6 · Costs:** hosting, SMS per alert, beacon unit cost at 100 and 1,000 units.
