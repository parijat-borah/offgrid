import { useState } from "react";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { discard, processOutbox, retry, useOutbox } from "../../lib/outbox";
import { useOnline } from "../../lib/useOnline";

/** Header chip showing writes waiting for signal, with a list to retry or discard them. */
export function OutboxButton() {
  const ops = useOutbox();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  if (ops.length === 0) return null;
  const failed = ops.filter((o) => o.failed).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-9 rounded-full px-2.5 text-xs font-bold ${failed ? "bg-danger-700 text-white" : "bg-sun-500 text-white"}`}
        aria-label={`${ops.length} ${ops.length === 1 ? "change" : "changes"} waiting to sync${failed ? `, ${failed} need attention` : ""}`}
      >
        ⟳ {ops.length}
      </button>
      <Dialog open={open} title="Waiting to sync" onClose={() => setOpen(false)}>
        <p className="mb-3 text-sm text-muted">
          {online ? "These will upload automatically." : "You're offline. These are saved on your phone and upload when you have signal."}
        </p>
        <ul className="space-y-2">
          {ops.map((o) => (
            <li key={o.id} className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold">{o.label}</p>
              {o.photos?.length ? <p className="text-xs text-muted">{o.photos.length} photo(s)</p> : null}
              {o.lastError && <p className={`text-xs ${o.failed ? "text-danger-700" : "text-muted"}`}>{o.lastError}</p>}
              <div className="mt-2 flex gap-2">
                {o.failed && (
                  <Button variant="secondary" onClick={() => void retry(o.id)}>
                    Retry
                  </Button>
                )}
                <Button variant="ghost" onClick={() => void discard(o.id)}>
                  Discard
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {online && (
          <Button block className="mt-3" onClick={() => void processOutbox()}>
            Sync now
          </Button>
        )}
      </Dialog>
    </>
  );
}
