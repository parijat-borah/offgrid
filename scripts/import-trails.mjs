// Builds trail lines for treks from OpenStreetMap footpaths:
//   node scripts/import-trails.mjs            (uses cached tiles in scripts/.osm-cache when present)
//
// For each trek: download the OSM data around the trailhead and destination (main API `map` call, in small
// tiles, politely rate-limited), build a walking graph that prefers paths over roads, and take the shortest
// route between the points nearest the trailhead and the destination. The result is the real mapped trail,
// simplified for the offline region pack. Start/end points were looked up by name with Nominatim.
//
// Output: data/regions/himachal/trails.json. OSM data is © OpenStreetMap contributors, ODbL 1.0: the app
// shows that attribution wherever a trail is drawn.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CACHE = `${root}scripts/.osm-cache`;
const OUT = `${root}data/regions/himachal/trails.json`;
const UA = "offgrid-sih-importer/0.1 (student project; one-off trail import)";

// Start and end points from Nominatim (OSM's geocoder), checked by hand. Treks without a mapped trailhead
// (Prashar Lake, Chandratal) and the 110 km Pin Parvati crossing are left out on purpose: no line beats a wrong one.
const TREKS = [
  { place: "triund", start: { name: "Galu Devi Temple", lat: 32.25458, lon: 76.3259 }, end: { name: "Triund ridge", lat: 32.26144, lon: 76.35455 } },
  { place: "indrahar-pass", start: { name: "Galu Devi Temple", lat: 32.25458, lon: 76.3259 }, end: { name: "Indrahar Pass", lat: 32.29756, lon: 76.38125 } },
  { place: "kareri-lake", start: { name: "Kareri village", lat: 32.27895, lon: 76.27861 }, end: { name: "Kareri Lake", lat: 32.32564, lon: 76.27388 } },
  { place: "kheerganga", start: { name: "Barshaini", lat: 32.00099, lon: 77.44024 }, end: { name: "Kheerganga", lat: 31.9938, lon: 77.513 } },
  { place: "tosh", start: { name: "Barshaini", lat: 32.00099, lon: 77.44024 }, end: { name: "Tosh", lat: 32.01439, lon: 77.45186 } },
  { place: "hampta-pass", start: { name: "Jobri", lat: 32.26769, lon: 77.24588 }, end: { name: "Hampta Pass", lat: 32.26987, lon: 77.34736 } },
  { place: "bhrigu-lake", start: { name: "Gulaba", lat: 32.3223, lon: 77.20097 }, end: { name: "Bhrigu Lake", lat: 32.29326, lon: 77.24249 } },
  { place: "beas-kund", start: { name: "Dhundi", lat: 32.35553, lon: 77.12653 }, end: { name: "Beas Kund", lat: 32.36653, lon: 77.08556 } },
  { place: "chandrakhani-pass", start: { name: "Rumsu", lat: 32.11439, lon: 77.17943 }, end: { name: "Chandrakhani Pass", lat: 32.117, lon: 77.24 } },
  { place: "jibhi-serolsar", start: { name: "Jalori Pass", lat: 31.53724, lon: 77.37175 }, end: { name: "Serolsar Lake", lat: 31.53748, lon: 77.41667 } },
  { place: "churdhar", start: { name: "Nohradhar", lat: 30.81184, lon: 77.42058 }, end: { name: "Churdhar peak", lat: 30.87054, lon: 77.48039 } },
  { place: "narkanda-hatu", start: { name: "Narkanda", lat: 31.25475, lon: 77.46126 }, end: { name: "Hatu Mata Temple", lat: 31.24256, lon: 77.50025 } },
];

// How much a metre costs on each kind of way: trails are preferred, busy roads avoided.
const COST = {
  path: 1, footway: 1, steps: 1.1, bridleway: 1, track: 1.05, pedestrian: 1,
  living_street: 1.4, residential: 1.4, unclassified: 1.4, service: 1.5,
  tertiary: 2, secondary: 2.5, primary: 3, trunk: 4,
};
const TRAIL_TYPES = new Set(["path", "footway", "steps", "bridleway", "track", "pedestrian"]);
const SNAP_LIMIT_M = 700;
const TILE = 0.05;
const PAD = 0.015;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rad = (d) => (d * Math.PI) / 180;
function meters(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function tile(minLon, minLat) {
  const key = `${minLon.toFixed(3)}_${minLat.toFixed(3)}`;
  const file = `${CACHE}/${key}.xml`;
  if (existsSync(file)) return readFileSync(file, "utf8");
  const bbox = [minLon, minLat, minLon + TILE, minLat + TILE].map((n) => n.toFixed(4)).join(",");
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, { headers: { "User-Agent": UA } });
    if (res.ok) {
      const xml = await res.text();
      writeFileSync(file, xml);
      await sleep(1500); // be gentle with the volunteer-run API
      return xml;
    }
    console.warn(`  tile ${bbox}: HTTP ${res.status}, retrying`);
    await sleep(3000 * 2 ** attempt);
  }
  throw new Error(`Couldn't download tile ${bbox}`);
}

const attr = (s, k) => {
  const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s);
  return m ? m[1] : null;
};

function parse(xml, nodes, ways) {
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const id = attr(m[0], "id");
    nodes.set(id, { lat: Number(attr(m[0], "lat")), lon: Number(attr(m[0], "lon")) });
  }
  for (const m of xml.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
    const id = attr(m[0], "id");
    if (ways.has(id)) continue;
    const tags = {};
    for (const t of m[1].matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)) tags[t[1]] = t[2];
    const hw = tags.highway;
    if (!hw || !(hw in COST) || tags.access === "private" || tags.access === "no" || tags.foot === "no") continue;
    ways.set(id, { hw, name: tags.name ?? null, refs: [...m[1].matchAll(/<nd ref="(\d+)"\/>/g)].map((x) => x[1]) });
  }
}

/** Minimal binary heap for Dijkstra. */
class Heap {
  a = [];
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

/** Douglas–Peucker in local metres, to keep the pack small without changing the shape. */
function simplify(pts, tolM) {
  if (pts.length < 3) return pts;
  const lat0 = rad(pts[0].lat);
  const xy = pts.map((p) => [p.lon * 111_320 * Math.cos(lat0), p.lat * 110_540]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    let best = -1, bestD = 0;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((y2 - y1) * xy[i][0] - (x2 - x1) * xy[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (bestD > tolM) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function route(trek, nodes, ways) {
  const adj = new Map();
  const edgeInfo = new Map(); // "a|b" → way
  const add = (a, b, w, way) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push([b, w]);
    edgeInfo.set(`${a}|${b}`, way);
  };
  for (const way of ways.values()) {
    for (let i = 1; i < way.refs.length; i++) {
      const a = way.refs[i - 1], b = way.refs[i];
      const na = nodes.get(a), nb = nodes.get(b);
      if (!na || !nb) continue;
      const w = meters(na, nb) * COST[way.hw];
      add(a, b, w, way);
      add(b, a, w, way);
    }
  }
  const nearest = (p) => {
    let best = null, bestD = Infinity;
    for (const id of adj.keys()) {
      const d = meters(p, nodes.get(id));
      if (d < bestD) { bestD = d; best = id; }
    }
    return { id: best, d: bestD };
  };
  const s = nearest(trek.start), t = nearest(trek.end);
  if (s.d > SNAP_LIMIT_M || t.d > SNAP_LIMIT_M) return { error: `no mapped path near the ${s.d > SNAP_LIMIT_M ? "start" : "end"} (${Math.round(Math.max(s.d, t.d))} m away)` };

  const dist = new Map([[s.id, 0]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push([0, s.id]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === t.id) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const [v, w] of adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        heap.push([nd, v]);
      }
    }
  }
  if (!dist.has(t.id)) return { error: "the paths near the start and end aren't connected in OSM" };

  const ids = [t.id];
  while (ids[ids.length - 1] !== s.id) ids.push(prev.get(ids[ids.length - 1]));
  ids.reverse();
  const pts = ids.map((id) => nodes.get(id));
  let total = 0, onTrail = 0;
  const names = new Map();
  for (let i = 1; i < ids.length; i++) {
    const m = meters(pts[i - 1], pts[i]);
    const way = edgeInfo.get(`${ids[i - 1]}|${ids[i]}`);
    total += m;
    if (TRAIL_TYPES.has(way.hw)) onTrail += m;
    if (way.name) names.set(way.name, (names.get(way.name) ?? 0) + m);
  }
  return {
    lengthKm: Math.round(total / 100) / 10,
    trailShare: Math.round((onTrail / total) * 100) / 100,
    snapM: Math.round(Math.max(s.d, t.d)),
    wayNames: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n),
    coords: simplify(pts, 6).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]),
  };
}

mkdirSync(CACHE, { recursive: true });
const places = JSON.parse(readFileSync(`${root}data/regions/himachal/places.json`, "utf8"));
const out = [];
for (const trek of TREKS) {
  const place = places.find((p) => p.id === trek.place);
  if (!place) throw new Error(`Unknown place ${trek.place}`);
  const minLat = Math.min(trek.start.lat, trek.end.lat) - PAD, maxLat = Math.max(trek.start.lat, trek.end.lat) + PAD;
  const minLon = Math.min(trek.start.lon, trek.end.lon) - PAD, maxLon = Math.max(trek.start.lon, trek.end.lon) + PAD;
  const nodes = new Map(), ways = new Map();
  for (let lon = Math.floor(minLon / TILE) * TILE; lon < maxLon; lon += TILE) {
    for (let lat = Math.floor(minLat / TILE) * TILE; lat < maxLat; lat += TILE) parse(await tile(lon, lat), nodes, ways);
  }
  const r = route(trek, nodes, ways);
  if (r.error) {
    console.log(`✗ ${place.name}: ${r.error}. Skipped (the app shows a location pin instead).`);
    continue;
  }
  // The place's distance is the whole trek, there and back. A route much longer than half of it means OSM is
  // missing a trail section and the shortest path took a detour (seen on Indrahar and Bhrigu): drop it.
  const expected = place.distance_km;
  if (r.lengthKm > (expected / 2) * 1.3) {
    console.log(`✗ ${place.name}: route is ${r.lengthKm} km one way, far more than ~${expected / 2} km. OSM is probably missing a section. Skipped.`);
    continue;
  }
  console.log(
    `✓ ${place.name.padEnd(22)} ${String(r.lengthKm).padStart(5)} km one way (data says ${expected} km total) · ${Math.round(r.trailShare * 100)}% on trails · snap ${r.snapM} m · ${r.coords.length} pts · ${r.wayNames.join(", ") || "unnamed paths"}`,
  );
  out.push({ place_id: trek.place, start: trek.start, end: trek.end, length_km: r.lengthKm, trail_share: r.trailShare, way_names: r.wayNames, coords: r.coords });
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: "OpenStreetMap",
      license: "ODbL-1.0",
      attribution: "© OpenStreetMap contributors",
      generated: new Date().toISOString().slice(0, 10),
      note: "Shortest walking route on mapped OSM paths between a named trailhead and destination. Check locally before you go: trails change after landslides and snow.",
      trails: out,
    },
    null,
    0,
  ).replace(/\{"place_id"/g, '\n{"place_id"') + "\n",
);
console.log(`\nWrote ${out.length} trails to data/regions/himachal/trails.json`);
