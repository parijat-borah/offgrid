# OFFGRID: the 3-minute demo

One presenter drives the phone (or a laptop at phone width), and a second runs the beacon or simulator. Practise
it end to end at least three times; the timings below assume you don't explain anything twice.

---

## T-30 minutes: setup checklist

1. **Fresh demo data.** Stop `npm run dev` first, then:
   ```bash
   npm run demo        # resets the database and seeds Asha, Bilal, Chen, Meera, trips, a buddy request, a chat, places, a hazard, a contact and a beacon
   npm run dev
   ```
   Logins and the beacon simulator command are in `apps/api/demo-accounts.local.txt`.
2. **Log in as Asha** on the demo phone. Chrome on Android, or Chrome DevTools at 390 px wide.
3. **Warm the map tiles.** Open Nearby and the Triund plan once while online, so the map tiles are cached.
4. **No venue internet?** Set `WEATHER_MODE=mock` in `apps/api/.env` and restart. Everything else already works
   offline or with mocks.
5. **Beacon:**
   - **Real hardware:** gateway unit on Wi-Fi with `RELAYURL` pointing at the laptop's IP (see
     [HARDWARE.md](HARDWARE.md)), and Asha's beacon re-paired over USB. Run `STATUS` on both.
   - **No hardware:** paste the simulator command from `demo-accounts.local.txt` into a terminal, but don't press
     Enter yet.
6. **Laptop:** a browser tab **logged in as Asha** on the SOS screen (`?view=sos`). On stage the phone is offline, so the laptop shows the result and opens the contacts' link.
7. **Phone:** brightness up, notifications silenced, mobile data **on**. You'll switch to aeroplane mode on stage.

---

## The script (3:00)

| Time | Show | Say (roughly) |
|---|---|---|
| **0:00–0:20** | Title slide, then the app's home screen | "Himachal gets 1.8 crore tourists a year. In the 2023 monsoon, 873 roads closed in a day and 2,000 people had to be evacuated from Kasol. Many high trails have no signal. OFFGRID is a trek companion that keeps working when the network doesn't, with a ₹2,500 radio for when things go wrong." |
| **0:20–0:50** | **Plan:** ₹8,000, 2 days, October, Easy, 2 people → **Find trips**. Open **Triund** → **Safety** tab | "Rules, not guesswork. It removes anything out of season, too hard or over budget, and tells you *why*. Here's a landslide report another trekker posted near Galu temple, with the nearest hospital and 112 a tap away." |
| **0:50–1:20** | **Save trip** → **Start** → **🧪 simulated track** → **Finish** | "On the trail it records GPS sparsely to save battery. Finishing checks the track is real: it reached Triund, at walking speed. That's what earns XP. Asha just levelled up, and her Wanderling evolved into a Summit Seeker." *(Wait for the animation: it's the crowd-pleaser.)* |
| **1:20–1:45** | Header 💬 → Bilal's request → **Accept**. Open the chat and send a message containing a phone number | "Solo travellers need people, safely. Matching is per trip, so you only meet people going to the same place on the same dates. Women can choose women-only, which needs an ID-verified woman on both sides. Numbers stay hidden until *both* tap Share. See: masked." |
| **1:45–2:35** | Phone to **aeroplane mode**. Press **SOS** on the beacon (hold 3 s) or `s` in the simulator. Switch to the laptop: refresh Asha's **SOS screen**, then open **"what contacts see"** | "No signal. The beacon sends a signed LoRa packet. Another beacon relays it, then a homestay gateway uploads it. Here's the SMS Maa gets, and her live page: a map, battery, the trek Asha planned, and the three nearest hospitals. No app, no login." |
| **2:35–2:50** | Hold the beacon 3 s again (or `c`). The contact page turns **green** | "And 'I'm safe' gets through the same way." |
| **2:50–3:00** | Profile → leaderboard (or the closing slide) | "Planner, offline maps, crowdsourced places, verified buddies, and an SOS that needs no network. Himachal is a data folder: Uttarakhand is next. Thank you." |

**If you're running long, cut** the chat message (1:35), then the leaderboard. **Never cut the SOS.**

---

## Fallbacks (decide before you go on stage)

| What breaks | Do this |
|---|---|
| Venue Wi-Fi is down | Everything runs on localhost. Weather: `WEATHER_MODE=mock`. Map tiles: warmed in setup step 3 |
| Real beacon doesn't come through | Switch to the simulator: same packets, same API. Say "here's the same thing from our simulator" |
| Gateway can't reach the laptop | Run the simulator on the laptop (it *is* the gateway) |
| Login expired | Log in again from `demo-accounts.local.txt` (Asha) |
| Demo data looks messy after a rehearsal | `npm run demo` again (stop the dev server first) |

---

## Questions judges are likely to ask

- **"Is the beacon legal?"**
  - It uses 865–867 MHz, India's licence-exempt band for low-power devices (≤1 W ERP, ≤200 kHz). We run 14 dBm
    at 125 kHz.
  - Selling it would need equipment type approval, which is noted in HARDWARE.md.
- **"What if someone fakes GPS for XP?"**
  - The server checks plausibility: reached the place, walking speed, long enough, no future timestamps.
  - Manual trips are capped and earn 25% XP.
  - Leaderboards drop simulated, overlapping and too-many-in-a-day trips, and beacon tracks are signed.
  - A rooted phone can still spoof GPS, which is why trips are graded and not trusted.
- **"Aadhaar? Really?"** No Aadhaar numbers, ever.
  - Verification goes through DigiLocker consent, which is mocked in the demo behind an adapter.
  - We keep the document type, the last 4 characters and the gender only, and consent can be withdrawn.
  - "ID Verified" is not a background check, and the app says so.
- **"How is this different from AllTrails or Wanderlog?"** Neither works with no signal for an SOS, verifies
  buddies per trip, or surfaces local homestays that don't exist on Google Maps, and none of them is built
  around Indian seasons, passes and budgets.
- **"What does it cost to run?"**
  - The planner and maps run on the phone, using OpenStreetMap and Open-Meteo, which need no paid keys.
  - The server is one small VM with SQLite, moving to Postgres/PostGIS at scale.
  - Real SMS costs a few paise per alert via a DLT-registered provider.
- **"What's mocked?"**
  - SMS, phone OTP, DigiLocker and the selfie check are mocked behind adapters.
  - The simulated GPS button is demo-only and refused in production.
  - Everything else (planner, XP, moderation, matching, signed packets, relay) is real code with 268 tests.
- **"Battery life of the beacon?"** About a day per 2,000 mAh today, because it listens constantly to relay for
  others. Duty-cycled receive is the next firmware milestone.
