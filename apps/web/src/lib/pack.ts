import { parseRegionPack, type RegionPack } from "@offgrid/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";

const REGION = "himachal";
const PACK_URL = `/api/v1/regions/${REGION}/pack`;

export type PackSource = "cache" | "network" | "bundled";
export type PackState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pack: RegionPack; source: PackSource; savedAt: number | null };

/** The copy shipped inside the app: always available, even on first launch with no signal. */
async function bundledPack(): Promise<RegionPack> {
  const [region, places, passes, rules, packing, fitnessQuiz, badges, mascots, xp, moderation, curated, osm, hazards, hospitals, safety, guide, photos, trails] = await Promise.all([
    import("@data/regions/himachal/region.json"),
    import("@data/regions/himachal/places.json"),
    import("@data/regions/himachal/passes.json"),
    import("@data/scoring-rules.json"),
    import("@data/packing-rules.json"),
    import("@data/fitness-quiz.json"),
    import("@data/badges.json"),
    import("@data/mascots.json"),
    import("@data/xp-rules.json"),
    import("@data/moderation-rules.json"),
    import("@data/regions/himachal/pois.json"),
    import("@data/regions/himachal/pois.osm.json"),
    import("@data/regions/himachal/hazards.json"),
    import("@data/regions/himachal/hospitals.json"),
    import("@data/safety-rules.json"),
    import("@data/safety-guide.json"),
    import("@data/regions/himachal/photos.json"),
    import("@data/regions/himachal/trails.json"),
  ]);
  return parseRegionPack({
    version: "bundled",
    region: region.default,
    places: places.default,
    passes: passes.default,
    rules: rules.default,
    packing: packing.default,
    fitnessQuiz: fitnessQuiz.default,
    badges: badges.default,
    mascots: mascots.default,
    xp: xp.default,
    moderation: moderation.default,
    pois: [...curated.default, ...osm.default],
    hazards: hazards.default,
    hospitals: hospitals.default,
    safety: safety.default,
    guide: guide.default,
    photos: photos.default,
    trails: trails.default,
  });
}

/** Fetch the latest pack. Returns null when the cached version is still current (HTTP 304). */
async function fetchPack(currentVersion: string | null): Promise<{ raw: unknown; pack: RegionPack } | null> {
  const res = await fetch(PACK_URL, { headers: currentVersion ? { "If-None-Match": `"${currentVersion}"` } : {} });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`Pack download failed (${res.status})`);
  const raw = (await res.json()) as unknown;
  return { raw, pack: parseRegionPack(raw) };
}

/**
 * Offline-first loading: show the IndexedDB copy instantly, then revalidate in the background.
 * With no cached copy, try the network, and fall back to the bundled copy so the app always opens.
 */
export function usePack() {
  const [state, setState] = useState<PackState>({ status: "loading" });
  const current = useRef<string | null>(null);

  const revalidate = useCallback(async () => {
    try {
      const fresh = await fetchPack(current.current);
      if (!fresh) return;
      const savedAt = Date.now();
      await db.packs.put({ regionId: REGION, version: fresh.pack.version, raw: fresh.raw, savedAt });
      current.current = fresh.pack.version;
      setState({ status: "ready", pack: fresh.pack, source: "network", savedAt });
    } catch {
      /* offline or server down: keep what we have */
    }
  }, []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const stored = await db.packs.get(REGION).catch(() => undefined);
      if (stored) {
        try {
          const pack = parseRegionPack(stored.raw);
          current.current = pack.version;
          setState({ status: "ready", pack, source: "cache", savedAt: stored.savedAt });
          void revalidate();
          return;
        } catch {
          // An old or corrupt pack from a previous app version: discard it and fetch a fresh one.
          await db.packs.delete(REGION).catch(() => undefined);
        }
      }
      const fresh = await fetchPack(null).catch(() => null);
      if (fresh) {
        const savedAt = Date.now();
        await db.packs.put({ regionId: REGION, version: fresh.pack.version, raw: fresh.raw, savedAt }).catch(() => undefined);
        current.current = fresh.pack.version;
        setState({ status: "ready", pack: fresh.pack, source: "network", savedAt });
        return;
      }
      setState({ status: "ready", pack: await bundledPack(), source: "bundled", savedAt: null });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [revalidate]);

  useEffect(() => {
    void load();
    const onOnline = () => void revalidate();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load, revalidate]);

  return { state, reload: load, revalidate };
}
