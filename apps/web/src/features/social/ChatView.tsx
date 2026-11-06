import type { ConversationDto, MessageDto, PlannerData } from "@offgrid/core";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { openStream } from "../../lib/stream";
import { RateBuddyCard, ratingText } from "./RateBuddyCard";

const REASONS = [
  { value: "harassment", label: "Harassment or threats" },
  { value: "unsafe_behaviour", label: "Unsafe behaviour or plans" },
  { value: "scam_or_money", label: "Asked for money or seems like a scam" },
  { value: "fake_profile", label: "Fake profile or pretending to be someone" },
  { value: "inappropriate", label: "Sexual or inappropriate messages" },
  { value: "underage", label: "Seems to be under 18" },
  { value: "other", label: "Something else" },
] as const;

export function ChatView({ data, conversationId, onBack, onChanged }: { data: PlannerData; conversationId: string; onBack: () => void; onChanged: () => void }) {
  const [conv, setConv] = useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ type: "user" | "message"; id: string } | null>(null);
  const [reason, setReason] = useState<string>("harassment");
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const draftId = useId();
  // Kept in a ref so a new callback from the parent never re-opens the stream.
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const add = useCallback((ms: MessageDto[]) => {
    setMessages((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      return [...cur, ...ms.filter((m) => !seen.has(m.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const load = useCallback(async () => {
    try {
      setConv(await api<ConversationDto>(`/conversations/${conversationId}`));
      add(await api<MessageDto[]>(`/conversations/${conversationId}/messages`));
      await api(`/conversations/${conversationId}/read`, { method: "POST" });
      changed.current();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [conversationId, add]);

  useEffect(() => {
    void load();
    // Live updates; the stream reconnects on its own after drops.
    const stop = openStream(`/conversations/${conversationId}/stream`, (event, payload) => {
      if (event !== "message") return;
      const m = JSON.parse(payload) as MessageDto;
      add([m]);
      if (m.system) void api<ConversationDto>(`/conversations/${conversationId}`).then(setConv).catch(() => undefined);
    });
    return stop;
  }, [conversationId, load, add]);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect that returns
  // anything but a function crashes React when it tries to "clean up" (found in the walkthrough).
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (error && !conv) return <ErrorState title="Couldn't open this chat" detail={error} onRetry={() => void load()} />;
  if (!conv) return <Skeleton className="h-80" />;
  const place = data.places.find((p) => p.id === conv.placeId);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      const m = await api<MessageDto>(`/conversations/${conversationId}/messages`, { method: "POST", body: { body } });
      add([m]);
      setDraft("");
      if (m.masked) setNotice("Contact details were hidden. Tap “Share contact” when you're both ready.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const shareContact = async () => {
    try {
      setConv(await api<ConversationDto>(`/conversations/${conversationId}/share-contact`, { method: "POST" }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const block = async () => {
    if (!confirm(`Block ${conv.other.displayName}? The chat closes and you won't see each other again.`)) return;
    await api(`/safety/blocks/${conv.other.userId}`, { method: "POST" }).catch((e: unknown) => setError(errorMessage(e)));
    changed.current();
    void load();
  };

  const submitReport = async () => {
    if (!reporting) return;
    try {
      await api("/safety/reports", { method: "POST", body: { targetType: reporting.type, targetId: reporting.id, reason, details, block: alsoBlock } });
      setReporting(null);
      setNotice(alsoBlock ? "Reported and blocked. A moderator will review it." : "Reported. A moderator will review it.");
      changed.current();
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const shareTrip = async () => {
    const text = `I'm planning ${place?.name ?? "a trip"} with ${conv.other.displayName}, a traveller I met on OFFGRID${conv.other.idVerified ? " (ID verified)" : ""}. I'll check in with you. If you don't hear from me, call 112.`;
    try {
      if (navigator.share) await navigator.share({ title: "My travel buddy", text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="flex min-h-[70dvh] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2">
          ← Chats
        </Button>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => setReporting({ type: "user", id: conv.other.userId })}>
            🚩 Report
          </Button>
          {!conv.closed && (
            <Button variant="ghost" onClick={() => void block()}>
              ⛔ Block
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-3xl">
          {conv.other.avatar}
        </span>
        <div>
          <h1 className="text-lg font-bold">{conv.other.displayName}</h1>
          <div className="flex flex-wrap gap-1">
            {conv.other.idVerified ? <Badge tone="good">🪪 ID Verified</Badge> : <Badge>Not ID-verified</Badge>}
            <Badge>Trust {conv.other.trust}</Badge>
            {ratingText(conv.other.rating) && <Badge tone="accent">{ratingText(conv.other.rating)}</Badge>}
            {place && <Badge tone="accent">{place.name}</Badge>}
          </div>
        </div>
      </div>

      {conv.closed ? (
        <Callout tone="warn">This chat is closed.</Callout>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-3 text-sm">
          {conv.other.phone ? (
            <p>
              📞 <a className="font-bold text-pine-700 underline" href={`tel:${conv.other.phone}`}>{conv.other.phone}</a> (you both chose to share)
            </p>
          ) : conv.iShared ? (
            <p className="text-muted">You've offered to share numbers. They'll appear when {conv.other.displayName} agrees too.</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted">{conv.theyShared ? `${conv.other.displayName} is happy to share numbers.` : "Numbers stay hidden until you both agree."}</p>
              <Button variant="secondary" onClick={() => void shareContact()}>
                Share contact
              </Button>
            </div>
          )}
          <Button variant="ghost" className="mt-1 -ml-2" onClick={() => void shareTrip()}>
            📤 Tell someone I'm travelling with {conv.other.displayName}
          </Button>
        </div>
      )}

      {conv.canRate && <RateBuddyCard conv={conv} onRated={setConv} />}

      {notice && (
        <p role="status" className="rounded-xl bg-paper p-2 text-xs text-muted">
          {notice}
        </p>
      )}
      {error && <Callout tone="danger">{error}</Callout>}

      <ol className="flex-1 space-y-2" aria-live="polite" aria-label="Messages">
        {messages.map((m) =>
          m.system ? (
            <li key={m.id} className="mx-auto max-w-md rounded-xl bg-pine-50 p-3 text-center text-xs text-pine-800">
              🛡️ {m.body}
            </li>
          ) : (
            <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`group max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-pine-700 text-white" : "border border-line bg-surface"}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[11px] ${m.mine ? "text-pine-100" : "text-muted"}`}>
                  {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  {m.masked ? " · contact hidden" : ""}
                  {!m.mine && (
                    <button type="button" className="ml-2 underline" onClick={() => setReporting({ type: "message", id: m.id })} aria-label="Report this message">
                      report
                    </button>
                  )}
                </p>
              </div>
            </li>
          ),
        )}
      </ol>
      <div ref={bottom} />

      {!conv.closed && (
        <form onSubmit={send} className="sticky bottom-16 lg:bottom-0 -mx-4 sm:-mx-6 lg:-mx-8 flex gap-2 border-t border-line bg-paper/95 px-4 sm:px-6 lg:px-8 py-2 backdrop-blur">
          <label htmlFor={draftId} className="sr-only">
            Message
          </label>
          <input id={draftId} value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} placeholder="Message" className="min-h-12 flex-1 rounded-xl border border-line bg-surface px-3" autoComplete="off" />
          <Button type="submit" disabled={!draft.trim()}>
            Send
          </Button>
        </form>
      )}

      <Dialog open={reporting !== null} title={reporting?.type === "message" ? "Report this message" : `Report ${conv.other.displayName}`} onClose={() => setReporting(null)}>
        <div className="space-y-3 text-sm">
          <p>A moderator will review it. {conv.other.displayName} won't be told who reported them. If you're in danger now, call 112.</p>
          <fieldset className="space-y-1">
            <legend className="mb-1 font-semibold">What's wrong?</legend>
            {REASONS.map((r) => (
              <label key={r.value} className="flex min-h-10 items-center gap-2">
                <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} className="size-4 accent-pine-700" />
                {r.label}
              </label>
            ))}
          </fieldset>
          <textarea aria-label="Details (optional)" placeholder="Details (optional)" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-xl border border-line p-3" />
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-5 accent-pine-700" />
            Also block them
          </label>
          <Button block onClick={() => void submitReport()}>
            Send report
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
