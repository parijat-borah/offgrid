import { budgetBreakdown, plannedDays } from "./budget";
import { DIFFICULTY_LABELS, formatINR, formatList, formatNumber, HAZARD_LABELS, monthName, monthShort, VIBE_LABELS } from "./labels";
import type { PlannerData } from "./pack";
import { recommend } from "./recommender";
import type { Place, PlannerInput } from "./schemas";
import { checkSeason, seasonCalendar } from "./season";

export interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  /** Which side is better for this traveller, or null if it's a matter of taste. */
  better: "a" | "b" | null;
}

export interface Comparison {
  a: Place;
  b: Place;
  rows: CompareRow[];
  /** Plain-language summary, most decisive point first. */
  verdict: string[];
}

const pick = (a: number, b: number, lowerIsBetter: boolean): "a" | "b" | null => (a === b ? null : (a < b) === lowerIsBetter ? "a" : "b");
const SEASON_RANK = { good: 2, risky: 1, closed: 0 } as const;

/** Two places side by side for the traveller's own budget, dates, month and fitness. */
export function comparePlaces(a: Place, b: Place, input: PlannerInput, data: PlannerData): Comparison {
  const days = { a: plannedDays(a, input.days), b: plannedDays(b, input.days) };
  const cost = {
    a: budgetBreakdown(a, days.a, input.groupSize, data.rules).totalPerPerson,
    b: budgetBreakdown(b, days.b, input.groupSize, data.rules).totalPerPerson,
  };
  const season = { a: checkSeason(a, input.month, data.passes), b: checkSeason(b, input.month, data.passes) };
  const res = recommend(input, { ...data, places: [a, b] }, 2);
  const scoreOf = (p: Place) => res.ranked.find((r) => r.place.id === p.id)?.score ?? null;
  const blocked = (p: Place) => res.eliminated.find((e) => e.place.id === p.id)?.reasons.map((r) => r.message) ?? [];
  const vibeHits = (p: Place) => input.vibes.filter((v) => p.vibes.includes(v));
  const goodMonths = (p: Place) =>
    seasonCalendar(p, data.passes)
      .map((s, i) => (s === "good" ? monthShort(i + 1) : null))
      .filter(Boolean)
      .join(", ") || "None";
  const fits = (p: Place) => p.difficulty <= input.fitness;

  const sa = scoreOf(a);
  const sb = scoreOf(b);
  const rows: CompareRow[] = [
    { key: "match", label: "Match for you", a: sa === null ? "Doesn't fit" : `${sa}/100`, b: sb === null ? "Doesn't fit" : `${sb}/100`, better: pick(sa ?? -1, sb ?? -1, false) },
    { key: "cost", label: "Cost per person", a: formatINR(cost.a), b: formatINR(cost.b), better: pick(cost.a, cost.b, true) },
    { key: "season", label: `${monthName(input.month)}`, a: season.a.status, b: season.b.status, better: pick(SEASON_RANK[season.a.status], SEASON_RANK[season.b.status], false) },
    {
      key: "difficulty",
      label: "Difficulty",
      a: DIFFICULTY_LABELS[a.difficulty]!,
      b: DIFFICULTY_LABELS[b.difficulty]!,
      better: fits(a) === fits(b) ? null : fits(a) ? "a" : "b",
    },
    { key: "days", label: "Days needed", a: `${a.days_min}–${a.days_max}`, b: `${b.days_min}–${b.days_max}`, better: pick(Math.abs(days.a - input.days), Math.abs(days.b - input.days), true) },
    { key: "altitude", label: "Highest point", a: `${formatNumber(a.max_altitude_m)} m`, b: `${formatNumber(b.max_altitude_m)} m`, better: null },
    { key: "distance", label: "On foot", a: a.distance_km ? `${a.distance_km} km` : "Minimal", b: b.distance_km ? `${b.distance_km} km` : "Minimal", better: null },
    { key: "vibes", label: "Your vibes", a: vibeHits(a).map((v) => VIBE_LABELS[v]).join(", ") || "None", b: vibeHits(b).map((v) => VIBE_LABELS[v]).join(", ") || "None", better: pick(vibeHits(a).length, vibeHits(b).length, false) },
    { key: "hazards", label: "Main hazards", a: a.hazards.map((h) => HAZARD_LABELS[h]).join(", ") || "None noted", b: b.hazards.map((h) => HAZARD_LABELS[h]).join(", ") || "None noted", better: pick(a.hazards.length, b.hazards.length, true) },
    { key: "months", label: "Best months", a: goodMonths(a), b: goodMonths(b), better: null },
    { key: "stay", label: "Stay", a: a.stay_type, b: b.stay_type, better: null },
  ];

  const verdict: string[] = [];
  for (const p of [a, b]) {
    const why = blocked(p);
    if (why.length) verdict.push(`${p.name} doesn't fit your plan: ${why[0]}`);
  }
  if (season.a.status !== season.b.status) {
    const worse = SEASON_RANK[season.a.status] < SEASON_RANK[season.b.status] ? a : b;
    verdict.push(`${worse.name} is ${checkSeason(worse, input.month, data.passes).status} in ${monthName(input.month)}.`);
  }
  if (cost.a !== cost.b) {
    const cheaper = cost.a < cost.b ? a : b;
    verdict.push(`${cheaper.name} is ${formatINR(Math.abs(cost.a - cost.b))} cheaper per person.`);
  }
  const shared = input.vibes.filter((v) => a.vibes.includes(v) && b.vibes.includes(v));
  if (shared.length) verdict.push(`Both offer ${formatList(shared.map((v) => VIBE_LABELS[v].toLowerCase()))}.`);
  if (a.max_altitude_m >= 3500 || b.max_altitude_m >= 3500) {
    const high = a.max_altitude_m >= b.max_altitude_m ? a : b;
    verdict.push(`${high.name} goes to ${formatNumber(high.max_altitude_m)} m, so plan for altitude.`);
  }
  return { a, b, rows, verdict };
}
