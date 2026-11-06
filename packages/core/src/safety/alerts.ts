import { HAZARD_LABELS } from "../labels";
import type { Place } from "../schemas";
import { hazardsForPlace } from "./hazards";
import type { DailyForecast, Hazard, SafetyRules } from "./schemas";
import { forecastWarnings, groupWarnings, type WarningKind } from "./weather";

const KIND_TITLE: Record<WarningKind, string> = {
  storm: "Thunderstorms",
  rain: "Rain",
  snow: "Snow",
  cold: "Hard frost",
  wind: "Strong wind",
  uv: "Strong sun",
};

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export interface TripAlert {
  /** Stable across refreshes, so "already seen" tracking and notifications don't repeat. */
  id: string;
  tripId: string;
  placeId: string;
  kind: "weather" | "hazard";
  severity: 1 | 2 | 3;
  title: string;
  detail: string;
  date: string | null;
}

export interface AlertInput {
  tripId: string;
  place: Place;
  /** Forecasts at the base and at the highest point. Null when we have none (offline, never fetched). */
  base: DailyForecast[] | null;
  high: DailyForecast[] | null;
  hazards: Hazard[];
  now: Date;
  month: number;
}

/**
 * Everything worth telling a traveller about one trip, worst first. This runs on the phone
 * from cached data, so alerts still work with no signal; they're only as fresh as the last sync.
 */
export function tripAlerts(x: AlertInput, rules: SafetyRules): TripAlert[] {
  const out: TripAlert[] = [];
  const { place } = x;
  const fmt = (n: number) => n.toLocaleString("en-IN");

  const points = [
    { at: "base", days: x.base, point: { label: place.base_town, elevationM: place.base_alt_m } },
    { at: "high", days: x.high, point: { label: `${place.name} (${fmt(place.max_altitude_m)} m)`, elevationM: place.max_altitude_m } },
  ];
  for (const { at, days, point } of points) {
    if (!days) continue;
    // One alert per kind of weather per point (e.g. "Hard frost, 6 days"), not one per day.
    for (const g of groupWarnings(forecastWarnings(days, point, place, rules))) {
      if (g.severity < 2) continue; // UV tips belong on the forecast, not in alerts
      const when = g.dates.length === 1 ? `on ${shortDate(g.dates[0]!)}` : `${shortDate(g.dates[0]!)}–${shortDate(g.dates.at(-1)!)} (${g.dates.length} days)`;
      out.push({
        id: `w:${x.tripId}:${g.kind}:${at}:${g.dates[0]}`,
        tripId: x.tripId,
        placeId: place.id,
        kind: "weather",
        severity: g.severity,
        title: `${KIND_TITLE[g.kind]} ${when}`,
        detail: g.text,
        date: g.dates[0]!,
      });
    }
  }

  for (const { hazard } of hazardsForPlace(place, x.hazards, x.now, x.month, rules.alert_radius_km)) {
    out.push({
      id: `h:${x.tripId}:${hazard.id}`,
      tripId: x.tripId,
      placeId: place.id,
      kind: "hazard",
      severity: hazard.severity,
      title: `${HAZARD_LABELS[hazard.kind]}: ${hazard.title}`,
      detail: hazard.source === "community" ? `${hazard.description} (Traveller report, ${hazard.confirmations ?? 0} confirmations.)` : hazard.description,
      date: null,
    });
  }

  return out.sort((a, b) => b.severity - a.severity || (a.date ?? "9").localeCompare(b.date ?? "9"));
}
