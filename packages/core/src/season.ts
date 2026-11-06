import { monthName } from "./labels";
import type { Pass, Place } from "./schemas";

export type SeasonStatus = "good" | "risky" | "closed";

export interface SeasonCheck {
  status: SeasonStatus;
  /** Why the month is risky or closed. Empty for "good". */
  reasons: string[];
}

/**
 * Classify a month for a place. Closures come from the place itself and from any
 * road or pass it depends on (e.g. Chandratal needs the Gramphu–Batal road).
 */
export function checkSeason(place: Place, month: number, passes: Pass[]): SeasonCheck {
  const closedReasons: string[] = [];

  for (const window of place.season.closed) {
    if (window.months.includes(month)) closedReasons.push(`Closed in ${monthName(month)}: ${window.reason}`);
  }
  for (const passId of place.access_via) {
    const pass = passes.find((p) => p.id === passId);
    if (!pass) throw new Error(`Unknown pass "${passId}" for ${place.id}`);
    if (pass.closed_months.includes(month)) {
      closedReasons.push(`${pass.name} is usually closed in ${monthName(month)}. ${pass.note}`);
    }
  }
  if (closedReasons.length > 0) return { status: "closed", reasons: closedReasons };

  const risky = place.season.risky.filter((w) => w.months.includes(month)).map((w) => w.reason);
  if (risky.length > 0) return { status: "risky", reasons: risky };

  if (place.season.good.includes(month)) return { status: "good", reasons: [] };

  // validatePack makes this unreachable for shipped data; stay safe for hand-built inputs.
  return { status: "risky", reasons: ["No reliable season information for this month."] };
}

/** 12 statuses, January first, for the season strip in the UI. */
export function seasonCalendar(place: Place, passes: Pass[]): SeasonStatus[] {
  return Array.from({ length: 12 }, (_, i) => checkSeason(place, i + 1, passes).status);
}
