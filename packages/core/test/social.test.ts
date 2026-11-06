import { describe, expect, it } from "vitest";
import rulesJson from "../../../data/matching-rules.json";
import typesJson from "../../../data/traveller-types.json";
import { maskContacts, MASK } from "../src/social/mask";
import { ageBand, ageFromYear, canUseWomenOnly, compatibility, dateOverlap, ineligible, type Candidate, type MatchProfile, type MatchTrip } from "../src/social/match";
import { DEFAULT_MATCH_PREFS, MatchingRulesSchema, TravellerTypesSchema } from "../src/social/schemas";
import { scoreTravellerType } from "../src/social/travellerType";

const types = TravellerTypesSchema.parse(typesJson);
const rules = MatchingRulesSchema.parse(rulesJson);
const names = Object.fromEntries(types.types.map((t) => [t.id, t.name]));

const profile = (o: Partial<MatchProfile> = {}): MatchProfile => ({
  userId: "a",
  age: 24,
  gender: "woman",
  genderVerified: false,
  idVerified: false,
  phoneVerified: true,
  pace: 2,
  typeId: null,
  prefs: DEFAULT_MATCH_PREFS,
  blocked: new Set(),
  ...o,
});
const trip = (o: Partial<MatchTrip> = {}): MatchTrip => ({
  tripId: "t",
  placeId: "hampta-pass",
  startDate: "2026-11-01",
  days: 4,
  budgetPp: 15000,
  fitness: 2,
  vibes: ["adventure", "camping"],
  ...o,
});
const verifiedWoman = (o: Partial<MatchProfile> = {}) => profile({ idVerified: true, genderVerified: true, gender: "woman", ...o });

describe("traveller type quiz", () => {
  it("validates the data: every option points at real types", () => {
    const ids = new Set(types.types.map((t) => t.id));
    for (const q of types.questions) for (const o of q.options) for (const id of Object.keys(o.points)) expect(ids.has(id), id).toBe(true);
  });

  it("picks the type with the most points", () => {
    const res = scoreTravellerType(types, [0, 2, 0, 0, 0, 0]);
    expect(res.type.id).toBe("summit-chaser");
    expect(res.scores["summit-chaser"]).toBeGreaterThanOrEqual(10);
  });

  it("can land on each type", () => {
    const answers = { "photographer": [1, 0, 0, 3, 1, 2], "budget-backpacker": [2, 0, 1, 1, 3, 1], "spiritual-seeker": [3, 3, 3, 1, 4, 4] } as const;
    for (const [id, a] of Object.entries(answers)) expect(scoreTravellerType(types, [...a]).type.id).toBe(id);
  });

  it("rejects incomplete answers", () => {
    expect(() => scoreTravellerType(types, [0])).toThrow();
  });
});

describe("eligibility (both directions)", () => {
  it("allows two ordinary adults", () => {
    expect(ineligible(profile({ userId: "a" }), profile({ userId: "b" }))).toBeNull();
  });

  it("respects blocks either way, and hidden profiles", () => {
    expect(ineligible(profile({ userId: "a", blocked: new Set(["b"]) }), profile({ userId: "b" }))).toBe("blocked");
    expect(ineligible(profile({ userId: "a" }), profile({ userId: "b", blocked: new Set(["a"]) }))).toBe("blocked");
    expect(ineligible(profile({ userId: "a" }), profile({ userId: "b", prefs: { ...DEFAULT_MATCH_PREFS, visible: false } }))).toBe("hidden");
  });

  it("women-only needs ID-verified women on both sides", () => {
    const womenOnly = { ...DEFAULT_MATCH_PREFS, womenOnly: true };
    // A verified woman with women-only sees only verified women.
    expect(ineligible(verifiedWoman({ userId: "a", prefs: womenOnly }), verifiedWoman({ userId: "b" }))).toBeNull();
    expect(ineligible(verifiedWoman({ userId: "a", prefs: womenOnly }), profile({ userId: "b", gender: "woman" }))).toBe("mine:women-only");
    expect(ineligible(verifiedWoman({ userId: "a", prefs: womenOnly }), profile({ userId: "b", gender: "man", idVerified: true, genderVerified: true }))).toBe("mine:women-only");
    // A man who sets women-only gets no special filter: the pref is ignored, he's matched normally,
    // and a verified woman using women-only still can't see him.
    const man = profile({ userId: "m", gender: "man", prefs: womenOnly });
    expect(canUseWomenOnly(man)).toBe(false);
    expect(ineligible(man, profile({ userId: "b", gender: "woman" }))).toBeNull();
    expect(ineligible(man, verifiedWoman({ userId: "w", prefs: womenOnly }))).toBe("theirs:women-only");
  });

  it("verified-only and age range", () => {
    expect(ineligible(profile({ userId: "a", prefs: { ...DEFAULT_MATCH_PREFS, verifiedOnly: true } }), profile({ userId: "b" }))).toBe("mine:verified-only");
    expect(ineligible(profile({ userId: "a", prefs: { ...DEFAULT_MATCH_PREFS, ageMax: 29 } }), profile({ userId: "b", age: 35 }))).toBe("mine:age");
    expect(ineligible(profile({ userId: "a", age: 35 }), profile({ userId: "b", prefs: { ...DEFAULT_MATCH_PREFS, ageMax: 29 } }))).toBe("theirs:age");
  });

  it("never matches minors", () => {
    expect(ineligible(profile({ userId: "a" }), profile({ userId: "b", age: 17 }))).toBe("minor");
  });
});

describe("compatibility", () => {
  const me: Candidate = { profile: profile({ userId: "a", typeId: "summit-chaser", pace: 3 }), trip: trip() };

  it("scores a near-identical trip highly with reasons", () => {
    const res = compatibility(me, { profile: profile({ userId: "b", typeId: "summit-chaser", pace: 3 }), trip: trip({ tripId: "u" }) }, names, rules)!;
    expect(res.score).toBe(100);
    expect(res.reasons).toEqual(expect.arrayContaining(["4 of your 4 days overlap", "Same destination", "Both Summit Chasers", "Similar budgets"]));
  });

  it("drops trips too far apart, keeps nearby ones with a lower date score", () => {
    expect(compatibility(me, { profile: profile({ userId: "b" }), trip: trip({ startDate: "2026-11-15" }) }, names, rules)).toBeNull();
    const near = compatibility(me, { profile: profile({ userId: "b" }), trip: trip({ startDate: "2026-11-07" }) }, names, rules)!;
    expect(near.breakdown.dates).toBe(0.3);
    expect(near.reasons[0]).toBe("Dates are 2 days apart");
  });

  it("penalises different pace, budget and fitness", () => {
    const res = compatibility(me, { profile: profile({ userId: "b", pace: 1 }), trip: trip({ budgetPp: 7500, fitness: 1, vibes: ["chill"] }) }, names, rules)!;
    expect(res.breakdown).toMatchObject({ pace: 0, budget: 0.5, fitness: 0.5, vibes: 0 });
    expect(res.score).toBeLessThan(65);
  });

  it("computes date overlap", () => {
    expect(dateOverlap(trip(), trip({ startDate: "2026-11-03" }))).toEqual({ overlapDays: 2, gapDays: 0 });
    expect(dateOverlap(trip(), trip({ startDate: "2026-11-07" }))).toEqual({ overlapDays: 0, gapDays: 2 });
  });

  it("shows only an age band", () => {
    expect(ageBand(22, rules)).toBe("18–24");
    expect(ageBand(45, rules)).toBe("40+");
    expect(ageFromYear(2000, new Date("2026-10-23"))).toBe(26);
  });
});

describe("contact masking", () => {
  it.each([
    ["call me on 98765 43210", "call me on " + MASK],
    // Found in the browser walkthrough: the "WhatsApp" keyword used to swallow only half the number.
    ["Share a taxi? WhatsApp 98123 45670", "Share a taxi? WhatsApp " + MASK],
    ["+91-98765-43210 anytime", MASK + " anytime"],
    ["mail asha.k@gmail.com", "mail " + MASK],
    ["upi asha@okaxis thanks", "upi " + MASK + " thanks"],
    ["insta: asha.treks", MASK],
    ["dm me @asha_treks", "dm me " + MASK],
    ["https://wa.me/919876543210", MASK],
    ["join t.me/hampta_group", "join " + MASK],
  ])("hides %s", (input, expected) => {
    const res = maskContacts(input);
    expect(res.text).toBe(expected);
    expect(res.masked).toBe(true);
  });

  it.each(["Budget is ₹20,020 per person", "Day 3 we sleep at 3,600 m", "Meet at Manali bus stand 7am on 25/10/2026", "See https://open-meteo.com for weather"])("leaves %s alone", (input) => {
    expect(maskContacts(input)).toEqual({ text: input, masked: false });
  });
});
