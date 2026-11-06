import { z } from "zod";

export const ChallengesSchema = z.object({
  challenges: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        icon: z.string(),
        description: z.string(),
        xp: z.number().int().min(0),
        metric: z.enum(["season_verified_treks", "season_verified_trips", "season_contributions", "season_hazard_actions"]),
        target: z.number().int().min(1),
      }),
    )
    .min(1),
  streak: z.object({ xp_per_month: z.number().int().min(0), max_xp: z.number().int().min(0) }),
  leaderboard: z.object({ max_completions_per_day: z.number().int().min(1), top_n: z.number().int().min(5), cache_seconds: z.number().int().min(0) }),
});

export type Challenges = z.infer<typeof ChallengesSchema>;
export type Challenge = Challenges["challenges"][number];
export type SeasonMetric = Challenge["metric"];

export interface ChallengeProgress extends Challenge {
  current: number;
  done: boolean;
}

export function challengeProgress(data: Challenges, metrics: Record<SeasonMetric, number>): ChallengeProgress[] {
  return data.challenges.map((c) => ({ ...c, current: Math.min(c.target, metrics[c.metric]), done: metrics[c.metric] >= c.target }));
}

/**
 * Consecutive months, ending with `season`, that each have at least one qualifying trip.
 * `seasons` is the set of "YYYY-MM" months with a qualifying trip.
 */
export function streakMonths(seasons: Set<string>, season: string): number {
  let [y, m] = season.split("-").map(Number) as [number, number];
  let n = 0;
  while (seasons.has(`${y}-${String(m).padStart(2, "0")}`)) {
    n++;
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return n;
}

export function streakXp(months: number, data: Challenges): number {
  return Math.min(data.streak.max_xp, months * data.streak.xp_per_month);
}

/** What the anti-cheat check needs to know about a completed trip. */
export interface TripWindow {
  id: string;
  completedAt: number;
  /** First and last GPS timestamps; null when no track was recorded. */
  firstPoint: number | null;
  lastPoint: number | null;
  /** All points came from the demo "simulated track" button. */
  simulated: boolean;
}

/**
 * Leaderboard fair-play checks, on top of the GPS plausibility check that grades XP. A flagged trip
 * still counts for your level and badges (you did the walk), but not for leaderboards.
 */
export function tripAnomalies(trip: TripWindow, others: TripWindow[], data: Challenges): string[] {
  const out: string[] = [];
  if (trip.simulated) out.push("Simulated GPS (demo) doesn't count on leaderboards.");
  if (trip.firstPoint !== null && trip.lastPoint !== null) {
    const overlap = others.find((o) => o.id !== trip.id && o.firstPoint !== null && o.lastPoint !== null && o.firstPoint < trip.lastPoint! && trip.firstPoint! < o.lastPoint!);
    if (overlap) out.push("This GPS track overlaps another trip's track. You can't be in two places at once.");
  }
  const recent = others.filter((o) => o.id !== trip.id && Math.abs(trip.completedAt - o.completedAt) < 24 * 3_600_000).length;
  if (recent + 1 > data.leaderboard.max_completions_per_day) {
    out.push(`More than ${data.leaderboard.max_completions_per_day} trips finished within 24 hours.`);
  }
  return out;
}

export interface RankedEntry<T> {
  rank: number;
  value: number;
  item: T;
}

/** Standard competition ranking (1, 2, 2, 4): ties share a rank, and the next rank skips. */
export function rank<T>(items: T[], value: (t: T) => number, tiebreak: (t: T) => string): RankedEntry<T>[] {
  const sorted = [...items].sort((a, b) => value(b) - value(a) || tiebreak(a).localeCompare(tiebreak(b)));
  const out: RankedEntry<T>[] = [];
  sorted.forEach((item, i) => {
    const v = value(item);
    const prev = out[i - 1];
    out.push({ rank: prev && prev.value === v ? prev.rank : i + 1, value: v, item });
  });
  return out;
}
