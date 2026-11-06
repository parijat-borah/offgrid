import { elevationGainM, haversineKm, trackDistanceKm, type TrackPoint } from "../geo";
import type { Place } from "../schemas";
import type { Validation, XpRules } from "./schemas";

export interface TrackCheck {
  validation: Validation;
  /** Plain-language explanation shown to the traveller, so a lower grade never feels arbitrary. */
  reasons: string[];
  reachedPlace: boolean;
  distanceKm: number;
  elevationGainM: number;
  /** True when the track looks tampered with (teleports, future timestamps). */
  suspicious: boolean;
}

/**
 * Grades a GPS track against the planned place. This is a plausibility check, not proof:
 * GPS can be spoofed, so caps on manual entries and community reports back it up (see DECISIONS.md).
 */
export function checkTrack(place: Place, rawPoints: TrackPoint[], rules: XpRules, now: number = Date.now()): TrackCheck {
  const p = rules.plausibility;
  const reasons: string[] = [];
  const points = [...rawPoints].sort((a, b) => a.ts - b.ts);

  const fallback = { distanceKm: place.distance_km, elevationGainM: place.elevation_gain_m };
  if (points.length === 0) {
    return { validation: "manual", reasons: ["No GPS track was recorded."], reachedPlace: false, suspicious: false, ...fallback };
  }

  let suspicious = false;
  if (points.some((pt) => pt.ts > now + p.future_tolerance_min * 60_000)) {
    suspicious = true;
    reasons.push("Some GPS points have timestamps in the future.");
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const hours = (b.ts - a.ts) / 3_600_000;
    const km = haversineKm(a, b);
    // Two points at the same instant but far apart, or faster than any road vehicle here.
    if ((hours <= 0 && km > 0.5) || (hours > 0 && km / hours > p.max_speed_kmh)) {
      suspicious = true;
      reasons.push(`The track jumps ${km.toFixed(1)} km faster than ${p.max_speed_kmh} km/h.`);
      break;
    }
  }

  const closestKm = Math.min(...points.map((pt) => haversineKm(pt, place)));
  const reachedPlace = closestKm <= p.reach_radius_km;
  const hours = (points.at(-1)!.ts - points[0]!.ts) / 3_600_000;
  const minHours = place.days_min * p.min_hours_per_plan_day;
  const enoughPoints = points.length >= p.min_points;
  const longEnough = hours >= minHours;

  const distanceKm = Math.round(trackDistanceKm(points) * 10) / 10;
  const gain = elevationGainM(points);
  const measured = {
    distanceKm: distanceKm > 0 ? distanceKm : place.distance_km,
    elevationGainM: gain > 0 ? gain : place.elevation_gain_m,
  };

  if (suspicious) {
    return { validation: "manual", reasons, reachedPlace, suspicious, ...measured };
  }
  if (!reachedPlace) {
    reasons.push(`The closest GPS point was ${closestKm.toFixed(1)} km from ${place.name} (needs to be within ${p.reach_radius_km} km).`);
    return { validation: "manual", reasons, reachedPlace, suspicious, ...measured };
  }

  reasons.push(`Your track reached ${place.name}.`);
  if (!enoughPoints) reasons.push(`Only ${points.length} GPS points were recorded (${p.min_points} needed for full credit).`);
  if (!longEnough) reasons.push(`The track covers ${hours.toFixed(1)} h; this trip normally takes at least ${minHours} h.`);

  return {
    validation: enoughPoints && longEnough ? "verified" : "partial",
    reasons,
    reachedPlace,
    suspicious,
    ...measured,
  };
}
