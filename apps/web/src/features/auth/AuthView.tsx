import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { ApiFailure, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Wanderling } from "../mascot/Wanderling";

export type AuthMode = "login" | "signup";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm font-medium text-danger-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const input =
  "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base aria-[invalid=true]:border-danger-700 focus:border-pine-700";

export function AuthView({ mode, onMode, onDone }: { mode: AuthMode; onMode: (m: AuthMode) => void; onDone: () => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      if (mode === "login") await auth.login(email.trim(), password);
      else
        await auth.signup({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
          birthYear: Number(birthYear),
          acceptTerms: terms,
          confirmAdult: adult,
        });
      onDone();
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const invalid = (k: string) => (fields[k] ? true : undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Wanderling species="snow_leopard" stage="rookie" size={72} />
        <div>
          <h1 className="text-2xl font-extrabold">{mode === "login" ? "Welcome back" : "Join OFFGRID"}</h1>
          <p className="text-sm text-muted">
            {mode === "login" ? "Log in to see your trips, XP and badges." : "Save trips, earn XP and grow your Wanderling."}
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Log in or sign up" className="grid grid-cols-2 gap-2">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => onMode(m)}
            className={`min-h-11 rounded-xl border text-sm font-semibold ${
              mode === m ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface hover:bg-pine-50"
            }`}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <Card>
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && !Object.keys(fields).length && <Callout tone="danger">{error}</Callout>}

          {mode === "signup" && (
            <Field label="Name" error={fields.displayName} hint="Shown on your profile. A first name is fine.">
              {(id, d) => (
                <input id={id} aria-describedby={d} aria-invalid={invalid("displayName")} className={input} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              )}
            </Field>
          )}

          <Field label="Email" error={fields.email}>
            {(id, d) => (
              <input id={id} type="email" aria-describedby={d} aria-invalid={invalid("email")} className={input} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>

          <Field label="Password" error={fields.password} hint={mode === "signup" ? "At least 10 characters. A short phrase is easy to remember." : undefined}>
            {(id, d) => (
              <input
                id={id}
                type="password"
                aria-describedby={d}
                aria-invalid={invalid("password")}
                className={input}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          {mode === "signup" && (
            <>
              <Field label="Year of birth" error={fields.birthYear} hint="Year only. We store it encrypted and use it only to confirm you're 18+.">
                {(id, d) => (
                  <input id={id} inputMode="numeric" aria-describedby={d} aria-invalid={invalid("birthYear")} className={input} placeholder="2002" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                )}
              </Field>

              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
                <span>
                  I'm 18 or older.
                  {fields.confirmAdult && <span className="block font-medium text-danger-700">{fields.confirmAdult}</span>}
                </span>
              </label>

              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
                <span>
                  I agree to the terms and the privacy notice below.
                  {fields.acceptTerms && <span className="block font-medium text-danger-700">{fields.acceptTerms}</span>}
                </span>
              </label>

              <details className="rounded-xl bg-paper p-3 text-sm">
                <summary className="min-h-8 cursor-pointer font-semibold">Privacy notice (short version)</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                  <li>We collect your email, name, birth year and the trips and GPS points you choose to record.</li>
                  <li>We use them to run your account, award XP and keep you safe on trips. We never sell your data.</li>
                  <li>Your birth year is encrypted. Passwords are stored only as a one-way hash.</li>
                  <li>You can download all your data or delete your account at any time from your profile.</li>
                  <li>Under India's Digital Personal Data Protection Act, 2023, you can withdraw consent at any time.</li>
                </ul>
              </details>
            </>
          )}

          <Button type="submit" block disabled={busy} className="min-h-12 text-base">
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-muted">You can plan trips without an account. An account saves them and tracks your progress.</p>
    </div>
  );
}
