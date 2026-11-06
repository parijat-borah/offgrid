import { formatINR } from "./labels";
import type { Place, ScoringRules } from "./schemas";

export type BudgetKey = "stay" | "food" | "local_transport" | "activities" | "transport" | "permit";

export interface BudgetLine {
  key: BudgetKey;
  label: string;
  perPerson: number;
  note: string;
}

export interface Budget {
  days: number;
  groupSize: number;
  lines: BudgetLine[];
  subtotalPerPerson: number;
  bufferPct: number;
  bufferPerPerson: number;
  totalPerPerson: number;
  totalGroup: number;
  isEstimate: true;
  accessFrom: string;
  source: string;
  lastVerified: string;
}

/** How many days we actually plan: at least the minimum, never more than the place can fill. */
export function plannedDays(place: Place, availableDays: number): number {
  return Math.min(Math.max(availableDays, place.days_min), place.days_max);
}

/**
 * Per-person and group cost estimate. Data costs assume twin sharing, so a solo
 * traveller pays a configurable premium on stay (single rooms/tents cost more per head).
 */
export function budgetBreakdown(place: Place, days: number, groupSize: number, rules: ScoringRules): Budget {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
  if (!Number.isInteger(groupSize) || groupSize < 1) throw new RangeError("groupSize must be a positive integer");

  const c = place.cost;
  const solo = groupSize === 1;
  const stayPerDay = Math.round(c.stay * (solo ? rules.solo_stay_multiplier : 1));

  const lines: BudgetLine[] = [
    {
      key: "stay",
      label: "Stay",
      perPerson: stayPerDay * days,
      note: solo
        ? `${days} × ${formatINR(stayPerDay)} (solo rate, ×${rules.solo_stay_multiplier} of twin sharing)`
        : `${days} × ${formatINR(stayPerDay)} (twin sharing)`,
    },
    { key: "food", label: "Food", perPerson: c.food * days, note: `${days} × ${formatINR(c.food)}` },
    {
      key: "local_transport",
      label: "Local transport",
      perPerson: c.local_transport * days,
      note: `${days} × ${formatINR(c.local_transport)} (buses, shared taxis)`,
    },
    {
      key: "activities",
      label: "Activities & guides",
      perPerson: c.activities * days + c.activities_once,
      note:
        c.activities_once > 0
          ? `${days} × ${formatINR(c.activities)} + ${formatINR(c.activities_once)} one-time`
          : `${days} × ${formatINR(c.activities)}`,
    },
    {
      key: "transport",
      label: `Return travel from ${c.access_from}`,
      perPerson: c.transport_roundtrip,
      note: "Round trip by bus",
    },
    { key: "permit", label: "Permits & entry fees", perPerson: c.permit, note: c.permit > 0 ? "Per trip" : "None needed" },
  ];

  const subtotalPerPerson = lines.reduce((sum, l) => sum + l.perPerson, 0);
  const bufferPerPerson = Math.round((subtotalPerPerson * rules.buffer_pct) / 100);
  const totalPerPerson = subtotalPerPerson + bufferPerPerson;

  return {
    days,
    groupSize,
    lines,
    subtotalPerPerson,
    bufferPct: rules.buffer_pct,
    bufferPerPerson,
    totalPerPerson,
    totalGroup: totalPerPerson * groupSize,
    isEstimate: true,
    accessFrom: c.access_from,
    source: c.source,
    lastVerified: c.last_verified,
  };
}
