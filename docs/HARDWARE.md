# OFFGRID Beacon: hardware guide

A pocket LoRa radio that sends your SOS and location where phones have no signal. It is **not a certified
emergency device**: it complements 112, it doesn't replace it. The app always shows 112 first.

> **Status (Phase 7):** the firmware has **not been compiled yet**; it was written without an ESP32
> toolchain. The packet format is verified (TypeScript tests plus an independent Python check of the
> shared test vector), and the whole radio-to-server path has been run end to end with the simulator.
> On the first flash, run `SELFTEST` in the serial monitor and expect `PASS`.

---

## 1. How it works

```
 [Beacon] ──LoRa 866 MHz──▶ [any beacon in range] ──▶ … up to 3 hops … ──▶ [gateway with Wi-Fi]
     │                                                                          │
     └──Bluetooth──▶ [a phone running OFFGRID] ──(when it has signal)──▶  POST /api/v1/beacons/relay
                                                                                │
                                         API checks the HMAC, de-duplicates, raises the SOS
                                                                                ▼
                                    SMS to emergency contacts with a live-status link + map
```

- **Ping** every 5 minutes with location and battery. During an active trip, pings become part of the trip's track.
- **SOS:** hold the button for 3 seconds. The beacon sends an SOS every 30 s until you hold it for 3 seconds again,
  which sends "I'm safe" three times.
- **Relay:** every beacon rebroadcasts packets it hears, once each, with one hop fewer (3 hops at most). SOS
  packets jump the queue.
- **Gateway:** the same firmware with Wi-Fi configured (a homestay, a dhaba, a forest check-post) uploads
  everything it hears.
- **Phone relay:** the app connects over Bluetooth (Chrome on Android), receives the same packets, and uploads
  them as soon as the phone has any signal. If it has none, they wait in the app's outbox.

### Packet (v1, 34 bytes)
| Offset | Size | Field |
|---|---|---|
| 0 | 1 | version = 1 |
| 1 | 1 | kind: 1 ping, 2 SOS, 3 cancel |
| 2 | 4 | beacon id (uint32 LE) |
| 6 | 4 | seq (uint32 LE, only goes up, stored in flash) |
| 10 | 4 | lat × 10⁶ (int32 LE) |
| 14 | 4 | lon × 10⁶ (int32 LE) |
| 18 | 4 | GPS time, unix seconds (0 = no fix) |
| 22 | 1 | battery % |
| 23 | 1 | hops left (**not** signed, because relays decrement it) |
| 24 | 10 | MAC = first 10 bytes of HMAC-SHA256(key, bytes 0–22) |

- **No encryption:** relays must be able to read and prioritise an SOS. The MAC stops forging and tampering.
- **Replays:** the server rejects any `(beacon, seq)` it has seen, and any seq more than 64 behind the newest.
- **Pairing:** the server makes a fresh 128-bit key per pairing, stores it AES-256-GCM encrypted, and shows it
  once. Re-pairing rotates the key.
- **Test vector:** `packages/core/test/beacon.test.ts` holds the shared vector, and firmware `SELFTEST` must print
  the same hex.

---

## 2. Bill of materials (one beacon)

Indicative Indian retail prices, October 2026. Check before ordering.

| Part | Example | ≈ ₹ |
|---|---|---|
| ESP32-S3 + SX1262 board, 863–928 MHz version | Heltec WiFi LoRa 32 **V3** (antenna included) | 1,700–2,100 |
| GPS module + antenna | u-blox NEO-6M / NEO-M8N, or ATGM336H | 300–550 |
| Battery | 3.7 V LiPo, 2,000 mAh, JST 1.25 mm (fits the Heltec charger) | 300–400 |
| SOS button | 12 mm momentary push button (or use the board's PRG button) | 20 |
| Buzzer (optional) | 3–5 V active buzzer | 20 |
| Enclosure | 3D-printed or ABS project box, lanyard hole | 100–250 |
| **Total** | | **≈ 2,450–3,350** |

At 1,000 units with a custom PCB (ESP32-S3-MINI + SX1262 module + ATGM336H), the target is about ₹1,200.

**Two units minimum for the demo:** one beacon and one gateway. A third shows a relay hop.

---

## 3. Wiring (Heltec V3)

The radio, LED and PRG button are already on the board. Wire only the GPS (and optionally a button and buzzer):

| GPS module | Heltec V3 |
|---|---|
| VCC | 3V3 |
| GND | GND |
| TX | GPIO **47** |
| RX | GPIO **48** |

- External SOS button: between any free GPIO and GND. Set `PIN_BUTTON` in `config.h` (default GPIO 0, the PRG button).
- Buzzer: + to a free GPIO, − to GND. Set `PIN_BUZZER`.
- Battery: the JST 1.25 connector on the back. **Check the polarity**; cheap LiPos are often reversed.
- Battery reading: **V3.0** boards enable the divider with GPIO37 LOW, **V3.1/V3.2** with HIGH. Set
  `VBAT_CTRL_ACTIVE` to match the silkscreen.
- Another board (e.g. ESP32-S3 DevKit + Ebyte E22-900M30S): change the LoRa pins and set `LORA_TCXO_VOLTAGE`
  (0 for a plain crystal).

---

## 4. Flash it

**PlatformIO (recommended):**
```
cd firmware/offgrid_beacon
pio run -t upload
pio device monitor
```

**Arduino IDE 2.x:**
1. Add the board manager URL `https://resource.heltec.cn/download/package_heltec_esp32_index.json` (or use
   Espressif's esp32 core) and pick **Heltec WiFi LoRa 32(V3)**.
2. Install the **RadioLib** (7.x) and **TinyGPSPlus** libraries.
3. Set *Tools → Partition Scheme → Huge APP* (Bluetooth + Wi-Fi + TLS need the space).
4. Open `offgrid_beacon.ino` and upload. Serial monitor at **115200**.

**First boot checks:**
- `SELFTEST` → `PASS 01023d2c…682e`
- `ID` → the 8-character beacon id. Write it on the case.
- `STATUS` → GPS "searching" at first. Outdoors a cold fix takes 30 s to a few minutes.

---

## 5. Pair it

1. In the app: **Profile → SOS beacon → Pair a beacon**, and enter the id.
2. The app shows the key **once**, then either:
   - **🔌 Send to beacon over USB** (Chrome/Edge on a laptop, Web Serial), or
   - copy the `PAIR <id> <key>` line into any serial monitor.
3. The beacon replies `OK paired` and sends its first ping. The app shows "Last heard just now".
4. Add at least one **emergency contact** on the same screen.

---

## 6. Make a gateway

On the unit that stays somewhere with Wi-Fi:
```
WIFI <ssid> <password>
RELAYURL http://<api-host>:4000/api/v1/beacons/relay
```
It keeps working as a beacon and relay too. `WIFIOFF` turns the gateway role off.

**HTTPS:** packets are already signed, so TLS here protects privacy (locations), not integrity. The demo
firmware skips certificate checks for `https://` URLs; set a CA certificate (`tls.setCACert`) before real use.

---

## 7. Demo without hardware: the simulator

`apps/beacon-sim` plays a beacon, the relays and the gateway, sending real signed packets to the real API:
```
npm start -w @offgrid/beacon-sim -- --pair "PAIR 0a1b2c3d <key>" --place triund --relays 2 --loss 0.15
```
In demo mode, the pairing dialog shows this exact command.
- **Keys:** `s` SOS, `c` cancel, `p` ping, `q` quit.
- `--sos-after 20` raises an SOS on its own.
- `--no-fix` sends packets without a location.

**Demo script ("SOS with no signal"):**
1. Put the phone in aeroplane mode.
2. Press SOS on the beacon (or `s` in the simulator).
3. On the laptop, open the SMS text and the live-status page.
4. Hold the button again (or `c`), and the page turns green.

---

## 8. Radio rules (India) ⚠️

- **Band:** 865–867 MHz is licence-exempt in India for low-power devices under the WPC exemption, which allows
  up to **1 W ERP** and **200 kHz** channel bandwidth.
- **Our settings:** **866.0 MHz, 125 kHz, 14 dBm, SF9**, comfortably inside the limits.
- **Before a commercial launch:** check the current WPC notification, and the equipment type approval (ETA) or
  TEC requirements for selling a radio product.
- **Never** use 868 or 915 MHz settings from European or US examples. They are outside the Indian exempt band.
- **Airtime:** one packet takes about 0.3 s at SF9. SOS packets are 30 s apart (plus random jitter) and pings
  5 minutes apart, so the channel stays mostly free for other users.
- **Range:** expect 2–10 km line of sight on ridges. Dense forest or a valley floor can drop it below 1 km, which
  is why multi-hop relays and the phone relay exist.

## 9. Known limits (be honest in the demo)

- **Not compiled yet** (see the top of this guide). The first flash may need small fixes.
- **Battery life:** the firmware listens continuously, so it can relay for others. With BLE advertising, expect
  roughly **one day per 2,000 mAh**. Duty-cycled receive (radio CAD + light sleep) is the next step and should
  reach several days.
- **One-tap phone SOS** works only where the phone has some signal. Otherwise it queues until signal returns.
  The beacon is the no-signal path.
- **SMS delivery** is mocked (`SMS_MODE=mock`). Real SMS in India needs a DLT-registered sender and template.
- **Pairing squatting:** anyone who types a beacon's id first can pair it. They can't forge its packets, because
  the key is written over USB to the physical unit, but they can block the real owner until they unpair. Fix
  for production: a factory secret printed inside the case and required at pairing.
