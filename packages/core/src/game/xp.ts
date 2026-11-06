import type { Place } from "../schemas";
import type { Validation, XpRules } from "./schemas";

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP needed to reach the next level from the start of this one. */
  span: number;
  toNext: number;
  pct: number;
}

/** level = floor(xp / 100) + 1 with the default rules. */
export function levelForXp(xp: number, rules: XpRules): number {
  return Math.floor(Math.max(0, xp) / rules.xp_per_level) + 1;
}

export function levelProgress(xp: number, rules: XpRules): LevelProgress {
  const safe = Math.max(0, xp);
  const span = rules.xp_per_level;
  const into = safe % span;
  return { level: levelForXp(safe, rules), xp: safe, into, span, toNext: span - into, pct: Math.round((into / span) * 100) };
}

export interface TripXp {
  xp: number;
  note: string;
}

/**
 * XP for completing a trip. Validated trips earn more; manual (untracked) completions earn a
 * small share and are capped per month, so tapping "done" can't farm the leaderboard.
 */
export function tripXp(place: Place, validation: Validation, rules: XpRules, manualAlreadyThisMonth: number): TripXp {
  const mult = rules.validation_multiplier[validation];
  if (validation === "manual" && manualAlreadyThisMonth >= rules.manual_trips_per_month) {
    return {
      xp: 0,
      note: `You've used your ${rules.manual_trips_per_month} manual completions this month. Record GPS to earn XP.`,
    };
  }
  const xp = Math.round(place.base_xp * mult);
  const label = validation === "verified" ? "GPS-verified" : validation === "partial" ? "partly verified" : "manual entry";
  return { xp, note: `${place.base_xp} base XP × ${mult} (${label})` };
}
