// Board pins and radio settings. Defaults are for the Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262 on board).
// For another board (e.g. an ESP32-S3 DevKit + Ebyte E22-900M SX1262 module) change the pins below.
#pragma once

// ---- SX1262 radio (Heltec V3 internal wiring) ----
#define PIN_LORA_NSS 8
#define PIN_LORA_SCK 9
#define PIN_LORA_MOSI 10
#define PIN_LORA_MISO 11
#define PIN_LORA_RST 12
#define PIN_LORA_BUSY 13
#define PIN_LORA_DIO1 14
// Heltec V3 drives the SX1262 TCXO at 1.8 V. Use 0 for modules with a plain crystal.
#define LORA_TCXO_VOLTAGE 1.8

// ---- GPS (u-blox NEO-6M / NEO-M8N or ATGM336H, 9600 baud) ----
#define PIN_GPS_RX 47  // ESP32 receives on this pin: wire to the GPS module's TX
#define PIN_GPS_TX 48  // wire to the GPS module's RX
#define GPS_BAUD 9600

// ---- User interface ----
#define PIN_BUTTON 0     // Heltec "PRG" button; any momentary switch to GND works
#define PIN_LED 35       // Heltec white LED
#define PIN_BUZZER -1    // optional active buzzer; -1 = none

// ---- Battery (Heltec V3: divider on GPIO1, enabled by GPIO37) ----
// V3.0 enables the divider with ADC_CTRL LOW, V3.1/V3.2 with HIGH. Check the silkscreen on your board.
#define PIN_VBAT_ADC 1
#define PIN_VBAT_CTRL 37
#define VBAT_CTRL_ACTIVE HIGH
#define VBAT_DIVIDER 4.9f

// ---- Radio: India's licence-exempt 865–867 MHz band for low-power devices (WPC exemption) ----
// Limits: up to 1 W (30 dBm) ERP and 200 kHz channel bandwidth. We use 14 dBm and 125 kHz at 866.0 MHz,
// well inside both. Check the current WPC notification before any commercial launch (docs/HARDWARE.md).
#define LORA_FREQ_MHZ 866.0
#define LORA_BW_KHZ 125.0
#define LORA_SF 9           // ~0.3 s per 34-byte packet; 2–10 km line of sight in the hills
#define LORA_CR 7           // coding rate 4/7
#define LORA_POWER_DBM 14
#define LORA_PREAMBLE 8
#define LORA_SYNC_WORD 0x12 // private network, so we don't collide with LoRaWAN (0x34)

// ---- Timing ----
#define SOS_HOLD_MS 3000UL          // hold the button this long to raise (or cancel) an SOS
#define SOS_INTERVAL_MS 30000UL     // during SOS: one packet every 30 s (+ jitter)
#define PING_INTERVAL_MS 300000UL   // otherwise: a location ping every 5 min
#define RELAY_DELAY_MAX_MS 2500UL   // random wait before rebroadcasting, so relays don't collide
#define GATEWAY_FLUSH_MS 5000UL     // gateways post queued packets at most this often

// ---- BLE (phone link) ----
#define BLE_SERVICE_UUID "6f0f0001-8d3c-4a1e-9b5a-0ff9b1d00001"
#define BLE_PACKETS_UUID "6f0f0002-8d3c-4a1e-9b5a-0ff9b1d00001"  // notify: 34-byte packets for the phone to relay
#define BLE_COMMAND_UUID "6f0f0003-8d3c-4a1e-9b5a-0ff9b1d00001"  // write: "SOS", "CANCEL", "PING"
