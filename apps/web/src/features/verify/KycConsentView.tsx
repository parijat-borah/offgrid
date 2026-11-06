import type { Me } from "@offgrid/core";
import { useId, useState } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/**
 * SIMULATED DigiLocker consent screen, for demos only. In production the user lands on DigiLocker
 * itself and comes back with a code; here the tester chooses the details the "ID" contains.
 */
export function KycConsentView({ state, onDone }: { state: string; onDone: () => void }) {
  const auth = useAuth();
  const [name, setName] = useState(auth.me?.displayName ?? "");
  const [gender, setGender] = useState<"woman" | "man" | "nonbinary">("woman");
  const [year, setYear] = useState(String(auth.me?.birthYear ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), gender: useId(), year: useId() };

  if (auth.status !== "authed") return <EmptyState icon="🪪" title="Log in to continue verification" />;

  const finish = async (approved: boolean) => {
    setBusy(true);
    setError(null);
    const code = btoa(JSON.stringify({ approved, name, gender, yearOfBirth: Number(year) })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try {
      auth.setMe(await api<Me>("/verification/kyc/complete", { method: "POST", body: { state, code } }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-4 border-dashed border-sun-500 bg-sun-50 p-3 text-center text-sm font-bold">
        🧪 SIMULATED DIGILOCKER: demo only, nothing is checked against real records
      </div>
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-[#1d3b70] text-xl text-white">
            🗂️
          </div>
          <div>
            <h1 className="text-lg font-bold">OFFGRID is requesting access</h1>
            <p className="text-sm text-muted">To: Aadhaar (name, gender, year of birth, last 4 digits)</p>
          </div>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <p className="text-sm text-muted">Choose what this pretend ID says, to try different cases (for example, a year of birth that doesn't match).</p>
        <div>
          <label htmlFor={ids.name} className="mb-1 block text-sm font-semibold">
            Name on ID
          </label>
          <input id={ids.name} className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.gender} className="mb-1 block text-sm font-semibold">
            Gender on ID
          </label>
          <select id={ids.gender} className={input} value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
            <option value="woman">Female</option>
            <option value="man">Male</option>
            <option value="nonbinary">Transgender</option>
          </select>
        </div>
        <div>
          <label htmlFor={ids.year} className="mb-1 block text-sm font-semibold">
            Year of birth on ID
          </label>
          <input id={ids.year} inputMode="numeric" className={input} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void finish(false)}>
            Deny
          </Button>
          <Button disabled={busy || !name || year.length !== 4} onClick={() => void finish(true)}>
            {busy ? "Verifying…" : "Allow"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
