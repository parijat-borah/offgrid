import {
  findNearby,
  haversineKm,
  POI_CATEGORIES,
  POI_CATEGORY_LABELS,
  POI_TAG_LABELS,
  type LatLon,
  type NearbyResult,
  type PoiCategory,
  type PoiTag,
  type RegionPack,
  type TripDto,
} from "@offgrid/core";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, PageHeader } from "../../design/Card";
import { Chip } from "../../design/Fields";
import { EmptyState } from "../../design/States";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDistance, saveCenter, savedCenter, useGeolocation, type Center } from "../../lib/geo";
import type { PackSource } from "../../lib/pack";
import { readJSON, writeJSON } from "../../lib/storage";
import { MapView, type MapLine, type MapMarker } from "../map/MapView";
import { PlaceHero } from "../places/PlacePhotos";
import { LAPTOP, useMedia } from "../../lib/useMedia";
import { HazardStrip } from "../safety/HazardStrip";

const RADII = [1, 3, 5, 10, 25];
const FILTER_TAGS: PoiTag[] = ["veg", "vegan", "women_safe", "family", "free"];
const FILTERS_KEY = "offgrid.nearby.filters.v1";

export const CATEGORY_COLORS: Record<PoiCategory, string> = {
  food: "#d9661d",
  stay: "#3b4fa0",
  camp: "#2f8f4e",
  restroom: "#5b6470",
  water: "#2f6db5",
  event: "#b5379a",
  viewpoint: "#17613f",
  medical: "#c8372d",
  atm: "#7a4f00",
  fuel: "#7a4f00",
  guide: "#17613f",
};

interface Filters {
  categories: PoiCategory[];
  tags: PoiTag[];
  maxPrice: 1 | 2 | 3 | null;
  openNow: boolean;
  radiusKm: number;
}

const DEFAULT_FILTERS: Filters = { categories: [], tags: [], maxPrice: null, openNow: false, radiusKm: 3 };

function loadFilters(): Filters {
  const v = readJSON(FILTERS_KEY) as Partial<Filters> | null;
  return v ? { ...DEFAULT_FILTERS, ...v } : DEFAULT_FILTERS;
}

const SOURCE_LABEL = { osm: "OpenStreetMap", curated: "Curated", community: "Community" } as const;

function ResultRow({ r, open, onToggle }: { r: NearbyResult; open: boolean; onToggle: () => void }) {
  const { poi } = r;
  const cat = POI_CATEGORY_LABELS[poi.category];
  const tone = r.status.state === "open" ? "text-pine-700" : r.status.state === "closed" ? "text-danger-700" : "text-muted";
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-pine-50">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-paper text-xl">
          {cat.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-tight">{poi.name}</span>
          <span className="block text-xs text-muted">
            {cat.label} · {formatDistance(r.distanceKm)}
            {poi.price_band ? ` · ${"₹".repeat(poi.price_band)}` : ""}
          </span>
          {/* Most OSM places have no hours; repeating "Hours unknown" on every row is noise, so it shows in details only. */}
          {r.status.state !== "unknown" && <span className={`block text-xs font-semibold ${tone}`}>{r.status.label}</span>}
          {(poi.tags.length > 0 || poi.approximate) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {poi.approximate && <Badge tone="warn">Approximate area</Badge>}
              {poi.tags.map((t) => (
                <Badge key={t} tone={t === "women_safe" ? "good" : "neutral"}>
                  {POI_TAG_LABELS[t]}
                </Badge>
              ))}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="mb-2 ml-14 space-y-2 text-sm">
          {poi.description && <p>{poi.description}</p>}
          {poi.note && <p className="text-xs text-muted">{poi.note}</p>}
          <p className="text-xs text-muted">{poi.hours ? `Hours: ${poi.hours}` : "Opening hours unknown"}</p>
          {poi.photos && poi.photos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {poi.photos.map((src) => (
                <img key={src} src={src} alt={`Photo of ${poi.name}`} loading="lazy" className="h-24 w-32 shrink-0 rounded-lg object-cover" />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{SOURCE_LABEL[poi.source]}</Badge>
            {/* geo: opens the phone's own maps app, which may have offline maps. */}
            <a className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-pine-700 hover:bg-pine-50" href={`geo:${poi.lat},${poi.lon}?q=${poi.lat},${poi.lon}(${encodeURIComponent(poi.name)})`}>
              Open in maps
            </a>
            {poi.source_ref && (
              <a className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-pine-700 hover:bg-pine-50" href={poi.source_ref} target="_blank" rel="noreferrer">
                View on OSM ↗
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function NearbyView({
  pack,
  packSource,
  onAddPlace,
  onReview,
  onReportHazard,
  onOpenPlace,
}: {
  pack: RegionPack;
  packSource: PackSource;
  onAddPlace: () => void;
  onReview: () => void;
  onReportHazard: () => void;
  onOpenPlace: (placeId: string) => void;
}) {
  const auth = useAuth();
  const places = pack.planner.places;
  const fallback: Center = { lat: places[0]!.lat, lon: places[0]!.lon, label: places[0]!.name };
  const [center, setCenter] = useState<Center>(() => savedCenter(fallback));
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [view, setView] = useState<"list" | "map">("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [route, setRoute] = useState<{ label: string; points: LatLon[] } | null>(null);
  const [useRoute, setUseRoute] = useState(false);
  const geo = useGeolocation();
  const placeSelectId = useId();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => writeJSON(FILTERS_KEY, filters), [filters]);

  const moveTo = useCallback((c: Center) => {
    setCenter(c);
    saveCenter(c);
    setOpenId(null);
  }, []);

  useEffect(() => {
    if (geo.state.status === "ok") moveTo({ ...geo.state.pos, label: "Your location" });
  }, [geo.state, moveTo]);

  // An active trip's recorded route lets you search along the way, not just around a point.
  useEffect(() => {
    if (auth.status !== "authed") return;
    api<TripDto[]>("/trips?status=active")
      .then((trips) => {
        const t = trips.find((x) => x.route.length >= 2);
        const place = t && places.find((p) => p.id === t.placeId);
        if (t && place) setRoute({ label: place.name, points: t.route });
      })
      .catch(() => undefined);
  }, [auth.status, places]);

  const centerPlace = places.find((p) => p.name === center.label);
  const centerTrail = centerPlace ? pack.planner.media.trails[centerPlace.id] : undefined;
  const searchRoute = useMemo(
    () => route ?? (centerTrail && centerPlace ? { label: `${centerPlace.name} trail`, points: centerTrail.coords.map(([lat, lon]) => ({ lat, lon })), isTrail: true } : null),
    [route, centerTrail, centerPlace],
  );

  // Treks and destinations within 60 km, nearest first: the "what's around here" answer, with photos.
  const nearbyPlaces = useMemo(
    () =>
      places
        .map((p) => ({ p, km: haversineKm(center, p) }))
        .filter((x) => x.km <= 60)
        .sort((a, b) => a.km - b.km)
        .slice(0, 6),
    [places, center],
  );

  const results = useMemo(
    () =>
      findNearby(
        pack.pois,
        {
          center,
          radiusKm: filters.radiusKm,
          route: useRoute && searchRoute ? searchRoute.points : undefined,
          categories: filters.categories,
          tags: filters.tags,
          maxPriceBand: filters.maxPrice ?? undefined,
          openNow: filters.openNow,
        },
        now,
        pack.planner.region.utc_offset_minutes,
      ),
    [pack, center, filters, now, useRoute, searchRoute],
  );

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const active = filters.categories.length + filters.tags.length + (filters.maxPrice ? 1 : 0) + (filters.openNow ? 1 : 0);

  const routeLines: MapLine[] =
    useRoute && searchRoute ? [{ id: "route", coords: searchRoute.points.map((p) => [p.lat, p.lon] as [number, number]), color: "#17613f", label: searchRoute.label }] : [];
  const markers: MapMarker[] = results.map((r) => ({
    id: r.poi.id,
    lat: r.poi.lat,
    lon: r.poi.lon,
    color: CATEGORY_COLORS[r.poi.category],
    label: r.poi.name,
    radiusM: r.poi.approximate ? 1000 : undefined,
  }));

  const laptop = useMedia(LAPTOP);
  const mapView = (className: string) => (
    <MapView
      center={center}
      markers={markers}
      lines={routeLines}
      fit={routeLines.length > 0}
      selectedId={openId}
      onSelect={setOpenId}
      label={`Map of places near ${center.label}`}
      className={className}
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Works offline" title="Nearby" subtitle="Food, stays, restrooms, water points and events around you or along a trail." />

      {packSource === "bundled" && (
        <Callout tone="warn">Using the data built into the app. Connect once to download the latest places, including community finds.</Callout>
      )}

      {/* Laptop: filters and results on the left, the map always beside them. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
      <div className="min-w-0 space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={geo.locate} disabled={geo.state.status === "locating"}>
            📍 {geo.state.status === "locating" ? "Locating…" : "Near me"}
          </Button>
          <label htmlFor={placeSelectId} className="sr-only">
            Search near a place
          </label>
          <select
            id={placeSelectId}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3"
            value={places.some((p) => p.name === center.label) ? center.label : ""}
            onChange={(e) => {
              const p = places.find((x) => x.name === e.target.value);
              if (p) moveTo({ lat: p.lat, lon: p.lon, label: p.name });
            }}
          >
            <option value="" disabled>
              {center.label === "Your location" ? "Your location" : "Near a place…"}
            </option>
            {places.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {geo.state.status === "error" && <Callout tone="warn">{geo.state.message}</Callout>}
        {searchRoute && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={useRoute} onChange={(e) => setUseRoute(e.target.checked)} className="size-5 accent-pine-700" />
            {"isTrail" in searchRoute ? `Search along the ${searchRoute.label} (water, food, toilets on the way)` : `Search along my ${searchRoute.label} route`}
          </label>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
          {POI_CATEGORIES.filter((c) => c !== "guide").map((c) => (
            <Chip key={c} selected={filters.categories.includes(c)} onToggle={() => set("categories", toggle(filters.categories, c))}>
              <span aria-hidden="true">{POI_CATEGORY_LABELS[c].icon} </span>
              {POI_CATEGORY_LABELS[c].label}
            </Chip>
          ))}
        </div>

        <details>
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
            More filters{active > 0 ? ` (${active} on)` : ""}
          </summary>
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Must have">
              {FILTER_TAGS.map((t) => (
                <Chip key={t} selected={filters.tags.includes(t)} onToggle={() => set("tags", toggle(filters.tags, t))}>
                  {POI_TAG_LABELS[t]}
                </Chip>
              ))}
              <Chip selected={filters.openNow} onToggle={() => set("openNow", !filters.openNow)}>
                Open now
              </Chip>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Maximum price">
              <span className="text-sm font-semibold">Price up to</span>
              {([1, 2, 3] as const).map((p) => (
                <Chip key={p} selected={filters.maxPrice === p} onToggle={() => set("maxPrice", filters.maxPrice === p ? null : p)}>
                  {"₹".repeat(p)}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted">
              Places with no price data still show. "Open now" only includes places with known hours. "Women-friendly" means
              government-run or community-reported with a 24-hour staffed desk; always use your own judgement.
            </p>
            <Button variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)} disabled={active === 0 && filters.radiusKm === 3}>
              Reset filters
            </Button>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Distance">
          <span className="text-sm font-semibold">Within</span>
          {RADII.map((r) => (
            <Chip key={r} selected={filters.radiusKm === r} onToggle={() => set("radiusKm", r)}>
              {r} km
            </Chip>
          ))}
        </div>
      </Card>

      <HazardStrip pack={pack} center={center} onReport={onReportHazard} />

      {nearbyPlaces.length > 0 && (
        <section aria-label={`Treks and places near ${center.label}`}>
          <h2 className="mb-2 text-sm font-bold">Treks and places near {center.label}</h2>
          <ul className="scroll-thin -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
            {nearbyPlaces.map(({ p, km }) => {
              const trail = pack.planner.media.trails[p.id];
              return (
                <li key={p.id} className="w-44 shrink-0 snap-start">
                  <button type="button" onClick={() => onOpenPlace(p.id)} className="w-full rounded-xl text-left hover:bg-pine-50" aria-label={`Open the plan for ${p.name}, ${Math.round(km)} km away`}>
                    <PlaceHero photos={pack.planner.media.photos[p.id]} name={p.name} className="aspect-[4/3] rounded-xl" inButton />
                    <span className="mt-1 block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">
                      {km < 1 ? "Here" : `${Math.round(km)} km away`}
                      {trail ? ` · 🥾 ${trail.length_km} km trail` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm" aria-live="polite">
          <span className="font-bold">{results.length}</span> {useRoute && searchRoute ? `along the ${searchRoute.label}` : `near ${center.label}`}
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1 lg:hidden" role="group" aria-label="View">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${view === v ? "bg-pine-700 text-white" : "text-ink"}`}
            >
              {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      {view === "map" && !laptop && mapView("h-80")}

      {results.length === 0 ? (
        <EmptyState
          icon="🔭"
          title="Nothing matches here"
          action={
            <Button onClick={() => setFilters({ ...DEFAULT_FILTERS, radiusKm: 25 })} variant="secondary">
              Clear filters, widen to 25 km
            </Button>
          }
        >
          Try fewer filters or a bigger radius. Know a spot that's missing? Add it below.
        </EmptyState>
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-line">
            {(view === "map" && !laptop && openId ? results.filter((r) => r.poi.id === openId) : results.slice(0, 60)).map((r) => (
              <ResultRow key={r.poi.id} r={r} open={openId === r.poi.id} onToggle={() => setOpenId(openId === r.poi.id ? null : r.poi.id)} />
            ))}
          </ul>
          {(view === "list" || laptop) && results.length > 60 && <p className="p-2 text-xs text-muted">Showing the closest 60. Narrow the radius or add filters.</p>}
        </Card>
      )}
      </div>

      {laptop && <div className="sticky top-20">{mapView("h-[calc(100dvh-7rem)] min-h-[28rem]")}</div>}
      </div>

      <Card className="space-y-2 bg-pine-50">
        <h2 className="font-bold">Know a place that's not on the map?</h2>
        <p className="text-sm">
          Add hidden cafés, viewpoints, water points and camping spots. Verified places earn you XP and the 🧭 Explorer badge.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:max-w-xl">
          <Button onClick={onAddPlace}>＋ Add a hidden place</Button>
          <Button variant="secondary" onClick={onReview}>
            Review nearby finds
          </Button>
        </div>
      </Card>

      <p className="text-center text-xs text-muted">
        Map data © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL).
      </p>
    </div>
  );
}
