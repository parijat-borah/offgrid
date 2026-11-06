import { z } from "zod";

export const POI_CATEGORIES = [
  "food",
  "stay",
  "camp",
  "restroom",
  "water",
  "event",
  "viewpoint",
  "medical",
  "atm",
  "fuel",
  "guide",
] as const;

export const POI_TAGS = ["veg", "vegan", "women_safe", "family", "wheelchair", "upi", "wifi", "free"] as const;

export const PoiCategorySchema = z.enum(POI_CATEGORIES);
export const PoiTagSchema = z.enum(POI_TAGS);
const Month = z.number().int().min(1).max(12);

export const PoiSchema = z.object({
  id: z.string().min(1).max(80),
  region_id: z.string(),
  name: z.string().min(1).max(120),
  category: PoiCategorySchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  description: z.string().max(1000),
  price_band: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  tags: z.array(PoiTagSchema),
  /** OSM opening_hours syntax (a common subset is understood), or null when unknown. */
  hours: z.string().max(200).nullable(),
  /** Events only: the months it usually happens in. Lunar-calendar fairs don't have fixed dates. */
  event_months: z.array(Month).nullable(),
  source: z.enum(["curated", "osm", "community"]),
  source_ref: z.string().optional(),
  note: z.string().optional(),
  /** Community places on fragile or sacred sites are published with a fuzzed location. */
  approximate: z.boolean().optional(),
  /** Months the place is usable. Null or missing means all year. */
  seasonality: z.array(Month).nullable().optional(),
  photos: z.array(z.string()).optional(),
});

export const ModerationRulesSchema = z.object({
  version: z.string(),
  duplicate_radius_m: z.number().positive(),
  duplicate_min_similarity: z.number().min(0).max(1),
  auto_duplicate_radius_m: z.number().positive(),
  auto_duplicate_similarity: z.number().min(0).max(1),
  base_vote_weight: z.number().min(0).max(1),
  verify_score: z.number().positive(),
  verify_min_upvotes: z.number().int().min(1),
  flag_score: z.number().positive(),
  approx_grid_deg: z.number().positive(),
  submissions_per_day: z.number().int().min(1),
  contribution_xp: z.number().int().min(0),
});

export type PoiCategory = z.infer<typeof PoiCategorySchema>;
export type PoiTag = z.infer<typeof PoiTagSchema>;
export type Poi = z.infer<typeof PoiSchema>;
export type ModerationRules = z.infer<typeof ModerationRulesSchema>;

export const POI_CATEGORY_LABELS: Record<PoiCategory, { label: string; icon: string }> = {
  food: { label: "Food", icon: "🍲" },
  stay: { label: "Stay", icon: "🛏️" },
  camp: { label: "Camping", icon: "⛺" },
  restroom: { label: "Restrooms", icon: "🚻" },
  water: { label: "Water", icon: "🚰" },
  event: { label: "Events", icon: "🎪" },
  viewpoint: { label: "Viewpoints", icon: "🌄" },
  medical: { label: "Medical", icon: "🏥" },
  atm: { label: "ATM", icon: "🏧" },
  fuel: { label: "Fuel", icon: "⛽" },
  guide: { label: "Local guides", icon: "🧭" },
};

export const POI_TAG_LABELS: Record<PoiTag, string> = {
  veg: "Veg",
  vegan: "Vegan",
  women_safe: "Women-friendly",
  family: "Family",
  wheelchair: "Wheelchair access",
  upi: "UPI",
  wifi: "Wi-Fi",
  free: "Free",
};
