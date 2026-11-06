import { useId, useState } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { downloadFile } from "../../lib/download";

/** DPDP Act rights in one place: get a copy of your data, or erase it. */
export function YourDataCard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const auth = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwId = useId();

  const exportData = async () => {
    setError(null);
    try {
      const data = await api<unknown>("/me/export");
      downloadFile("offgrid-my-data.json", JSON.stringify(data, null, 2), "application/json");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/me", { method: "DELETE", body: { password } });
      setConfirming(false);
      await auth.logout();
      onLoggedOut();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle hint="You own your data. Download it or delete it at any time.">Your data</SectionTitle>
      {error && !confirming && <Callout tone="danger">{error}</Callout>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button variant="secondary" onClick={exportData}>
          ⬇ Download my data
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await auth.logout();
            onLoggedOut();
          }}
        >
          Log out
        </Button>
        <Button variant="ghost" className="text-danger-700 hover:bg-danger-50" onClick={() => setConfirming(true)}>
          Delete account
        </Button>
      </div>

      <Dialog open={confirming} title="Delete your account?" onClose={() => setConfirming(false)}>
        <p className="text-sm">
          This permanently deletes your profile, trips, GPS tracks, XP and badges straight away. It can't be undone.
        </p>
        {error && (
          <div className="mt-3">
            <Callout tone="danger">{error}</Callout>
          </div>
        )}
        <label htmlFor={pwId} className="mt-4 mb-1 block text-sm font-semibold">
          Enter your password to confirm
        </label>
        <input id={pwId} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="min-h-12 w-full rounded-xl border border-line px-3" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep my account
          </Button>
          <Button onClick={remove} disabled={busy || !password} className="bg-danger-700 hover:bg-danger-700">
            {busy ? "Deleting…" : "Delete forever"}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
