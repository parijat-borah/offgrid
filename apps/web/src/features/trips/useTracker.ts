import { haversineKm, type TrackPoint } from "@offgrid/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { readJSON, writeJSON } from "../../lib/storage";

const MIN_GAP_MS = 5 * 60_000; // battery-friendly: one point per 5 minutes…
const MIN_MOVE_KM = 0.2; // …unless you've moved 200 m
const MAX_ACCURACY_M = 100; // ignore wild fixes

const key = (tripId: string) => `offgrid.track.v1.${tripId}`;
const readBuffer = (tripId: string): TrackPoint[] => {
  const v = readJSON(key(tripId));
  return Array.isArray(v) ? (v as TrackPoint[]) : [];
};

/**
 * Records sparse GPS breadcrumbs. Points go to a localStorage buffer first, so nothing is
 * lost without signal, then upload whenever the server is reachable.
 */
export function useTracker(tripId: string, enabled: boolean) {
  const [recording, setRecording] = useState(false);
  const [buffered, setBuffered] = useState(() => readBuffer(tripId).length);
  const [uploaded, setUploaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const last = useRef<TrackPoint | null>(readBuffer(tripId).at(-1) ?? null);

  const flush = useCallback(async () => {
    const buf = readBuffer(tripId);
    if (buf.length === 0) return;
    try {
      const res = await api<{ accepted: number }>(`/trips/${tripId}/points`, { method: "POST", body: { points: buf.slice(0, 500) } });
      const rest = readBuffer(tripId).slice(Math.min(buf.length, 500));
      writeJSON(key(tripId), rest);
      setBuffered(rest.length);
      setUploaded((n) => n + res.accepted);
    } catch {
      /* stay buffered; we'll retry on the next point or when back online */
    }
  }, [tripId]);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share your location.");
      return;
    }
    setError(null);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > MAX_ACCURACY_M) return;
        const p: TrackPoint = {
          ts: pos.timestamp,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          alt: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
        };
        const prev = last.current;
        if (prev && p.ts - prev.ts < MIN_GAP_MS && haversineKm(prev, p) < MIN_MOVE_KM) return;
        last.current = p;
        const buf = [...readBuffer(tripId), p];
        writeJSON(key(tripId), buf);
        setBuffered(buf.length);
        void flush();
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED ? "Location permission was denied. Allow it in your browser settings." : "Can't get a GPS fix right now.");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 60_000 },
    );
    setRecording(true);
  }, [flush, stop, tripId]);

  useEffect(() => {
    if (!enabled) stop();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, flush, stop]);

  useEffect(() => stop, [stop]);

  return { recording, buffered, uploaded, error, start, stop, flush };
}
