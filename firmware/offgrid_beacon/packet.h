// OFFGRID Beacon packet v1. Mirrors packages/core/src/beacon/packet.ts byte for byte.
// Layout (34 bytes, little-endian): version, kind, beacon id u32, seq u32, lat i32 (×1e6), lon i32 (×1e6),
// GPS time u32 (unix s, 0 = no fix), battery u8, hops left u8 (not signed), MAC[10] = HMAC-SHA256(key, bytes 0..22).
#pragma once
#include <Arduino.h>
#include "mbedtls/md.h"

namespace offgrid {

constexpr uint8_t VERSION = 1;
constexpr size_t PACKET_LEN = 34;
constexpr size_t SIGNED_LEN = 23;
constexpr size_t HOPS_OFFSET = 23;
constexpr size_t MAC_OFFSET = 24;
constexpr size_t MAC_LEN = 10;
constexpr uint8_t MAX_HOPS = 3;
constexpr size_t KEY_LEN = 16;

enum Kind : uint8_t { KIND_PING = 1, KIND_SOS = 2, KIND_CANCEL = 3 };

struct Fields {
  uint8_t kind;
  uint32_t beaconId;
  uint32_t seq;
  bool hasFix;
  double lat, lon;
  uint32_t gpsUnix;  // 0 when there's no fix
  uint8_t battery;   // 0–100
  uint8_t hopsLeft;
};

inline void put32(uint8_t* p, uint32_t v) {
  p[0] = v & 0xff; p[1] = (v >> 8) & 0xff; p[2] = (v >> 16) & 0xff; p[3] = (v >> 24) & 0xff;
}
inline uint32_t get32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

inline bool hmacSha256(const uint8_t* key, size_t keyLen, const uint8_t* data, size_t len, uint8_t out[32]) {
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  return mbedtls_md_hmac(info, key, keyLen, data, len, out) == 0;
}

// Builds and signs a packet. Returns false if HMAC failed (should never happen).
inline bool encode(const Fields& f, const uint8_t key[KEY_LEN], uint8_t out[PACKET_LEN]) {
  out[0] = VERSION;
  out[1] = f.kind;
  put32(out + 2, f.beaconId);
  put32(out + 6, f.seq);
  // Same rounding as the TypeScript side: Math.round(x * 1e6).
  int32_t lat = f.hasFix ? (int32_t)lround(f.lat * 1e6) : 0;
  int32_t lon = f.hasFix ? (int32_t)lround(f.lon * 1e6) : 0;
  put32(out + 10, (uint32_t)lat);
  put32(out + 14, (uint32_t)lon);
  put32(out + 18, f.hasFix ? f.gpsUnix : 0);
  out[22] = f.battery > 100 ? 100 : f.battery;
  out[HOPS_OFFSET] = f.hopsLeft > MAX_HOPS ? MAX_HOPS : f.hopsLeft;
  uint8_t mac[32];
  if (!hmacSha256(key, KEY_LEN, out, SIGNED_LEN, mac)) return false;
  memcpy(out + MAC_OFFSET, mac, MAC_LEN);
  return true;
}

// Cheap shape check used by relays, which don't have other beacons' keys and can't verify the MAC.
inline bool looksValid(const uint8_t* p, size_t len) {
  return len == PACKET_LEN && p[0] == VERSION && p[1] >= KIND_PING && p[1] <= KIND_CANCEL && p[22] <= 100 && p[HOPS_OFFSET] <= MAX_HOPS;
}

inline uint32_t beaconIdOf(const uint8_t* p) { return get32(p + 2); }
inline uint32_t seqOf(const uint8_t* p) { return get32(p + 6); }

inline void toHex(const uint8_t* p, size_t len, char* out) {
  static const char* d = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) { out[i * 2] = d[p[i] >> 4]; out[i * 2 + 1] = d[p[i] & 15]; }
  out[len * 2] = 0;
}

inline bool fromHex(const char* s, uint8_t* out, size_t len) {
  auto nib = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  if (strlen(s) != len * 2) return false;
  for (size_t i = 0; i < len; i++) {
    int hi = nib(s[i * 2]), lo = nib(s[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (hi << 4) | lo;
  }
  return true;
}

// The shared test vector from packages/core/test/beacon.test.ts.
inline bool selfTest(char hexOut[PACKET_LEN * 2 + 1]) {
  const uint8_t key[KEY_LEN] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
  Fields f{KIND_SOS, 0x0a1b2c3d, 42, true, 32.256012, 76.348734, 1792823400UL, 87, MAX_HOPS};
  uint8_t buf[PACKET_LEN];
  if (!encode(f, key, buf)) return false;
  toHex(buf, PACKET_LEN, hexOut);
  return strcmp(hexOut, "01023d2c1b0a2a0000000c30ec013efd8c046850dc6a5703b917e56dc29ee86b682e") == 0;
}

}  // namespace offgrid
