import { z } from "zod";
import { haversineKm } from "./geo";

/** A freely licensed photo of a place. Credit lines are a licence requirement, not decoration. */
export const PhotoSchema = z.object({
  file: z.string().min(1),
  url: z.url().refine((u) => u.startsWith("https://"), "photo URLs must be https"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  author: z.string().min(1),
  license: z.string().min(1),
  license_url: z.url().nullable(),
  source_url: z.url(),
  caption: z.string().nullable(),
});

export const PhotosFileSchema = z.object({
  source: z.string(),
  generated: z.string(),
  photos: z.record(z.string(), z.array(PhotoSchema)),
});

const Point = z.object({ name: z.string(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

/** A trek's walking line from OpenStreetMap: [lat, lon] pairs from trailhead to destination. */
export const TrailSchema = z.object({
  place_id: z.string(),
  start: Point,
  end: Point,
  length_km: z.number().positive(),
  /** Share of the line on paths and tracks rather than roads (0–1). */
  trail_share: z.number().min(0).max(1),
  way_names: z.array(z.string()),
  coords: z.array(z.tuple([z.number(), z.number()])).min(2),
});

export const TrailsFileSchema = z.object({
  source: z.string(),
  license: z.string(),
  attribution: z.string(),
  generated: z.string(),
  note: z.string(),
  trails: z.array(TrailSchema),
});

export type Photo = z.infer<typeof PhotoSchema>;
export type Trail = z.infer<typeof TrailSchema>;
export type TrailsFile = z.infer<typeof TrailsFileSchema>;

export interface PlaceMedia {
  photos: Record<string, Photo[]>;
  trails: Record<string, Trail>;
  /** Shown wherever a trail is drawn (ODbL attribution) together with the "check locally" note. */
  trailCredit: { attribution: string; license: string; note: string } | null;
}

export const EMPTY_MEDIA: PlaceMedia = { photos: {}, trails: {}, trailCredit: null };

export function toPlaceMedia(photos: z.infer<typeof PhotosFileSchema> | undefined, trails: TrailsFile | undefined): PlaceMedia {
  return {
    photos: photos?.photos ?? {},
    trails: Object.fromEntries((trails?.trails ?? []).map((t) => [t.place_id, t])),
    trailCredit: trails ? { attribution: trails.attribution, license: trails.license, note: trails.note } : null,
  };
}

/** Problems a content editor should fix: media for unknown places, or trails that wander off. */
export function validateMedia(media: PlaceMedia, places: { id: string; lat: number; lon: number }[], bbox: [number, number, number, number]): string[] {
  const issues: string[] = [];
  const byId = new Map(places.map((p) => [p.id, p]));
  for (const id of Object.keys(media.photos)) if (!byId.has(id)) issues.push(`photos.${id}: no such place`);
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (const [id, t] of Object.entries(media.trails)) {
    const place = byId.get(id);
    if (!place) {
      issues.push(`trails.${id}: no such place`);
      continue;
    }
    if (t.coords.some(([lat, lon]) => lon < minLon || lon > maxLon || lat < minLat || lat > maxLat)) issues.push(`trails.${id}: line leaves the region`);
    // The line must reach its named destination, and that destination must belong to this place. (A place
    // can span two spots, like "Jibhi & Serolsar Lake", so the destination may sit a few km from the pin.)
    const [lat, lon] = t.coords.at(-1)!;
    if (haversineKm({ lat, lon }, t.end) > 1) issues.push(`trails.${id}: line stops more than 1 km short of ${t.end.name}`);
    if (haversineKm(t.end, place) > 10) issues.push(`trails.${id}: ${t.end.name} is more than 10 km from ${id}`);
  }
  return issues;
}

/** Distance along a trail, for "x km from the trailhead" style labels. */
export function trailLengthKm(coords: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm({ lat: coords[i - 1]![0], lon: coords[i - 1]![1] }, { lat: coords[i]![0], lon: coords[i]![1] });
  return km;
}
