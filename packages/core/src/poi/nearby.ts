import { haversineKm, type LatLon } from "../geo";
import { monthName } from "../labels";
import { openStatus, type OpenStatus } from "./hours";
import type { Poi, PoiCategory, PoiTag } from "./schemas";

export interface NearbyQuery {
  center: LatLon;
  radiusKm: number;
  /** If given, distance is measured to this polyline (e.g. a trip's route) instead of to `center`. */
  route?: LatLon[] | undefined;
  categories?: PoiCategory[];
  /** Places priced above this are hidden. Places with no price data are kept and labelled. */
  maxPriceBand?: 1 | 2 | 3 | undefined;
  /** Every listed tag must be present. */
  tags?: PoiTag[];
  openNow?: boolean;
  limit?: number;
}

export interface NearbyResult {
  poi: Poi;
  distanceKm: number;
  status: OpenStatus;
}

/** Equirectangular projection around `p`: accurate to well under 1% over a few tens of km. */
function project(p: LatLon, origin: LatLon): [number, number] {
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  return [(p.lon - origin.lon) * kx, (p.lat - origin.lat) * 110.57];
}

export function distanceToRouteKm(p: LatLon, route: LatLon[]): number {
  if (route.length === 0) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return haversineKm(p, route[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = project(route[i - 1]!, p);
    const [bx, by] = project(route[i]!, p);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Status for events (by month) and seasonal community places, falling back to opening hours. */
export function poiStatus(poi: Poi, now: Date, utcOffsetMinutes: number): OpenStatus {
  const month = new Date(now.getTime() + utcOffsetMinutes * 60_000).getUTCMonth() + 1;
  if (poi.category === "event") {
    const months = poi.event_months ?? [];
    if (months.includes(month)) return { state: "open", label: "Happening this month" };
    const next = [...Array(12).keys()].map((i) => ((month - 1 + i + 1) % 12) + 1).find((m) => months.includes(m));
    return { state: "closed", label: next ? `Usually in ${monthName(next)}` : "Dates unknown" };
  }
  if (poi.seasonality?.length && !poi.seasonality.includes(month)) {
    return { state: "closed", label: `Out of season in ${monthName(month)}` };
  }
  return openStatus(poi.hours, now, utcOffsetMinutes);
}

export function findNearby(pois: Poi[], q: NearbyQuery, now: Date, utcOffsetMinutes: number): NearbyResult[] {
  const cats = q.categories?.length ? new Set(q.categories) : null;
  const out: NearbyResult[] = [];
  for (const poi of pois) {
    if (cats && !cats.has(poi.category)) continue;
    if (q.maxPriceBand && poi.price_band !== null && poi.price_band > q.maxPriceBand) continue;
    if (q.tags?.some((t) => !poi.tags.includes(t))) continue;
    const distanceKm = q.route?.length ? distanceToRouteKm(poi, q.route) : haversineKm(q.center, poi);
    if (distanceKm > q.radiusKm) continue;
    const status = poiStatus(poi, now, utcOffsetMinutes);
    if (q.openNow && status.state !== "open") continue;
    out.push({ poi, distanceKm, status });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm || a.poi.name.localeCompare(b.poi.name));
  return out.slice(0, q.limit ?? 150);
}
