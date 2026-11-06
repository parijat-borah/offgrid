import {
  ChallengesSchema,
  type Challenges,
  MatchingRulesSchema,
  TravellerTypesSchema,
  type MatchingRules,
  type TravellerTypes,
  HazardSchema,
  HospitalSchema,
  SafetyGuideSchema,
  SafetyRulesSchema,
  type Hazard,
  type Hospital,
  type SafetyRules,
  ModerationRulesSchema,
  parseGameData,
  parsePlannerData,
  PoiSchema,
  type GameData,
  type ModerationRules,
  type Place,
  type PlannerData,
  type Poi,
} from "@offgrid/core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The same JSON the web app uses. The server loads it too, because XP and moderation run server-side. */
export interface Content {
  planner: PlannerData;
  game: GameData;
  moderation: ModerationRules;
  /** Curated and OpenStreetMap points. Verified community places are added from the DB when a pack is built. */
  pois: Poi[];
  /** Curated hazard zones. Community reports are added from the DB. */
  hazards: Hazard[];
  hospitals: Hospital[];
  safety: SafetyRules;
  travellerTypes: TravellerTypes;
  matching: MatchingRules;
  challenges: Challenges;
  /** The raw JSON files, passed through unchanged into region packs. */
  raw: Record<string, unknown>;
  place(id: string): Place | undefined;
  stateOf(place: Place): string;
}

const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));
const read = (rel: string): unknown => JSON.parse(readFileSync(DATA_DIR + rel, "utf8"));

export function loadContent(): Content {
  const raw = {
    region: read("regions/himachal/region.json"),
    places: read("regions/himachal/places.json"),
    passes: read("regions/himachal/passes.json"),
    rules: read("scoring-rules.json"),
    packing: read("packing-rules.json"),
    fitnessQuiz: read("fitness-quiz.json"),
    photos: read("regions/himachal/photos.json"),
    trails: read("regions/himachal/trails.json"),
    badges: read("badges.json"),
    mascots: read("mascots.json"),
    xp: read("xp-rules.json"),
    moderation: read("moderation-rules.json"),
    hospitals: read("regions/himachal/hospitals.json"),
    safety: read("safety-rules.json"),
    guide: read("safety-guide.json"),
  };
  const planner = parsePlannerData(raw);
  const game = parseGameData({ badges: raw.badges, mascots: raw.mascots, xp: raw.xp });
  const moderation = ModerationRulesSchema.parse(raw.moderation);
  const pois = z
    .array(PoiSchema)
    .parse([...(read("regions/himachal/pois.json") as unknown[]), ...(read("regions/himachal/pois.osm.json") as unknown[])]);
  const hazards = z.array(HazardSchema).parse(read("regions/himachal/hazards.json"));
  const hospitals = z.array(HospitalSchema).parse(raw.hospitals);
  const safety = SafetyRulesSchema.parse(raw.safety);
  SafetyGuideSchema.parse(raw.guide);
  const byId = new Map(planner.places.map((p) => [p.id, p]));
  return {
    planner,
    game,
    moderation,
    pois,
    hazards,
    hospitals,
    safety,
    travellerTypes: TravellerTypesSchema.parse(read("traveller-types.json")),
    matching: MatchingRulesSchema.parse(read("matching-rules.json")),
    challenges: ChallengesSchema.parse(read("challenges.json")),
    raw,
    place: (id) => byId.get(id),
    // One region today; with more packs this becomes a region_id → state lookup.
    stateOf: () => planner.region.state,
  };
}
