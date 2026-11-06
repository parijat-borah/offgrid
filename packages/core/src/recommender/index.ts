import type { Budget } from "../budget";
import { budgetBreakdown, plannedDays } from "../budget";
import { formatINR, monthName } from "../labels";
import type { PlannerData } from "../pack";
import type { Place, PlannerInput } from "../schemas";
import { checkSeason, type SeasonCheck } from "../season";
import { hardFilter, type EliminationReason } from "./filters";
import { softScore, type Reason, type ScoreBreakdown } from "./score";

export { hardFilter } from "./filters";
export type { EliminationCode, EliminationReason, FilterResult } from "./filters";
export type { Reason, ReasonTone, ScoreBreakdown } from "./score";

export interface Recommendation {
  place: Place;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: Reason[];
  season: SeasonCheck;
  budget: Budget;
  plannedDays: number;
}

export interface Elimination {
  place: Place;
  reasons: EliminationReason[];
}

export interface RecommendResult {
  top: Recommendation[];
  /** Every place that passed the hard filters, best first. */
  ranked: Recommendation[];
  eliminated: Elimination[];
  /** "What would unlock more options" hints, most useful first. */
  suggestions: string[];
}

export function recommend(input: PlannerInput, data: PlannerData, limit = 3): RecommendResult {
  const ranked: Recommendation[] = [];
  const eliminated: Elimination[] = [];

  for (const place of data.places) {
    const filtered = hardFilter(place, input, data);
    if (filtered.reasons.length > 0) {
      eliminated.push({ place, reasons: filtered.reasons });
      continue;
    }
    const scored = softScore(place, input, filtered, data.rules);
    ranked.push({
      place,
      ...scored,
      season: filtered.season,
      budget: filtered.budget,
      plannedDays: filtered.plannedDays,
    });
  }

  // Deterministic order: score, then cheaper, then name, so the same input always gives the same list.
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.budget.totalPerPerson - b.budget.totalPerPerson ||
      a.place.name.localeCompare(b.place.name),
  );

  return {
    top: ranked.slice(0, limit),
    ranked,
    eliminated,
    suggestions: ranked.length >= limit ? [] : suggest(input, data, eliminated),
  };
}

/**
 * For places blocked by exactly one rule, work out the smallest change that would
 * let them in. Only single-blocker places count, because one change has to be enough.
 */
export function suggest(input: PlannerInput, data: PlannerData, eliminated: Elimination[]): string[] {
  const out: string[] = [];
  const onlyBy = (code: EliminationReason["code"]) =>
    eliminated.filter((e) => e.reasons.length > 0 && e.reasons.every((r) => r.code === code)).map((e) => e.place);

  const budgetBlocked = onlyBy("budget");
  if (budgetBlocked.length > 0) {
    const needed = budgetBlocked
      .map((p) => budgetBreakdown(p, plannedDays(p, input.days), input.groupSize, data.rules).totalPerPerson)
      .sort((a, b) => a - b);
    const roundedUp = Math.ceil(needed[0]! / 500) * 500;
    const ceiling = roundedUp * (1 + data.rules.budget_tolerance_pct / 100);
    const unlocked = needed.filter((n) => n <= ceiling).length;
    out.push(
      `Raising your budget to ${formatINR(roundedUp)} per person unlocks ${unlocked} more ${unlocked === 1 ? "place" : "places"}.`,
    );
  }

  const daysBlocked = onlyBy("days");
  if (daysBlocked.length > 0) {
    const minDays = Math.min(...daysBlocked.map((p) => p.days_min));
    const count = daysBlocked.filter((p) => p.days_min === minDays).length;
    out.push(`With ${minDays} days you could do ${count} more ${count === 1 ? "trip" : "trips"}.`);
  }

  const seasonBlocked = onlyBy("season");
  if (seasonBlocked.length > 0) {
    // Find the nearest upcoming month that opens the most of these places.
    let best = { month: input.month, count: 0 };
    for (let offset = 1; offset <= 11; offset++) {
      const month = ((input.month - 1 + offset) % 12) + 1;
      const count = seasonBlocked.filter((p) => checkSeason(p, month, data.passes).status === "good").length;
      if (count > best.count) best = { month, count };
    }
    if (best.count > 0) {
      out.push(
        `${seasonBlocked.length} ${seasonBlocked.length === 1 ? "place is" : "places are"} closed in ${monthName(input.month)}; ` +
          `${monthName(best.month)} is good for ${best.count} of them.`,
      );
    }
  }

  const difficultyBlocked = onlyBy("difficulty");
  if (difficultyBlocked.length > 0) {
    out.push(
      `${difficultyBlocked.length} harder ${difficultyBlocked.length === 1 ? "trek fits" : "treks fit"} everything else. ` +
        `Take the fitness check, or go with a guide once you've done an easier trek.`,
    );
  }

  return out;
}
