import { z } from "zod";
import { VibeSchema } from "../schemas";

export const GENDERS = ["woman", "man", "nonbinary", "prefer_not"] as const;
export const GenderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;

export const TravellerTypesSchema = z.object({
  types: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        icon: z.string(),
        pace: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        vibes: z.array(VibeSchema),
        description: z.string(),
      }),
    )
    .min(2),
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        options: z.array(z.object({ label: z.string(), points: z.record(z.string(), z.number().int().min(0)) })).min(2),
      }),
    )
    .min(1),
});

export const MatchingRulesSchema = z.object({
  version: z.string(),
  weights: z.object({ dates: z.number(), destination: z.number(), pace: z.number(), budget: z.number(), fitness: z.number(), vibes: z.number() }),
  max_date_gap_days: z.number().int().min(0),
  min_score: z.number().min(0).max(100),
  requests_per_day: z.number().int().min(1),
  request_expiry_days: z.number().int().min(1),
  message_max_chars: z.number().int().min(50),
  age_bands: z.array(z.object({ min: z.number().int(), max: z.number().int(), label: z.string() })).min(1),
});

export const MatchPrefsSchema = z.object({
  /** Only show women; needs the traveller to be an ID-verified woman herself. */
  womenOnly: z.boolean(),
  /** Only show people of my gender; needs ID-verified gender on both sides. */
  sameGender: z.boolean(),
  verifiedOnly: z.boolean(),
  ageMin: z.number().int().min(18).max(99),
  ageMax: z.number().int().min(18).max(120),
  /** Off: nobody finds you, though you can still send requests yourself. */
  visible: z.boolean(),
});

export type TravellerTypes = z.infer<typeof TravellerTypesSchema>;
export type TravellerType = TravellerTypes["types"][number];
export type MatchingRules = z.infer<typeof MatchingRulesSchema>;
export type MatchPrefs = z.infer<typeof MatchPrefsSchema>;

export const DEFAULT_MATCH_PREFS: MatchPrefs = { womenOnly: false, sameGender: false, verifiedOnly: false, ageMin: 18, ageMax: 120, visible: true };
