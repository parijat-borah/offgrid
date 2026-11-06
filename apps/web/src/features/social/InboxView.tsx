import type { ConversationDto, MatchRequestDto, PlannerData } from "@offgrid/core";
import { useState } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { EmptyState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ratingText } from "./RateBuddyCard";

function Person({ p }: { p: MatchRequestDto["other"] }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="text-2xl">
        {p.avatar}
      </span>
      <span>
        <span className="block font-semibold">{p.displayName}</span>
        <span className="flex flex-wrap gap-1">
          {p.idVerified ? <Badge tone="good">🪪 ID Verified</Badge> : <Badge>Not ID-verified</Badge>}
          <Badge>Trust {p.trust}</Badge>
          {ratingText(p.rating) && <Badge tone="accent">{ratingText(p.rating)}</Badge>}
          {p.travellerType && <Badge>{`${p.travellerType.icon} ${p.travellerType.name}`}</Badge>}
        </span>
      </span>
    </span>
  );
}

export function InboxView({
  data,
  requests,
  conversations,
  loaded,
  onRefresh,
  onOpenChat,
  onLogin,
}: {
  data: PlannerData;
  requests: MatchRequestDto[];
  conversations: ConversationDto[];
  loaded: boolean;
  onRefresh: () => Promise<void>;
  onOpenChat: (id: string) => void;
  onLogin: () => void;
}) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (auth.status !== "authed") return <EmptyState icon="💬" title="Requests & chats" action={<Button onClick={onLogin}>Log in</Button>} />;
  if (!loaded) return <Skeleton className="h-60" />;

  const placeName = (id: string) => data.places.find((p) => p.id === id)?.name ?? id;
  const incoming = requests.filter((r) => r.direction === "incoming" && r.status === "pending");
  const outgoing = requests.filter((r) => r.direction === "outgoing" && r.status === "pending");

  const act = async (r: MatchRequestDto, action: "accept" | "decline" | "cancel") => {
    setError(null);
    try {
      const res = await api<{ conversationId?: string }>(`/match/requests/${r.id}/${action}`, { method: "POST" });
      await onRefresh();
      if (res.conversationId) onOpenChat(res.conversationId);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Requests & chats</h1>
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {incoming.length > 0 && (
        <Card className="space-y-3">
          <SectionTitle hint="Accepting opens a chat inside OFFGRID. Contact details stay hidden until you both choose to share.">Asking to travel with you</SectionTitle>
          {incoming.map((r) => (
            <div key={r.id} className="space-y-2 border-t border-line pt-3 first:border-0 first:pt-0">
              <Person p={r.other} />
              <p className="text-sm text-muted">
                {placeName(r.placeId)}
                {r.theirStartDate ? ` · from ${new Date(`${r.theirStartDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
              </p>
              {r.message && <p className="rounded-xl bg-paper p-3 text-sm">“{r.message}”</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => void act(r, "decline")}>
                  Decline
                </Button>
                <Button onClick={() => void act(r, "accept")}>Accept</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <SectionTitle>Chats</SectionTitle>
        {conversations.length === 0 ? (
          <p className="text-sm text-muted">No chats yet. Find buddies from any upcoming trip.</p>
        ) : (
          <ul className="divide-y divide-line">
            {conversations.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenChat(c.id)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:bg-pine-50">
                  <span aria-hidden="true" className="text-2xl">
                    {c.other.avatar}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {c.other.displayName} <span className="font-normal text-muted">· {placeName(c.placeId)}</span>
                    </span>
                    <span className="block truncate text-sm text-muted">{c.closed ? "Chat closed" : (c.lastMessage?.body ?? "")}</span>
                  </span>
                  {c.unread > 0 && !c.closed && <span className="grid min-w-6 place-items-center rounded-full bg-pine-700 px-1.5 text-xs font-bold text-white">{c.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {outgoing.length > 0 && (
        <Card className="space-y-3">
          <SectionTitle>Sent requests</SectionTitle>
          {outgoing.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <Person p={r.other} />
              <Button variant="ghost" onClick={() => void act(r, "cancel")}>
                Cancel
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
