import { DailyForecastSchema, type DailyForecast } from "@offgrid/core";

export interface ForecastQuery {
  lat: number;
  lon: number;
  /** Open-Meteo downscales temperature to this elevation, so a summit forecast isn't a valley one. */
  elevationM: number;
  days: number;
}

/** Every external service sits behind an interface with a mock, so the demo and tests never need the network. */
export interface WeatherAdapter {
  name: string;
  forecast(q: ForecastQuery): Promise<DailyForecast[]>;
}

const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "snowfall_sum",
  "precipitation_probability_max",
  "wind_gusts_10m_max",
  "uv_index_max",
] as const;

type Daily = Record<(typeof DAILY)[number], (number | null)[]> & { time: string[] };

/**
 * Open-Meteo: free for non-commercial use, no API key, global models with elevation downscaling.
 * A commercial launch needs their paid plan or an IMD feed behind this same interface.
 */
export class OpenMeteoAdapter implements WeatherAdapter {
  name = "open-meteo";
  constructor(
    private readonly baseUrl = "https://api.open-meteo.com/v1/forecast",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async forecast(q: ForecastQuery): Promise<DailyForecast[]> {
    const params = new URLSearchParams({
      latitude: q.lat.toFixed(4),
      longitude: q.lon.toFixed(4),
      elevation: String(Math.round(q.elevationM)),
      daily: DAILY.join(","),
      timezone: "Asia/Kolkata",
      forecast_days: String(q.days),
    });
    const res = await this.fetchImpl(`${this.baseUrl}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const { daily } = (await res.json()) as { daily: Daily };
    const out: DailyForecast[] = [];
    daily.time.forEach((date, i) => {
      const at = (k: (typeof DAILY)[number]) => daily[k][i] ?? null;
      const tMax = at("temperature_2m_max");
      const tMin = at("temperature_2m_min");
      if (tMax === null || tMin === null) return; // a day with no temperatures is no use to anyone
      out.push(
        DailyForecastSchema.parse({
          date,
          code: at("weather_code") ?? -1,
          tMaxC: tMax,
          tMinC: tMin,
          precipMm: at("precipitation_sum") ?? 0,
          snowCm: at("snowfall_sum") ?? 0,
          precipProb: at("precipitation_probability_max"),
          gustKmh: at("wind_gusts_10m_max") ?? 0,
          uvMax: at("uv_index_max"),
        }),
      );
    });
    return out;
  }
}

/**
 * MOCK. Deterministic, plausible mountain weather: colder with height (6.5 °C per km, the
 * standard lapse rate), one wet day and one stormy day a week. Used in tests and offline demos.
 */
export class MockWeatherAdapter implements WeatherAdapter {
  name = "mock";
  calls = 0;

  async forecast(q: ForecastQuery): Promise<DailyForecast[]> {
    this.calls++;
    const base = 26 - 6.5 * (q.elevationM / 1000);
    const pattern = [
      { code: 1, rain: 0, dt: 0 },
      { code: 3, rain: 2, dt: -1 },
      { code: 63, rain: 24, dt: -3 },
      { code: 2, rain: 0, dt: 0 },
      { code: 0, rain: 0, dt: 1 },
      { code: 95, rain: 9, dt: -2 },
      { code: 1, rain: 0, dt: 0 },
    ];
    const start = new Date();
    return Array.from({ length: q.days }, (_, i) => {
      const p = pattern[i % pattern.length]!;
      const tMax = Math.round((base + p.dt) * 10) / 10;
      const tMin = Math.round((tMax - 9) * 10) / 10;
      const snowing = tMax < 1 && p.rain > 0;
      return {
        date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
        code: snowing ? 73 : p.code,
        tMaxC: tMax,
        tMinC: tMin,
        precipMm: p.rain,
        snowCm: snowing ? Math.round(p.rain * 0.7) : 0,
        precipProb: p.rain > 0 ? 80 : 10,
        gustKmh: 20 + (q.elevationM > 3500 ? 35 : 10) + (p.code === 95 ? 25 : 0),
        uvMax: Math.min(11, 5 + q.elevationM / 1000),
      };
    });
  }
}

export function weatherAdapterFor(mode: string): WeatherAdapter {
  return mode === "mock" ? new MockWeatherAdapter() : new OpenMeteoAdapter();
}
