import type { LatLon } from "@offgrid/core";
import { useCallback, useState } from "react";
import { readJSON, writeJSON } from "./storage";

export interface Center extends LatLon {
  label: string;
}

const CENTER_KEY = "offgrid.center.v1";

/** The last place the traveller searched around, shared by Nearby, Add place and Review. */
export function savedCenter(fallback: Center): Center {
  const v = readJSON(CENTER_KEY) as Partial<Center> | null;
  return v && typeof v.lat === "number" && typeof v.lon === "number" && typeof v.label === "string" ? (v as Center) : fallback;
}

export function saveCenter(c: Center) {
  writeJSON(CENTER_KEY, c);
}

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ok"; pos: LatLon; accuracyM: number }
  | { status: "error"; message: string };

/** One-shot location. A recent cached fix is fine for "what's near me", and saves battery. */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });
  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "error", message: "This browser can't share your location." });
      return;
    }
    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => setState({ status: "ok", pos: { lat: p.coords.latitude, lon: p.coords.longitude }, accuracyM: p.coords.accuracy }),
      (e) =>
        setState({
          status: "error",
          message: e.code === e.PERMISSION_DENIED ? "Location permission was denied. Pick a place instead." : "Couldn't get your location. Pick a place instead.",
        }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  }, []);
  return { state, locate };
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
