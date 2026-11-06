import { z } from "zod";

export const BADGE_METRICS = [
  "trips_completed",
  "treks_completed",
  "verified_trips",
  "cheapest_trip_pp",
  "max_altitude_m",
  "passes_crossed",
  "districts_visited",
  "contributions_verified",
  "km_total",
] as const;

export const VALIDATIONS = ["verified", "partial", "manual"] as const;

export const TRAVEL_STYLES = [
  "solo",
  "group",
  "budget",
  "comfort",
  "slow",
  "fast",
  "photographer",
  "foodie",
  "spiritual",
  "adventure",
] as const;

export const AVATARS = ["🥾", "🧗", "🏕️", "🏔️", "🧭", "🌄", "🎒", "🦅"] as const;

export const BadgeMetricSchema = z.enum(BADGE_METRICS);
export const ValidationSchema = z.enum(VALIDATIONS);
export const TravelStyleSchema = z.enum(TRAVEL_STYLES);

export const BadgeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  xp: z.number().int().min(0),
  rule: z.object({
    metric: BadgeMetricSchema,
    op: z.enum([">=", "<"]),
    value: z.number(),
  }),
});

export const MascotsSchema = z.object({
  stages: z
    .array(
      z.object({
        id: z.enum(["rookie", "trail-hunter", "summit-seeker", "legend"]),
        name: z.string(),
        min_level: z.number().int().min(1),
        description: z.string(),
      }),
    )
    .min(1),
  species: z
    .array(z.object({ id: z.enum(["snow_leopard", "monal", "red_panda"]), name: z.string() }))
    .min(1),
});

export const XpRulesSchema = z.object({
  version: z.string(),
  xp_per_level: z.number().int().min(1),
  validation_multiplier: z.object({ verified: z.number(), partial: z.number(), manual: z.number() }),
  manual_trips_per_month: z.number().int().min(0),
  plausibility: z.object({
    min_points: z.number().int().min(2),
    reach_radius_km: z.number().positive(),
    min_hours_per_plan_day: z.number().positive(),
    max_speed_kmh: z.number().positive(),
    future_tolerance_min: z.number().min(0),
  }),
});

export type BadgeMetric = z.infer<typeof BadgeMetricSchema>;
export type Validation = z.infer<typeof ValidationSchema>;
export type TravelStyle = z.infer<typeof TravelStyleSchema>;
export type Avatar = (typeof AVATARS)[number];
export type Badge = z.infer<typeof BadgeSchema>;
export type Mascots = z.infer<typeof MascotsSchema>;
export type MascotStage = Mascots["stages"][number];
export type MascotStageId = MascotStage["id"];
export type MascotSpecies = Mascots["species"][number]["id"];
export type XpRules = z.infer<typeof XpRulesSchema>;

export interface GameData {
  badges: Badge[];
  mascots: Mascots;
  xp: XpRules;
}

const GameDataSchema = z.object({ badges: z.array(BadgeSchema).min(1), mascots: MascotsSchema, xp: XpRulesSchema });

export function parseGameData(raw: unknown): GameData {
  const data = GameDataSchema.parse(raw);
  const stages = [...data.mascots.stages].sort((a, b) => a.min_level - b.min_level);
  if (stages[0]?.min_level !== 1) throw new Error("mascots: the first stage must start at level 1");
  const ids = new Set<string>();
  for (const b of data.badges) {
    if (ids.has(b.id)) throw new Error(`badges: duplicate id ${b.id}`);
    ids.add(b.id);
  }
  return { ...data, mascots: { ...data.mascots, stages } };
}
