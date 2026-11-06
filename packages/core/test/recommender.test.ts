import { describe, expect, it } from "vitest";
import { recommend } from "../src/recommender";
import { hardFilter } from "../src/recommender/filters";
import { makeData, makeInput, makePlace } from "./fixtures";

const cost = makePlace().cost;
// Easy Lake for 2 people, 2 days: (1000+500+100)×2 + 2000 = 5200, +10% = 5720 per person.
const EASY_LAKE_PP = 5720;

describe("hard filters", () => {
  const data = makeData([makePlace()]);

  it("passes a place that fits everything", () => {
    expect(hardFilter(makePlace(), makeInput(), data).reasons).toEqual([]);
  });

  it("eliminates closed months", () => {
    const r = hardFilter(makePlace(), makeInput({ month: 1 }), data).reasons;
    expect(r.map((x) => x.code)).toEqual(["season"]);
  });

  it("keeps risky months (they are penalised, not removed)", () => {
    expect(hardFilter(makePlace(), makeInput({ month: 7 }), data).reasons).toEqual([]);
  });

  it("eliminates when a required pass is closed", () => {
    const p = makePlace({ access_via: ["high_road"] });
    expect(hardFilter(p, makeInput({ month: 5 }), data).reasons.map((x) => x.code)).toEqual(["season"]);
  });

  it("eliminates treks harder than the fitness level", () => {
    const p = makePlace({ difficulty: 2 });
    expect(hardFilter(p, makeInput({ fitness: 1 }), data).reasons.map((x) => x.code)).toEqual(["difficulty"]);
    expect(hardFilter(p, makeInput({ fitness: 2 }), data).reasons).toEqual([]);
  });

  it("eliminates trips longer than the days available", () => {
    const p = makePlace({ days_min: 3, days_max: 4 });
    expect(hardFilter(p, makeInput({ days: 2 }), data).reasons.map((x) => x.code)).toEqual(["days"]);
  });

  it("allows up to 10% over budget and eliminates beyond it", () => {
    const at = (budget: number) => hardFilter(makePlace(), makeInput({ budgetPerPerson: budget }), data).reasons;
    expect(at(EASY_LAKE_PP)).toEqual([]);
    expect(at(Math.ceil(EASY_LAKE_PP / 1.1))).toEqual([]); // exactly at the ceiling
    expect(at(Math.ceil(EASY_LAKE_PP / 1.1) - 10).map((x) => x.code)).toEqual(["budget"]);
  });

  it("collects every failing rule, not just the first", () => {
    const p = makePlace({ difficulty: 3, days_min: 5, days_max: 6, plan: [] });
    const codes = hardFilter(p, makeInput({ month: 1, budgetPerPerson: 500 }), data).reasons.map((x) => x.code);
    expect(codes.sort()).toEqual(["budget", "days", "difficulty", "season"]);
  });
});

describe("ranking", () => {
  const lake = makePlace({ id: "lake", name: "Lake", vibes: ["lakes", "camping"] });
  const cafe = makePlace({ id: "cafe", name: "Cafe Town", type: "town", vibes: ["cafes", "chill"] });
  const snow = makePlace({ id: "snow", name: "Snow Ridge", vibes: ["snow", "camping"] });

  it("ranks by vibe overlap", () => {
    const res = recommend(makeInput({ vibes: ["cafes", "chill"] }), makeData([lake, cafe, snow]));
    expect(res.top[0]?.place.id).toBe("cafe");
    expect(res.top[0]?.breakdown.vibe).toBe(1);
  });

  it("scores a perfect fit at 100", () => {
    const res = recommend(makeInput({ vibes: ["lakes"] }), makeData([lake]));
    expect(res.top[0]?.score).toBe(100);
  });

  it("treats empty vibes as neutral for every place", () => {
    const res = recommend(makeInput({ vibes: [] }), makeData([lake, cafe]));
    expect(res.ranked.every((r) => r.breakdown.vibe === 0.5)).toBe(true);
  });

  it("penalises risky months and explains why", () => {
    const res = recommend(makeInput({ month: 7, vibes: ["lakes"] }), makeData([lake]));
    const top = res.top[0]!;
    expect(top.breakdown.season).toBe(0.4);
    expect(top.score).toBe(91); // 100 − 15 × 0.6
    expect(top.reasons.some((r) => r.tone === "warn" && r.text.includes("Monsoon"))).toBe(true);
  });

  it("scores partially over-budget places lower, linearly", () => {
    const halfway = Math.round(EASY_LAKE_PP / 1.05);
    const res = recommend(makeInput({ budgetPerPerson: halfway, vibes: ["lakes"] }), makeData([lake]));
    expect(res.top[0]!.breakdown.budget).toBeGreaterThan(0.4);
    expect(res.top[0]!.breakdown.budget).toBeLessThan(0.6);
  });

  it("rewards using more of the available days", () => {
    const short = makePlace({ id: "short", name: "Short", days_min: 2, days_max: 2, extras: [] });
    const res = recommend(makeInput({ days: 3, budgetPerPerson: 50000 }), makeData([short, lake]));
    expect(res.top[0]?.place.id).toBe("lake");
    expect(res.ranked.find((r) => r.place.id === "short")?.breakdown.days).toBeCloseTo(2 / 3);
  });

  it("lowers places already visited", () => {
    const res = recommend(makeInput({ visited: ["lake"] }), makeData([lake, snow]));
    expect(res.top[0]?.place.id).toBe("snow");
  });

  it("breaks ties by cost, then name", () => {
    const cheap = makePlace({ id: "b", name: "B", cost: { ...cost, food: 100 } });
    const a = makePlace({ id: "a", name: "A" });
    const c = makePlace({ id: "c", name: "C" });
    const res = recommend(makeInput(), makeData([c, a, cheap]));
    expect(res.ranked.map((r) => r.place.id)).toEqual(["b", "a", "c"]);
  });

  it("returns at most `limit` results with human-readable reasons", () => {
    const many = Array.from({ length: 6 }, (_, i) => makePlace({ id: `p${i}`, name: `P${i}` }));
    const res = recommend(makeInput(), makeData(many));
    expect(res.top).toHaveLength(3);
    expect(res.ranked).toHaveLength(6);
    for (const r of res.top) expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("suggestions", () => {
  it("suggests the budget that unlocks budget-blocked places", () => {
    const res = recommend(makeInput({ budgetPerPerson: 3000 }), makeData([makePlace()]));
    expect(res.top).toHaveLength(0);
    expect(res.suggestions[0]).toMatch(/₹6,000/);
  });

  it("suggests the number of days needed", () => {
    const res = recommend(makeInput({ days: 1 }), makeData([makePlace()]));
    expect(res.suggestions.join(" ")).toMatch(/With 2 days/);
  });

  it("suggests the nearest good month", () => {
    const res = recommend(makeInput({ month: 12 }), makeData([makePlace()]));
    expect(res.suggestions.join(" ")).toMatch(/March is good for 1/);
  });

  it("stays quiet when there are enough results", () => {
    const many = Array.from({ length: 3 }, (_, i) => makePlace({ id: `p${i}`, name: `P${i}` }));
    expect(recommend(makeInput(), makeData(many)).suggestions).toEqual([]);
  });
});
