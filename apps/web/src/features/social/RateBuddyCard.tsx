import { RATING_TAGS, type ConversationDto, type RatingTag } from "@offgrid/core";
import { useState } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { api, errorMessage } from "../../lib/api";

export const TAG_LABELS: Record<RatingTag, string> = {
  punctual: "⏰ On time",
  safe: "🛡️ Felt safe",
  fun: "🎉 Fun",
  fair_with_money: "🤝 Fair with money",
  good_navigator: "🧭 Good navigator",
  respectful: "🙏 Respectful",
};

/** "★ 4.6 (5)" for person cards; null when nobody has rated them yet. */
export function ratingText(r: { avg: number; count: number } | null): string | null {
  return r ? `★ ${r.avg.toFixed(1)} (${r.count})` : null;
}

/**
 * Shown in the chat once the trip is over. Ratings are private (the other person sees only their
 * average) and feed their trust score, so people who travel well become easier to find.
 */
export function RateBuddyCard({ conv, onRated }: { conv: ConversationDto; onRated: (c: ConversationDto) => void }) {
  const [stars, setStars] = useState(conv.myRating ?? 0);
  const [tags, setTags] = useState<RatingTag[]>([]);
  const [editing, setEditing] = useState(conv.myRating === null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = conv.other.displayName;

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
        <p>
          You rated {name} <span className="font-bold text-sun-500">{"★".repeat(conv.myRating ?? 0)}</span>. Thanks, it helps other travellers.
        </p>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onRated(await api<ConversationDto>(`/conversations/${conv.id}/rate`, { method: "POST", body: { stars, tags } }));
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-sun-500/40 bg-sun-50 p-3 text-sm">
      <p className="font-bold">How was travelling with {name}?</p>
      <div role="radiogroup" aria-label="Stars" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setStars(n)}
            className={`grid size-11 place-items-center rounded-full text-2xl ${n <= stars ? "text-sun-500" : "text-line"} hover:bg-surface`}
          >
            ★
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What stood out (optional)">
        {RATING_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
              className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${on ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface"}`}
            >
              {TAG_LABELS[t]}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">{name} sees only their average, never who gave which rating. Something unsafe happened? Use Report instead.</p>
      {error && <Callout tone="danger">{error}</Callout>}
      <Button onClick={() => void save()} disabled={stars === 0 || saving}>
        {saving ? "Saving…" : "Save rating"}
      </Button>
    </div>
  );
}
