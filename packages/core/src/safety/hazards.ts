import { haversineKm, type LatLon } from "../geo";
import type { Place } from "../schemas";
import type { Hazard, Hospital } from "./schemas";

/** Expired community reports and out-of-season curated risks are hidden. */
export function isActive(h: Hazard, now: Date, month: number): boolean {
  if (h.expires_at && Date.parse(h.expires_at) <= now.getTime()) return false;
  if (h.months && !h.months.includes(month)) return false;
  return true;
}

/** Distance from a point to the edge of the hazard area (0 when inside it). */
export function distanceToHazardKm(p: LatLon, h: Hazard): number {
  return Math.max(0, haversineKm(p, h) - h.radius_m / 1000);
}

export interface HazardHit {
  hazard: Hazard;
  distanceKm: number;
}

/** Hazards that apply to a place: linked to it in the data, or within `radiusKm` of it. Worst first. */
export function hazardsForPlace(place: Place, hazards: Hazard[], now: Date, month: number, radiusKm: number): HazardHit[] {
  return hazards
    .filter((h) => isActive(h, now, month))
    .map((h) => ({ hazard: h, distanceKm: distanceToHazardKm(place, h) }))
    .filter((x) => x.hazard.place_ids.includes(place.id) || x.distanceKm <= radiusKm)
    .sort((a, b) => b.hazard.severity - a.hazard.severity || a.distanceKm - b.distanceKm);
}

export function hazardsNear(p: LatLon, hazards: Hazard[], now: Date, month: number, radiusKm: number): HazardHit[] {
  return hazards
    .filter((h) => isActive(h, now, month))
    .map((h) => ({ hazard: h, distanceKm: distanceToHazardKm(p, h) }))
    .filter((x) => x.distanceKm <= radiusKm)
    .sort((a, b) => b.hazard.severity - a.hazard.severity || a.distanceKm - b.distanceKm);
}

/**
 * Nearest hospitals, preferring ones with 24-hour emergency care. A clinic 5 km away that
 * closes at 5 pm is less useful at night than a district hospital 25 km away, so both are shown.
 */
export function nearestHospitals(p: LatLon, hospitals: Hospital[], n = 2): { hospital: Hospital; distanceKm: number }[] {
  const ranked = hospitals.map((h) => ({ hospital: h, distanceKm: haversineKm(p, h) })).sort((a, b) => a.distanceKm - b.distanceKm);
  const out = ranked.slice(0, n);
  if (!out.some((x) => x.hospital.emergency_24h)) {
    const e = ranked.find((x) => x.hospital.emergency_24h);
    if (e) out.push(e);
  }
  return out;
}
