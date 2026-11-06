import { z } from "zod";
import { HAZARD_KINDS, HazardKindSchema } from "../schemas";

const Month = z.number().int().min(1).max(12);

export const HazardSchema = z.object({
  id: z.string().min(1).max(80),
  region_id: z.string(),
  kind: HazardKindSchema,
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1).max(120),
  description: z.string().max(1000),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_m: z.number().int().min(50).max(50_000),
  /** Months when the risk applies. Null means all year. */
  months: z.array(Month).nullable(),
  place_ids: z.array(z.string()).default([]),
  source: z.enum(["curated", "official", "community"]),
  source_note: z.string().max(300).default(""),
  /** Community reports expire unless other travellers confirm them. */
  reported_at: z.string().optional(),
  expires_at: z.string().nullable().optional(),
  confirmations: z.number().int().min(0).optional(),
});

export const HospitalSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.enum(["medical_college", "district", "civil", "chc", "phc"]),
  lat: z.number(),
  lon: z.number(),
  emergency_24h: z.boolean(),
});

const kindHours = z.object(Object.fromEntries(HAZARD_KINDS.map((k) => [k, z.number().positive()])) as Record<(typeof HAZARD_KINDS)[number], z.ZodNumber>);

export const SafetyRulesSchema = z.object({
  version: z.string(),
  weather: z.object({
    rain_mm: z.number(),
    heavy_rain_mm: z.number(),
    snow_cm: z.number(),
    heavy_snow_cm: z.number(),
    frost_c: z.number(),
    severe_cold_c: z.number(),
    gust_kmh: z.number(),
    severe_gust_kmh: z.number(),
    uv_index: z.number(),
    storm_codes: z.array(z.number().int()),
  }),
  hazard_reports: z.object({
    default_ttl_hours: kindHours,
    confirm_extends_hours: z.number().positive(),
    max_ttl_hours: z.number().positive(),
    clears_to_expire: z.number().int().min(1),
    reports_per_day: z.number().int().min(1),
    radius_m: z.number().int().min(50),
  }),
  alert_radius_km: z.number().positive(),
});

export const SafetyGuideSchema = z.object({
  source: z.string(),
  altitude: z.object({
    intro: z.string(),
    prevent: z.array(z.string()),
    levels: z.array(z.object({ name: z.string(), signs: z.string(), action: z.string() })),
    rule: z.string(),
  }),
  tell_someone: z.array(z.string()),
  weather_rules: z.array(z.string()),
});

/** One day of forecast at one point, in the shape every weather source is normalised to. */
export const DailyForecastSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code: z.number().int(),
  tMaxC: z.number(),
  tMinC: z.number(),
  precipMm: z.number().min(0),
  snowCm: z.number().min(0),
  precipProb: z.number().min(0).max(100).nullable(),
  gustKmh: z.number().min(0),
  uvMax: z.number().min(0).nullable(),
});

export type Hazard = z.infer<typeof HazardSchema>;
export type Hospital = z.infer<typeof HospitalSchema>;
export type SafetyRules = z.infer<typeof SafetyRulesSchema>;
export type SafetyGuide = z.infer<typeof SafetyGuideSchema>;
export type DailyForecast = z.infer<typeof DailyForecastSchema>;
