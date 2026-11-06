// Small synthetic places so rule tests don't break whenever the real seed data is edited.
import { EMPTY_MEDIA } from "../src/media";
import type { PlannerData } from "../src/pack";
import type { FitnessQuiz, PackingRule, Pass, Place, PlannerInput, Region, ScoringRules } from "../src/schemas";

export const rules: ScoringRules = {
  version: "test",
  weights: { vibe: 40, budget: 20, days: 15, season: 15, novelty: 10 },
  budget_tolerance_pct: 10,
  buffer_pct: 10,
  solo_stay_multiplier: 1.5,
  risky_season_score: 0.4,
  neutral_vibe_score: 0.5,
  high_altitude_note_m: 3500,
  fitness_km_per_day: { "1": 10, "2": 15, "3": 22 },
  ams: { threshold_m: 3000, max_gain_per_night_m: 500 },
};

export const region: Region = {
  id: "testland",
  name: "Testland",
  state: "Testland",
  bbox: [70, 25, 80, 35],
  pack_version: "test",
  default_access_from: "Delhi",
  utc_offset_minutes: 330,
  emergency: [{ label: "All emergencies", number: "112" }],
};

export const passes: Pass[] = [{ id: "high_road", name: "High Road", closed_months: [11, 12, 1, 2, 3, 4, 5], note: "Snow." }];

export function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "easy-lake",
    region_id: "testland",
    name: "Easy Lake",
    type: "lake",
    district: "Test",
    base_town: "Basetown",
    base_alt_m: 2000,
    lat: 30,
    lon: 75,
    summary: "A test lake.",
    difficulty: 1,
    days_min: 2,
    days_max: 3,
    max_altitude_m: 2800,
    distance_km: 12,
    elevation_gain_m: 800,
    stay_type: "camp",
    season: {
      good: [3, 4, 5, 9, 10, 11],
      risky: [{ months: [6, 7, 8], reason: "Monsoon." }],
      closed: [{ months: [12, 1, 2], reason: "Snow." }],
    },
    access_via: [],
    vibes: ["lakes", "camping"],
    cost: {
      stay: 1000,
      food: 500,
      local_transport: 100,
      activities: 0,
      activities_once: 0,
      transport_roundtrip: 2000,
      permit: 0,
      access_from: "Delhi",
      is_estimate: true,
      source: "test",
      last_verified: "2026-10-01",
    },
    base_xp: 50,
    hazards: ["landslide"],
    safety_notes: ["Be careful."],
    permit_notes: "None.",
    plan: [
      { title: "Up", detail: "Walk up.", trek_km: 6, sleep_alt_m: 2800 },
      { title: "Down", detail: "Walk down.", trek_km: 6, sleep_alt_m: 2000 },
    ],
    extras: [{ after_day: 1, kind: "side_trip", title: "Ridge", detail: "Ridge walk.", trek_km: 4, sleep_alt_m: 2800 }],
    sensitive: false,
    ...overrides,
  };
}

export const packing: PackingRule[] = [];

export const fitnessQuiz: FitnessQuiz = {
  questions: [
    { id: "a", text: "A?", options: [{ label: "x", points: 0 }, { label: "y", points: 1 }, { label: "z", points: 2 }] },
    { id: "b", text: "B?", options: [{ label: "x", points: 0 }, { label: "y", points: 1 }, { label: "z", points: 2 }] },
  ],
  bands: [
    { max_points: 1, level: 1, label: "Easy", description: "" },
    { max_points: 3, level: 2, label: "Moderate", description: "" },
    { max_points: 4, level: 3, label: "Hard", description: "" },
  ],
};

export function makeData(places: Place[]): PlannerData {
  return { region, places, passes, rules, packing, fitnessQuiz, media: EMPTY_MEDIA };
}

export function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return { budgetPerPerson: 10000, days: 2, month: 10, fitness: 1, groupSize: 2, vibes: [], ...overrides };
}
