import { describe, expect, it } from "vitest";
import badgesJson from "../../../data/badges.json";
import mascotsJson from "../../../data/mascots.json";
import xpJson from "../../../data/xp-rules.json";
import { badgeProgress, meetsRule, newlyEarned, nextStage, nudges, stageForLevel } from "../src/game/badges";
import { checkTrack } from "../src/game/plausibility";
import { parseGameData } from "../src/game/schemas";
import { simulateTrack } from "../src/game/simulate";
import { computeStats, isTrek, type CompletedTrip } from "../src/game/stats";
import { levelForXp, levelProgress, tripXp } from "../src/game/xp";
import { downsample, elevationGainM, haversineKm } from "../src/geo";
import { makePlace } from "./fixtures";

const game = parseGameData({ badges: badgesJson, mascots: mascotsJson, xp: xpJson });
const rules = game.xp;
const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("levels", () => {
  it("level = floor(xp / 100) + 1", () => {
    expect(levelForXp(0, rules)).toBe(1);
    expect(levelForXp(99, rules)).toBe(1);
    expect(levelForXp(100, rules)).toBe(2);
    expect(levelForXp(250, rules)).toBe(3);
    expect(levelForXp(-5, rules)).toBe(1);
  });

  it("reports progress inside the level", () => {
    expect(levelProgress(250, rules)).toEqual({ level: 3, xp: 250, into: 50, span: 100, toNext: 50, pct: 50 });
  });
});

describe("mascot stages", () => {
  const stages = game.mascots.stages;
  it.each([
    [1, "rookie"],
    [2, "rookie"],
    [3, "trail-hunter"],
    [4, "trail-hunter"],
    [5, "summit-seeker"],
    [7, "summit-seeker"],
    [8, "legend"],
    [20, "legend"],
  ])("level %i → %s", (level, id) => {
    expect(stageForLevel(stages, level).id).toBe(id);
  });

  it("knows the next evolution", () => {
    expect(nextStage(stages, 1)?.id).toBe("trail-hunter");
    expect(nextStage(stages, 8)).toBeNull();
  });
});

describe("trip XP", () => {
  const place = makePlace({ base_xp: 80 });
  it("scales by validation", () => {
    expect(tripXp(place, "verified", rules, 0).xp).toBe(80);
    expect(tripXp(place, "partial", rules, 0).xp).toBe(40);
    expect(tripXp(place, "manual", rules, 0).xp).toBe(20);
  });
  it("caps manual completions per month", () => {
    expect(tripXp(place, "manual", rules, 1).xp).toBe(20);
    expect(tripXp(place, "manual", rules, 2).xp).toBe(0);
    // Verified trips are never capped.
    expect(tripXp(place, "verified", rules, 5).xp).toBe(80);
  });
});

describe("GPS plausibility", () => {
  const place = makePlace({ lat: 32.2559, lon: 76.3459, days_min: 2 });

  it("verifies a believable track", () => {
    const res = checkTrack(place, simulateTrack(place, NOW), rules, NOW);
    expect(res.validation).toBe("verified");
    expect(res.reachedPlace).toBe(true);
    expect(res.distanceKm).toBeGreaterThan(5);
  });

  it("is manual with no track", () => {
    expect(checkTrack(place, [], rules, NOW).validation).toBe("manual");
  });

  it("is partial when the track is too short in time", () => {
    const quick = simulateTrack(place, NOW).map((p, i) => ({ ...p, ts: NOW - 3_600_000 + i * 60_000 }));
    const res = checkTrack(place, quick, rules, NOW);
    expect(res.validation).toBe("partial");
    expect(res.reasons.join(" ")).toMatch(/normally takes/);
  });

  it("is partial with too few points", () => {
    const track = simulateTrack(place, NOW);
    const sparse = [track[0]!, track[7]!, track[13]!];
    expect(checkTrack(place, sparse, rules, NOW).validation).toBe("partial");
  });

  it("is manual when the track never reaches the place", () => {
    const far = simulateTrack(place, NOW).map((p) => ({ ...p, lat: p.lat - 1 }));
    const res = checkTrack(place, far, rules, NOW);
    expect(res.validation).toBe("manual");
    expect(res.reasons[0]).toMatch(/closest GPS point/);
  });

  it("flags teleporting tracks as suspicious", () => {
    const track = simulateTrack(place, NOW);
    track[3] = { ...track[3]!, lat: track[3]!.lat + 3 };
    const res = checkTrack(place, track, rules, NOW);
    expect(res.suspicious).toBe(true);
    expect(res.validation).toBe("manual");
  });

  it("flags future timestamps", () => {
    const track = simulateTrack(place, NOW + 86_400_000);
    expect(checkTrack(place, track, rules, NOW).suspicious).toBe(true);
  });
});

describe("geo helpers", () => {
  it("measures distance", () => {
    // McLeodganj to Triund is roughly 3 km in a straight line.
    expect(haversineKm({ lat: 32.2426, lon: 76.3213 }, { lat: 32.2559, lon: 76.3459 })).toBeCloseTo(2.75, 1);
  });
  it("ignores GPS altitude noise", () => {
    const pts = [100, 105, 98, 130, 125, 160].map((alt, i) => ({ ts: i, lat: 0, lon: 0, alt }));
    // 105 and 98 are within the 10 m noise band of 100, so the climbs are 100→130 and 130→160.
    expect(elevationGainM(pts)).toBe(60);
  });
  it("downsamples keeping both ends", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const d = downsample(xs, 5);
    expect(d).toEqual([0, 25, 50, 74, 99]);
  });
});

describe("stats and badges", () => {
  const trek = makePlace({ id: "trek-a", type: "trek", distance_km: 18, district: "Kangra", max_altitude_m: 2850 });
  const pass = makePlace({ id: "pass-b", type: "pass", distance_km: 26, district: "Kullu / Lahaul", max_altitude_m: 4270 });
  const town = makePlace({ id: "town-c", type: "town", distance_km: 0, district: "Kullu (Banjar)", max_altitude_m: 1900 });
  const places = [trek, pass, town];
  const trip = (placeId: string, validation: CompletedTrip["validation"], spend: number | null = null): CompletedTrip => ({
    placeId,
    validation,
    distanceKm: null,
    actualSpendPp: spend,
    completedAt: "2026-10-01T00:00:00Z",
  });
  const stats = (trips: CompletedTrip[]) => computeStats(trips, places, () => "Himachal Pradesh");

  it("knows what counts as a trek", () => {
    expect(isTrek(trek)).toBe(true);
    expect(isTrek(town)).toBe(false);
    expect(isTrek(makePlace({ type: "lake", distance_km: 4 }))).toBe(false);
  });

  it("totals everything but only counts validated trips for badges", () => {
    const s = stats([trip("trek-a", "verified", 4500), trip("pass-b", "manual", 3000), trip("town-c", "partial")]);
    expect(s.tripsCompleted).toBe(3);
    expect(s.kmTotal).toBe(44);
    expect(s.highestAltitudeM).toBe(4270);
    expect(s.districtsVisited).toEqual(["Kangra", "Kullu", "Lahaul"]);
    expect(s.metrics.trips_completed).toBe(2);
    expect(s.metrics.passes_crossed).toBe(0); // the pass was manual
    expect(s.metrics.cheapest_trip_pp).toBe(4500); // the manual ₹3,000 doesn't count
    expect(s.metrics.districts_visited).toBe(2);
  });

  it("awards First Steps, Budget Hero and Thin Air from rules", () => {
    const s = stats([trip("pass-b", "verified", 4800)]);
    const ids = newlyEarned(game.badges, s.metrics, []).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["first-steps", "budget-hero", "thin-air", "pass-crosser"]));
    expect(ids).not.toContain("summit-seeker");
  });

  it("never awards a badge twice", () => {
    const s = stats([trip("trek-a", "verified")]);
    expect(newlyEarned(game.badges, s.metrics, ["first-steps"]).map((b) => b.id)).not.toContain("first-steps");
  });

  it("doesn't award Budget Hero without a reported spend", () => {
    const s = stats([trip("trek-a", "verified")]);
    const hero = game.badges.find((b) => b.id === "budget-hero")!;
    expect(meetsRule(hero, s.metrics)).toBe(false);
  });

  it("shows progress and what's left", () => {
    const s = stats([trip("trek-a", "verified")]);
    const p = badgeProgress(game.badges, s.metrics, ["first-steps"]).find((b) => b.badge.id === "summit-seeker")!;
    expect(p.progress).toBeCloseTo(1 / 3);
    expect(p.remaining).toBe("2 more treks");
  });

  it("nudges toward the next evolution and nearest badges", () => {
    const s = stats([trip("trek-a", "verified")]);
    const n = nudges(game, 100, s.metrics, ["first-steps"]);
    expect(n[0]).toBe("100 XP to level 3, when your Wanderling evolves into Trail Hunter.");
    expect(n).toHaveLength(3);
    // Closest first: 2,850 of 4,000 m beats 1 of 3 treks.
    expect(n[1]).toBe("A trip above 4,000 m to unlock 🏔️ Thin Air.");
  });
});
