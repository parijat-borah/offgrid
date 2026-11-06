import { budgetBreakdown, plannedDays, type Budget } from "../budget";
import { DIFFICULTY_LABELS, formatINR } from "../labels";
import type { PlannerData } from "../pack";
import type { Place, PlannerInput } from "../schemas";
import { checkSeason, type SeasonCheck } from "../season";

export type EliminationCode = "season" | "difficulty" | "days" | "budget";

export interface EliminationReason {
  code: EliminationCode;
  message: string;
}

export interface FilterResult {
  reasons: EliminationReason[];
  season: SeasonCheck;
  budget: Budget;
  plannedDays: number;
}

/**
 * Hard rules: a place that fails any of these is never recommended. All failures are
 * collected (not just the first) so the UI can explain "why not" and suggest what to change.
 */
export function hardFilter(place: Place, input: PlannerInput, data: PlannerData): FilterResult {
  const reasons: EliminationReason[] = [];

  const season = checkSeason(place, input.month, data.passes);
  if (season.status === "closed") {
    for (const message of season.reasons) reasons.push({ code: "season", message });
  }

  if (place.difficulty > input.fitness) {
    reasons.push({
      code: "difficulty",
      message: `${DIFFICULTY_LABELS[place.difficulty]} trek; your fitness level is ${input.fitness} (${DIFFICULTY_LABELS[input.fitness]}).`,
    });
  }

  if (place.days_min > input.days) {
    reasons.push({ code: "days", message: `Needs at least ${place.days_min} days; you have ${input.days}.` });
  }

  const days = plannedDays(place, input.days);
  const budget = budgetBreakdown(place, days, input.groupSize, data.rules);
  const ceiling = input.budgetPerPerson * (1 + data.rules.budget_tolerance_pct / 100);
  if (budget.totalPerPerson > ceiling) {
    reasons.push({
      code: "budget",
      message: `Estimated ${formatINR(budget.totalPerPerson)} per person is over your ${formatINR(input.budgetPerPerson)} budget.`,
    });
  }

  return { reasons, season, budget, plannedDays: days };
}
