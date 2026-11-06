import { DIFFICULTY_LABELS, formatINR, formatList, formatNumber, monthName, VIBE_LABELS } from "../labels";
import type { PlannerInput, Place, ScoringRules } from "../schemas";
import type { FilterResult } from "./filters";

export type ReasonTone = "good" | "neutral" | "warn";

export interface Reason {
  tone: ReasonTone;
  text: string;
}

/** Each factor is normalised to 0..1 before weighting, so weights read as "points out of 100". */
export interface ScoreBreakdown {
  vibe: number;
  budget: number;
  days: number;
  season: number;
  novelty: number;
}

export interface Scored {
  score: number;
  breakdown: ScoreBreakdown;
  reasons: Reason[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function softScore(place: Place, input: PlannerInput, filtered: FilterResult, rules: ScoringRules): Scored {
  const reasons: Reason[] = [];

  // Vibe: share of the user's chosen vibes this place offers. No vibes chosen = neutral for all.
  const matched = input.vibes.filter((v) => place.vibes.includes(v));
  const vibe = input.vibes.length === 0 ? rules.neutral_vibe_score : matched.length / input.vibes.length;
  if (matched.length > 0) {
    reasons.push({ tone: "good", text: `Matches your vibes: ${formatList(matched.map((v) => VIBE_LABELS[v]))}` });
  } else if (input.vibes.length > 0) {
    reasons.push({ tone: "neutral", text: "None of your chosen vibes, but it fits your other filters" });
  }

  // Budget: full marks at or under budget, falling linearly to 0 at the tolerance ceiling.
  const cost = filtered.budget.totalPerPerson;
  const toleranceRupees = (input.budgetPerPerson * rules.budget_tolerance_pct) / 100;
  const budget =
    cost <= input.budgetPerPerson ? 1 : clamp01(1 - (cost - input.budgetPerPerson) / Math.max(1, toleranceRupees));
  if (cost <= input.budgetPerPerson) {
    reasons.push({
      tone: "good",
      text: `About ${formatINR(cost)} per person, ${formatINR(input.budgetPerPerson - cost)} under your budget`,
    });
  } else {
    const pct = Math.round(((cost - input.budgetPerPerson) / input.budgetPerPerson) * 100);
    reasons.push({ tone: "warn", text: `About ${formatINR(cost)} per person, ${pct}% over your budget` });
  }

  // Days: how fully the place uses the time the traveller has.
  const days = clamp01(filtered.plannedDays / input.days);
  reasons.push(
    filtered.plannedDays === input.days
      ? { tone: "good", text: `Fits your ${input.days} days exactly` }
      : { tone: "neutral", text: `Uses ${filtered.plannedDays} of your ${input.days} days` },
  );

  // Season: risky months stay eligible but score lower and carry their reasons as warnings.
  const season = filtered.season.status === "good" ? 1 : rules.risky_season_score;
  if (filtered.season.status === "good") {
    reasons.push({ tone: "good", text: `${monthName(input.month)} is a good time to go` });
  } else {
    for (const r of filtered.season.reasons) reasons.push({ tone: "warn", text: `${monthName(input.month)}: ${r}` });
  }

  const visited = input.visited?.includes(place.id) ?? false;
  const novelty = visited ? 0 : 1;
  if (visited) reasons.push({ tone: "neutral", text: "You've already done this one" });

  reasons.push({
    tone: "good",
    text: `${DIFFICULTY_LABELS[place.difficulty]} difficulty suits your fitness`,
  });
  if (place.max_altitude_m >= rules.high_altitude_note_m) {
    reasons.push({
      tone: "warn",
      text: `Reaches ${formatNumber(place.max_altitude_m)} m, so plan for altitude`,
    });
  }

  const breakdown: ScoreBreakdown = { vibe, budget, days, season, novelty };
  const w = rules.weights;
  const score = Math.round(
    w.vibe * vibe + w.budget * budget + w.days * days + w.season * season + w.novelty * novelty,
  );

  return { score, breakdown, reasons };
}
