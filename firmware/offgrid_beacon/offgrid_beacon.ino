// OFFGRID Beacon firmware (Arduino-ESP32 core 2.x or 3.x, RadioLib 7.x, TinyGPSPlus 1.x).
// NOT YET COMPILED: written without an ESP32 toolchain. First flash: run SELFTEST and expect PASS.
//
// One sketch, three roles:
//   * Beacon:  sends a signed location ping every 5 min, and an SOS every 30 s after the button is held 3 s.
//   * Relay:   rebroadcasts packets it hears from other beacons, once each, until their hop count runs out.
//   * Gateway: if Wi-Fi is configured, also posts every packet it has to the OFFGRID API (POST /beacons/relay).
// A phone running OFFGRID connects over Bluetooth, receives the same packets and relays them when it has signal.
//
// Serial console at 115200 baud. Type HELP for commands. Pair from the app (Profile → SOS beacon), which
// sends "PAIR <id> <key>" over USB, or paste that line here yourself.
//
// Not a certified emergency device: it complements 112, it doesn't replace it.

#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <RadioLib.h>
#include <SPI.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "packet.h"

using namespace offgrid;

// ---------------------------------------------------------------- state

SPIClass loraSpi(FSPI);
SX1262 radio = new Module(PIN_LORA_NSS, PIN_LORA_DIO1, PIN_LORA_RST, PIN_LORA_BUSY, loraSpi);
TinyGPSPlus gps;
Preferences prefs;

uint32_t beaconId = 0;
uint8_t key[KEY_LEN];
bool paired = false;
uint32_t seq = 0;

bool sosActive = false;
unsigned long lastOwnTx = 0;
unsigned long nextOwnTxGap = PING_INTERVAL_MS;

volatile bool rxFlag = false;
void IRAM_ATTR onDio1() { rxFlag = true; }

// Packets heard recently, so each is rebroadcast and uploaded at most once.
struct Seen { uint32_t id; uint32_t seq; };
Seen seen[64];
uint8_t seenNext = 0;

// Packets waiting to be rebroadcast over LoRa.
struct Pending { uint8_t buf[PACKET_LEN]; unsigned long due; bool used; };
Pending relayQueue[16];

// Packets waiting for an internet connection (gateway role).
struct Upload { char hex[PACKET_LEN * 2 + 1]; bool used; };
Upload uploadQueue[32];
unsigned long lastFlush = 0;
String wifiSsid, wifiPass, relayUrl;

// Button
unsigned long pressStart = 0;
bool holdHandled = false;

// BLE
BLECharacteristic* blePackets = nullptr;
bool bleConnected = false;
volatile bool bleCommandPending = false;
String bleCommand;

// ---------------------------------------------------------------- helpers

uint8_t batteryPercent() {
  pinMode(PIN_VBAT_CTRL, OUTPUT);
  digitalWrite(PIN_VBAT_CTRL, VBAT_CTRL_ACTIVE);
  delay(5);
  uint32_t mv = analogReadMilliVolts(PIN_VBAT_ADC) * VBAT_DIVIDER;
  digitalWrite(PIN_VBAT_CTRL, !VBAT_CTRL_ACTIVE);
  // Li-ion: ~3.3 V empty, 4.2 V full. Good enough for "charge me soon".
  if (mv >= 4200) return 100;
  if (mv <= 3300) return 0;
  return (uint8_t)((mv - 3300) / 9);
}

// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm), so we don't need timegm().
long daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (long)doe - 719468;
}

bool gpsFix(Fields& f) {
  bool fresh = gps.location.isValid() && gps.location.age() < 120000 && gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2024;
  f.hasFix = fresh;
  if (!fresh) { f.lat = f.lon = 0; f.gpsUnix = 0; return false; }
  f.lat = gps.location.lat();
  f.lon = gps.location.lng();
  long days = daysFromCivil(gps.date.year(), gps.date.month(), gps.date.day());
  // The fix may be up to 2 minutes old; report when it was taken, not when we send.
  uint32_t ageS = gps.location.age() / 1000;
  f.gpsUnix = (uint32_t)(days * 86400L + gps.time.hour() * 3600L + gps.time.minute() * 60L + gps.time.second()) - ageS;
  return true;
}

void led(bool on) { digitalWrite(PIN_LED, on ? HIGH : LOW); }

void beep(int ms) {
  if (PIN_BUZZER < 0) return;
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
}

bool markSeen(uint32_t id, uint32_t s) {
  for (auto& e : seen) if (e.id == id && e.seq == s) return false;
  seen[seenNext] = {id, s};
  seenNext = (seenNext + 1) % 64;
  return true;
}

void queueUpload(const uint8_t* buf) {
  if (wifiSsid.isEmpty()) return;
  for (auto& u : uploadQueue) {
    if (!u.used) { toHex(buf, PACKET_LEN, u.hex); u.used = true; return; }
  }
  // Full: drop the oldest ping to make room, never an SOS.
  for (auto& u : uploadQueue) {
    if (u.hex[3] == '1') { toHex(buf, PACKET_LEN, u.hex); return; }
  }
}

void notifyPhone(const uint8_t* buf) {
  if (!bleConnected || !blePackets) return;
  blePackets->setValue((uint8_t*)buf, PACKET_LEN);
  blePackets->notify();
}

void transmit(const uint8_t* buf) {
  led(true);
  int st = radio.transmit((uint8_t*)buf, PACKET_LEN);
  led(false);
  if (st != RADIOLIB_ERR_NONE) Serial.printf("LoRa send failed (%d)\n", st);
  radio.startReceive();
}

// ---------------------------------------------------------------- own packets

void sendOwn(uint8_t kind) {
  if (!paired) {
    Serial.println("Not paired: pair in the OFFGRID app first (Profile → SOS beacon).");
    return;
  }
  Fields f{};
  f.kind = kind;
  f.beaconId = beaconId;
  f.seq = ++seq;
  gpsFix(f);
  f.battery = batteryPercent();
  f.hopsLeft = MAX_HOPS;
  prefs.putUInt("seq", seq);  // NVS is wear-levelled; one write per packet is fine

  uint8_t buf[PACKET_LEN];
  if (!encode(f, key, buf)) { Serial.println("HMAC failed"); return; }
  markSeen(beaconId, seq);
  transmit(buf);
  notifyPhone(buf);
  queueUpload(buf);
  lastOwnTx = millis();
  nextOwnTxGap = (sosActive ? SOS_INTERVAL_MS : PING_INTERVAL_MS) + random(0, 3000);

  char hex[PACKET_LEN * 2 + 1];
  toHex(buf, PACKET_LEN, hex);
  Serial.printf("TX %s seq=%lu fix=%s bat=%u%% %s\n", kind == KIND_SOS ? "SOS" : kind == KIND_CANCEL ? "CANCEL" : "PING", (unsigned long)seq,
                f.hasFix ? "yes" : "no", f.battery, hex);
}

void startSos() {
  if (sosActive) return;
  sosActive = true;
  Serial.println(">>> SOS ON. Sending every 30 s. Hold the button 3 s again to cancel. Call 112 if you can.");
  beep(600);
  sendOwn(KIND_SOS);
}

void cancelSos() {
  if (!sosActive) return;
  sosActive = false;
  Serial.println(">>> SOS cancelled: sending 'I'm safe' three times.");
  beep(150); delay(100); beep(150);
  // Repeat the cancel a few times: it matters that it gets through too.
  for (int i = 0; i < 3; i++) { sendOwn(KIND_CANCEL); delay(1500 + random(0, 1000)); }
}

// ---------------------------------------------------------------- receive and relay

void handleReceived() {
  uint8_t buf[64];
  size_t len = radio.getPacketLength();
  if (len > sizeof(buf)) len = sizeof(buf);
  int st = radio.readData(buf, len);
  radio.startReceive();
  if (st != RADIOLIB_ERR_NONE || !looksValid(buf, len)) return;
  uint32_t id = beaconIdOf(buf), s = seqOf(buf);
  if (id == beaconId || !markSeen(id, s)) return;

  Serial.printf("RX beacon %08lx seq=%lu kind=%u hops=%u rssi=%.0f\n", (unsigned long)id, (unsigned long)s, buf[1], buf[HOPS_OFFSET], radio.getRSSI());
  notifyPhone(buf);
  queueUpload(buf);
  if (buf[HOPS_OFFSET] == 0) return;

  // Rebroadcast once, one hop fewer, after a random delay so nearby relays don't all talk at once.
  for (auto& p : relayQueue) {
    if (!p.used) {
      memcpy(p.buf, buf, PACKET_LEN);
      p.buf[HOPS_OFFSET]--;
      // SOS jumps the queue.
      p.due = millis() + (buf[1] == KIND_SOS ? random(200, 800) : random(500, RELAY_DELAY_MAX_MS));
      p.used = true;
      return;
    }
  }
}

void runRelayQueue() {
  unsigned long now = millis();
  for (auto& p : relayQueue) {
    if (p.used && (long)(now - p.due) >= 0) {
      transmit(p.buf);
      p.used = false;
    }
  }
}

// ---------------------------------------------------------------- gateway

void flushUploads() {
  if (wifiSsid.isEmpty() || relayUrl.isEmpty() || millis() - lastFlush < GATEWAY_FLUSH_MS) return;
  lastFlush = millis();
  bool any = false;
  for (auto& u : uploadQueue) any |= u.used;
  if (!any) return;
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    return;  // try again on the next flush
  }

  String body = "{\"relayId\":\"gw-";
  char idHex[9];
  snprintf(idHex, sizeof(idHex), "%08lx", (unsigned long)beaconId);
  body += idHex;
  body += "\",\"packets\":[";
  bool first = true;
  for (auto& u : uploadQueue) {
    if (!u.used) continue;
    if (!first) body += ",";
    body += "\"";
    body += u.hex;
    body += "\"";
    first = false;
  }
  body += "]}";

  HTTPClient http;
  WiFiClientSecure tls;
  bool ok;
  if (relayUrl.startsWith("https://")) {
    // Packets are HMAC-signed, so TLS protects privacy here, not integrity. For a demo without a CA bundle
    // this skips certificate checks; set a CA certificate with tls.setCACert() for production.
    tls.setInsecure();
    ok = http.begin(tls, relayUrl);
  } else {
    ok = http.begin(relayUrl);
  }
  if (!ok) return;
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  http.end();
  Serial.printf("Gateway upload: HTTP %d\n", code);
  // 200 means the server looked at every packet (accepted, duplicate or rejected). Retry anything else.
  if (code == 200) for (auto& u : uploadQueue) u.used = false;
}

// ---------------------------------------------------------------- BLE

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; Serial.println("Phone connected over Bluetooth"); }
  void onDisconnect(BLEServer* s) override {
    bleConnected = false;
    s->getAdvertising()->start();
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    // Handled in loop(): radio calls don't belong in the BLE task.
    bleCommand = String(c->getValue().c_str());
    bleCommandPending = true;
  }
};

void setupBle() {
  char name[20];
  snprintf(name, sizeof(name), "OFFGRID-%08lx", (unsigned long)beaconId);
  BLEDevice::init(name);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* svc = server->createService(BLE_SERVICE_UUID);
  blePackets = svc->createCharacteristic(BLE_PACKETS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  blePackets->addDescriptor(new BLE2902());
  BLECharacteristic* cmd = svc->createCharacteristic(BLE_COMMAND_UUID, BLECharacteristic::PROPERTY_WRITE);
  cmd->setCallbacks(new CommandCallbacks());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->start();
}

// ---------------------------------------------------------------- serial commands

void printStatus() {
  Serial.printf("Beacon id: %08lx  paired: %s  seq: %lu  SOS: %s\n", (unsigned long)beaconId, paired ? "yes" : "no", (unsigned long)seq, sosActive ? "ON" : "off");
  Serial.printf("GPS: %s  sats: %lu  battery: %u%%\n", gps.location.isValid() ? "fix" : "searching", (unsigned long)gps.satellites.value(), batteryPercent());
  Serial.printf("Gateway: %s\n", wifiSsid.isEmpty() ? "off (beacon/relay only)" : (wifiSsid + " → " + relayUrl).c_str());
}

void handleCommand(String line) {
  line.trim();
  String cmd = line;
  int sp = line.indexOf(' ');
  if (sp > 0) cmd = line.substring(0, sp);
  cmd.toUpperCase();

  if (cmd == "HELP") {
    Serial.println("ID | STATUS | PAIR <id> <32-hex key> | UNPAIR | SOS | CANCEL | PING | SELFTEST | WIFI <ssid> <password> | RELAYURL <url> | WIFIOFF");
  } else if (cmd == "ID") {
    Serial.printf("%08lx\n", (unsigned long)beaconId);
  } else if (cmd == "STATUS") {
    printStatus();
  } else if (cmd == "PAIR") {
    char id[16], keyHex[48];
    if (sscanf(line.c_str(), "%*s %15s %47s", id, keyHex) != 2) { Serial.println("ERR usage: PAIR <id> <key>"); return; }
    char mine[9];
    snprintf(mine, sizeof(mine), "%08lx", (unsigned long)beaconId);
    // The key is for one specific beacon; refuse a key generated for another id.
    if (strcasecmp(id, mine) != 0) { Serial.printf("ERR this beacon is %s, not %s\n", mine, id); return; }
    uint8_t k[KEY_LEN];
    if (!fromHex(keyHex, k, KEY_LEN)) { Serial.println("ERR key must be 32 hex characters"); return; }
    memcpy(key, k, KEY_LEN);
    paired = true;
    seq = 0;  // the server forgets old packets when it issues a new key
    prefs.putBytes("key", key, KEY_LEN);
    prefs.putBool("paired", true);
    prefs.putUInt("seq", 0);
    Serial.println("OK paired");
    beep(100);
    sendOwn(KIND_PING);
  } else if (cmd == "UNPAIR") {
    memset(key, 0, KEY_LEN);
    paired = false;
    prefs.remove("key");
    prefs.putBool("paired", false);
    Serial.println("OK unpaired");
  } else if (cmd == "SOS") {
    startSos();
  } else if (cmd == "CANCEL") {
    cancelSos();
  } else if (cmd == "PING") {
    sendOwn(KIND_PING);
  } else if (cmd == "SELFTEST") {
    char hex[PACKET_LEN * 2 + 1];
    bool ok = selfTest(hex);
    Serial.printf("%s %s\n", ok ? "PASS" : "FAIL", hex);
  } else if (cmd == "WIFI") {
    int sp2 = line.indexOf(' ', sp + 1);
    if (sp < 0 || sp2 < 0) { Serial.println("ERR usage: WIFI <ssid> <password>"); return; }
    wifiSsid = line.substring(sp + 1, sp2);
    wifiPass = line.substring(sp2 + 1);
    prefs.putString("ssid", wifiSsid);
    prefs.putString("pass", wifiPass);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    Serial.println("OK gateway Wi-Fi saved");
  } else if (cmd == "RELAYURL") {
    relayUrl = line.substring(sp + 1);
    prefs.putString("url", relayUrl);
    Serial.println("OK relay URL saved");
  } else if (cmd == "WIFIOFF") {
    wifiSsid = "";
    prefs.remove("ssid");
    prefs.remove("pass");
    WiFi.disconnect(true);
    Serial.println("OK gateway off");
  } else if (cmd.length()) {
    Serial.println("ERR unknown command, type HELP");
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  if (PIN_BUZZER >= 0) pinMode(PIN_BUZZER, OUTPUT);
  randomSeed(esp_random());

  // Printed on a sticker on the case; the app asks for it when pairing.
  beaconId = (uint32_t)(ESP.getEfuseMac() & 0xffffffffULL);

  prefs.begin("offgrid", false);
  paired = prefs.getBool("paired", false) && prefs.getBytes("key", key, KEY_LEN) == KEY_LEN;
  seq = prefs.getUInt("seq", 0);
  wifiSsid = prefs.getString("ssid", "");
  wifiPass = prefs.getString("pass", "");
  relayUrl = prefs.getString("url", "");

  Serial1.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  loraSpi.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  int st = radio.begin(LORA_FREQ_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR, LORA_SYNC_WORD, LORA_POWER_DBM, LORA_PREAMBLE, LORA_TCXO_VOLTAGE);
  if (st != RADIOLIB_ERR_NONE) Serial.printf("LoRa init failed (%d). Check the pins in config.h.\n", st);
  radio.setDio2AsRfSwitch(true);
  radio.setDio1Action(onDio1);
  radio.startReceive();

  setupBle();
  if (!wifiSsid.isEmpty()) WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  Serial.println("\nOFFGRID Beacon ready. Type HELP.");
  printStatus();
  lastOwnTx = millis() - PING_INTERVAL_MS + 15000;  // first ping ~15 s after boot, once GPS has had a moment
}

void loop() {
  while (Serial1.available()) gps.encode(Serial1.read());

  if (Serial.available()) handleCommand(Serial.readStringUntil('\n'));

  if (bleCommandPending) {
    bleCommandPending = false;
    String c = bleCommand;
    c.toUpperCase();
    if (c == "SOS") startSos();
    else if (c == "CANCEL") cancelSos();
    else if (c == "PING") sendOwn(KIND_PING);
  }

  // Hold 3 s: SOS on; hold 3 s again: SOS off. A short press does nothing, so a bump in a pocket can't trigger it.
  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down && pressStart == 0) { pressStart = millis(); holdHandled = false; }
  if (!down) pressStart = 0;
  if (down && !holdHandled && millis() - pressStart >= SOS_HOLD_MS) {
    holdHandled = true;
    if (sosActive) cancelSos(); else startSos();
  }

  if (rxFlag) { rxFlag = false; handleReceived(); }
  runRelayQueue();

  if (paired && millis() - lastOwnTx >= nextOwnTxGap) sendOwn(sosActive ? KIND_SOS : KIND_PING);

  flushUploads();

  // LED: fast blink during SOS, a blip every 3 s otherwise, double blip if unpaired.
  static unsigned long lastBlink = 0;
  unsigned long period = sosActive ? 250 : 3000;
  if (millis() - lastBlink >= period) {
    lastBlink = millis();
    led(true); delay(sosActive ? 120 : 20); led(false);
    if (!paired && !sosActive) { delay(120); led(true); delay(20); led(false); }
  }
}
