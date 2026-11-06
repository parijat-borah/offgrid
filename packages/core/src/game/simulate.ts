import type { TrackPoint } from "../geo";
import type { Place } from "../schemas";

/**
 * DEMO ONLY. Builds a believable out-and-back walk to a place so a trip can be shown end to
 * end without real GPS. The UI labels this "Simulated GPS"; it's also used by tests.
 */
export function simulateTrack(place: Place, endTs: number = Date.now(), points = 14): TrackPoint[] {
  const hours = place.days_min * 5;
  const start = endTs - hours * 3_600_000;
  // Start about 4 km south-west of the destination, walk in, come back out.
  const from = { lat: place.lat - 0.025, lon: place.lon - 0.025 };
  const half = Math.floor(points / 2);
  const out: TrackPoint[] = [];
  for (let i = 0; i < points; i++) {
    const f = i <= half ? i / half : (points - 1 - i) / (points - 1 - half);
    out.push({
      ts: Math.round(start + (i / (points - 1)) * (endTs - start)),
      lat: from.lat + (place.lat - from.lat) * f,
      lon: from.lon + (place.lon - from.lon) * f,
      alt: Math.round(place.base_alt_m + (place.max_altitude_m - place.base_alt_m) * f),
      accuracy: 15,
    });
  }
  return out;
}
