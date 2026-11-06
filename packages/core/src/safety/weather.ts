import { formatNumber } from "../labels";
import type { Place } from "../schemas";
import type { DailyForecast, SafetyRules } from "./schemas";

/** WMO weather interpretation codes (used by Open-Meteo and most national services). */
const WMO: [number[], string, string][] = [
  [[0], "Clear", "☀️"],
  [[1, 2], "Partly cloudy", "🌤️"],
  [[3], "Overcast", "☁️"],
  [[45, 48], "Fog", "🌫️"],
  [[51, 53, 55, 56, 57], "Drizzle", "🌦️"],
  [[61, 63, 80, 81], "Rain", "🌧️"],
  [[65, 82], "Heavy rain", "🌧️"],
  [[66, 67], "Freezing rain", "🌨️"],
  [[71, 73, 77, 85], "Snow", "🌨️"],
  [[75, 86], "Heavy snow", "❄️"],
  [[95], "Thunderstorm", "⛈️"],
  [[96, 99], "Thunderstorm with hail", "⛈️"],
];

export function weatherLabel(code: number): { label: string; icon: string } {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { label: hit[1], icon: hit[2] } : { label: "Unknown", icon: "❔" };
}

export type WarningKind = "rain" | "snow" | "storm" | "cold" | "wind" | "uv";

export interface WeatherWarning {
  date: string;
  kind: WarningKind;
  severity: 1 | 2 | 3;
  /** The measured quantity (mm, cm, °C, km/h or UV index), used to find the worst day. */
  value: number;
  text: string;
}

export interface ForecastPoint {
  /** e.g. "Triund (2,850 m)". */
  label: string;
  elevationM: number;
}

/**
 * Turn raw forecast numbers into plain advice tied to the trip: a rain day matters more on a
 * route with river crossings, and frost matters at the altitude you'll sleep at, not the town below.
 */
export function forecastWarnings(days: DailyForecast[], point: ForecastPoint, place: Place | null, rules: SafetyRules): WeatherWarning[] {
  const w = rules.weather;
  const out: WeatherWarning[] = [];
  const crossings = place?.hazards.includes("river_crossing") ?? false;
  const slides = place?.hazards.includes("landslide") ?? false;
  const exposed = place?.hazards.includes("lightning") ?? false;

  for (const d of days) {
    const at = point.label;
    if (w.storm_codes.includes(d.code)) {
      out.push({
        date: d.date,
        kind: "storm",
        severity: exposed ? 3 : 2,
        value: d.precipMm,
        text: `Thunderstorms at ${at}. ${exposed ? "This route is exposed: be off the ridge by noon." : "Start early and be under cover by early afternoon."}`,
      });
    }
    if (d.precipMm >= w.rain_mm && d.snowCm < w.snow_cm) {
      const heavy = d.precipMm >= w.heavy_rain_mm;
      const extra = [crossings ? "streams will be high; cross early or wait a day" : null, slides ? "watch for slides on the approach road" : null]
        .filter(Boolean)
        .join("; ");
      out.push({
        date: d.date,
        kind: "rain",
        severity: heavy ? 3 : 2,
        value: d.precipMm,
        text: `${heavy ? "Heavy rain" : "Rain"} (${Math.round(d.precipMm)} mm) at ${at}${extra ? `: ${extra}` : ""}.`,
      });
    }
    if (d.snowCm >= w.snow_cm) {
      const heavy = d.snowCm >= w.heavy_snow_cm;
      out.push({
        date: d.date,
        kind: "snow",
        severity: heavy ? 3 : 2,
        value: d.snowCm,
        text: `${heavy ? "Heavy snow" : "Snow"} (${Math.round(d.snowCm)} cm) at ${at}. ${heavy ? "Trails and passes may close; check with locals." : "Trails get slippery; microspikes help."}`,
      });
    }
    if (d.tMinC <= w.frost_c) {
      const severe = d.tMinC <= w.severe_cold_c;
      out.push({
        date: d.date,
        kind: "cold",
        severity: severe ? 3 : 2,
        value: d.tMinC,
        text: `Night low of ${formatTemp(d.tMinC)} at ${at}. ${severe ? "Severe cold: a −15 °C sleeping bag and full layers are essential." : "Pack thermals, a down jacket and a warm sleeping bag."}`,
      });
    }
    if (d.gustKmh >= w.gust_kmh) {
      const severe = d.gustKmh >= w.severe_gust_kmh;
      out.push({
        date: d.date,
        kind: "wind",
        severity: severe ? 3 : 2,
        value: d.gustKmh,
        text: `Gusts up to ${Math.round(d.gustKmh)} km/h at ${at}. ${severe ? "Dangerous on passes and ridges; wait it out." : "Pitch tents in a sheltered spot."}`,
      });
    }
    if (d.uvMax !== null && d.uvMax >= w.uv_index && point.elevationM >= 2500) {
      out.push({
        date: d.date,
        kind: "uv",
        severity: 1,
        value: d.uvMax,
        text: `Very strong sun (UV ${Math.round(d.uvMax)}) at ${formatNumber(point.elevationM)} m. Wear sunglasses and SPF 50, especially on snow.`,
      });
    }
  }
  return out;
}

export interface WarningGroup {
  kind: WarningKind;
  severity: 1 | 2 | 3;
  value: number;
  dates: string[];
  /** Advice for the worst day in the group. */
  text: string;
}

/**
 * One entry per kind of warning, carrying the worst day's advice. Seven separate "cold night"
 * lines bury the one thunderstorm that actually changes the plan.
 */
export function groupWarnings(warnings: WeatherWarning[]): WarningGroup[] {
  const groups = new Map<WarningKind, WarningGroup>();
  for (const w of warnings) {
    const g = groups.get(w.kind);
    if (!g) groups.set(w.kind, { kind: w.kind, severity: w.severity, value: w.value, dates: [w.date], text: w.text });
    else {
      g.dates.push(w.date);
      // Worse means higher severity, then the more extreme reading (colder for cold, more for the rest).
      const more = w.kind === "cold" ? w.value < g.value : w.value > g.value;
      if (w.severity > g.severity || (w.severity === g.severity && more)) {
        g.severity = w.severity;
        g.value = w.value;
        g.text = w.text;
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.severity - a.severity);
}

/** "−12 °C" with a real minus sign, which screen readers say as "minus". */
export function formatTemp(c: number): string {
  const r = Math.round(c);
  return `${r < 0 ? "−" : ""}${Math.abs(r)} °C`;
}

/** Worst severity per date, for colouring a 7-day strip. */
export function worstByDate(warnings: WeatherWarning[]): Map<string, 1 | 2 | 3> {
  const m = new Map<string, 1 | 2 | 3>();
  for (const w of warnings) m.set(w.date, Math.max(m.get(w.date) ?? 0, w.severity) as 1 | 2 | 3);
  return m;
}
