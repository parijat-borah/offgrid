# OFFGRID: impact, and how we'd measure it

Every feature exists to move a number. This file maps each feature to its metric, says how we'd measure it,
and keeps two kinds of numbers apart:

- **Sourced facts** about the problem today, with links.
- **Hypotheses and pilot targets.** These are what we *expect*. They are goals to test, **not results**. We have
  no users yet, and we won't claim impact we haven't measured.

---

## 1. The problem in numbers (sourced)

| Fact | Source |
|---|---|
| Himachal Pradesh received **1.80 crore domestic tourists in 2024**, the second-highest year ever | [The Tribune, 7 Jul 2025](https://www.tribuneindia.com/news/himachal/from-heaven-to-havoc-hills-buckle-under-tourist-pressure/amp) |
| In the July 2023 monsoon, **873 roads were blocked** in one day and **over 2,000 stranded tourists** had to be evacuated from Kasol alone; about **300 more were stuck at Chandratal** | [The Tribune, 12 Jul 2023](https://www.tribuneindia.com/news/himachal/2-000-tourists-stranded-in-kasol-evacuated-says-himachal-cm-sukhu-525025) |
| In a survey of **1,214 Indian women** (Outlook Traveller × Toluna, Feb 2024), **~90%** said safety comes first when choosing a destination, and **~59%** had faced gender-based harassment while travelling in India | [Outlook Traveller, "What Women Want" survey](https://www.outlooktraveller.com/women-in-travel/what-women-want-survey-decoding-the-woman-traveller) |
| Trekkers still die in sudden snow on high routes: a snowstorm in Kinnaur in Oct 2021 stranded a 13-member group at Burua Kanda; 3 died and 10 were rescued | [Republic World, Oct 2021](https://www.republicworld.com/india/three-maharashtra-trekkers-die-due-to-a-snowstorm-in-himachal-pradesh-ten-rescued) |

**Gaps to fill in the pilot.** We found no public dataset on trekker overspending, how solo travellers find
companions, or how many tourists discover homestays and dhabas off mainstream maps. These are the hypotheses
below, and the pilot survey measures each one.

---

## 2. Feature → metric → measurement

**How we measure, respecting privacy (DPDP Act 2023):**
- Analytics are **opt-in** and aggregated per week.
- No location trails are used for analytics.
- Survey answers are anonymous.
- Counts come from data the app already keeps, such as trips, completions and votes. We add no new tracking.

| Feature | Problem it addresses | Metric | How we measure it | Baseline | Pilot target (hypothesis) |
|---|---|---|---|---|---|
| **Trip planner** (season, fitness and budget rules + top-3 with reasons) | Bad planning, wrong season, overspending | **Budget accuracy:** actual spend ÷ planned spend per trip | The app asks "what did you spend per person?" when a trip is finished; we compare it with the plan's estimate | Pre-pilot survey: "How much over budget was your last trip?" | Median within **±15%** of plan; half as many trips **>30% over** as the survey baseline |
| Planner seasonal logic | Trips into closed or unsafe seasons | Plans made for a "closed" or "risky" month that still go ahead | Trips saved after the app showed a closed or risky warning | Measured in the pilot | **<5%** of saved trips go ahead in a "closed" month |
| **Offline region pack + Nearby** | No signal, no info on food, rest stops, toilets, water | Offline sessions; Nearby searches answered with no network | Client counter (opt-in): `pack_source=cache` and offline searches | n/a (new capability) | **≥40%** of trail-day sessions work fully offline |
| **Hidden places** (crowdsourced, moderated) | Small homestays, dhabas and guides are invisible on mainstream maps | (a) Verified local listings; (b) **visits to them** | (a) Verified submissions per month; (b) the post-trip question "did you visit a place you found on OFFGRID?" | 0 listings | **50 verified local businesses** in the Kangra/Kullu pilot; **20%** of finished trips report a visit |
| Moderation (duplicate check, trust-weighted votes, approximate locations) | Fake or harmful listings; overtourism at fragile sites | Wrong verifications; time to verify | Moderator reversals after verification; median time from submission to decision | n/a | **<2%** reversed; median **<48 h** |
| **Weather + hazard alerts** | Landslides, snow and lightning catch travellers unprepared | Trips changed after an alert; hazard reports confirmed by others | Plans edited or postponed within 24 h of a severe alert; confirm/clear votes per report | n/a | **≥30%** of severe alerts lead to a changed plan; **≥50%** of reports get a second traveller's vote |
| **Safety card** (112, nearest hospital, tell-someone message) | People don't know whom to call or where the hospital is | Trips where the plan was shared with someone | "Share my plan" taps per saved trip | Pre-pilot survey: "Did someone know your route?" | **≥60%** of trips shared with a contact |
| **SOS beacon + contacts' live page** | No network, no way to call for help | (a) Time from SOS to the contact being alerted; (b) delivery rate | (a) `sos_incidents.started_at` → first notification; (b) beacon SOS packets received ÷ sent (sequence gaps), in field tests at 2/5/10 km | Phone with no signal: never delivered | Median **<2 min** via a gateway in range; **≥90%** of SOS delivered within 3 retries at ≤5 km line of sight |
| **Buddy matching** (trip-scoped, verified, women-only option) | Unsafe or unverified travel companions | (a) Requests that become chats; (b) **reports per 100 chats**; (c) women who use the women-only filter and feel safe | (a), (b) from `match_requests` and `reports`; (c) a one-question rating after the trip | Pre-pilot survey on how people find companions today | Reports **<1 per 100 chats**; **≥80%** of women users rate their buddy "felt safe" |
| **Verification + trust score** | No way to know who's real | ID-verified share of matched users; trust of reported users vs everyone | `verifications` table; trust distribution | n/a | **≥50%** of matched users phone-verified, **≥25%** ID-verified |
| **XP, badges, mascot, challenges** | Safety features only help if people keep the app | 4-week retention; GPS-verified share of trips | Weekly active trekkers; `validation=verified` ÷ all trips | n/a | **≥35%** week-4 retention; **≥70%** of trips GPS-verified |
| **Leaderboards with fair play** | Gamification invites cheating | Trips kept off the boards; cheating reports | `leaderboard_eligible=0` rate; reports tagged "cheating" | n/a | Flags stay **<10%** of trips; zero confirmed cheats in the top 10 |
| **Expense splitter** | Money disputes in groups; UPI back-and-forth | Groups that settle with no disputes | Ledgers fully settled; post-trip question "any money disagreements?" | Pre-pilot survey | **≥80%** of shared ledgers settled within 7 days |
| **Compare mode** | Hard to choose between two treks | Compares that end in a saved trip | Compare views → a trip saved within the session | n/a | **≥30%** |

---

## 3. Money and time saved: worked examples (to be confirmed in the pilot)

These show the size of the effect we expect. They are **calculations from our seed data**, not observations.

- **Avoiding a monsoon week on a landslide-prone route.** Our seed cost for a 3-day Kasol/Kheerganga trip is
  about ₹6,000–8,000 per person. One cancelled trip (bookings lost, extra nights while stuck) easily costs more
  than that. If the planner's season rule moves even 1 in 10 monsoon plans to a safe month, that is real money
  for a student.
- **The settle-up algorithm** turns n people's tangled IOUs into at most n−1 payments. For a group of 6 that's
  5 UPI payments instead of up to 15 pairwise ones.
- **Local income.** If each pilot listing gets 4 OFFGRID-sourced guests a month at about ₹900 a night (our seeded
  Kareri homestay), that's about **₹3,600 a month per family**, before food and guiding.

---

## 4. Pilot plan (4 weeks, Kangra + Kullu)

1. **Recruit:**
   - 50–80 trekkers through college trekking and NSS clubs;
   - 15 homestays, dhabas and guides through the HP Homestay Scheme network;
   - 2 gateway hosts: a homestay at McLeodganj and one at Barshaini.
2. **Week 0 survey** for the baselines above: budget overrun, how people find companions, whether someone knew
   their route, and how they found where to eat and stay.
3. **Weeks 1–4:** the app, plus 10 beacons lent to groups heading to Triund, Kareri and Kheerganga.
4. **Field tests:** beacon range and delivery at 2, 5 and 10 km on two ridgelines, logged by sequence gaps.
5. **Week 4 survey**, then publish the numbers in this file, including any that missed their target.

**Success criteria:** at least 6 of the 14 targets met, and **no** safety incident caused by the app (for
example, a buddy match that led to harm). Any such incident stops the matching feature until it is reviewed.

---

## 5. Scale (why the impact grows)

A new region is **data, not code**:
- add a folder under `data/regions/<state>/` with places, passes, hazards, hospitals and an OSM import;
- run `npm run validate:data`.

Uttarakhand, Ladakh and Sikkim reuse every feature. The beacon network grows with every unit: each beacon
is also a relay, and each homestay gateway covers a valley.
