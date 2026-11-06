import type { HazardKind, PackingCategory, Vibe } from "./schemas";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function monthName(month: number): string {
  const name = MONTH_NAMES[month - 1];
  if (!name) throw new RangeError(`Invalid month: ${month}`);
  return name;
}

export function monthShort(month: number): string {
  return monthName(month).slice(0, 3);
}

export const DIFFICULTY_LABELS: Record<number, string> = { 1: "Easy", 2: "Moderate", 3: "Hard" };

export const VIBE_LABELS: Record<Vibe, string> = {
  camping: "Camping",
  snow: "Snow",
  lakes: "Lakes",
  adventure: "Adventure",
  chill: "Chill",
  cafes: "Cafés",
  spiritual: "Spiritual",
  photography: "Photography",
  wildlife: "Wildlife",
  culture: "Culture",
  villages: "Villages",
  paragliding: "Paragliding",
  "hot-springs": "Hot springs",
  stargazing: "Stargazing",
};

export const HAZARD_LABELS: Record<HazardKind, string> = {
  landslide: "Landslides",
  bear: "Bear zone",
  leopard: "Leopard zone",
  snake: "Snakes",
  river_crossing: "River crossings",
  avalanche: "Avalanche / rockfall",
  ams: "Altitude sickness",
  extreme_cold: "Extreme cold",
  flash_flood: "Flash floods",
  road_closure: "Road closures",
  lightning: "Lightning",
};

export const PACKING_CATEGORY_LABELS: Record<PackingCategory, string> = {
  documents: "Documents & money",
  essentials: "Essentials",
  clothing: "Clothing",
  gear: "Gear",
  health: "Health",
  tech: "Tech & safety",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN");

export function formatINR(rupees: number): string {
  return inr.format(Math.round(rupees));
}

export function formatNumber(n: number): string {
  return num.format(n);
}

export function formatList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
