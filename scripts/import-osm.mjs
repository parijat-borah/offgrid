// Imports real points of interest from OpenStreetMap (via the Overpass API) around every
// place in a region pack, and writes data/regions/<region>/pois.osm.json.
//
//   node scripts/import-osm.mjs [region=himachal] [radiusMeters=3000]
//
// OSM data is © OpenStreetMap contributors, licensed under ODbL. The app shows the attribution,
// and this generated file must stay under ODbL. Re-run it to refresh; it never touches curated data.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const region = process.argv[2] ?? "himachal";
const radius = Number(process.argv[3] ?? 3000);
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = `${root}data/regions/${region}/`;
const places = JSON.parse(readFileSync(`${dir}places.json`, "utf8"));

const AMENITY = {
  restaurant: "food",
  cafe: "food",
  fast_food: "food",
  toilets: "restroom",
  drinking_water: "water",
  atm: "atm",
  bank: "atm",
  pharmacy: "medical",
  hospital: "medical",
  clinic: "medical",
  doctors: "medical",
  fuel: "fuel",
};
const TOURISM = { guest_house: "stay", hostel: "stay", hotel: "stay", camp_site: "camp", viewpoint: "viewpoint" };

const around = places.map((p) => `(around:${radius},${p.lat},${p.lon})`);
const parts = around.flatMap((a) => [
  `nwr["amenity"~"^(${Object.keys(AMENITY).join("|")})$"]${a};`,
  `nwr["tourism"~"^(${Object.keys(TOURISM).join("|")})$"]${a};`,
]);
const query = `[out:json][timeout:120];(${parts.join("")});out center tags;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "offgrid-sih-importer/0.1" },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
const { elements } = await res.json();

const tagsFor = (t) => {
  const tags = [];
  if (t["diet:vegetarian"] === "only" || t["diet:vegetarian"] === "yes") tags.push("veg");
  if (t["diet:vegan"] === "only" || t["diet:vegan"] === "yes") tags.push("vegan");
  if (t.wheelchair === "yes") tags.push("wheelchair");
  if (t["payment:upi"] === "yes") tags.push("upi");
  if (t.internet_access === "wlan" || t.internet_access === "yes") tags.push("wifi");
  if (t.fee === "no") tags.push("free");
  return tags;
};

const seen = new Set();
const pois = [];
for (const el of elements) {
  const t = el.tags ?? {};
  const category = AMENITY[t.amenity] ?? TOURISM[t.tourism];
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!category || lat == null || lon == null) continue;
  const id = `osm-${el.type[0]}${el.id}`;
  if (seen.has(id)) continue;
  seen.add(id);
  // Unnamed toilets, taps and viewpoints are still useful; unnamed restaurants and hotels mostly aren't.
  const name =
    t["name:en"] ?? t.name ?? { restroom: "Public toilet", water: "Drinking water", viewpoint: "Viewpoint", atm: "ATM", fuel: "Fuel station" }[category];
  if (!name) continue;
  pois.push({
    id,
    region_id: region,
    name,
    category,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    description: t.description ?? "",
    price_band: null,
    tags: tagsFor(t),
    hours: t.opening_hours ?? null,
    event_months: null,
    source: "osm",
    source_ref: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  });
}
pois.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(`${dir}pois.osm.json`, JSON.stringify(pois, null, 1) + "\n");
const counts = pois.reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
console.log(`Wrote ${pois.length} OSM POIs to data/regions/${region}/pois.osm.json`, counts);
