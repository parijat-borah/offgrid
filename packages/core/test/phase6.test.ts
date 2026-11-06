import { describe, expect, it } from "vitest";
import challengesJson from "../../../data/challenges.json";
import fitnessQuiz from "../../../data/fitness-quiz.json";
import packing from "../../../data/packing-rules.json";
import passes from "../../../data/regions/himachal/passes.json";
import places from "../../../data/regions/himachal/places.json";
import region from "../../../data/regions/himachal/region.json";
import rules from "../../../data/scoring-rules.json";
import { comparePlaces } from "../src/compare";
import { challengeProgress, ChallengesSchema, rank, streakMonths, streakXp, tripAnomalies, type TripWindow } from "../src/game/fairplay";
import { balances, formatPaise, parseRupees, settleUp, sharesOf, upiLink, validateExpense, type Expense, type ExpenseMember } from "../src/game/settle";
import { parsePlannerData } from "../src/pack";

const data = parsePlannerData({ region, places, passes, rules, packing, fitnessQuiz });
const challenges = ChallengesSchema.parse(challengesJson);

const members: ExpenseMember[] = [
  { id: "a", name: "Asha", upi: "asha@okaxis" },
  { id: "b", name: "Bilal" },
  { id: "c", name: "Chen" },
  { id: "d", name: "Divya" },
];
const exp = (o: Partial<Expense>): Expense => ({ id: "e", description: "Taxi", amountPaise: 300000, paidBy: "a", split: { type: "equal", among: ["a", "b", "c"] }, createdAt: "2026-10-23", ...o });

describe("expense splitter", () => {
  it("splits equally to the paisa, giving leftovers to the first people", () => {
    const s = sharesOf(exp({ amountPaise: 10000, split: { type: "equal", among: ["a", "b", "c"] } }));
    expect([...s.values()]).toEqual([3334, 3333, 3333]);
    expect([...s.values()].reduce((x, y) => x + y)).toBe(10000);
  });

  it("supports exact splits and validates them", () => {
    const e = exp({ amountPaise: 1000, split: { type: "exact", shares: { a: 600, b: 400 } } });
    expect(validateExpense(e, members)).toBeNull();
    expect(validateExpense({ ...e, split: { type: "exact", shares: { a: 600, b: 300 } } }, members)).toMatch(/add up to ₹9/);
    expect(validateExpense(exp({ amountPaise: 0 }), members)).toMatch(/above zero/);
    expect(validateExpense(exp({ paidBy: "zz" }), members)).toMatch(/who paid/);
    expect(validateExpense(exp({ split: { type: "equal", among: [] } }), members)).toMatch(/at least one/);
  });

  it("balances always sum to zero", () => {
    const es = [
      exp({ id: "1", amountPaise: 300000, paidBy: "a", split: { type: "equal", among: ["a", "b", "c", "d"] } }),
      exp({ id: "2", amountPaise: 120050, paidBy: "b", split: { type: "equal", among: ["a", "b", "c"] } }),
      exp({ id: "3", amountPaise: 80000, paidBy: "c", split: { type: "exact", shares: { c: 20000, d: 60000 } } }),
    ];
    const bal = balances(members, es);
    expect([...bal.values()].reduce((x, y) => x + y, 0)).toBe(0);
  });

  it("settles with at most n−1 payments that clear every balance", () => {
    const es = [
      exp({ id: "1", amountPaise: 400000, paidBy: "a", split: { type: "equal", among: ["a", "b", "c", "d"] } }),
      exp({ id: "2", amountPaise: 200000, paidBy: "b", split: { type: "equal", among: ["a", "b", "c", "d"] } }),
    ];
    const bal = balances(members, es);
    // Each owes ₹1,500. Asha paid ₹4,000 (+₹2,500), Bilal ₹2,000 (+₹500), Chen and Divya nothing (−₹1,500 each).
    expect(Object.fromEntries(bal)).toEqual({ a: 250000, b: 50000, c: -150000, d: -150000 });
    const t = settleUp(bal);
    expect(t.length).toBeLessThanOrEqual(3);
    const after = new Map(bal);
    for (const x of t) {
      after.set(x.from, after.get(x.from)! + x.amountPaise);
      after.set(x.to, after.get(x.to)! - x.amountPaise);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it("needs no payments when everyone is square", () => {
    expect(settleUp(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("formats and parses rupees", () => {
    expect(formatPaise(123450)).toBe("₹1,234.50");
    expect(formatPaise(500000)).toBe("₹5,000");
    expect(parseRupees("₹1,250.5")).toBe(125050);
    expect(parseRupees("12.345")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
  });

  it("builds a UPI link only for a valid UPI ID", () => {
    const link = upiLink(members[0]!, 125050, "Hampta taxi")!;
    expect(link).toMatch(/^upi:\/\/pay\?/);
    expect(new URLSearchParams(link.split("?")[1]).get("am")).toBe("1250.50");
    expect(link).toContain("pa=asha@okaxis&");
    expect(link).toContain("tn=Hampta%20taxi");
    expect(upiLink(members[1]!, 100, "x")).toBeNull();
    expect(upiLink({ id: "z", name: "Z", upi: "not a upi" }, 100, "x")).toBeNull();
  });
});

describe("fair play", () => {
  const H = 3_600_000;
  const t = (o: Partial<TripWindow>): TripWindow => ({ id: "t", completedAt: 100 * H, firstPoint: 80 * H, lastPoint: 99 * H, simulated: false, ...o });

  it("flags simulated tracks, overlapping tracks and too many trips a day", () => {
    expect(tripAnomalies(t({ simulated: true }), [], challenges)[0]).toMatch(/Simulated/);
    expect(tripAnomalies(t({}), [t({ id: "o", firstPoint: 90 * H, lastPoint: 120 * H, completedAt: 200 * H })], challenges)[0]).toMatch(/overlaps/);
    const day = [t({ id: "x", completedAt: 95 * H, firstPoint: null, lastPoint: null }), t({ id: "y", completedAt: 90 * H, firstPoint: null, lastPoint: null })];
    expect(tripAnomalies(t({}), day, challenges).join(" ")).toMatch(/within 24 hours/);
    expect(tripAnomalies(t({}), [t({ id: "o", firstPoint: 10 * H, lastPoint: 20 * H, completedAt: 30 * H })], challenges)).toEqual([]);
  });

  it("ranks with ties sharing a place", () => {
    const r = rank([{ n: "a", v: 10 }, { n: "b", v: 30 }, { n: "c", v: 10 }, { n: "d", v: 5 }], (x) => x.v, (x) => x.n);
    expect(r.map((e) => `${e.rank}${e.item.n}`)).toEqual(["1b", "2a", "2c", "4d"]);
  });

  it("counts monthly streaks across a year boundary and caps the bonus", () => {
    expect(streakMonths(new Set(["2026-11", "2026-12", "2027-01"]), "2027-01")).toBe(3);
    expect(streakMonths(new Set(["2026-11", "2027-01"]), "2027-01")).toBe(1);
    expect(streakXp(3, challenges)).toBe(30);
    expect(streakXp(12, challenges)).toBe(50);
  });

  it("tracks challenge progress", () => {
    const p = challengeProgress(challenges, { season_verified_treks: 1, season_verified_trips: 1, season_contributions: 0, season_hazard_actions: 5 });
    expect(p.find((c) => c.id === "out-there")?.done).toBe(true);
    expect(p.find((c) => c.id === "double-up")).toMatchObject({ done: false, current: 1, target: 2 });
    expect(p.find((c) => c.id === "trail-guardian")).toMatchObject({ done: true, current: 3 });
  });
});

describe("compare mode", () => {
  const triund = data.places.find((p) => p.id === "triund")!;
  const hampta = data.places.find((p) => p.id === "hampta-pass")!;

  it("compares cost, season and fit for the traveller's own plan", () => {
    const c = comparePlaces(triund, hampta, { budgetPerPerson: 25000, days: 4, month: 10, fitness: 2, groupSize: 2, vibes: ["camping", "snow"] }, data);
    const row = (k: string) => c.rows.find((r) => r.key === k)!;
    expect(row("cost").better).toBe("a");
    expect(row("season")).toMatchObject({ a: "good", b: "risky", better: "a" });
    expect(row("vibes").better).toBe("b"); // Hampta has both camping and snow
    expect(c.verdict.join(" ")).toMatch(/Hampta Pass is risky in October/);
    expect(c.verdict.join(" ")).toMatch(/Triund is ₹[\d,]+ cheaper per person/);
  });

  it("explains when one option doesn't fit at all", () => {
    const c = comparePlaces(triund, hampta, { budgetPerPerson: 8000, days: 3, month: 12, fitness: 1, groupSize: 2, vibes: [] }, data);
    expect(c.rows.find((r) => r.key === "match")!.b).toBe("Doesn't fit");
    expect(c.verdict[0]).toMatch(/^Hampta Pass doesn't fit your plan/);
  });
});
