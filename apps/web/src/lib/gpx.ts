import type { Trail } from "@offgrid/core";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GPX 1.1 of a trail, for offline map apps (OsmAnd, Organic Maps, Gaia). Keeps the ODbL attribution
 * in the file, because the line is derived from OpenStreetMap.
 */
export function trailGpx(trail: Trail, placeName: string, attribution: string): string {
  const pts = trail.coords.map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OFFGRID" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(placeName)} trail</name>
    <desc>${esc(`${trail.start.name} to ${trail.end.name}, ${trail.length_km} km one way. Derived from OpenStreetMap: check locally before you go.`)}</desc>
    <copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/1-0/</license></copyright>
    <link href="https://www.openstreetmap.org/copyright"><text>${esc(attribution)}</text></link>
  </metadata>
  <wpt lat="${trail.start.lat}" lon="${trail.start.lon}"><name>${esc(`Start: ${trail.start.name}`)}</name></wpt>
  <wpt lat="${trail.end.lat}" lon="${trail.end.lon}"><name>${esc(trail.end.name)}</name></wpt>
  <trk>
    <name>${esc(placeName)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
