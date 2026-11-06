import { describe, expect, it } from "vitest";
import { buildItinerary } from "../src/itinerary";
import { makePlace, rules } from "./fixtures";

describe("buildItinerary", () => {
  it("returns the base plan for the minimum days", () => {
    const it2 = buildItinerary(makePlace(), 2, 1, rules);
    expect(it2.days.map((d) => d.title)).toEqual(["Up", "Down"]);
    expect(it2.days.map((d) => d.day)).toEqual([1, 2]);
    expect(it2.plannedDays).toBe(2);
    expect(it2.spareDays).toBe(0);
  });

  it("inserts extras after their anchor day, keeping the return day last", () => {
    const res = buildItinerary(makePlace(), 3, 1, rules);
    expect(res.days.map((d) => d.title)).toEqual(["Up", "Ridge", "Down"]);
    expect(res.days[1]?.kind).toBe("side_trip");
  });

  it("caps at days_max and reports spare days", () => {
    const res = buildItinerary(makePlace(), 7, 1, rules);
    expect(res.days).toHaveLength(3);
    expect(res.spareDays).toBe(4);
  });

  it("uses extras in data order (acclimatisation first)", () => {
    const place = makePlace({
      days_max: 4,
      extras: [
        { after_day: 1, kind: "acclimatise", title: "Acclimatise", detail: "", trek_km: 2, sleep_alt_m: 2800 },
        { after_day: 1, kind: "side_trip", title: "Side", detail: "", trek_km: 2, sleep_alt_m: 2800 },
      ],
    });
    expect(buildItinerary(place, 3, 1, rules).days.map((d) => d.title)).toEqual(["Up", "Acclimatise", "Down"]);
    expect(buildItinerary(place, 4, 1, rules).days.map((d) => d.title)).toEqual(["Up", "Acclimatise", "Side", "Down"]);
  });

  it("flags a day longer than the fitness level's comfortable distance as overpacked", () => {
    const place = makePlace({
      plan: [
        { title: "Long", detail: "", trek_km: 14, sleep_alt_m: 2800 },
        { title: "Down", detail: "", trek_km: 6, sleep_alt_m: 2000 },
      ],
    });
    const easy = buildItinerary(place, 2, 1, rules);
    expect(easy.overpacked).toBe(true);
    expect(easy.days[0]?.warnings[0]).toMatch(/14 km.*fitness level 1/);
    expect(buildItinerary(place, 2, 2, rules).overpacked).toBe(false);
  });

  describe("altitude sickness rule (≤500 m gain per night above 3,000 m)", () => {
    const withSleeps = (base: number, sleeps: number[]) =>
      makePlace({
        base_alt_m: base,
        days_min: sleeps.length,
        days_max: sleeps.length,
        extras: [],
        plan: sleeps.map((s, i) => ({ title: `D${i + 1}`, detail: "", trek_km: 5, sleep_alt_m: s })),
      });

    it("does not count gain below the threshold", () => {
      // Manali 2,050 m to Chika 3,100 m: only 100 m is above 3,000 m.
      const res = buildItinerary(withSleeps(2050, [3100, 2050]), 2, 2, rules);
      expect(res.days[0]?.warnings).toEqual([]);
    });

    it("warns on a big jump above the threshold", () => {
      // Manali to Chandratal camps (4,250 m) in one day.
      const res = buildItinerary(withSleeps(2050, [4250, 2050]), 2, 2, rules);
      expect(res.days[0]?.warnings[0]).toMatch(/4,250 m/);
      expect(res.overpacked).toBe(true);
    });

    it("allows exactly 500 m and flags 501 m", () => {
      expect(buildItinerary(withSleeps(3100, [3600, 3000]), 2, 2, rules).days[0]?.warnings).toEqual([]);
      expect(buildItinerary(withSleeps(3100, [3601, 3000]), 2, 2, rules).days[0]?.warnings).toHaveLength(1);
    });

    it("never warns on descent", () => {
      const res = buildItinerary(withSleeps(4000, [3200, 2000]), 2, 2, rules);
      expect(res.days.every((d) => d.warnings.length === 0)).toBe(true);
    });
  });

  it("warns when an acclimatisation day doesn't fit", () => {
    const place = makePlace({
      days_max: 3,
      extras: [{ after_day: 1, kind: "acclimatise", title: "Acc", detail: "", trek_km: 2, sleep_alt_m: 2800 }],
    });
    expect(buildItinerary(place, 2, 1, rules).warnings.join(" ")).toMatch(/acclimatisation/);
    expect(buildItinerary(place, 3, 1, rules).warnings).toEqual([]);
  });

  it("warns about no buffer day on moderate+ treks at minimum length", () => {
    const place = makePlace({ difficulty: 2 });
    expect(buildItinerary(place, 2, 2, rules).warnings.join(" ")).toMatch(/buffer/);
    expect(buildItinerary(place, 3, 2, rules).warnings).toEqual([]);
  });
});
