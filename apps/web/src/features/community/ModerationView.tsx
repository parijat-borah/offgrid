import { POI_CATEGORY_LABELS, POI_TAG_LABELS, type ModerationItem, type ReportItem } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDistance } from "../../lib/geo";
import { MapView } from "../map/MapView";
import { FLAG_REASONS } from "./ReviewView";

const reasonLabel = (r: string | null) => FLAG_REASONS.find((f) => f.value === r)?.label ?? r ?? "";

function ItemCard({ item, onDone }: { item: ModerationItem; onDone: (id: string, msg: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = POI_CATEGORY_LABELS[item.category];

  const act = async (action: "approve" | "reject" | "duplicate", duplicateOf?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/moderation/submissions/${item.id}`, { method: "POST", body: { action, duplicateOf, note: note.trim() || undefined } });
      onDone(item.id, action === "approve" ? `Approved “${item.name}”` : action === "reject" ? `Rejected “${item.name}”` : `Marked “${item.name}” as a duplicate`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">
            {cat.icon} {cat.label} · by {item.submittedBy.displayName} (trust {item.submittedBy.trust})
          </p>
          <h2 className="text-lg font-bold">{item.name}</h2>
        </div>
        <Badge tone={item.status === "flagged" ? "danger" : "neutral"}>{item.status}</Badge>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      <MapView
        center={{ lat: item.exactLat, lon: item.exactLon }}
        zoom={15}
        className="h-48"
        markers={[{ id: item.id, lat: item.exactLat, lon: item.exactLon, color: "#d9661d", label: "Exact pin (moderators only)", radiusM: item.approximate ? 1000 : undefined }]}
        label={`Exact location of ${item.name}`}
      />
      {item.approximate && <p className="text-xs text-muted">Shown publicly as an approximate ~2 km area.</p>}
      {item.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {item.photos.map((src) => (
            <img key={src} src={src} alt={`Photo of ${item.name}`} className="h-28 w-36 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}
      {item.tips && <p className="text-sm">{item.tips}</p>}
      <div className="flex flex-wrap gap-1">
        {item.tags.map((t) => (
          <Badge key={t}>{POI_TAG_LABELS[t]}</Badge>
        ))}
      </div>
      {item.votes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            {item.upvotes} up, {item.flags} flags (score {item.score})
          </summary>
          <ul className="mt-1 space-y-1 text-muted">
            {item.votes.map((v, i) => (
              <li key={i}>
                {v.value === 1 ? "👍" : "🚩"} ×{v.weight} {v.reason ? `· ${reasonLabel(v.reason)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {item.duplicateCandidates.length > 0 && (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">Possible duplicates</p>
          {item.duplicateCandidates.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <span>
                {d.name} · {formatDistance(d.distanceM / 1000)} · {Math.round(d.similarity * 100)}% similar
              </span>
              <Button variant="ghost" disabled={busy} onClick={() => void act("duplicate", d.id)}>
                Same place
              </Button>
            </div>
          ))}
        </div>
      )}
      <textarea
        aria-label="Note to the contributor (optional)"
        placeholder="Note to the contributor (optional)"
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full rounded-xl border border-line p-3 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void act("reject")}>
          Reject
        </Button>
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve
        </Button>
      </div>
    </Card>
  );
}

export function ModerationView() {
  const auth = useAuth();
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<ModerationItem[]>("/moderation/queue")
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (auth.me?.role === "moderator" || auth.me?.role === "admin") load();
  }, [auth.me?.role, load]);

  if (!auth.me || (auth.me.role !== "moderator" && auth.me.role !== "admin")) {
    return <EmptyState icon="🔒" title="Moderators only">Ask an admin to give your account moderator access.</EmptyState>;
  }
  if (error) return <ErrorState title="Couldn't load the queue" detail={error} onRetry={load} />;
  if (!items) return <Skeleton className="h-60" />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Moderation queue</h1>
        <p className="text-sm text-muted">Flagged places first. Exact locations are shown here only; keep approximate ones private.</p>
      </div>
      {toast && (
        <p role="status" className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">
          {toast}
        </p>
      )}
      <ReportsSection onToast={setToast} />
      <h2 className="text-lg font-bold">Places</h2>
      {items.length === 0 ? (
        <EmptyState icon="🎉" title="Queue is empty">Nothing waiting for review.</EmptyState>
      ) : (
        items.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            onDone={(id, msg) => {
              setItems((xs) => xs!.filter((x) => x.id !== id));
              setToast(msg);
            }}
          />
        ))
      )}
    </div>
  );
}

/** Reports about people. Upholding one costs that traveller 15 trust points. */
function ReportsSection({ onToast }: { onToast: (msg: string) => void }) {
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const load = useCallback(() => {
    api<ReportItem[]>("/moderation/reports")
      .then(setReports)
      .catch(() => setReports([]));
  }, []);
  useEffect(load, [load]);
  if (!reports) return <Skeleton className="h-24" />;

  const act = async (r: ReportItem, action: "uphold" | "dismiss") => {
    try {
      await api(`/moderation/reports/${r.id}`, { method: "POST", body: { action } });
      setReports((xs) => xs!.filter((x) => x.id !== r.id));
      onToast(action === "uphold" ? `Upheld: ${r.reported.displayName} loses 15 trust` : "Report dismissed");
    } catch (e) {
      onToast(errorMessage(e));
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">Reports about people ({reports.length})</h2>
      {reports.length === 0 ? (
        <p className="text-sm text-muted">No open reports.</p>
      ) : (
        reports.map((r) => (
          <Card key={r.id} className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="danger">{r.reason.replace(/_/g, " ")}</Badge>
              <span className="text-muted">
                {r.reporter.displayName} reported <span className="font-semibold text-ink">{r.reported.displayName}</span> (trust {r.reported.trust}, {r.reported.upheldBefore} upheld before)
              </span>
            </div>
            {r.messageBody && <p className="rounded-xl bg-paper p-3">“{r.messageBody}”</p>}
            {r.details && <p className="text-muted">{r.details}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void act(r, "dismiss")}>
                Dismiss
              </Button>
              <Button onClick={() => void act(r, "uphold")}>Uphold</Button>
            </div>
          </Card>
        ))
      )}
    </section>
  );
}
