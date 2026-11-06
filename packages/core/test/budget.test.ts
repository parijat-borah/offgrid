import { describe, expect, it } from "vitest";
import { budgetBreakdown, plannedDays } from "../src/budget";
import { makePlace, rules } from "./fixtures";

describe("plannedDays", () => {
  const place = makePlace({ days_min: 2, days_max: 3 });
  it("clamps to the place's range", () => {
    expect(plannedDays(place, 1)).toBe(2);
    expect(plannedDays(place, 2)).toBe(2);
    expect(plannedDays(place, 3)).toBe(3);
    expect(plannedDays(place, 10)).toBe(3);
  });
});

describe("budgetBreakdown", () => {
  it("adds daily costs, one-offs and a 10% buffer", () => {
    const place = makePlace({
      cost: { ...makePlace().cost, stay: 1000, food: 500, local_transport: 100, activities: 200, activities_once: 3000, transport_roundtrip: 2000, permit: 300 },
    });
    const b = budgetBreakdown(place, 2, 2, rules);
    // (1000 + 500 + 100 + 200) × 2 + 3000 + 2000 + 300 = 8900
    expect(b.subtotalPerPerson).toBe(8900);
    expect(b.bufferPerPerson).toBe(890);
    expect(b.totalPerPerson).toBe(9790);
    expect(b.totalGroup).toBe(19580);
    expect(b.lines.find((l) => l.key === "activities")?.perPerson).toBe(3400);
    expect(b.isEstimate).toBe(true);
  });

  it("charges solo travellers the solo stay multiplier", () => {
    const place = makePlace();
    const pair = budgetBreakdown(place, 2, 2, rules);
    const solo = budgetBreakdown(place, 2, 1, rules);
    const stay = (b: typeof pair) => b.lines.find((l) => l.key === "stay")!.perPerson;
    expect(stay(pair)).toBe(2000);
    expect(stay(solo)).toBe(3000);
    expect(solo.totalGroup).toBe(solo.totalPerPerson);
  });

  it("produces integer rupees only", () => {
    const place = makePlace({ cost: { ...makePlace().cost, stay: 333 } });
    const b = budgetBreakdown(place, 3, 1, rules);
    for (const n of [b.subtotalPerPerson, b.bufferPerPerson, b.totalPerPerson, ...b.lines.map((l) => l.perPerson)]) {
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("rejects nonsense inputs", () => {
    expect(() => budgetBreakdown(makePlace(), 0, 2, rules)).toThrow();
    expect(() => budgetBreakdown(makePlace(), 2, 0, rules)).toThrow();
  });
});
