# OFFGRID: Privacy and safety by design (DPDP Act 2023)

How OFFGRID handles personal data, mapped to India's Digital Personal Data Protection Act, 2023 and the DPDP Rules. This document explains the design; it is not legal advice. Before launch, a lawyer should review it and the notice text.

## 1. What we collect, why, and for how long

| Data | Purpose | Stored as | Kept until |
|---|---|---|---|
| Email, display name | Account | Plain (needed to log in) | Account deletion |
| Password | Login | Argon2id hash only | Account deletion |
| Birth **year** (not date) | 18+ check, age band for matching | AES-256-GCM | Account deletion |
| Phone number | OTP verification; shown to a travel buddy **only** after both people tap "share contact" | AES-256-GCM, plus a keyed HMAC for uniqueness checks | Account deletion |
| Gender (self-declared, or from ID) | Women-only and same-gender matching filters | Plain enum; never shown on profiles | Account deletion, or reverts to self-declared when ID consent is withdrawn |
| Government ID result | "ID Verified" badge, trust | Document type + **last 4 characters** only | Withdrawal of KYC consent, or deletion |
| Legal name, full ID number, ID photo | Checking the ID matches the account | **Never stored.** The name is compared, then discarded; the number and photo are never requested | n/a |
| Selfie | Liveness check | **Never stored.** Checked in memory, buffer zeroed | n/a |
| Trips, GPS points | Plans, XP, alerts | Plain; points only while a trip is active | Account deletion |
| Chat messages | Buddy chat | Plain; contact details masked until both agree | Account deletion of either side |
| Reports | Safety moderation | Plain, visible to moderators only | Account deletion of the reporter or the reported person |
| Photos of places | Hidden places | Re-encoded WebP, EXIF/GPS stripped | Submission deletion |
| Buddy ratings | Trust score | Stars + tags. The rated person sees only their average, never who rated them; your export lists only ratings you gave | Account deletion of either side |
| Leaderboard entry | Monthly boards | Name, avatar, level and the metric only, never location or trips. **Opt-in**, and you can leave any time | Computed live; nothing extra is stored |
| Emergency contacts | SMS if you raise an SOS | Name; phone AES-256-GCM encrypted (only the last 3 digits shown). You confirm they agreed | Removal, or account deletion |
| Beacon location and battery | SOS, live map, trip track | Last position on the beacon record; every packet in `beacon_events` | Unpairing (deletes events), or account deletion |
| SOS incidents | Telling your contacts where you are | Track points + the messages sent. The contacts' link is a random 32-character token stored hashed, and it stops working 72 h after the SOS ends | Account deletion |
| Shared expenses | Splitting trip costs | **On your phone only** (IndexedDB), never sent to OFFGRID. Friends' names and UPI IDs you type stay on the device | Until you clear the app's data |

## 2. Consent (Section 6)

- **Account:** a separate checkbox at sign-up, recorded in `consents` with the notice version.
- **KYC:** its own explicit consent screen listing exactly what's kept and what's discarded, recorded as purpose `kyc`. It's **withdrawable** from the profile (`DELETE /verification/kyc`), which removes the verification, un-verifies gender, and switches off women-only and same-gender filters.
- **Location:** GPS recording is per trip and only while the app is open.
- **Matching visibility:** off by default for each trip. You opt each trip in ("Let others find me"), and a global "visible" switch hides you everywhere.

## 3. Rights of the data principal (Sections 11–13)

| Right | How |
|---|---|
| Access | `GET /me/export`: everything we hold, as JSON (no secrets) |
| Correction | Profile editing; gender is locked only while it comes from an ID |
| Erasure | `DELETE /me` (password required): immediate hard delete, cascading to trips, GPS, XP, badges, verifications, chats, requests, reports and blocks |
| Grievance | To be appointed before launch: a grievance officer contact in the app and on the site |
| Withdraw consent | KYC withdraw button; account deletion |

## 4. Children (Section 9)

OFFGRID is **18+ only**. Sign-up refuses anyone whose birth year means they *might* be under 18. KYC re-checks the year against the ID, and matching refuses anyone under 18. We never collect a child's data knowingly, so the verifiable parental consent rules don't apply. An "underage" report reason lets users flag anyone who seems younger.

## 5. Security safeguards (Section 8(5))

- TLS in transit (deployment); AES-256-GCM for PII at rest, key from env/KMS.
- 15-minute access tokens; rotating refresh tokens in httpOnly, SameSite=Strict cookies, with reuse detection.
- Rate limits on login, OTP (3 per 10 minutes, 5 wrong tries per code), KYC, requests (10 a day) and reports.
- Mock identity adapters **refuse to start** with `NODE_ENV=production`.
- Moderators see exact locations and reported messages; that access is role-checked server-side.

## 6. Breach response (Section 8(6))

If personal data is breached:
1. Contain it: rotate keys, revoke sessions.
2. Notify the **Data Protection Board** and the affected users without delay, with what happened, which data was involved, what we've done, and what they should do.
3. Write a post-incident review.

A named owner and contact list are needed before launch.

## 7. Safety design for buddy matching

| Risk | Mitigation |
|---|---|
| Strangers meeting | Trip-scoped only (no "people nearby" browsing); only phone-verified users can be found; ID-verified badge; safety tips at the start of every chat; "Tell someone I'm travelling with X" share |
| Women being targeted | Women-only matching **only for ID-verified women**, and it applies both ways; self-declared gender never unlocks it; gender is never displayed |
| Moving to WhatsApp too early (scams, harassment) | Phone numbers, emails, UPI IDs and social handles are masked until both people opt to share, including in the first request message |
| Money scams | Safety copy: "never send money in advance"; a "scam_or_money" report reason; reported messages go to moderators |
| Harassment | One-tap report and block; block closes the chat, declines requests and hides both people from each other; upheld reports cost 15 trust each |
| Dating misuse | Copy and UX are about trips ("Ask to travel together"); no photos beyond an emoji avatar; no swiping |
| Over-trusting badges | "ID Verified is not a background check" is shown where badges appear |

**What we do not claim:** criminal background checks; real-time location sharing between buddies; that masking is unbreakable (people can spell numbers out).
