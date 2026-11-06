import { haversineKm, type LatLon } from "../geo";
import type { ModerationRules } from "./schemas";

/** Lowercase, strip accents and punctuation, so "Moon Café!" and "moon cafe" compare equal. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${normalizeName(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams: 1 = identical, 0 = nothing shared. Robust to typos. */
export function nameSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  source: string;
  distanceM: number;
  similarity: number;
  /** Close and similar enough that we mark it a duplicate without asking a human. */
  certain: boolean;
}

export function findDuplicates(
  candidate: LatLon & { name: string },
  existing: (LatLon & { id: string; name: string; source: string })[],
  rules: ModerationRules,
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  for (const e of existing) {
    const distanceM = Math.round(haversineKm(candidate, e) * 1000);
    if (distanceM > rules.duplicate_radius_m) continue;
    const similarity = Math.round(nameSimilarity(candidate.name, e.name) * 100) / 100;
    if (similarity < rules.duplicate_min_similarity) continue;
    out.push({
      id: e.id,
      name: e.name,
      source: e.source,
      distanceM,
      similarity,
      certain: distanceM <= rules.auto_duplicate_radius_m && similarity >= rules.auto_duplicate_similarity,
    });
  }
  return out.sort((a, b) => b.similarity - a.similarity || a.distanceM - b.distanceM);
}

/**
 * Snap to the centre of a fixed grid cell (about 2 km for 0.02°). Deterministic on purpose:
 * random jitter could be averaged away by looking at the place many times.
 */
export function fuzzLocation(p: LatLon, gridDeg: number): LatLon {
  const snap = (v: number) => Math.round((Math.floor(v / gridDeg) * gridDeg + gridDeg / 2) * 1e6) / 1e6;
  return { lat: snap(p.lat), lon: snap(p.lon) };
}

export interface TrustInput {
  phoneVerified: boolean;
  emailVerified: boolean;
  govIdVerified: boolean;
  livenessVerified: boolean;
  verifiedTrips: number;
  /** Average peer rating 1–5, or null when nobody has rated yet. */
  avgRating: number | null;
  upheldReports: number;
}

export interface TrustPart {
  label: string;
  points: number;
  max: number;
}

/** Where a trust score comes from, so travellers can see exactly how to raise it (and why it dropped). */
export function trustBreakdown(t: TrustInput): { score: number; parts: TrustPart[] } {
  const parts: TrustPart[] = [
    { label: "Phone verified", points: t.phoneVerified ? 25 : 0, max: 25 },
    { label: "Email verified", points: t.emailVerified ? 10 : 0, max: 10 },
    { label: "Government ID (DigiLocker)", points: t.govIdVerified ? 30 : 0, max: 30 },
    { label: "Selfie check", points: t.livenessVerified ? 10 : 0, max: 10 },
    { label: `GPS-verified trips (${t.verifiedTrips})`, points: Math.min(15, 3 * t.verifiedTrips), max: 15 },
    { label: "Ratings from travel buddies", points: t.avgRating === null ? 0 : Math.round((10 * (t.avgRating - 3)) / 2), max: 10 },
  ];
  if (t.upheldReports > 0) parts.push({ label: `Reports upheld by moderators (${t.upheldReports})`, points: -15 * t.upheldReports, max: 0 });
  const raw = parts.reduce((s, p) => s + p.points, 0);
  return { score: Math.max(0, Math.min(100, Math.round(raw))), parts };
}

/** Trust score 0–100, as in DATA_MODEL.md. */
export function trustScore(t: TrustInput): number {
  return trustBreakdown(t).score;
}

/** A new account's vote still counts, but trusted travellers count for several. */
export function voteWeight(trust: number, rules: ModerationRules): number {
  return Math.round((rules.base_vote_weight + trust / 100) * 100) / 100;
}

export interface VoteTally {
  score: number;
  upvotes: number;
  flags: number;
  flagWeight: number;
  decision: "verify" | "flag" | "none";
}

/** Flags win over upvotes: a possibly unsafe or fake place goes to a human before anything else. */
export function tallyVotes(votes: { value: 1 | -1; weight: number }[], rules: ModerationRules): VoteTally {
  let score = 0;
  let upvotes = 0;
  let flags = 0;
  let flagWeight = 0;
  for (const v of votes) {
    score += v.value * v.weight;
    if (v.value === 1) upvotes++;
    else {
      flags++;
      flagWeight += v.weight;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const decision =
    flagWeight >= rules.flag_score ? "flag" : score >= rules.verify_score && upvotes >= rules.verify_min_upvotes ? "verify" : "none";
  return { score: round(score), upvotes, flags, flagWeight: round(flagWeight), decision };
}
