import { PlannerInputSchema, VIBES, type PlannerInput, type Vibe } from "./schemas";

/**
 * Share links carry only planner inputs, never personal data, so they work offline and
 * need no server. Server-side share tokens for saved trips arrive with accounts in Phase 2.
 */
export function encodeShare(input: PlannerInput, placeId?: string): string {
  const params = new URLSearchParams({
    b: String(input.budgetPerPerson),
    d: String(input.days),
    m: String(input.month),
    f: String(input.fitness),
    g: String(input.groupSize),
  });
  if (input.vibes.length) params.set("v", input.vibes.join(","));
  if (placeId) params.set("p", placeId);
  return params.toString();
}

export interface DecodedShare {
  input: PlannerInput | null;
  placeId: string | null;
}

/** Tolerant decoder: anything malformed yields null instead of throwing. */
export function decodeShare(search: string): DecodedShare {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const placeRaw = params.get("p");
  const placeId = placeRaw && /^[a-z0-9-]{1,64}$/.test(placeRaw) ? placeRaw : null;
  if (!params.has("b")) return { input: null, placeId };

  const vibes = (params.get("v") ?? "")
    .split(",")
    .filter((v): v is Vibe => (VIBES as readonly string[]).includes(v));
  const candidate = {
    budgetPerPerson: Number(params.get("b")),
    days: Number(params.get("d")),
    month: Number(params.get("m")),
    fitness: Number(params.get("f")),
    groupSize: Number(params.get("g")),
    vibes: [...new Set(vibes)],
  };
  const parsed = PlannerInputSchema.safeParse(candidate);
  return { input: parsed.success ? parsed.data : null, placeId };
}
