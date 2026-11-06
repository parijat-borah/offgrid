import { formatList, VIBE_LABELS } from "../labels";
import type { Vibe } from "../schemas";
import type { Gender, MatchingRules, MatchPrefs } from "./schemas";

/** What matching may know about a traveller. No name, email, exact age or location. */
export interface MatchProfile {
  userId: string;
  age: number;
  gender: Gender;
  /** Gender confirmed from a government ID (via DigiLocker), not just self-declared. */
  genderVerified: boolean;
  idVerified: boolean;
  phoneVerified: boolean;
  /** 1 = slow, 3 = fast. From the traveller-type quiz; 2 if unknown. */
  pace: 1 | 2 | 3;
  typeId: string | null;
  prefs: MatchPrefs;
  blocked: ReadonlySet<string>;
}

export interface MatchTrip {
  tripId: string;
  placeId: string;
  /** YYYY-MM-DD */
  startDate: string;
  days: number;
  budgetPp: number;
  fitness: 1 | 2 | 3;
  vibes: Vibe[];
}

export interface Candidate {
  profile: MatchProfile;
  trip: MatchTrip;
}

/** Women-only search is for women, proven by ID. Otherwise it would be a tool for finding women. */
export function canUseWomenOnly(p: MatchProfile): boolean {
  return p.idVerified && p.genderVerified && p.gender === "woman";
}

export function canUseSameGender(p: MatchProfile): boolean {
  return p.idVerified && p.genderVerified && p.gender !== "prefer_not";
}

/** One side's preferences applied to the other side. Returns why not, or null if acceptable. */
function prefsBlock(viewer: MatchProfile, other: MatchProfile): string | null {
  const p = viewer.prefs;
  if (p.womenOnly && !(other.genderVerified && other.gender === "woman")) return "women-only";
  if (p.sameGender && !(other.genderVerified && other.gender === viewer.gender)) return "same-gender";
  if (p.verifiedOnly && !other.idVerified) return "verified-only";
  if (other.age < p.ageMin || other.age > p.ageMax) return "age";
  return null;
}

/**
 * Hard rules, checked in both directions: a match must be acceptable to both people. Reasons are
 * internal (for tests and logs); we never tell someone *why* another person can't see them.
 */
export function ineligible(me: MatchProfile, them: MatchProfile): string | null {
  if (me.userId === them.userId) return "self";
  if (me.blocked.has(them.userId) || them.blocked.has(me.userId)) return "blocked";
  if (me.age < 18 || them.age < 18) return "minor";
  if (!them.prefs.visible) return "hidden";
  // Prefs that need verification only count if the person is actually verified for them.
  const mine = prefsBlock({ ...me, prefs: { ...me.prefs, womenOnly: me.prefs.womenOnly && canUseWomenOnly(me), sameGender: me.prefs.sameGender && canUseSameGender(me) } }, them);
  if (mine) return `mine:${mine}`;
  const theirs = prefsBlock({ ...them, prefs: { ...them.prefs, womenOnly: them.prefs.womenOnly && canUseWomenOnly(them), sameGender: them.prefs.sameGender && canUseSameGender(them) } }, me);
  if (theirs) return `theirs:${theirs}`;
  return null;
}

const DAY = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function dateOverlap(a: MatchTrip, b: MatchTrip): { overlapDays: number; gapDays: number } {
  const aStart = parseDay(a.startDate);
  const bStart = parseDay(b.startDate);
  const aEnd = aStart + a.days * DAY;
  const bEnd = bStart + b.days * DAY;
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / DAY;
  const gap = overlap > 0 ? 0 : Math.max(aStart - bEnd, bStart - aEnd) / DAY;
  return { overlapDays: Math.round(overlap), gapDays: Math.round(gap) };
}

export interface Compatibility {
  score: number;
  breakdown: Record<keyof MatchingRules["weights"], number>;
  reasons: string[];
}

/** Soft score 0–100 with plain reasons. Returns null if the dates are too far apart to travel together. */
export function compatibility(mine: Candidate, theirs: Candidate, typeNames: Record<string, string>, rules: MatchingRules): Compatibility | null {
  const reasons: string[] = [];
  const { overlapDays, gapDays } = dateOverlap(mine.trip, theirs.trip);
  if (overlapDays === 0 && gapDays > rules.max_date_gap_days) return null;
  const dates = overlapDays > 0 ? overlapDays / mine.trip.days : 0.3;
  reasons.push(overlapDays > 0 ? `${overlapDays} of your ${mine.trip.days} days overlap` : `Dates are ${gapDays} ${gapDays === 1 ? "day" : "days"} apart`);

  const destination = mine.trip.placeId === theirs.trip.placeId ? 1 : 0;
  if (destination) reasons.push("Same destination");

  const pace = 1 - Math.abs(mine.profile.pace - theirs.profile.pace) / 2;
  if (mine.profile.typeId && mine.profile.typeId === theirs.profile.typeId) reasons.push(`Both ${typeNames[mine.profile.typeId] ?? "the same type"}s`);
  else if (pace === 1) reasons.push("Similar pace");
  else if (pace === 0) reasons.push("Very different pace");

  const lo = Math.min(mine.trip.budgetPp, theirs.trip.budgetPp);
  const hi = Math.max(mine.trip.budgetPp, theirs.trip.budgetPp);
  const budget = hi === 0 ? 1 : lo / hi;
  if (budget >= 0.85) reasons.push("Similar budgets");

  const fitness = 1 - Math.abs(mine.trip.fitness - theirs.trip.fitness) / 2;
  if (fitness < 1) reasons.push(theirs.trip.fitness > mine.trip.fitness ? "They're a fitter walker" : "You're the fitter walker");

  const a = new Set(mine.trip.vibes);
  const b = new Set(theirs.trip.vibes);
  const shared = [...a].filter((v) => b.has(v));
  const union = new Set([...a, ...b]).size;
  const vibes = union === 0 ? 0.5 : shared.length / union;
  if (shared.length) reasons.push(`Both into ${formatList(shared.map((v) => VIBE_LABELS[v].toLowerCase()))}`);

  const w = rules.weights;
  const breakdown = { dates, destination, pace, budget, fitness, vibes };
  const score = Math.round(w.dates * dates + w.destination * destination + w.pace * pace + w.budget * budget + w.fitness * fitness + w.vibes * vibes);
  return { score, breakdown, reasons };
}

export function ageBand(age: number, rules: MatchingRules): string {
  return rules.age_bands.find((b) => age >= b.min && age <= b.max)?.label ?? "18+";
}

/** Age from a birth year. Year-only data can be one year high; matching only ever shows a band. */
export function ageFromYear(birthYear: number, now = new Date()): number {
  return now.getUTCFullYear() - birthYear;
}
