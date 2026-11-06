import type { Fitness, FitnessQuiz } from "./schemas";

export interface FitnessResult {
  points: number;
  maxPoints: number;
  level: Fitness;
  label: string;
  description: string;
}

/**
 * Score the self-assessment quiz. `answers[i]` is the chosen option index for question i.
 * A self-report is not a medical assessment; the UI says so next to the result.
 */
export function scoreFitness(quiz: FitnessQuiz, answers: number[]): FitnessResult {
  if (answers.length !== quiz.questions.length) {
    throw new RangeError(`Expected ${quiz.questions.length} answers, got ${answers.length}`);
  }
  let points = 0;
  let maxPoints = 0;
  quiz.questions.forEach((q, i) => {
    const option = q.options[answers[i]!];
    if (!option) throw new RangeError(`Invalid answer ${answers[i]} for question "${q.id}"`);
    points += option.points;
    maxPoints += Math.max(...q.options.map((o) => o.points));
  });

  const bands = [...quiz.bands].sort((a, b) => a.max_points - b.max_points);
  const band = bands.find((b) => points <= b.max_points) ?? bands[bands.length - 1]!;
  return { points, maxPoints, level: band.level, label: band.label, description: band.description };
}
