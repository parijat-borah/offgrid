import { describe, expect, it } from "vitest";
import { checkSeason, seasonCalendar } from "../src/season";
import { makePlace, passes } from "./fixtures";

describe("checkSeason", () => {
  const place = makePlace();

  it("is good in a listed good month", () => {
    expect(checkSeason(place, 10, passes)).toEqual({ status: "good", reasons: [] });
  });

  it("is risky in a risky month, carrying the reason", () => {
    const res = checkSeason(place, 7, passes);
    expect(res.status).toBe("risky");
    expect(res.reasons).toEqual(["Monsoon."]);
  });

  it("is closed in a closed month", () => {
    const res = checkSeason(place, 1, passes);
    expect(res.status).toBe("closed");
    expect(res.reasons[0]).toContain("January");
  });

  it("is closed when a required pass is shut, even in an otherwise good month", () => {
    const p = makePlace({ access_via: ["high_road"], season: { good: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2], risky: [], closed: [] } });
    const res = checkSeason(p, 4, passes);
    expect(res.status).toBe("closed");
    expect(res.reasons[0]).toContain("High Road");
    expect(checkSeason(p, 7, passes).status).toBe("good");
  });

  it("throws on an unknown pass id", () => {
    const p = makePlace({ access_via: ["nope"] });
    expect(() => checkSeason(p, 7, passes)).toThrow(/Unknown pass/);
  });

  it("builds a 12-month calendar", () => {
    const cal = seasonCalendar(place, passes);
    expect(cal).toHaveLength(12);
    expect(cal[0]).toBe("closed");
    expect(cal[6]).toBe("risky");
    expect(cal[9]).toBe("good");
  });
});
