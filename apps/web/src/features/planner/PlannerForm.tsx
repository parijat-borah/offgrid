import {
  DIFFICULTY_LABELS,
  formatINR,
  MONTH_NAMES,
  PlannerInputSchema,
  VIBE_LABELS,
  VIBES,
  type Fitness,
  type FitnessQuiz,
  type PlannerInput,
  type Vibe,
} from "@offgrid/core";
import { useId, useState, type FormEvent } from "react";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Chip, Segmented, Stepper } from "../../design/Fields";
import { FitnessQuizDialog } from "./FitnessQuizDialog";

const BUDGET_PRESETS = [5000, 8000, 12000, 20000];

export function PlannerForm({
  initial,
  quiz,
  onSubmit,
}: {
  initial: PlannerInput;
  quiz: FitnessQuiz;
  onSubmit: (input: PlannerInput) => void;
}) {
  const [budgetText, setBudgetText] = useState(String(initial.budgetPerPerson));
  const [days, setDays] = useState(initial.days);
  const [month, setMonth] = useState(initial.month);
  const [fitness, setFitness] = useState<Fitness>(initial.fitness);
  const [groupSize, setGroupSize] = useState(initial.groupSize);
  const [vibes, setVibes] = useState<Vibe[]>(initial.vibes);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const budgetId = useId();
  const monthId = useId();
  const headingId = useId();

  const toggleVibe = (v: Vibe) => setVibes((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const budget = Number(budgetText.replace(/[,\s₹]/g, ""));
    const parsed = PlannerInputSchema.safeParse({
      budgetPerPerson: Math.round(budget),
      days,
      month,
      fitness,
      groupSize,
      vibes,
    });
    if (!parsed.success) {
      setBudgetError("Enter a budget between ₹500 and ₹5,00,000 per person.");
      document.getElementById(budgetId)?.focus();
      return;
    }
    setBudgetError(null);
    onSubmit(parsed.data);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="text-xl font-extrabold">
          Plan your trip
        </h2>
        <p className="mt-0.5 text-sm text-muted">We rule out what's closed, too hard or too costly, and explain every pick.</p>
      </div>

      <Card className="space-y-5">
        <div>
          <label htmlFor={budgetId} className="mb-1.5 block text-sm font-semibold">
            Budget per person
          </label>
          <div className="flex items-center rounded-xl border border-line bg-surface focus-within:border-pine-700">
            <span aria-hidden="true" className="pl-3 text-lg font-semibold text-muted">
              ₹
            </span>
            <input
              id={budgetId}
              inputMode="numeric"
              autoComplete="off"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              aria-invalid={budgetError ? true : undefined}
              aria-describedby={budgetError ? `${budgetId}-err` : `${budgetId}-hint`}
              className="min-h-12 w-full rounded-xl bg-transparent px-2 text-lg font-bold tabular-nums outline-none"
            />
          </div>
          {budgetError ? (
            <p id={`${budgetId}-err`} className="mt-1 text-sm font-medium text-danger-700">
              {budgetError}
            </p>
          ) : (
            <p id={`${budgetId}-hint`} className="mt-1 text-xs text-muted">
              Everything included: travel from Delhi, stay, food, activities and permits.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {BUDGET_PRESETS.map((b) => (
              <Chip key={b} selected={budgetText === String(b)} onToggle={() => setBudgetText(String(b))}>
                {formatINR(b)}
              </Chip>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Stepper label="Days" value={days} min={1} max={14} onChange={setDays} />
          <Stepper label="People" value={groupSize} min={1} max={12} onChange={setGroupSize} />
        </div>

        <div className="max-w-sm">
          <label htmlFor={monthId} className="mb-1.5 block text-sm font-semibold">
            Month of travel
          </label>
          <select
            id={monthId}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Segmented<Fitness>
            label="Fitness level"
            value={fitness}
            onChange={setFitness}
            options={[1, 2, 3].map((n) => ({
              value: n as Fitness,
              label: DIFFICULTY_LABELS[n]!,
              hint: n === 1 ? "≤10 km/day" : n === 2 ? "≤15 km/day" : "≤22 km/day",
            }))}
          />
          <Button variant="ghost" className="mt-1 -ml-2" onClick={() => setQuizOpen(true)}>
            Not sure? Take the 5-question fitness check
          </Button>
        </div>
      </Card>

      <Card>
        <fieldset>
          <legend className="text-sm font-semibold">What's your vibe?</legend>
          <p className="mb-2 text-xs text-muted">Pick any. Leave empty and we'll rank on budget, days and season.</p>
          <div className="flex flex-wrap gap-2">
            {VIBES.map((v) => (
              <Chip key={v} selected={vibes.includes(v)} onToggle={() => toggleVibe(v)}>
                {VIBE_LABELS[v]}
              </Chip>
            ))}
          </div>
        </fieldset>
      </Card>

      {/* Phones: the button stays in thumb reach. Laptops: it sits under the form like any other. */}
      <div className="sticky bottom-16 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <Button type="submit" block className="min-h-12 text-base">
          Find my trip →
        </Button>
      </div>

      <FitnessQuizDialog
        open={quizOpen}
        quiz={quiz}
        onClose={() => setQuizOpen(false)}
        onUse={(level) => {
          setFitness(level);
          setQuizOpen(false);
        }}
      />
    </form>
  );
}
