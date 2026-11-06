import { tripAlerts, type PlaceWeather, type RegionPack, type TripAlert, type TripDto } from "@offgrid/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { readJSON, writeJSON } from "./storage";
import { cachedForecast, fetchForecast } from "./weather";

const TRIPS_KEY = "offgrid.alerts.trips.v1";
const SEEN_KEY = "offgrid.alerts.seen.v1";
const NOTIFIED_KEY = "offgrid.alerts.notified.v1";
const FORECAST_FRESH_MS = 60 * 60_000;

const readSet = (k: string) => new Set(((readJSON(k) as string[] | null) ?? []).filter((x) => typeof x === "string"));

/** Weather is only relevant to a trip that's under way or starts within the 7-day forecast window. */
function weatherRelevant(t: TripDto, now: Date): boolean {
  if (t.status === "active") return true;
  if (!t.startDate) return false;
  const days = (Date.parse(t.startDate) - now.getTime()) / 86_400_000;
  return days <= 7 && days >= -t.plannerInput.days;
}

async function notify(alert: TripAlert, placeName: string) {
  const title = `⚠ ${placeName}: ${alert.title}`;
  const options = { body: alert.detail, tag: alert.id, icon: "/icon.svg" };
  try {
    // A service-worker notification survives the tab being in the background; fall back to a page one.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* notifications blocked or unsupported: the in-app list still shows it */
  }
}

/**
 * Alerts for the traveller's planned and active trips, computed on the phone from the region pack
 * and saved forecasts, so they still work with no signal (as fresh as the last sync).
 */
export function useTripAlerts(pack: RegionPack | null, authed: boolean) {
  const [trips, setTrips] = useState<TripDto[]>(() => ((readJSON(TRIPS_KEY) as TripDto[] | null) ?? []).filter((t) => t && typeof t.id === "string"));
  const [forecasts, setForecasts] = useState<Map<string, PlaceWeather>>(new Map());
  const [seen, setSeen] = useState(() => readSet(SEEN_KEY));
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => ("Notification" in window ? Notification.permission : "unsupported"));

  const tripsRef = useRef(trips);
  tripsRef.current = trips;

  const sync = useCallback(async () => {
    let current = tripsRef.current;
    if (authed && navigator.onLine) {
      try {
        const all = await api<TripDto[]>("/trips");
        current = all.filter((t) => t.status === "planned" || t.status === "active");
        setTrips(current);
        writeJSON(TRIPS_KEY, current);
      } catch {
        /* keep the cached list */
      }
    }
    const now = new Date();
    const next = new Map<string, PlaceWeather>();
    for (const placeId of new Set(current.filter((t) => weatherRelevant(t, now)).map((t) => t.placeId))) {
      const cached = await cachedForecast(placeId);
      const fresh = cached && Date.now() - cached.savedAt < FORECAST_FRESH_MS ? cached.data : navigator.onLine ? await fetchForecast(placeId) : null;
      const data = fresh ?? cached?.data;
      if (data) next.set(placeId, data);
    }
    setForecasts(next);
  }, [authed]);

  useEffect(() => {
    if (!authed) {
      setTrips([]);
      return;
    }
    void sync();
    const t = setInterval(() => void sync(), 30 * 60_000);
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onOnline);
    };
  }, [authed, sync]);

  const alerts = useMemo(() => {
    if (!pack) return [];
    const now = new Date();
    return trips.flatMap((t) => {
      const place = pack.planner.places.find((p) => p.id === t.placeId);
      if (!place) return [];
      const f = weatherRelevant(t, now) ? forecasts.get(t.placeId) : undefined;
      // Seasonal risks follow the trip's month, unless it's already under way.
      const month = t.status === "active" ? now.getMonth() + 1 : t.plannerInput.month;
      return tripAlerts({ tripId: t.id, place, base: f?.base.days ?? null, high: f?.high.days ?? null, hazards: pack.hazards, now, month }, pack.safety);
    });
  }, [pack, trips, forecasts]);

  const unseen = alerts.filter((a) => a.severity >= 2 && !seen.has(a.id));

  // Notify once per severe alert, on this device, if the traveller has allowed it.
  useEffect(() => {
    if (permission !== "granted" || !pack) return;
    const notified = readSet(NOTIFIED_KEY);
    const fresh = alerts.filter((a) => a.severity === 3 && !notified.has(a.id));
    for (const a of fresh.slice(0, 3)) {
      void notify(a, pack.planner.places.find((p) => p.id === a.placeId)?.name ?? "Your trip");
      notified.add(a.id);
    }
    if (fresh.length) writeJSON(NOTIFIED_KEY, [...notified].slice(-500));
  }, [alerts, permission, pack]);

  const markAllSeen = () => {
    const next = new Set([...seen, ...alerts.map((a) => a.id)]);
    setSeen(next);
    writeJSON(SEEN_KEY, [...next].slice(-500));
  };

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  };

  return { alerts, trips, unseenCount: unseen.length, markAllSeen, permission, requestPermission, refresh: sync };
}
