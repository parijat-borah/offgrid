import { plannedDays } from "./budget";
import { formatNumber } from "./labels";
import type { ExtraDay, Fitness, Place, PlanDay, ScoringRules } from "./schemas";

export type DayKind = "plan" | ExtraDay["kind"];

export interface ItineraryDay extends PlanDay {
  day: number;
  kind: DayKind;
  warnings: string[];
}

export interface Itinerary {
  placeId: string;
  plannedDays: number;
  /** Days the traveller has beyond what this place can fill. */
  spareDays: number;
  days: ItineraryDay[];
  /** Trip-level cautions (e.g. no buffer day). */
  warnings: string[];
  /** True when any single day is harder than the traveller should attempt. */
  overpacked: boolean;
}

/**
 * Day-by-day plan. The base plan is the minimum trip; spare days are filled with the
 * place's extras in data order (authors list acclimatisation first), each slotted in
 * after its anchor day so the return day always stays last.
 */
export function buildItinerary(place: Place, availableDays: number, fitness: Fitness, rules: ScoringRules): Itinerary {
  const n = plannedDays(place, availableDays);
  const chosen = place.extras.slice(0, n - place.days_min);
  const chosenSet = new Set(chosen);

  const sequence: Array<PlanDay & { kind: DayKind }> = [];
  place.plan.forEach((day, i) => {
    sequence.push({ ...day, kind: "plan" });
    for (const extra of chosen) {
      if (extra.after_day === i + 1) sequence.push(extra);
    }
  });

  const kmCap = rules.fitness_km_per_day[String(fitness) as "1" | "2" | "3"];
  const { threshold_m: amsThreshold, max_gain_per_night_m: maxGain } = rules.ams;

  let prevSleep = place.base_alt_m;
  const days: ItineraryDay[] = sequence.map((d, i) => {
    const warnings: string[] = [];
    if (d.trek_km > kmCap) {
      warnings.push(
        `${d.trek_km} km of trekking is a long day for fitness level ${fitness} (comfortable: up to ${kmCap} km).`,
      );
    }
    // WMS guideline: above ~3,000 m, raise sleeping altitude by no more than ~500 m per night.
    // Only the gain above the threshold counts, so sleeping at 3,100 m after Manali is fine.
    const gainAboveThreshold = d.sleep_alt_m - Math.max(prevSleep, amsThreshold);
    if (d.sleep_alt_m > amsThreshold && gainAboveThreshold > maxGain) {
      warnings.push(
        `Sleeping altitude jumps to ${formatNumber(d.sleep_alt_m)} m (+${formatNumber(d.sleep_alt_m - prevSleep)} m). ` +
          `Above ${formatNumber(amsThreshold)} m, aim for no more than ${maxGain} m gain per night. ` +
          `Watch for headache and nausea, and descend if they get worse.`,
      );
    }
    prevSleep = d.sleep_alt_m;
    const { kind, title, detail, trek_km, sleep_alt_m } = d;
    return { day: i + 1, kind, title, detail, trek_km, sleep_alt_m, warnings };
  });

  const warnings: string[] = [];
  if (availableDays < place.days_min) {
    warnings.push(`This trip needs at least ${place.days_min} days; you have ${availableDays}.`);
  }
  const skippedAcclimatise = place.extras.some((e) => e.kind === "acclimatise" && !chosenSet.has(e));
  if (skippedAcclimatise) {
    warnings.push("No acclimatisation day fits in your dates. Add one if you can; it lowers the risk of altitude sickness.");
  }
  if (n === place.days_min && place.difficulty >= 2 && !skippedAcclimatise) {
    warnings.push("No buffer day. Mountain weather often costs a day, so add one if you can.");
  }

  return {
    placeId: place.id,
    plannedDays: n,
    spareDays: Math.max(0, availableDays - n),
    days,
    warnings,
    overpacked: days.some((d) => d.warnings.length > 0),
  };
}
