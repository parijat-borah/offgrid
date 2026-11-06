import { z } from "zod";
import { parseGameData, type GameData } from "../game/schemas";
import { parsePlannerData, type PlannerData } from "../pack";
import {
  HazardSchema,
  HospitalSchema,
  SafetyGuideSchema,
  SafetyRulesSchema,
  type Hazard,
  type Hospital,
  type SafetyGuide,
  type SafetyRules,
} from "../safety/schemas";
import { ModerationRulesSchema, PoiSchema, type ModerationRules, type Poi } from "./schemas";

/**
 * Everything the app needs to work with no network for one region: planner content,
 * game rules and every point of interest. The client stores it in IndexedDB.
 */
export interface RegionPack {
  version: string;
  planner: PlannerData;
  game: GameData;
  moderation: ModerationRules;
  pois: Poi[];
  /** Curated risks plus community reports that were active when the pack was built. */
  hazards: Hazard[];
  hospitals: Hospital[];
  safety: SafetyRules;
  guide: SafetyGuide;
}

const RawPackSchema = z.object({
  version: z.string(),
  region: z.unknown(),
  places: z.unknown(),
  passes: z.unknown(),
  rules: z.unknown(),
  packing: z.unknown(),
  fitnessQuiz: z.unknown(),
  photos: z.unknown().optional(),
  trails: z.unknown().optional(),
  badges: z.unknown(),
  mascots: z.unknown(),
  xp: z.unknown(),
  moderation: ModerationRulesSchema,
  pois: z.array(PoiSchema),
  hazards: z.array(HazardSchema),
  hospitals: z.array(HospitalSchema),
  safety: SafetyRulesSchema,
  guide: SafetyGuideSchema,
});

export type RawRegionPack = z.input<typeof RawPackSchema>;

export function parseRegionPack(raw: unknown): RegionPack {
  const r = RawPackSchema.parse(raw);
  const planner = parsePlannerData({
    region: r.region,
    places: r.places,
    passes: r.passes,
    rules: r.rules,
    packing: r.packing,
    fitnessQuiz: r.fitnessQuiz,
    photos: r.photos,
    trails: r.trails,
  });
  const game = parseGameData({ badges: r.badges, mascots: r.mascots, xp: r.xp });
  const seen = new Set<string>();
  const pois = r.pois.filter((p) => {
    // Skip duplicate ids (the same place from two sources) rather than failing the whole pack.
    if (seen.has(p.id) || p.region_id !== planner.region.id) return false;
    seen.add(p.id);
    return true;
  });
  return {
    version: r.version,
    planner,
    game,
    moderation: r.moderation,
    pois,
    hazards: r.hazards.filter((h) => h.region_id === planner.region.id),
    hospitals: r.hospitals,
    safety: r.safety,
    guide: r.guide,
  };
}
