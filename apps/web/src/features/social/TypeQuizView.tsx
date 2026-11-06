import { scoreTravellerType, type Me } from "@offgrid/core";
import { useState } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { TRAVELLER_TYPES, typeById } from "./types";

export function TypeQuizView({ onDone, onLogin }: { onDone: () => void; onLogin: () => void }) {
  const auth = useAuth();
  const [answers, setAnswers] = useState<(number | null)[]>(() => TRAVELLER_TYPES.questions.map(() => null));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = answers.every((a) => a !== null);
  const result = complete ? scoreTravellerType(TRAVELLER_TYPES, answers as number[]) : null;

  if (auth.status !== "authed") {
    return <EmptyState icon="🧭" title="What kind of traveller are you?" action={<Button onClick={onLogin}>Log in to take the quiz</Button>} />;
  }

  const save = async () => {
    setError(null);
    try {
      auth.setMe(await api<Me>("/me/traveller-type", { method: "POST", body: { answers } }));
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const current = typeById(auth.me?.travellerType);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">What kind of traveller are you?</h1>
        <p className="text-sm text-muted">
          Six quick questions. Your type helps match you with buddies who travel at your pace.
          {current ? ` You're currently a ${current.name}.` : ""}
        </p>
      </div>
      <ol className="space-y-4">
        {TRAVELLER_TYPES.questions.map((q, qi) => (
          <li key={q.id}>
            <Card>
              <fieldset>
                <legend className="mb-2 font-semibold">
                  {qi + 1}. {q.text}
                </legend>
                <div className="space-y-2">
                  {q.options.map((o, oi) => (
                    <label
                      key={o.label}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-sun-500 ${answers[qi] === oi ? "border-pine-700 bg-pine-50" : "border-line"}`}
                    >
                      <input type="radio" name={q.id} checked={answers[qi] === oi} onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))} className="size-4 accent-pine-700" />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
          </li>
        ))}
      </ol>

      <div aria-live="polite">
        {result && (
          <Card className="space-y-3 border-pine-600 text-center">
            <div aria-hidden="true" className="og-pop text-5xl">
              {result.type.icon}
            </div>
            <h2 className="text-xl font-extrabold">You're a {result.type.name}</h2>
            <p className="text-sm">{result.type.description}</p>
            {result.runnerUp && <p className="text-xs text-muted">With a bit of {result.runnerUp.name} {result.runnerUp.icon}</p>}
            {error && <Callout tone="danger">{error}</Callout>}
            {saved ? (
              <Button block onClick={onDone}>
                Done
              </Button>
            ) : (
              <Button block onClick={() => void save()}>
                Save to my profile
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
