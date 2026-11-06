export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackPoint extends LatLon {
  /** Unix epoch milliseconds. */
  ts: number;
  alt?: number | null;
  accuracy?: number | null;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. Accurate to well under 1% at trekking scales. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function trackDistanceKm(points: TrackPoint[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  return km;
}

/** Sum of climbs, ignoring wobbles under `noiseM` (GPS altitude is noisy). */
export function elevationGainM(points: TrackPoint[], noiseM = 10): number {
  let gain = 0;
  let ref: number | null = null;
  for (const p of points) {
    if (p.alt == null) continue;
    if (ref === null) {
      ref = p.alt;
      continue;
    }
    if (p.alt - ref > noiseM) {
      gain += p.alt - ref;
      ref = p.alt;
    } else if (ref - p.alt > noiseM) {
      ref = p.alt;
    }
  }
  return Math.round(gain);
}

/** Evenly thin a track to at most `max` points, always keeping the first and last. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points.slice(0, Math.max(max, 0));
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}
