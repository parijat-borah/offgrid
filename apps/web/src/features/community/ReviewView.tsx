import { haversineKm, POI_CATEGORY_LABELS, POI_TAG_LABELS, voteWeight, type RegionPack, type SubmissionDto, type VoteResponse } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDistance, savedCenter } from "../../lib/geo";
import { useOnline } from "../../lib/useOnline";

export const FLAG_REASONS = [
  { value: "not_real", label: "It doesn't exist / is closed for good" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "unsafe", label: "Unsafe for travellers" },
  { value: "private_property", label: "Private property" },
  { value: "fragile_or_sacred", label: "Fragile or sacred site; shouldn't be public" },
  { value: "duplicate", label: "Already listed" },
  { value: "other", label: "Something else" },
] as const;

export function ReviewView({ pack, onLogin }: { pack: RegionPack; onLogin: () => void }) {
  const auth = useAuth();
  const online = useOnline();
  const center = savedCenter({ lat: pack.planner.places[0]!.lat, lon: pack.planner.places[0]!.lon, label: pack.planner.places[0]!.name });
  const [items, setItems] = useState<SubmissionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<SubmissionDto | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<SubmissionDto[]>(`/submissions?lat=${center.lat}&lon=${center.lon}&radius_km=25`)
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [center.lat, center.lon]);

  useEffect(() => {
    if (auth.status === "authed" && online) load();
  }, [auth.status, online, load]);

  if (auth.status !== "authed") {
    return (
      <EmptyState icon="🕵️" title="Review community finds" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        Confirm places other travellers added, or flag ones that look wrong or unsafe.
      </EmptyState>
    );
  }
  if (!online) return <EmptyState icon="📶" title="Reviewing needs a connection">The latest submissions are fetched live. Nearby still works offline.</EmptyState>;
  if (error) return <ErrorState title="Couldn't load submissions" detail={error} onRetry={load} />;
  if (!items) return <Skeleton className="h-40" />;

  const vote = async (s: SubmissionDto, value: 1 | -1, reason?: string) => {
    try {
      const res = await api<VoteResponse>(`/submissions/${s.id}/vote`, { method: "POST", body: { value, reason } });
      setItems((xs) => xs!.map((x) => (x.id === s.id ? res.submission : x)));
      setToast(res.transitioned === "verified" ? "Your vote verified this place! 🎉" : res.transitioned === "flagged" ? "Sent to moderators. Thanks for keeping people safe." : "Vote saved");
    } catch (e) {
      setToast(errorMessage(e));
    }
    setFlagging(null);
  };

  const weight = voteWeight(auth.me?.trust ?? 0, pack.moderation);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Review finds near {center.label}</h1>
        <p className="text-sm text-muted">
          Only vote on places you've actually been to. Your vote counts ×{weight.toFixed(2)}; it grows with GPS-verified trips and, soon,
          ID verification.
        </p>
      </div>
      {toast && (
        <p role="status" className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">
          {toast}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState icon="✅" title="Nothing waiting for review nearby">
          Check back later, or add a place you know.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => {
            const cat = POI_CATEGORY_LABELS[s.category];
            return (
              <li key={s.id}>
                <Card className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted">
                        {cat.icon} {cat.label} · {formatDistance(haversineKm(center, s))} away
                      </p>
                      <h2 className="font-bold">{s.name}</h2>
                    </div>
                    <Badge tone="accent">
                      {s.upvotes} 👍 · {s.flags} 🚩
                    </Badge>
                  </div>
                  {s.photos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto">
                      {s.photos.map((src) => (
                        <img key={src} src={src} alt={`Photo of ${s.name}`} loading="lazy" className="h-28 w-36 shrink-0 rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  {s.tips && <p className="text-sm">{s.tips}</p>}
                  <div className="flex flex-wrap gap-1">
                    {s.approximate && <Badge tone="warn">Approximate area</Badge>}
                    {s.tags.map((t) => (
                      <Badge key={t}>{POI_TAG_LABELS[t]}</Badge>
                    ))}
                  </div>
                  {s.duplicateCandidates.length > 0 && (
                    <Callout tone="warn">Possibly the same as “{s.duplicateCandidates[0]!.name}” ({formatDistance(s.duplicateCandidates[0]!.distanceM / 1000)} away).</Callout>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={s.myVote === 1 ? "primary" : "secondary"} aria-pressed={s.myVote === 1} onClick={() => void vote(s, 1)}>
                      👍 It's real
                    </Button>
                    <Button variant={s.myVote === -1 ? "primary" : "secondary"} aria-pressed={s.myVote === -1} onClick={() => setFlagging(s)}>
                      🚩 Flag
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={flagging !== null} title={`Flag “${flagging?.name ?? ""}”`} onClose={() => setFlagging(null)}>
        <p className="mb-3 text-sm text-muted">What's wrong? Two flags send it to a moderator.</p>
        <ul className="space-y-2">
          {FLAG_REASONS.map((r) => (
            <li key={r.value}>
              <Button variant="secondary" block className="justify-start text-left" onClick={() => flagging && void vote(flagging, -1, r.value)}>
                {r.label}
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
