import { formatINR, formatNumber } from "../labels";
import type { Badge, BadgeMetric, GameData, MascotStage } from "./schemas";
import { levelProgress } from "./xp";

export function meetsRule(badge: Badge, metrics: Record<BadgeMetric, number>): boolean {
  const v = metrics[badge.rule.metric];
  return badge.rule.op === ">=" ? v >= badge.rule.value : v < badge.rule.value;
}

/** Badges whose rule is now met and that the traveller doesn't already hold. */
export function newlyEarned(badges: Badge[], metrics: Record<BadgeMetric, number>, held: Iterable<string>): Badge[] {
  const have = new Set(held);
  return badges.filter((b) => !have.has(b.id) && meetsRule(b, metrics));
}

export interface BadgeProgress {
  badge: Badge;
  earned: boolean;
  /** 0..1. Threshold ("<") badges are all-or-nothing. */
  progress: number;
  /** What's left, e.g. "2 more treks". Null once earned. */
  remaining: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} more ${n === 1 ? one : many}`;

function remainingText(badge: Badge, current: number): string {
  const left = Math.max(0, Math.ceil(badge.rule.value - current));
  switch (badge.rule.metric) {
    case "trips_completed":
      return plural(left, "trip");
    case "treks_completed":
      return plural(left, "trek");
    case "verified_trips":
      return plural(left, "GPS-verified trip");
    case "passes_crossed":
      return plural(left, "pass", "passes");
    case "districts_visited":
      return plural(left, "district");
    case "contributions_verified":
      return plural(left, "verified hidden place");
    case "km_total":
      return `${formatNumber(left)} more km`;
    case "max_altitude_m":
      return `a trip above ${formatNumber(badge.rule.value)} m`;
    case "cheapest_trip_pp":
      return `a trip under ${formatINR(badge.rule.value)} per person`;
  }
}

export function badgeProgress(badges: Badge[], metrics: Record<BadgeMetric, number>, held: Iterable<string>): BadgeProgress[] {
  const have = new Set(held);
  return badges.map((badge) => {
    const earned = have.has(badge.id);
    const current = metrics[badge.rule.metric];
    const progress = earned
      ? 1
      : badge.rule.op === ">="
        ? Math.min(1, Math.max(0, current / badge.rule.value))
        : meetsRule(badge, metrics)
          ? 1
          : 0;
    return { badge, earned, progress, remaining: earned ? null : remainingText(badge, current) };
  });
}

export function stageForLevel(stages: MascotStage[], level: number): MascotStage {
  let current = stages[0]!;
  for (const s of stages) if (level >= s.min_level) current = s;
  return current;
}

export function nextStage(stages: MascotStage[], level: number): MascotStage | null {
  return stages.find((s) => s.min_level > level) ?? null;
}

/**
 * "Explore more" prompts: the mascot's next evolution, then the closest unearned badges.
 * Ordered by how near they are, because a goal that's almost reached motivates most.
 */
export function nudges(game: GameData, xp: number, metrics: Record<BadgeMetric, number>, held: Iterable<string>, max = 3): string[] {
  const out: string[] = [];
  const lp = levelProgress(xp, game.xp);
  const next = nextStage(game.mascots.stages, lp.level);
  if (next) {
    const xpNeeded = (next.min_level - 1) * game.xp.xp_per_level - lp.xp;
    out.push(`${formatNumber(xpNeeded)} XP to level ${next.min_level}, when your Wanderling evolves into ${next.name}.`);
  }
  const open = badgeProgress(game.badges, metrics, held)
    .filter((b) => !b.earned)
    .sort((a, b) => b.progress - a.progress || a.badge.xp - b.badge.xp);
  for (const b of open) {
    if (out.length >= max) break;
    out.push(`${capitalise(b.remaining!)} to unlock ${b.badge.icon} ${b.badge.name}.`);
  }
  return out;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
