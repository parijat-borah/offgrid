/**
 * A small parser for the common subset of OpenStreetMap `opening_hours` that real Himachal
 * data uses: "24/7", "Mo-Su 08:30-21:30", "09:00-17:00; Th off", "Mo-Fr 09:00-13:00,14:00-18:00",
 * overnight ranges like "18:00-02:00". Anything else returns null ("hours unknown") rather than a guess.
 */

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Minutes from local midnight. `end` may exceed 1440 for ranges that run past midnight. */
type Interval = readonly [start: number, end: number];
/** Index 0 = Monday. */
export type WeekHours = Interval[][];

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function parseDays(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.trim().split("-");
    const i = DAYS.indexOf(a as (typeof DAYS)[number]);
    if (i < 0) return null;
    if (b === undefined) {
      out.add(i);
      continue;
    }
    const j = DAYS.indexOf(b as (typeof DAYS)[number]);
    if (j < 0) return null;
    // Ranges can wrap, e.g. "Sa-Mo".
    for (let k = i; ; k = (k + 1) % 7) {
      out.add(k);
      if (k === j) break;
    }
  }
  return [...out];
}

export function parseHours(spec: string | null | undefined): WeekHours | null {
  if (!spec) return null;
  const s = spec.trim();
  if (s === "24/7") return Array.from({ length: 7 }, () => [[0, 1440] as const]);

  const week: (Interval[] | null)[] = Array.from({ length: 7 }, () => null);
  for (const raw of s.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // public holidays: not modelled, so ignored
    const m = /^(?:([A-Za-z]{2}(?:[-,][A-Za-z]{2})*)\s+)?(.+)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const body = m[2]!.trim();

    let intervals: Interval[];
    if (body === "off" || body === "closed") {
      intervals = [];
    } else {
      intervals = [];
      for (const range of body.split(",")) {
        const [a, b] = range.trim().split("-");
        const start = parseTime(a ?? "");
        const end = parseTime(b ?? "");
        if (start === null || end === null) return null;
        intervals.push([start, end <= start ? end + 1440 : end]);
      }
    }
    // OSM semantics: a later rule replaces earlier ones for the days it names.
    for (const d of days) week[d] = intervals;
  }
  if (week.every((d) => d === null)) return null;
  return week.map((d) => d ?? []);
}

export interface OpenStatus {
  state: "open" | "closed" | "unknown";
  label: string;
}

const fmt = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Local Monday-based day index and minutes since local midnight. */
export function localClock(date: Date, utcOffsetMinutes: number): { day: number; minute: number } {
  const local = new Date(date.getTime() + utcOffsetMinutes * 60_000);
  return { day: (local.getUTCDay() + 6) % 7, minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function openStatus(spec: string | null | undefined, date: Date, utcOffsetMinutes: number): OpenStatus {
  const week = parseHours(spec);
  if (!week) return { state: "unknown", label: "Hours unknown" };
  if (spec!.trim() === "24/7") return { state: "open", label: "Open 24 hours" };

  const { day, minute } = localClock(date, utcOffsetMinutes);
  // Absolute minutes in the week, so overnight ranges from yesterday are handled naturally.
  const now = day * 1440 + minute;
  const spans: [number, number][] = [];
  for (let offset = -1; offset <= 7; offset++) {
    const d = (((day + offset) % 7) + 7) % 7;
    for (const [s, e] of week[d]!) spans.push([(day + offset) * 1440 + s, (day + offset) * 1440 + e]);
  }

  const current = spans.find(([s, e]) => now >= s && now < e);
  if (current) return { state: "open", label: `Open · closes ${fmt(current[1])}` };

  const next = spans.filter(([s]) => s > now).sort((a, b) => a[0] - b[0])[0];
  if (!next) return { state: "closed", label: "Closed" };
  const nextDay = Math.floor(next[0] / 1440);
  const when = nextDay === day ? fmt(next[0]) : `${DAY_NAMES[((nextDay % 7) + 7) % 7]} ${fmt(next[0])}`;
  return { state: "closed", label: `Closed · opens ${when}` };
}
