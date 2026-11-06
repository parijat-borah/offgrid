import { describe, expect, it } from "vitest";
import guideJson from "../../../data/safety-guide.json";
import rulesJson from "../../../data/safety-rules.json";
import hazardsJson from "../../../data/regions/himachal/hazards.json";
import hospitalsJson from "../../../data/regions/himachal/hospitals.json";
import placesJson from "../../../data/regions/himachal/places.json";
import { tripAlerts } from "../src/safety/alerts";
import { distanceToHazardKm, hazardsForPlace, hazardsNear, isActive, nearestHospitals } from "../src/safety/hazards";
import { HazardSchema, HospitalSchema, SafetyGuideSchema, SafetyRulesSchema, type DailyForecast, type Hazard } from "../src/safety/schemas";
import { forecastWarnings, weatherLabel, worstByDate } from "../src/safety/weather";
import { PlaceSchema } from "../src/schemas";
import { makePlace } from "./fixtures";

const rules = SafetyRulesSchema.parse(rulesJson);
const NOW = new Date("2026-10-22T06:00:00Z");
const day = (o: Partial<DailyForecast> = {}): DailyForecast => ({
  date: "2026-10-23",
  code: 1,
  tMaxC: 12,
  tMinC: 3,
  precipMm: 0,
  snowCm: 0,
  precipProb: 10,
  gustKmh: 20,
  uvMax: 5,
  ...o,
});
const hazard = (o: Partial<Hazard> = {}): Hazard =>
  HazardSchema.parse({
    id: "h",
    region_id: "himachal",
    kind: "landslide",
    severity: 2,
    title: "Slide",
    description: "",
    lat: 30,
    lon: 75,
    radius_m: 1000,
    months: null,
    source: "curated",
    ...o,
  });

describe("weather warnings", () => {
  const point = { label: "Camp", elevationM: 3600 };

  it("labels WMO codes", () => {
    expect(weatherLabel(0)).toEqual({ label: "Clear", icon: "☀️" });
    expect(weatherLabel(95).label).toBe("Thunderstorm");
    expect(weatherLabel(12345).label).toBe("Unknown");
  });

  it("stays quiet on a fine day", () => {
    expect(forecastWarnings([day()], point, null, rules)).toEqual([]);
  });

  it("grades rain and adds route-specific advice", () => {
    const route = makePlace({ hazards: ["river_crossing", "landslide"] });
    const [w] = forecastWarnings([day({ precipMm: 45 })], point, route, rules);
    expect(w).toMatchObject({ kind: "rain", severity: 3 });
    expect(w!.text).toMatch(/streams will be high/);
    expect(w!.text).toMatch(/slides/);
    expect(forecastWarnings([day({ precipMm: 20 })], point, null, rules)[0]!.severity).toBe(2);
  });

  it("reports snow instead of rain when it's snowing", () => {
    const ws = forecastWarnings([day({ precipMm: 20, snowCm: 12, code: 75 })], point, null, rules);
    expect(ws.map((w) => w.kind)).toEqual(["snow"]);
    expect(ws[0]!.severity).toBe(3);
  });

  it("makes thunderstorms worse on exposed routes", () => {
    const ridge = makePlace({ hazards: ["lightning"] });
    expect(forecastWarnings([day({ code: 95 })], point, ridge, rules)[0]).toMatchObject({ kind: "storm", severity: 3 });
    expect(forecastWarnings([day({ code: 95 })], point, null, rules)[0]!.severity).toBe(2);
  });

  it("warns about frost, wind and high-altitude UV", () => {
    const kinds = forecastWarnings([day({ tMinC: -12, gustKmh: 80, uvMax: 10 })], point, null, rules).map((w) => [w.kind, w.severity]);
    expect(kinds).toEqual([
      ["cold", 3],
      ["wind", 3],
      ["uv", 1],
    ]);
    // UV isn't flagged down in the valley.
    expect(forecastWarnings([day({ uvMax: 10 })], { label: "Town", elevationM: 1200 }, null, rules)).toEqual([]);
  });

  it("finds the worst day", () => {
    const ws = forecastWarnings([day({ date: "2026-10-23", precipMm: 50 }), day({ date: "2026-10-24", tMinC: -3 })], point, null, rules);
    expect(Object.fromEntries(worstByDate(ws))).toEqual({ "2026-10-23": 3, "2026-10-24": 2 });
  });
});

describe("hazards", () => {
  it("hides expired reports and out-of-season risks", () => {
    expect(isActive(hazard({ expires_at: "2026-10-21T00:00:00Z" }), NOW, 10)).toBe(false);
    expect(isActive(hazard({ expires_at: "2026-10-25T00:00:00Z" }), NOW, 10)).toBe(true);
    expect(isActive(hazard({ months: [7, 8] }), NOW, 10)).toBe(false);
    expect(isActive(hazard({ months: null }), NOW, 10)).toBe(true);
  });

  it("measures to the edge of the hazard area", () => {
    const h = hazard({ lat: 30, lon: 75, radius_m: 2000 });
    expect(distanceToHazardKm({ lat: 30, lon: 75 }, h)).toBe(0);
    expect(distanceToHazardKm({ lat: 30.1, lon: 75 }, h)).toBeCloseTo(11.12 - 2, 1);
  });

  it("finds hazards for a place by link or distance, worst first", () => {
    const place = makePlace({ id: "lake", lat: 30, lon: 75 });
    const linked = hazard({ id: "linked", lat: 31, lon: 76, place_ids: ["lake"], severity: 1 });
    const near = hazard({ id: "near", lat: 30.02, lon: 75, severity: 3 });
    const far = hazard({ id: "far", lat: 31, lon: 76 });
    expect(hazardsForPlace(place, [far, linked, near], NOW, 10, 10).map((x) => x.hazard.id)).toEqual(["near", "linked"]);
    expect(hazardsNear({ lat: 30, lon: 75 }, [far, near], NOW, 10, 5).map((x) => x.hazard.id)).toEqual(["near"]);
  });

  it("always includes a 24-hour hospital", () => {
    const hs = [
      { id: "clinic", name: "Clinic", level: "chc" as const, lat: 30.01, lon: 75, emergency_24h: false },
      { id: "phc", name: "PHC", level: "phc" as const, lat: 30.02, lon: 75, emergency_24h: false },
      { id: "district", name: "District", level: "district" as const, lat: 30.5, lon: 75, emergency_24h: true },
    ];
    expect(nearestHospitals({ lat: 30, lon: 75 }, hs).map((x) => x.hospital.id)).toEqual(["clinic", "phc", "district"]);
  });
});

describe("trip alerts", () => {
  const place = makePlace({ id: "pass", name: "High Pass", base_town: "Base", hazards: ["river_crossing"], max_altitude_m: 4200 });

  it("combines forecast and hazard alerts with stable ids, skipping minor tips", () => {
    const alerts = tripAlerts(
      {
        tripId: "t1",
        place,
        base: [day({ precipMm: 25 })],
        high: [day({ tMinC: -12, uvMax: 11 })],
        hazards: [hazard({ id: "slide", place_ids: ["pass"], severity: 3 })],
        now: NOW,
        month: 10,
      },
      rules,
    );
    expect(alerts.map((a) => [a.kind, a.severity])).toEqual([
      ["weather", 3],
      ["hazard", 3],
      ["weather", 2],
    ]);
    expect(alerts.map((a) => a.id)).toContain("w:t1:cold:high:2026-10-23");
    expect(alerts.some((a) => a.detail.includes("UV"))).toBe(false);
  });

  it("groups a run of cold nights into one alert carrying the coldest night", () => {
    const week = [-3, -12, -15, -11].map((t, i) => day({ date: `2026-10-2${3 + i}`, tMinC: t }));
    const alerts = tripAlerts({ tripId: "t", place, base: null, high: week, hazards: [], now: NOW, month: 10 }, rules);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("Hard frost 23 Oct–26 Oct (4 days)");
    expect(alerts[0]!.detail).toMatch(/−15 °C/);
    expect(alerts[0]!.severity).toBe(3);
  });

  it("still gives hazard alerts with no forecast (offline, never synced)", () => {
    const alerts = tripAlerts({ tripId: "t", place, base: null, high: null, hazards: [hazard({ place_ids: ["pass"] })], now: NOW, month: 10 }, rules);
    expect(alerts).toHaveLength(1);
  });
});

describe("safety data", () => {
  it("parses and links to real places", () => {
    const placeIds = new Set(placesJson.map((p) => PlaceSchema.parse(p).id));
    const hazards = hazardsJson.map((h) => HazardSchema.parse(h));
    for (const h of hazards) for (const id of h.place_ids) expect(placeIds.has(id)).toBe(true);
    expect(hospitalsJson.map((h) => HospitalSchema.parse(h)).length).toBeGreaterThanOrEqual(15);
    expect(SafetyGuideSchema.parse(guideJson).altitude.levels).toHaveLength(3);
  });

  it("has a 24-hour hospital within 70 km of every place", () => {
    const hospitals = hospitalsJson.map((h) => HospitalSchema.parse(h));
    for (const p of placesJson.map((x) => PlaceSchema.parse(x))) {
      const best = nearestHospitals(p, hospitals, 3).filter((x) => x.hospital.emergency_24h);
      expect(best[0]?.distanceKm, p.id).toBeLessThan(70);
    }
  });
});
