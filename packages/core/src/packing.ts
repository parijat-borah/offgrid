import { HAZARD_LABELS, formatList, formatNumber, monthName, PACKING_CATEGORY_LABELS } from "./labels";
import { PACKING_CATEGORIES, type PackingCategory, type PackingRule, type Place } from "./schemas";

type Condition = NonNullable<PackingRule["when"]>[number];

export interface PackingItem {
  id: string;
  label: string;
  /** Why this item is on the list, e.g. "Max altitude 4,270 m". */
  why: string;
}

export interface PackingGroup {
  category: PackingCategory;
  label: string;
  items: PackingItem[];
}

interface TripContext {
  place: Place;
  month: number;
  days: number;
}

/** Returns the human-readable reasons if every key in the condition matches, otherwise null. */
function matchCondition(cond: Condition, { place, month, days }: TripContext): string[] | null {
  const why: string[] = [];
  if (cond.altitude_gte !== undefined) {
    if (place.max_altitude_m < cond.altitude_gte) return null;
    why.push(`max altitude ${formatNumber(place.max_altitude_m)} m`);
  }
  if (cond.months) {
    if (!cond.months.includes(month)) return null;
    why.push(`${monthName(month)} conditions`);
  }
  if (cond.days_gte !== undefined) {
    if (days < cond.days_gte) return null;
    why.push(`${days}-day trip`);
  }
  if (cond.types) {
    if (!cond.types.includes(place.type)) return null;
    why.push(`${place.type} trip`);
  }
  if (cond.hazards_any) {
    const hit = cond.hazards_any.filter((h) => place.hazards.includes(h));
    if (hit.length === 0) return null;
    why.push(formatList(hit.map((h) => HAZARD_LABELS[h].toLowerCase())));
  }
  if (cond.difficulty_gte !== undefined) {
    if (place.difficulty < cond.difficulty_gte) return null;
    why.push(`difficulty ${place.difficulty}`);
  }
  if (cond.stay_types) {
    if (!cond.stay_types.includes(place.stay_type)) return null;
    why.push(`${place.stay_type} stay`);
  }
  return why;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Packing list driven entirely by data/packing-rules.json; grouped in a fixed category order. */
export function packingList(place: Place, month: number, days: number, rules: PackingRule[]): PackingGroup[] {
  const ctx: TripContext = { place, month, days };
  const byCategory = new Map<PackingCategory, PackingItem[]>();

  for (const rule of rules) {
    let why: string[] | null;
    if (!rule.when) {
      why = [];
    } else {
      why = null;
      for (const cond of rule.when) {
        why = matchCondition(cond, ctx);
        if (why) break;
      }
    }
    if (!why) continue;
    const items = byCategory.get(rule.category) ?? [];
    items.push({ id: rule.id, label: rule.label, why: why.length ? capitalise(why.join(", ")) : "Always pack" });
    byCategory.set(rule.category, items);
  }

  return PACKING_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    label: PACKING_CATEGORY_LABELS[category],
    items: byCategory.get(category)!,
  }));
}
