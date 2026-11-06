import type { PlaceWeather } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";
import { db } from "./db";

const FRESH_MS = 60 * 60_000;

export type ForecastState =
  | { status: "loading" }
  | { status: "none"; error: string | null }
  | { status: "ready"; data: PlaceWeather; savedAt: number; refreshing: boolean; error: string | null };

/** Fetch a place's forecast and save it; returns null if offline or the service is down. */
export async function fetchForecast(placeId: string): Promise<PlaceWeather | null> {
  try {
    const data = await api<PlaceWeather>(`/weather/place/${placeId}`);
    await db.weather.put({ placeId, data, savedAt: Date.now() }).catch(() => undefined);
    return data;
  } catch {
    return null;
  }
}

export async function cachedForecast(placeId: string): Promise<{ data: PlaceWeather; savedAt: number } | null> {
  return (await db.weather.get(placeId).catch(() => undefined)) ?? null;
}

/** Show the saved forecast at once, then refresh it if it's over an hour old and we're online. */
export function useForecast(placeId: string) {
  const [state, setState] = useState<ForecastState>({ status: "loading" });

  const refresh = useCallback(
    async (force = false) => {
      const cached = await cachedForecast(placeId);
      if (cached) setState({ status: "ready", data: cached.data, savedAt: cached.savedAt, refreshing: false, error: null });
      if (!navigator.onLine || (!force && cached && Date.now() - cached.savedAt < FRESH_MS)) {
        if (!cached) setState({ status: "none", error: null });
        return;
      }
      if (cached) setState({ status: "ready", data: cached.data, savedAt: cached.savedAt, refreshing: true, error: null });
      try {
        const data = await api<PlaceWeather>(`/weather/place/${placeId}`);
        const savedAt = Date.now();
        await db.weather.put({ placeId, data, savedAt }).catch(() => undefined);
        setState({ status: "ready", data, savedAt, refreshing: false, error: null });
      } catch (e) {
        setState(cached ? { status: "ready", data: cached.data, savedAt: cached.savedAt, refreshing: false, error: errorMessage(e) } : { status: "none", error: errorMessage(e) });
      }
    },
    [placeId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh: () => refresh(true) };
}

export function ageLabel(savedAt: number, now = Date.now()): string {
  const min = Math.round((now - savedAt) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
