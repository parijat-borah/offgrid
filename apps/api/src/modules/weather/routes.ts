import type { DailyForecast, PlaceWeather } from "@offgrid/core";
import { Router } from "express";
import { weatherAdapterFor, type WeatherAdapter } from "../../adapters/weather";
import type { Ctx } from "../../context";
import { HttpError, notFound } from "../../lib/errors";

const TTL_MS = 60 * 60_000;
const DAYS = 7;

/**
 * Forecasts are cached for an hour per place, so a busy weekend (or a classroom demo) costs a
 * handful of upstream calls, well inside Open-Meteo's free limits. Clients cache them too for offline use.
 */
export function weatherRoutes(ctx: Ctx): Router {
  const r = Router();
  const adapter: WeatherAdapter = ctx.weather ?? weatherAdapterFor(ctx.config.weatherMode);
  const cache = new Map<string, { at: number; data: PlaceWeather }>();
  const inflight = new Map<string, Promise<PlaceWeather>>();

  const load = async (placeId: string): Promise<PlaceWeather> => {
    const place = ctx.content.place(placeId);
    if (!place) throw notFound("Unknown place.");
    // Same coordinates, two elevations: the town you sleep in first, and the highest point.
    const series = async (label: string, elevationM: number) => ({
      label,
      elevationM,
      days: (await adapter.forecast({ lat: place.lat, lon: place.lon, elevationM, days: DAYS })) as DailyForecast[],
    });
    const [base, high] = await Promise.all([
      series(`${place.base_town} (${place.base_alt_m.toLocaleString("en-IN")} m)`, place.base_alt_m),
      series(`${place.name} (${place.max_altitude_m.toLocaleString("en-IN")} m)`, place.max_altitude_m),
    ]);
    return { placeId, source: adapter.name, fetchedAt: new Date().toISOString(), base, high };
  };

  r.get("/place/:id", async (req, res) => {
    const id = req.params.id;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) {
      res.json(hit.data);
      return;
    }
    // Collapse simultaneous requests for the same place into one upstream call.
    let p = inflight.get(id);
    if (!p) {
      p = load(id).finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    try {
      const data = await p;
      cache.set(id, { at: Date.now(), data });
      res.json(data);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Serve a stale forecast rather than nothing; the client shows its age.
      if (hit) {
        res.json(hit.data);
        return;
      }
      throw new HttpError(502, "WEATHER_UNAVAILABLE", "The weather service isn't responding. Try again in a few minutes.");
    }
  });

  return r;
}
