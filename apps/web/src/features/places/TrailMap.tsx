import { HAZARD_LABELS, isActive, type Hazard, type LatLon, type Place, type PlannerData } from "@offgrid/core";
import { useMemo } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { downloadFile } from "../../lib/download";
import { trailGpx } from "../../lib/gpx";
import { MapView, type MapLine, type MapMarker } from "../map/MapView";

const TRAIL = "#17613f";
const TRACK = "#1f6fb2";
const HAZARD = "#b42318";

/** Is the hazard within ~1.5 km of any point on the line (or of the place, when there's no line)? */
function nearLine(h: Hazard, pts: [number, number][]) {
  const k = Math.cos((h.lat * Math.PI) / 180);
  const reach = (h.radius_m + 1500) / 111_000;
  return pts.some(([lat, lon]) => Math.hypot(lat - h.lat, (lon - h.lon) * k) < reach);
}

/**
 * The route like a maps app: the trek's line from OpenStreetMap, trailhead and destination, hazards
 * near the line, and (on a trip) your own recorded track. Uses Leaflet, so screens load it lazily.
 */
export function TrailMap({
  place,
  data,
  hazards = [],
  track,
  className = "h-80",
}: {
  place: Place;
  data: PlannerData;
  hazards?: Hazard[];
  /** A recorded GPS track to draw over the planned trail. */
  track?: LatLon[];
  className?: string;
}) {
  const trail = data.media.trails[place.id];
  const credit = data.media.trailCredit;

  const { lines, markers, near } = useMemo(() => {
    const lines: MapLine[] = [];
    const markers: MapMarker[] = [];
    const pts: [number, number][] = trail ? trail.coords : [[place.lat, place.lon]];
    if (trail) {
      lines.push({ id: "trail", coords: trail.coords, color: TRAIL, label: `${place.name} trail, ${trail.length_km} km one way`, dashed: !!track?.length });
      markers.push({ id: "start", lat: trail.start.lat, lon: trail.start.lon, color: TRAIL, label: `Start: ${trail.start.name}` });
      markers.push({ id: "end", lat: trail.end.lat, lon: trail.end.lon, color: "#b5530f", label: trail.end.name });
    } else {
      markers.push({ id: "place", lat: place.lat, lon: place.lon, color: "#b5530f", label: place.name });
    }
    if (track && track.length > 1) lines.push({ id: "track", coords: track.map((p) => [p.lat, p.lon]), color: TRACK, label: "Your recorded track" });
    const month = new Date().getMonth() + 1;
    const near = hazards.filter((h) => isActive(h, new Date(), month) && nearLine(h, pts));
    for (const h of near) markers.push({ id: `hz-${h.id}`, lat: h.lat, lon: h.lon, color: HAZARD, label: `⚠️ ${HAZARD_LABELS[h.kind]}: ${h.title}`, radiusM: h.radius_m });
    return { lines, markers, near };
  }, [trail, track, place, hazards]);

  const directions = trail ?? { start: { lat: place.lat, lon: place.lon, name: place.name } };
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${directions.start.lat},${directions.start.lon}`;
  const osm = trail
    ? `https://www.openstreetmap.org/?mlat=${trail.end.lat}&mlon=${trail.end.lon}#map=13/${trail.end.lat}/${trail.end.lon}`
    : `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=13/${place.lat}/${place.lon}`;

  return (
    <div className="space-y-2">
      <MapView
        center={{ lat: place.lat, lon: place.lon }}
        zoom={13}
        fit={!!trail || !!track?.length}
        lines={lines}
        markers={markers}
        label={trail ? `Map of the ${place.name} trail from ${trail.start.name}` : `Map of ${place.name}`}
        className={className}
      />

      {trail ? (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge tone="good">🥾 {trail.length_km} km one way</Badge>
          <Badge>Start: {trail.start.name}</Badge>
          <Badge>{Math.round(trail.trail_share * 100)}% on mapped trails</Badge>
          {track && track.length > 1 && <Badge tone="accent">Blue: your track · dashed green: the trail</Badge>}
        </div>
      ) : (
        <p className="text-xs text-muted">
          {place.distance_km > 0
            ? "OpenStreetMap doesn't have a complete trail for this one yet, so we show the destination only rather than guess a line."
            : "A road-trip destination: the pin shows where it is."}
        </p>
      )}

      {near.length > 0 && (
        <p className="text-xs text-danger-700">
          ⚠️ {near.length} hazard{near.length > 1 ? "s" : ""} near this route: {near.map((h) => HAZARD_LABELS[h.kind]).join(", ")}. Tap the red marks for details.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <a href={gmaps} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold hover:bg-pine-50">
          🧭 Directions to {trail ? "the trailhead" : place.name} ↗
        </a>
        <a href={osm} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-pine-700 hover:bg-pine-50">
          Open in OpenStreetMap ↗
        </a>
        {trail && credit && (
          <Button variant="ghost" onClick={() => downloadFile(`${place.id}-trail.gpx`, trailGpx(trail, place.name, credit.attribution), "application/gpx+xml")}>
            ⬇ GPX for offline maps
          </Button>
        )}
      </div>

      {trail && credit && (
        <p className="text-[11px] text-muted">
          Trail line {credit.attribution} (ODbL). {credit.note}
        </p>
      )}
    </div>
  );
}
