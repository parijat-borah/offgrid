import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

/** A line on the map, e.g. a trail from OpenStreetMap or a recorded GPS track. */
export interface MapLine {
  id: string;
  coords: [number, number][];
  color: string;
  label: string;
  dashed?: boolean;
}

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label: string;
  /** Draw a shaded circle instead of implying a precise pin (approximate community places). */
  radiusM?: number;
}

/**
 * A thin Leaflet wrapper. The list next to it is always the primary, accessible view; the map is
 * a visual aid. Tiles come from OpenStreetMap, and only tiles you've viewed are cached offline.
 */
export function MapView({
  center,
  zoom = 13,
  markers,
  lines = [],
  fit = false,
  selectedId,
  onSelect,
  onPick,
  label,
  className = "h-72",
}: {
  center: { lat: number; lon: number };
  zoom?: number;
  markers: MapMarker[];
  lines?: MapLine[];
  /** Zoom to show every line and marker (instead of centring on `center`). */
  fit?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onPick?: (p: { lat: number; lon: number }) => void;
  label: string;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView([center.lat, center.lon], zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    // The container may still be laying out when Leaflet measures it.
    const t = setTimeout(() => m.invalidateSize(), 50);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
    };
    // Created once; later center/zoom changes are applied by the effect below.
  }, []);

  useEffect(() => {
    if (fit) return;
    map.current?.setView([center.lat, center.lon], map.current.getZoom() || zoom);
  }, [center.lat, center.lon, zoom, fit]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const ln of lines) {
      // A white casing under the line keeps it readable over busy terrain tiles.
      L.polyline(ln.coords, { color: "#ffffff", weight: 7, opacity: 0.9 }).addTo(g);
      L.polyline(ln.coords, { color: ln.color, weight: 4, dashArray: ln.dashed ? "6 8" : undefined }).bindTooltip(ln.label, { sticky: true }).addTo(g);
    }
    for (const mk of markers) {
      if (mk.radiusM) {
        L.circle([mk.lat, mk.lon], { radius: mk.radiusM, color: mk.color, weight: 1, fillOpacity: 0.12 }).addTo(g);
      }
      const selected = mk.id === selectedId;
      L.circleMarker([mk.lat, mk.lon], {
        radius: selected ? 10 : 7,
        color: "#ffffff",
        weight: 2,
        fillColor: mk.color,
        fillOpacity: 1,
      })
        .bindTooltip(mk.label)
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onSelect?.(mk.id);
        })
        .addTo(g);
    }
    if (fit && map.current) {
      const pts: [number, number][] = [...lines.flatMap((l) => l.coords), ...markers.map((m) => [m.lat, m.lon] as [number, number])];
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 15 });
    }
  }, [markers, lines, fit, selectedId, onSelect]);

  return <div ref={el} role="region" aria-label={label} className={`z-0 overflow-hidden rounded-2xl border border-line ${className}`} />;
}
