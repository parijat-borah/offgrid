import { describe, expect, it } from "vitest";
import { scoreFitness } from "../src/fitness";
import { packingList } from "../src/packing";
import type { PackingRule } from "../src/schemas";
import { decodeShare, encodeShare } from "../src/share";
import { fitnessQuiz, makeInput, makePlace } from "./fixtures";

describe("packingList", () => {
  const rules: PackingRule[] = [
    { id: "id-card", label: "ID", category: "documents" },
    { id: "down", label: "Down jacket", category: "clothing", when: [{ altitude_gte: 3000 }, { months: [12, 1] }] },
    { id: "rain", label: "Rain jacket", category: "clothing", when: [{ months: [7] }] },
    { id: "spikes", label: "Microspikes", category: "gear", when: [{ months: [1], altitude_gte: 2500 }] },
    { id: "whistle", label: "Whistle", category: "essentials", when: [{ hazards_any: ["bear"] }] },
    { id: "liner", label: "Liner", category: "gear", when: [{ stay_types: ["camp"] }] },
  ];
  const ids = (groups: ReturnType<typeof packingList>) => groups.flatMap((g) => g.items.map((i) => i.id));

  it("always includes unconditional items", () => {
    expect(ids(packingList(makePlace(), 10, 2, rules))).toContain("id-card");
  });

  it("matches any one condition (OR)", () => {
    const low = makePlace({ max_altitude_m: 2000 });
    expect(ids(packingList(low, 10, 2, rules))).not.toContain("down");
    expect(ids(packingList(low, 12, 2, rules))).toContain("down");
    expect(ids(packingList(makePlace({ max_altitude_m: 3200 }), 10, 2, rules))).toContain("down");
  });

  it("requires every key inside one condition (AND)", () => {
    expect(ids(packingList(makePlace({ max_altitude_m: 2800 }), 1, 2, rules))).toContain("spikes");
    expect(ids(packingList(makePlace({ max_altitude_m: 2000 }), 1, 2, rules))).not.toContain("spikes");
  });

  it("explains why each item is there", () => {
    const groups = packingList(makePlace({ max_altitude_m: 3200 }), 10, 2, rules);
    const down = groups.flatMap((g) => g.items).find((i) => i.id === "down");
    expect(down?.why).toBe("Max altitude 3,200 m");
  });

  it("checks hazards and stay type", () => {
    expect(ids(packingList(makePlace({ hazards: ["bear"] }), 10, 2, rules))).toContain("whistle");
    expect(ids(packingList(makePlace({ stay_type: "hotel" }), 10, 2, rules))).not.toContain("liner");
  });

  it("groups in a fixed category order and omits empty groups", () => {
    const groups = packingList(makePlace({ stay_type: "hotel" }), 10, 2, rules);
    expect(groups.map((g) => g.category)).toEqual(["documents"]);
  });
});

describe("scoreFitness", () => {
  it("maps points to bands", () => {
    expect(scoreFitness(fitnessQuiz, [0, 0]).level).toBe(1);
    expect(scoreFitness(fitnessQuiz, [1, 1]).level).toBe(2);
    expect(scoreFitness(fitnessQuiz, [2, 2])).toMatchObject({ level: 3, points: 4, maxPoints: 4 });
  });

  it("rejects missing or invalid answers", () => {
    expect(() => scoreFitness(fitnessQuiz, [0])).toThrow();
    expect(() => scoreFitness(fitnessQuiz, [0, 9])).toThrow();
  });
});

describe("share links", () => {
  it("round-trips input and place", () => {
    const input = makeInput({ vibes: ["lakes", "snow"], groupSize: 4 });
    const decoded = decodeShare("?" + encodeShare(input, "triund"));
    expect(decoded.placeId).toBe("triund");
    expect(decoded.input).toEqual({ ...input, visited: undefined });
  });

  it("never puts more than planner inputs in the URL", () => {
    const qs = encodeShare(makeInput({ visited: ["secret-place"] }));
    expect(qs).not.toContain("secret");
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(decodeShare("b=abc&d=2&m=10&f=1&g=2").input).toBeNull();
    expect(decodeShare("b=5000&d=2&m=13&f=1&g=2").input).toBeNull();
    expect(decodeShare("p=<script>").placeId).toBeNull();
    expect(decodeShare("").input).toBeNull();
  });

  it("drops unknown vibes", () => {
    expect(decodeShare("b=5000&d=2&m=10&f=1&g=2&v=lakes,hacking").input?.vibes).toEqual(["lakes"]);
  });
});
