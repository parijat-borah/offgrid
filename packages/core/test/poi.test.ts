import { describe, expect, it } from "vitest";
import curated from "../../../data/regions/himachal/pois.json";
import osm from "../../../data/regions/himachal/pois.osm.json";
import moderationJson from "../../../data/moderation-rules.json";
import { fuzzLocation, findDuplicates, nameSimilarity, normalizeName, tallyVotes, trustScore, voteWeight } from "../src/poi/community";
import { openStatus, parseHours } from "../src/poi/hours";
import { distanceToRouteKm, findNearby, poiStatus } from "../src/poi/nearby";
import { ModerationRulesSchema, PoiSchema, type Poi } from "../src/poi/schemas";

const IST = 330;
const moderation = ModerationRulesSchema.parse(moderationJson);
/** Builds a Date for a given IST wall-clock time. 2026-10-19 is a Monday. */
const ist = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 19 + day, hh, mm) - IST * 60_000);

const poi = (o: Partial<Poi>): Poi => ({
  id: "p",
  region_id: "himachal",
  name: "Place",
  category: "food",
  lat: 32.24,
  lon: 76.32,
  description: "",
  price_band: null,
  tags: [],
  hours: null,
  event_months: null,
  source: "osm",
  ...o,
});

describe("opening hours", () => {
  it("parses the forms found in real OSM data", () => {
    expect(parseHours("24/7")?.every((d) => d.length === 1)).toBe(true);
    expect(parseHours("Mo-Su 08:30-21:30")?.[3]).toEqual([[510, 1290]]);
    const thOff = parseHours("09:00-17:00; Th off")!;
    expect(thOff[3]).toEqual([]);
    expect(thOff[4]).toEqual([[540, 1020]]);
    expect(parseHours("Mo-Fr 09:00-13:00,14:00-18:00")?.[0]).toHaveLength(2);
    expect(parseHours("Sa-Mo 10:00-12:00")?.map((d) => d.length)).toEqual([1, 0, 0, 0, 0, 1, 1]);
  });

  it("returns null for anything it doesn't understand, instead of guessing", () => {
    expect(parseHours("sunrise-sunset")).toBeNull();
    expect(parseHours("Mo-Fr 25:00-26:00")).toBeNull();
    expect(parseHours("by appointment")).toBeNull();
    expect(parseHours(null)).toBeNull();
  });

  it("says open with the closing time, or closed with the next opening", () => {
    expect(openStatus("Mo-Su 08:30-21:30", ist(0, 12), IST)).toEqual({ state: "open", label: "Open · closes 21:30" });
    expect(openStatus("Mo-Su 08:30-21:30", ist(0, 7), IST)).toEqual({ state: "closed", label: "Closed · opens 08:30" });
    expect(openStatus("Mo-Su 08:30-21:30", ist(0, 22), IST).label).toBe("Closed · opens Tue 08:30");
    expect(openStatus("09:00-17:00; Th off", ist(3, 12), IST).label).toBe("Closed · opens Fri 09:00");
  });

  it("handles ranges past midnight", () => {
    expect(openStatus("Fr 20:00-02:00", ist(5, 1), IST).state).toBe("open"); // Saturday 01:00
    expect(openStatus("Fr 20:00-02:00", ist(5, 3), IST).state).toBe("closed");
  });

  it("uses the region's local time, not the device's", () => {
    // 03:00 UTC is 08:30 IST on Monday.
    expect(openStatus("Mo 08:30-09:00", new Date(Date.UTC(2026, 9, 19, 3, 0)), IST).state).toBe("open");
  });

  it("reports unknown hours honestly", () => {
    expect(openStatus(null, ist(0, 12), IST)).toEqual({ state: "unknown", label: "Hours unknown" });
  });
});

describe("nearby", () => {
  const center = { lat: 32.2426, lon: 76.3213 };
  const near = poi({ id: "near", name: "Near cafe", lat: 32.243, lon: 76.322, tags: ["veg"], price_band: 1, hours: "24/7" });
  const mid = poi({ id: "mid", name: "Mid hotel", category: "stay", lat: 32.26, lon: 76.33, price_band: 3, tags: ["women_safe"] });
  const far = poi({ id: "far", name: "Far place", lat: 32.5, lon: 76.5 });
  const all = [far, mid, near];

  it("sorts by distance and respects the radius", () => {
    const res = findNearby(all, { center, radiusKm: 5 }, ist(0, 12), IST);
    expect(res.map((r) => r.poi.id)).toEqual(["near", "mid"]);
    expect(res[0]!.distanceKm).toBeLessThan(0.2);
  });

  it("filters by category, tags and price, keeping places with no price data", () => {
    expect(findNearby(all, { center, radiusKm: 5, categories: ["stay"] }, ist(0, 12), IST).map((r) => r.poi.id)).toEqual(["mid"]);
    expect(findNearby(all, { center, radiusKm: 5, tags: ["veg"] }, ist(0, 12), IST).map((r) => r.poi.id)).toEqual(["near"]);
    expect(findNearby(all, { center, radiusKm: 5, maxPriceBand: 2 }, ist(0, 12), IST).map((r) => r.poi.id)).toEqual(["near"]);
    const unpriced = poi({ id: "unpriced", lat: 32.244, lon: 76.322 });
    expect(findNearby([unpriced], { center, radiusKm: 5, maxPriceBand: 1 }, ist(0, 12), IST)).toHaveLength(1);
  });

  it("'open now' keeps only places known to be open", () => {
    expect(findNearby(all, { center, radiusKm: 5, openNow: true }, ist(0, 12), IST).map((r) => r.poi.id)).toEqual(["near"]);
  });

  it("measures distance to a route when one is given", () => {
    const route = [
      { lat: 32.4, lon: 76.4 },
      { lat: 32.6, lon: 76.6 },
    ];
    expect(distanceToRouteKm({ lat: 32.5, lon: 76.5 }, route)).toBeLessThan(0.01);
    const res = findNearby(all, { center, radiusKm: 2, route }, ist(0, 12), IST);
    expect(res.map((r) => r.poi.id)).toEqual(["far"]);
  });

  it("shows events by month and seasonal places as out of season", () => {
    const fair = poi({ category: "event", event_months: [10] });
    expect(poiStatus(fair, ist(0, 12), IST)).toEqual({ state: "open", label: "Happening this month" });
    expect(poiStatus(poi({ category: "event", event_months: [5] }), ist(0, 12), IST).label).toBe("Usually in May");
    expect(poiStatus(poi({ seasonality: [6, 7, 8], hours: "24/7" }), ist(0, 12), IST).label).toBe("Out of season in October");
  });
});

describe("community moderation", () => {
  it("normalises names", () => {
    expect(normalizeName("  Moon Café!! ")).toBe("moon cafe");
  });

  it("scores similar names high and different names low", () => {
    expect(nameSimilarity("Moon Light Cafe", "Moonlight Café")).toBeGreaterThan(0.6);
    expect(nameSimilarity("Shanti Cafe", "Gravity Cafe")).toBeLessThan(0.45);
  });

  it("finds duplicates nearby and marks near-identical ones as certain", () => {
    const existing = [
      { id: "a", name: "Moon Light Cafe", source: "osm", lat: 32.0, lon: 77.0 },
      { id: "b", name: "Moon Light Cafe", source: "osm", lat: 32.01, lon: 77.0 }, // ~1.1 km away
      { id: "c", name: "Rainbow Dhaba", source: "osm", lat: 32.0, lon: 77.0003 },
    ];
    const dups = findDuplicates({ name: "Moonlight Café", lat: 32.0002, lon: 77.0 }, existing, moderation);
    expect(dups.map((d) => d.id)).toEqual(["a"]);
    expect(dups[0]!.certain).toBe(true);
  });

  it("fuzzes locations to a fixed grid cell, the same way every time", () => {
    const a = fuzzLocation({ lat: 32.2559, lon: 76.3459 }, 0.02);
    expect(a).toEqual(fuzzLocation({ lat: 32.2501, lon: 76.3401 }, 0.02));
    expect(a).toEqual({ lat: 32.25, lon: 76.35 });
  });

  it("computes trust and vote weight", () => {
    const base = { phoneVerified: false, emailVerified: false, govIdVerified: false, livenessVerified: false, avgRating: null, upheldReports: 0 };
    expect(trustScore({ ...base, verifiedTrips: 0 })).toBe(0);
    expect(trustScore({ ...base, verifiedTrips: 10 })).toBe(15);
    expect(trustScore({ ...base, verifiedTrips: 2, govIdVerified: true, phoneVerified: true })).toBe(61);
    expect(trustScore({ ...base, verifiedTrips: 0, upheldReports: 3 })).toBe(0);
    expect(voteWeight(0, moderation)).toBe(0.3);
    expect(voteWeight(61, moderation)).toBe(0.91);
  });

  it("verifies with enough trusted upvotes, and lets flags win", () => {
    const up = (w: number) => ({ value: 1 as const, weight: w });
    const flag = (w: number) => ({ value: -1 as const, weight: w });
    // Three brand-new accounts aren't enough on their own…
    expect(tallyVotes([up(0.3), up(0.3), up(0.3)], moderation).decision).toBe("none");
    // …but three trusted travellers are.
    expect(tallyVotes([up(0.9), up(0.7), up(0.5)], moderation).decision).toBe("verify");
    // Two flags from new accounts send it to a moderator even with upvotes.
    expect(tallyVotes([up(0.9), up(0.9), up(0.9), flag(0.3), flag(0.3)], moderation).decision).toBe("flag");
  });
});

describe("POI data", () => {
  it("parses every curated and OSM point", () => {
    const all = [...curated, ...osm].map((p) => PoiSchema.parse(p));
    expect(all.length).toBeGreaterThan(500);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(all.filter((p) => p.category === "event").every((p) => p.event_months?.length)).toBe(true);
  });

  it("understands most real opening hours", () => {
    const withHours = [...curated, ...osm].filter((p) => p.hours);
    const parsed = withHours.filter((p) => parseHours(p.hours) !== null);
    expect(parsed.length / withHours.length).toBeGreaterThan(0.8);
  });
});
