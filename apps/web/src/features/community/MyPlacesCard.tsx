import { POI_CATEGORY_LABELS, type SubmissionDto, type SubmissionStatus } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge, type Tone } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";

const STATUS: Record<SubmissionStatus, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for review", tone: "neutral" },
  verified: { label: "Verified", tone: "good" },
  flagged: { label: "With moderators", tone: "warn" },
  rejected: { label: "Not accepted", tone: "danger" },
  duplicate: { label: "Already listed", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function MyPlacesCard({ onAdd, onModerate, isModerator }: { onAdd: () => void; onModerate: () => void; isModerator: boolean }) {
  const [items, setItems] = useState<SubmissionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SubmissionDto[]>("/submissions/mine")
      .then(setItems)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const withdraw = async (id: string) => {
    try {
      await api(`/submissions/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <SectionTitle hint="Places you've added for other travellers.">My places</SectionTitle>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {!items ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">None yet. Hidden spots you add earn XP once verified.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block font-semibold">
                  <span aria-hidden="true">{POI_CATEGORY_LABELS[s.category].icon} </span>
                  {s.name}
                </span>
                <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                {s.reviewNote && <span className="block text-xs text-muted">Moderator: {s.reviewNote}</span>}
              </span>
              {(s.status === "pending" || s.status === "duplicate") && (
                <Button variant="ghost" onClick={() => void withdraw(s.id)}>
                  Withdraw
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onAdd}>
          ＋ Add a place
        </Button>
        {isModerator && (
          <Button variant="secondary" onClick={onModerate}>
            🛡️ Moderation queue
          </Button>
        )}
      </div>
    </Card>
  );
}
