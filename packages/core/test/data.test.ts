// Validates the real seed data and checks the planner gives sensible answers on it.
// Run on its own with `npm run validate:data` from the repo root.
import { describe, expect, it } from "vitest";
import fitnessQuiz from "../../../data/fitness-quiz.json";
import packing from "../../../data/packing-rules.json";
import passes from "../../../data/regions/himachal/passes.json";
import places from "../../../data/regions/himachal/places.json";
import region from "../../../data/regions/himachal/region.json";
import rules from "../../../data/scoring-rules.json";
import { buildItinerary } from "../src/itinerary";
import { parsePlannerData, validatePack } from "../src/pack";
import { packingList } from "../src/packing";
import { recommend } from "../src/recommender";
import { planToText } from "../src/exportText";
import type { PlannerInput } from "../src/schemas";
import { checkSeason } from "../src/season";
import { budgetBreakdown } from "../src/budget";

const data = parsePlannerData({ region, places, passes, rules, packing, fitnessQuiz });
const input = (o: Partial<PlannerInput>): PlannerInput => ({
  budgetPerPerson: 8000,
  days: 3,
  month: 10,
  fitness: 1,
  groupSize: 2,
  vibes: [],
  ...o,
});

describe("Himachal seed data", () => {
  it("parses and passes every cross-field check", () => {
    expect(validatePack(data)).toEqual([]);
  });

  it("has at least 20 places across all three difficulty levels", () => {
    expect(data.places.length).toBeGreaterThanOrEqual(20);
    expect(new Set(data.places.map((p) => p.difficulty))).toEqual(new Set([1, 2, 3]));
  });

  it("labels every cost as an estimate with a source and date", () => {
    for (const p of data.places) {
      expect(p.cost.is_estimate).toBe(true);
      expect(p.cost.source.length).toBeGreaterThan(3);
      expect(p.cost.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("covers the headline places", () => {
    const ids = data.places.map((p) => p.id);
    for (const id of ["triund", "kheerganga", "hampta-pass", "bir-billing", "kasol-manikaran", "spiti-valley"]) {
      expect(ids).toContain(id);
    }
  });

  it("builds an itinerary, budget and packing list for every place at every length", () => {
    for (const p of data.places) {
      for (let d = p.days_min; d <= p.days_max; d++) {
        const it = buildItinerary(p, d, 3, data.rules);
        expect(it.days).toHaveLength(d);
        expect(it.days.at(-1)?.kind).toBe("plan"); // return day stays last
        expect(budgetBreakdown(p, d, 2, data.rules).totalPerPerson).toBeGreaterThan(0);
        expect(packingList(p, 10, d, data.packing).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("planner scenarios on real data", () => {
  it("a beginner with ₹8,000 and 3 days in October gets easy treks", () => {
    const res = recommend(input({ vibes: ["camping"] }), data);
    expect(res.top.length).toBe(3);
    expect(res.top.every((r) => r.place.difficulty === 1)).toBe(true);
    expect(res.top.map((r) => r.place.id)).toContain("triund");
  });

  it("closes Hampta Pass and Chandratal in December", () => {
    const hampta = data.places.find((p) => p.id === "hampta-pass")!;
    const chandratal = data.places.find((p) => p.id === "chandratal")!;
    expect(checkSeason(hampta, 12, data.passes).status).toBe("closed");
    expect(checkSeason(chandratal, 12, data.passes).status).toBe("closed");
    const res = recommend(input({ month: 12, fitness: 3, budgetPerPerson: 50000, days: 10 }), data);
    const out = res.eliminated.map((e) => e.place.id);
    expect(out).toContain("hampta-pass");
    expect(out).toContain("chandratal");
  });

  it("flags the Manali → Chandratal altitude jump", () => {
    const chandratal = data.places.find((p) => p.id === "chandratal")!;
    const it = buildItinerary(chandratal, 2, 2, data.rules);
    expect(it.days[0]?.warnings.join(" ")).toMatch(/altitude/i);
  });

  it("keeps Pin Parvati for fit, well-funded, long trips in August only", () => {
    const res = recommend(input({ month: 8, fitness: 3, budgetPerPerson: 60000, days: 11, vibes: ["adventure"] }), data);
    expect(res.ranked.map((r) => r.place.id)).toContain("pin-parvati-pass");
    const low = recommend(input({ month: 8, fitness: 2, budgetPerPerson: 60000, days: 11 }), data);
    expect(low.ranked.map((r) => r.place.id)).not.toContain("pin-parvati-pass");
  });

  it("offers useful suggestions when the budget is too tight", () => {
    const res = recommend(input({ budgetPerPerson: 2000 }), data);
    expect(res.top).toHaveLength(0);
    expect(res.suggestions[0]).toMatch(/Raising your budget/);
  });

  it("exports a readable text plan", () => {
    const triund = data.places.find((p) => p.id === "triund")!;
    const it = buildItinerary(triund, 2, 1, data.rules);
    const txt = planToText({
      input: input({ days: 2 }),
      place: triund,
      region: data.region,
      season: checkSeason(triund, 10, data.passes),
      itinerary: it,
      budget: budgetBreakdown(triund, 2, 2, data.rules),
      packing: packingList(triund, 10, 2, data.packing),
      generatedAt: new Date("2026-10-22T00:00:00Z"),
    });
    expect(txt).toContain("OFFGRID TRIP PLAN: TRIUND");
    expect(txt).toContain("Day 1: McLeodganj to Triund");
    expect(txt).toContain("TOTAL per person");
    expect(txt).toContain("112");
    expect(txt).toContain("[ ] Government photo ID");
  });
});
