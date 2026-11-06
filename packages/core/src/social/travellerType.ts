import type { TravellerType, TravellerTypes } from "./schemas";

export interface TypeResult {
  type: TravellerType;
  /** Points per type id, for showing "you're also a bit of…". */
  scores: Record<string, number>;
  runnerUp: TravellerType | null;
}

/** `answers[i]` is the chosen option index for question i. Ties go to the type listed first in the data. */
export function scoreTravellerType(data: TravellerTypes, answers: number[]): TypeResult {
  if (answers.length !== data.questions.length) throw new RangeError(`Expected ${data.questions.length} answers`);
  const scores: Record<string, number> = Object.fromEntries(data.types.map((t) => [t.id, 0]));
  data.questions.forEach((q, i) => {
    const opt = q.options[answers[i]!];
    if (!opt) throw new RangeError(`Invalid answer for "${q.id}"`);
    for (const [id, pts] of Object.entries(opt.points)) if (id in scores) scores[id]! += pts;
  });
  const ranked = [...data.types].sort((a, b) => scores[b.id]! - scores[a.id]!);
  const runnerUp = ranked[1] && scores[ranked[1].id]! > 0 ? ranked[1] : null;
  return { type: ranked[0]!, scores, runnerUp };
}
