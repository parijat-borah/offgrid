import type { CompleteTripResponse, Validation } from "@offgrid/core";
import { Badge, type Tone } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Wanderling } from "../mascot/Wanderling";

export const VALIDATION_LABEL: Record<Validation, { label: string; tone: Tone }> = {
  verified: { label: "GPS-verified", tone: "good" },
  partial: { label: "Partly verified", tone: "warn" },
  manual: { label: "Manual entry", tone: "neutral" },
};

function Sparkles() {
  const bits = ["✨", "⭐", "✨", "🎉", "⭐"];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {bits.map((b, i) => (
        <span
          key={i}
          className="og-sparkle absolute text-xl"
          style={{ left: `${12 + i * 18}%`, top: `${40 + (i % 2) * 20}%`, animationDelay: `${i * 0.12}s` }}
        >
          {b}
        </span>
      ))}
    </div>
  );
}

export function LevelUpDialog({
  result,
  onClose,
  onProfile,
}: {
  result: CompleteTripResponse | null;
  onClose: () => void;
  onProfile: () => void;
}) {
  if (!result) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>;
  const { me, levelUp, stageChange } = result;
  const v = VALIDATION_LABEL[result.validation];
  const title = stageChange ? "Your Wanderling evolved!" : levelUp ? `Level ${levelUp.to}!` : "Trip complete!";

  return (
    <Dialog open title={title} onClose={onClose}>
      <div className="relative flex flex-col items-center text-center">
        {(levelUp || stageChange) && <Sparkles />}
        <div className="flex items-end gap-2">
          {stageChange && (
            <>
              <Wanderling species={me.mascotSpecies} stage={stageChange.from.id} stageName={stageChange.from.name} size={64} motion="still" className="opacity-50" />
              <span aria-hidden="true" className="mb-6 text-2xl text-muted">
                →
              </span>
            </>
          )}
          <Wanderling species={me.mascotSpecies} stage={me.stage.id} stageName={me.stage.name} size={140} motion="pop" />
        </div>
        <p className="mt-1 font-bold">{me.stage.name}</p>
        {stageChange && <p className="text-sm text-muted">{stageChange.to.description}</p>}

        <p className="mt-4 text-4xl font-extrabold text-pine-700" aria-live="polite">
          +{result.xpAwarded} XP
        </p>
        <p className="text-xs text-muted">{result.xpNote}</p>
        {levelUp && (
          <p className="mt-1 font-semibold">
            Level {levelUp.from} → {levelUp.to}
          </p>
        )}

        <div
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-line"
          role="meter"
          aria-label="Progress to next level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={me.level.pct}
        >
          <div className="h-full rounded-full bg-pine-600" style={{ width: `${me.level.pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {me.level.toNext} XP to level {me.level.level + 1}
        </p>
      </div>

      <div className="mt-4 rounded-xl bg-paper p-3 text-sm">
        <Badge tone={v.tone}>{v.label}</Badge>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {result.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      {result.newBadges.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold">New {result.newBadges.length === 1 ? "badge" : "badges"}</h3>
          <ul className="grid grid-cols-2 gap-2">
            {result.newBadges.map((b, i) => (
              <li key={b.id} className="og-pop rounded-xl border border-pine-100 bg-pine-50 p-2 text-center" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
                <div aria-hidden="true" className="text-2xl">
                  {b.icon}
                </div>
                <p className="text-sm font-bold">{b.name}</p>
                <p className="text-xs text-muted">+{b.xp} XP</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {me.nudges[0] && <p className="mt-4 text-sm text-muted">Next up: {me.nudges[0]}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onProfile}>See my profile</Button>
      </div>
    </Dialog>
  );
}
