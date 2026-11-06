import { scoreFitness, type Fitness, type FitnessQuiz } from "@offgrid/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../design/Button";
import { Callout } from "../../design/Badge";

/** Native <dialog>: focus is trapped, Esc closes, and the backdrop is handled by the browser. */
export function FitnessQuizDialog({
  open,
  quiz,
  onClose,
  onUse,
}: {
  open: boolean;
  quiz: FitnessQuiz;
  onClose: () => void;
  onUse: (level: Fitness) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null));

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setAnswers(quiz.questions.map(() => null));
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, quiz]);

  const complete = answers.every((a) => a !== null);
  const result = complete ? scoreFitness(quiz, answers as number[]) : null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="fitness-title"
      className="m-auto rounded-2xl bg-surface p-0 text-ink shadow-xl"
      style={{ width: "min(100% - 2rem, 32rem)", maxWidth: "none" }}
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <h2 id="fitness-title" className="text-lg font-bold">
            Fitness check
          </h2>
          <Button variant="ghost" aria-label="Close" onClick={onClose} className="-mt-2 -mr-2">
            ✕
          </Button>
        </div>
        <p className="text-sm text-muted">Five quick questions. Be honest: it's for your safety on the trail.</p>

        <ol className="mt-4 space-y-5">
          {quiz.questions.map((q, qi) => (
            <li key={q.id}>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">
                  {qi + 1}. {q.text}
                </legend>
                <div className="space-y-2">
                  {q.options.map((o, oi) => (
                    <label
                      key={o.label}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-sun-500 ${
                        answers[qi] === oi ? "border-pine-700 bg-pine-50" : "border-line"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={answers[qi] === oi}
                        onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                        className="size-4 accent-pine-700"
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ol>

        <div aria-live="polite" className="mt-5">
          {result && (
            <div className="space-y-3">
              <Callout tone="good" title={`Level ${result.level}: ${result.label}`}>
                <p>{result.description}</p>
                <p className="mt-1 text-xs text-muted">
                  Score {result.points}/{result.maxPoints}
                </p>
              </Callout>
              <p className="text-xs text-muted">
                This is a self-check, not medical advice. If you have heart, lung or blood-pressure conditions, see a doctor
                before going above 3,000 m.
              </p>
              <Button block onClick={() => onUse(result.level)}>
                Use level {result.level}
              </Button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
