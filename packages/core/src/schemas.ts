// Zod schemas are the single source of truth for content shapes: TypeScript
// types are inferred from them, and the same schemas validate data packs at load time.
import { z } from "zod";

export const VIBES = [
  "camping",
  "snow",
  "lakes",
  "adventure",
  "chill",
  "cafes",
  "spiritual",
  "photography",
  "wildlife",
  "culture",
  "villages",
  "paragliding",
  "hot-springs",
  "stargazing",
] as const;

export const HAZARD_KINDS = [
  "landslide",
  "bear",
  "leopard",
  "snake",
  "river_crossing",
  "avalanche",
  "ams",
  "extreme_cold",
  "flash_flood",
  "road_closure",
  "lightning",
] as const;

export const PLACE_TYPES = ["trek", "town", "valley", "lake", "pass", "village"] as const;
export const STAY_TYPES = ["camp", "homestay", "hotel", "mixed"] as const;
export const PACKING_CATEGORIES = ["documents", "essentials", "clothing", "gear", "health", "tech"] as const;

const Month = z.number().int().min(1).max(12);
const Rupees = z.number().int().min(0);
const Meters = z.number().int().min(0).max(9000);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const Slug = z.string().regex(/^[a-z0-9-]+$/, "expected a lowercase slug");

export const VibeSchema = z.enum(VIBES);
export const HazardKindSchema = z.enum(HAZARD_KINDS);
export const PlaceTypeSchema = z.enum(PLACE_TYPES);
export const StayTypeSchema = z.enum(STAY_TYPES);

const SeasonWindowSchema = z.object({
  months: z.array(Month).min(1),
  reason: z.string().min(3),
});

export const PlanDaySchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  trek_km: z.number().min(0).max(40),
  sleep_alt_m: Meters,
});

export const ExtraDaySchema = PlanDaySchema.extend({
  kind: z.enum(["acclimatise", "side_trip", "rest"]),
  // Inserted after this day of the base plan (1-based); never after the final (return) day.
  after_day: z.number().int().min(1),
});

export const CostSchema = z.object({
  // Per person per day, twin sharing.
  stay: Rupees,
  food: Rupees,
  local_transport: Rupees,
  activities: Rupees,
  // Per person, once per trip.
  activities_once: Rupees,
  transport_roundtrip: Rupees,
  permit: Rupees,
  access_from: z.string().min(1),
  is_estimate: z.literal(true),
  source: z.string().min(3),
  last_verified: IsoDate,
});

export const PlaceSchema = z.object({
  id: Slug,
  region_id: Slug,
  name: z.string().min(1),
  type: PlaceTypeSchema,
  district: z.string().min(1),
  base_town: z.string().min(1),
  base_alt_m: Meters,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  summary: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  days_min: z.number().int().min(1).max(30),
  days_max: z.number().int().min(1).max(30),
  max_altitude_m: Meters,
  distance_km: z.number().min(0),
  elevation_gain_m: z.number().min(0),
  stay_type: StayTypeSchema,
  season: z.object({
    good: z.array(Month),
    risky: z.array(SeasonWindowSchema),
    closed: z.array(SeasonWindowSchema),
  }),
  access_via: z.array(z.string()),
  vibes: z.array(VibeSchema).min(1),
  cost: CostSchema,
  base_xp: z.number().int().min(0),
  hazards: z.array(HazardKindSchema),
  safety_notes: z.array(z.string().min(1)).min(1),
  permit_notes: z.string().min(1),
  plan: z.array(PlanDaySchema).min(1),
  extras: z.array(ExtraDaySchema),
  sensitive: z.boolean(),
});

export const PassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  closed_months: z.array(Month),
  note: z.string().min(1),
});

export const RegionSchema = z.object({
  id: Slug,
  name: z.string().min(1),
  state: z.string().min(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  pack_version: z.string().min(1),
  default_access_from: z.string().min(1),
  /** Local time offset used for "open now". India has no daylight saving, so a fixed offset is exact. */
  utc_offset_minutes: z.number().int().min(-720).max(840),
  emergency: z.array(z.object({ label: z.string(), number: z.string().regex(/^\d{3,12}$/) })).min(1),
});

export const ScoringRulesSchema = z.object({
  version: z.string(),
  weights: z.object({
    vibe: z.number().min(0),
    budget: z.number().min(0),
    days: z.number().min(0),
    season: z.number().min(0),
    novelty: z.number().min(0),
  }),
  budget_tolerance_pct: z.number().min(0).max(100),
  buffer_pct: z.number().min(0).max(100),
  solo_stay_multiplier: z.number().min(1).max(3),
  risky_season_score: z.number().min(0).max(1),
  neutral_vibe_score: z.number().min(0).max(1),
  high_altitude_note_m: Meters,
  fitness_km_per_day: z.object({ "1": z.number(), "2": z.number(), "3": z.number() }),
  ams: z.object({ threshold_m: Meters, max_gain_per_night_m: z.number().int().min(100) }),
});

const PackingConditionSchema = z
  .object({
    altitude_gte: Meters.optional(),
    months: z.array(Month).optional(),
    days_gte: z.number().int().min(1).optional(),
    types: z.array(PlaceTypeSchema).optional(),
    hazards_any: z.array(HazardKindSchema).optional(),
    difficulty_gte: z.number().int().min(1).max(3).optional(),
    stay_types: z.array(StayTypeSchema).optional(),
  })
  .strict();

export const PackingRuleSchema = z.object({
  id: Slug,
  label: z.string().min(1),
  category: z.enum(PACKING_CATEGORIES),
  // OR of ANDs: the item is packed if ANY condition object fully matches. Omitted = always.
  when: z.array(PackingConditionSchema).min(1).optional(),
});

export const FitnessQuizSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        options: z.array(z.object({ label: z.string(), points: z.number().int().min(0) })).min(2),
      }),
    )
    .min(1),
  bands: z
    .array(
      z.object({
        max_points: z.number().int().min(0),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        label: z.string(),
        description: z.string(),
      }),
    )
    .min(1),
});

export const PlannerInputSchema = z.object({
  budgetPerPerson: z.number().int().min(500).max(500_000),
  days: z.number().int().min(1).max(30),
  month: Month,
  fitness: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  groupSize: z.number().int().min(1).max(20),
  vibes: z.array(VibeSchema).max(VIBES.length),
  visited: z.array(z.string()).optional(),
});

export type Vibe = z.infer<typeof VibeSchema>;
export type HazardKind = z.infer<typeof HazardKindSchema>;
export type PlaceType = z.infer<typeof PlaceTypeSchema>;
export type StayType = z.infer<typeof StayTypeSchema>;
export type PlanDay = z.infer<typeof PlanDaySchema>;
export type ExtraDay = z.infer<typeof ExtraDaySchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Pass = z.infer<typeof PassSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type ScoringRules = z.infer<typeof ScoringRulesSchema>;
export type PackingRule = z.infer<typeof PackingRuleSchema>;
export type PackingCategory = (typeof PACKING_CATEGORIES)[number];
export type FitnessQuiz = z.infer<typeof FitnessQuizSchema>;
export type PlannerInput = z.infer<typeof PlannerInputSchema>;
export type Fitness = PlannerInput["fitness"];
