import { z } from "zod";
import { PhotosFileSchema, toPlaceMedia, TrailsFileSchema, validateMedia, type PlaceMedia } from "./media";
import {
  FitnessQuizSchema,
  PackingRuleSchema,
  PassSchema,
  PlaceSchema,
  RegionSchema,
  ScoringRulesSchema,
  type FitnessQuiz,
  type PackingRule,
  type Pass,
  type Place,
  type Region,
  type ScoringRules,
} from "./schemas";

/** Everything the planner needs. One region pack plus the global rule files. */
export interface PlannerData {
  region: Region;
  places: Place[];
  passes: Pass[];
  rules: ScoringRules;
  packing: PackingRule[];
  fitnessQuiz: FitnessQuiz;
  /** Photos and trail lines per place. Optional data: a region without them still plans fine. */
  media: PlaceMedia;
}

export class PackError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Data pack is invalid:\n- ${issues.slice(0, 20).join("\n- ")}`);
    this.name = "PackError";
  }
}

const RawPackSchema = z.object({
  region: RegionSchema,
  places: z.array(PlaceSchema).min(1),
  passes: z.array(PassSchema),
  rules: ScoringRulesSchema,
  packing: z.array(PackingRuleSchema),
  fitnessQuiz: FitnessQuizSchema,
  photos: PhotosFileSchema.optional(),
  trails: TrailsFileSchema.optional(),
});

/** Parse untrusted JSON into PlannerData. Throws PackError listing every problem. */
export function parsePlannerData(raw: unknown): PlannerData {
  const parsed = RawPackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PackError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const { photos, trails, ...rest } = parsed.data;
  const data: PlannerData = { ...rest, media: toPlaceMedia(photos, trails) };
  const issues = validatePack(data);
  if (issues.length > 0) throw new PackError(issues);
  return data;
}

/**
 * Cross-field and referential checks that a per-object schema can't express.
 * Returns human-readable issues so content editors can fix data without reading code.
 */
export function validatePack(data: PlannerData): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const passIds = new Set(data.passes.map((p) => p.id));

  const w = data.rules.weights;
  const weightSum = w.vibe + w.budget + w.days + w.season + w.novelty;
  if (weightSum !== 100) issues.push(`scoring-rules: weights must sum to 100 (got ${weightSum})`);

  for (const place of data.places) {
    const at = `places.${place.id}`;
    if (ids.has(place.id)) issues.push(`${at}: duplicate id`);
    ids.add(place.id);

    if (place.region_id !== data.region.id) issues.push(`${at}: region_id "${place.region_id}" ≠ pack region "${data.region.id}"`);
    if (place.days_max < place.days_min) issues.push(`${at}: days_max < days_min`);
    if (place.plan.length !== place.days_min) {
      issues.push(`${at}: plan has ${place.plan.length} days but days_min is ${place.days_min}`);
    }
    if (place.days_min + place.extras.length < place.days_max) {
      issues.push(`${at}: needs at least ${place.days_max - place.days_min} extras to fill days_max`);
    }
    for (const [i, extra] of place.extras.entries()) {
      if (extra.after_day >= place.plan.length) {
        issues.push(`${at}.extras[${i}]: after_day must be before the final (return) day`);
      }
    }

    const [minLon, minLat, maxLon, maxLat] = data.region.bbox;
    if (place.lon < minLon || place.lon > maxLon || place.lat < minLat || place.lat > maxLat) {
      issues.push(`${at}: coordinates fall outside the region bbox`);
    }

    // Every month must be classified exactly once, so the planner never guesses.
    const seen = new Map<number, number>();
    const mark = (m: number) => seen.set(m, (seen.get(m) ?? 0) + 1);
    place.season.good.forEach(mark);
    place.season.risky.forEach((wdw) => wdw.months.forEach(mark));
    place.season.closed.forEach((wdw) => wdw.months.forEach(mark));
    for (let m = 1; m <= 12; m++) {
      const count = seen.get(m) ?? 0;
      if (count === 0) issues.push(`${at}: month ${m} is not classified as good, risky or closed`);
      if (count > 1) issues.push(`${at}: month ${m} is classified more than once`);
    }

    for (const pass of place.access_via) {
      if (!passIds.has(pass)) issues.push(`${at}: unknown access pass "${pass}"`);
    }
  }

  const ruleIds = new Set<string>();
  for (const rule of data.packing) {
    if (ruleIds.has(rule.id)) issues.push(`packing.${rule.id}: duplicate id`);
    ruleIds.add(rule.id);
  }

  const quiz = data.fitnessQuiz;
  const maxPoints = quiz.questions.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.points)), 0);
  const sortedBands = [...quiz.bands].sort((a, b) => a.max_points - b.max_points);
  if ((sortedBands.at(-1)?.max_points ?? -1) < maxPoints) {
    issues.push(`fitness-quiz: highest band must cover ${maxPoints} points`);
  }

  issues.push(...validateMedia(data.media, data.places, data.region.bbox));

  return issues;
}
