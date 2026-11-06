import { describe, expect, it } from "vitest";
import fitnessQuiz from "../../../data/fitness-quiz.json";
import packing from "../../../data/packing-rules.json";
import passes from "../../../data/regions/himachal/passes.json";
import photos from "../../../data/regions/himachal/photos.json";
import places from "../../../data/regions/himachal/places.json";
import region from "../../../data/regions/himachal/region.json";
import trails from "../../../data/regions/himachal/trails.json";
import rules from "../../../data/scoring-rules.json";
import { haversineKm } from "../src/geo";
import { PhotosFileSchema, toPlaceMedia, TrailsFileSchema, trailLengthKm, validateMedia } from "../src/media";
import { parsePlannerData } from "../src/pack";

const data = parsePlannerData({ region, places, passes, rules, packing, fitnessQuiz, photos, trails });
const FREE = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+)$/;

describe("place photos", () => {
  it("gives every place at least one credited, freely licensed photo", () => {
    for (const p of data.places) {
      const list = data.media.photos[p.id] ?? [];
      expect(list.length, p.id).toBeGreaterThan(0);
      for (const ph of list) {
        expect(ph.license, `${p.id}: ${ph.file}`).toMatch(FREE);
        expect(ph.author.length).toBeGreaterThan(0);
        expect(ph.source_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      }
    }
  });

  it("uses a landscape-shaped hero photo so cards don't crop to a sliver", () => {
    for (const [id, list] of Object.entries(data.media.photos)) {
      const a = list[0]!.width / list[0]!.height;
      expect(a, id).toBeGreaterThanOrEqual(1);
      expect(a, id).toBeLessThanOrEqual(2.6);
    }
  });
});

describe("trail lines", () => {
  it("start at the named trailhead and end at their own place", () => {
    expect(Object.keys(data.media.trails).length).toBeGreaterThanOrEqual(5);
    for (const [id, t] of Object.entries(data.media.trails)) {
      const place = data.places.find((p) => p.id === id)!;
      const [sLat, sLon] = t.coords[0]!;
      const [eLat, eLon] = t.coords.at(-1)!;
      expect(haversineKm({ lat: sLat, lon: sLon }, t.start), `${id} start`).toBeLessThan(1);
      expect(haversineKm({ lat: eLat, lon: eLon }, t.end), `${id} end`).toBeLessThan(1);
      expect(haversineKm(t.end, place), `${id} destination`).toBeLessThan(10);
    }
  });

  it("are about as long as the trek (one way ≈ half the round trip, never a detour)", () => {
    for (const [id, t] of Object.entries(data.media.trails)) {
      const place = data.places.find((p) => p.id === id)!;
      expect(t.length_km, id).toBeLessThanOrEqual((place.distance_km / 2) * 1.3);
      // Simplification keeps the shape: drawn length within 15% of the routed length.
      expect(Math.abs(trailLengthKm(t.coords) - t.length_km) / t.length_km, id).toBeLessThan(0.15);
    }
  });

  it("carry the OpenStreetMap attribution the ODbL requires", () => {
    expect(data.media.trailCredit).toMatchObject({ attribution: "© OpenStreetMap contributors", license: "ODbL-1.0" });
  });
});

describe("media validation", () => {
  const p = PhotosFileSchema.parse(photos);
  const t = TrailsFileSchema.parse(trails);

  it("flags media for unknown places and trails that belong somewhere else", () => {
    const bad = toPlaceMedia(
      { ...p, photos: { ...p.photos, atlantis: p.photos.triund! } },
      { ...t, trails: [...t.trails, { ...t.trails[0]!, place_id: "kareri-lake" }] },
    );
    const issues = validateMedia(bad, data.places, data.region.bbox);
    expect(issues).toContain("photos.atlantis: no such place");
    expect(issues.some((i) => i.startsWith("trails.kareri-lake:") && i.includes("more than 10 km"))).toBe(true);
  });

  it("is optional: a region with no photos or trails still parses", () => {
    const plain = parsePlannerData({ region, places, passes, rules, packing, fitnessQuiz });
    expect(plain.media).toEqual({ photos: {}, trails: {}, trailCredit: null });
  });
});
