import type { Place } from "../schemas";
import type { BadgeMetric, Validation } from "./schemas";

export interface CompletedTrip {
  placeId: string;
  validation: Validation;
  /** Measured distance; falls back to the place's distance when no track exists. */
  distanceKm: number | null;
  actualSpendPp: number | null;
  completedAt: string;
}

export interface TravellerStats {
  tripsCompleted: number;
  treksCompleted: number;
  verifiedTrips: number;
  kmTotal: number;
  elevationGainM: number;
  highestAltitudeM: number;
  statesVisited: string[];
  districtsVisited: string[];
  moneySpent: number;
  /** Badge metrics. Computed only from GPS-verified or partly verified trips. */
  metrics: Record<BadgeMetric, number>;
}

/** A trek is a walking trip of at least 8 km, so a drive-up lake doesn't count. */
export function isTrek(place: Place): boolean {
  return ["trek", "pass", "lake"].includes(place.type) && place.distance_km >= 8;
}

/** Districts like "Kullu / Lahaul" count for each part. */
const districtsOf = (p: Place) => p.district.split(/\s*\/\s*/).map((d) => d.replace(/\s*\(.*\)$/, "").trim());

export function computeStats(
  trips: CompletedTrip[],
  places: Place[],
  stateOf: (place: Place) => string,
  contributionsVerified = 0,
): TravellerStats {
  const byId = new Map(places.map((p) => [p.id, p]));
  const resolved = trips.flatMap((t) => {
    const place = byId.get(t.placeId);
    return place ? [{ trip: t, place }] : [];
  });
  const counted = resolved.filter((r) => r.trip.validation !== "manual");

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const km = (r: (typeof resolved)[number]) => r.trip.distanceKm ?? r.place.distance_km;
  const spends = counted.map((r) => r.trip.actualSpendPp).filter((n): n is number => n !== null);

  return {
    tripsCompleted: resolved.length,
    treksCompleted: resolved.filter((r) => isTrek(r.place)).length,
    verifiedTrips: resolved.filter((r) => r.trip.validation === "verified").length,
    kmTotal: Math.round(sum(resolved.map(km)) * 10) / 10,
    elevationGainM: sum(resolved.map((r) => r.place.elevation_gain_m)),
    highestAltitudeM: Math.max(0, ...resolved.map((r) => r.place.max_altitude_m)),
    statesVisited: [...new Set(resolved.map((r) => stateOf(r.place)))].sort(),
    districtsVisited: [...new Set(resolved.flatMap((r) => districtsOf(r.place)))].sort(),
    moneySpent: sum(resolved.map((r) => r.trip.actualSpendPp ?? 0)),
    metrics: {
      trips_completed: counted.length,
      treks_completed: counted.filter((r) => isTrek(r.place)).length,
      verified_trips: counted.filter((r) => r.trip.validation === "verified").length,
      // No qualifying spend yet means "infinitely expensive", so a "<" rule can't fire on nothing.
      cheapest_trip_pp: spends.length ? Math.min(...spends) : Number.POSITIVE_INFINITY,
      max_altitude_m: Math.max(0, ...counted.map((r) => r.place.max_altitude_m)),
      passes_crossed: counted.filter((r) => r.place.type === "pass").length,
      districts_visited: new Set(counted.flatMap((r) => districtsOf(r.place))).size,
      contributions_verified: contributionsVerified,
      km_total: Math.round(sum(counted.map(km)) * 10) / 10,
    },
  };
}
