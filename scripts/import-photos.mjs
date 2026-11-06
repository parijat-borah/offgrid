// Place photos from Wikimedia Commons, with the attribution their licences require.
//
//   node scripts/import-photos.mjs --candidates   list freely licensed candidates per place, for a human to review
//   node scripts/import-photos.mjs                fetch metadata for the files chosen in PICKS and write photos.json
//
// Only CC0, public domain, CC BY and CC BY-SA files are accepted. Every photo keeps its author, licence and
// file-page link, and the app shows them under the image. Images are served from Wikimedia's thumbnail
// servers and cached by the service worker after the first view, so they work offline afterwards.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const UA = "offgrid-sih-importer/0.1 (student project; one-off photo import)";
const API = "https://commons.wikimedia.org/w/api.php";
const WIDTH = 960;
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? [0-9.]+( [a-z]+)?)$/i;

// Search terms per place (Commons titles are inconsistent, so a few spellings each).
const QUERIES = {
  triund: ["Triund", "Triund trek"],
  kheerganga: ["Kheerganga", "Kheer Ganga", "Khirganga"],
  "hampta-pass": ["Hampta Pass", "Hamta Pass"],
  "bir-billing": ["Bir Billing", "Billing paragliding"],
  "kasol-manikaran": ["Kasol", "Manikaran"],
  "spiti-valley": ["Spiti Valley", "Key Monastery", "Kaza Spiti"],
  chandratal: ["Chandratal", "Chandra Taal"],
  "prashar-lake": ["Prashar Lake", "Prashar lake Mandi"],
  "jibhi-serolsar": ["Serolsar Lake", "Jalori Pass", "Jibhi"],
  "bhrigu-lake": ["Bhrigu Lake"],
  "kareri-lake": ["Kareri Lake", "Kareri"],
  "beas-kund": ["Beas Kund"],
  tosh: ["Tosh village", "Tosh Parvati"],
  "tirthan-valley": ["Tirthan Valley", "Tirthan river", "Great Himalayan National Park"],
  "narkanda-hatu": ["Hatu Peak", "Narkanda"],
  chitkul: ["Chitkul", "Sangla valley"],
  "dalhousie-khajjiar": ["Khajjiar", "Dalhousie Himachal"],
  barot: ["Barot Himachal", "Barot valley", "Uhl river Barot"],
  churdhar: ["Churdhar", "Chur Peak"],
  "indrahar-pass": ["Indrahar Pass", "Indrahar"],
  "pin-parvati-pass": ["Pin Parvati Pass", "Pin Valley National Park"],
  "chandrakhani-pass": ["Chandrakhani Pass", "Malana village"],
};

// Chosen by a human from the --candidates list: they must actually show the place.
const PICKS = JSON.parse(readFileSync(`${root}scripts/photo-picks.json`, "utf8"));

const strip = (html) => (html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`Commons API ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); // rate-limited: back off
  }
  throw new Error("Commons API kept rate-limiting; try again later");
}

function toPhoto(page) {
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata ?? {};
  const license = strip(m.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(page.title)) return null;
  if ((ii.width ?? 0) < 800) return null;
  // Wide panoramas crop to a sliver in a card; tall portraits leave most of the place out.
  const aspect = ii.width / ii.height;
  if (aspect > 2.6 || aspect < 0.6) return null;
  return {
    file: page.title,
    url: ii.thumburl.replace(/[?&]utm_[^&]*/g, "").replace(/\?$/, ""),
    width: ii.thumbwidth,
    height: ii.thumbheight,
    author: strip(m.Artist?.value).slice(0, 120) || "Unknown",
    license,
    license_url: m.LicenseUrl?.value ?? null,
    source_url: ii.descriptionurl,
    caption: strip(m.ImageDescription?.value).slice(0, 160) || null,
  };
}

const imageProps = { prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: String(WIDTH), iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ImageDescription" };

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

if (process.argv.includes("--candidates")) {
  for (const [placeId, queries] of Object.entries(QUERIES)) {
    if (only && !only.includes(placeId)) continue;
    console.log(`\n## ${placeId}`);
    const seen = new Set();
    for (const q of queries) {
      const data = await api({ action: "query", generator: "search", gsrsearch: q, gsrnamespace: "6", gsrlimit: "12", ...imageProps });
      for (const page of data.query?.pages ?? []) {
        const p = toPhoto(page);
        if (!p || seen.has(p.file)) continue;
        seen.add(p.file);
        console.log(`  ${p.file}  [${p.license}; ${p.author.slice(0, 30)}]`);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  process.exit(0);
}

const out = {};
for (const [placeId, files] of Object.entries(PICKS)) {
  const data = await api({ action: "query", titles: files.join("|"), ...imageProps });
  const byTitle = new Map((data.query?.pages ?? []).map((p) => [p.title, p]));
  out[placeId] = [];
  for (const f of files) {
    const p = byTitle.get(f) && toPhoto(byTitle.get(f));
    if (!p) {
      console.warn(`  ✗ ${placeId}: ${f} missing, not freely licensed, or a panorama; skipped`);
      continue;
    }
    out[placeId].push(p);
  }
  // The first photo is the card's hero: make it a normal landscape shot if there is one.
  const hero = out[placeId].findIndex((p) => p.width / p.height >= 1.2 && p.width / p.height <= 2);
  if (hero > 0) out[placeId].unshift(...out[placeId].splice(hero, 1));
  console.log(`✓ ${placeId}: ${out[placeId].length} photo(s)`);
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync(
  `${root}data/regions/himachal/photos.json`,
  JSON.stringify({ source: "Wikimedia Commons", generated: new Date().toISOString().slice(0, 10), photos: out }, null, 2) + "\n",
);
console.log("Wrote data/regions/himachal/photos.json");
