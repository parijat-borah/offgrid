import { formatNumber, type LeaderboardDto, type LeaderboardMetric, type LeaderboardScope, type Me } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { Tabs } from "../../design/Tabs";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const METRICS: { key: LeaderboardMetric; label: string; unit: (v: number) => string }[] = [
  { key: "xp", label: "XP", unit: (v) => `${formatNumber(v)} XP` },
  { key: "km", label: "Distance", unit: (v) => `${formatNumber(v)} km` },
  { key: "elevation", label: "Climbed", unit: (v) => `${formatNumber(v)} m` },
  { key: "contributions", label: "Places added", unit: (v) => `${v} verified` },
];
const SCOPES: { key: LeaderboardScope; label: string; empty: string }[] = [
  { key: "global", label: "Everyone", empty: "Nobody is on this month's board yet. Finish a GPS-verified trip to be first." },
  { key: "region", label: "Himachal", empty: "No verified trips in Himachal this month yet." },
  { key: "friends", label: "Buddies", empty: "Travellers you've connected with show up here once they opt in." },
];
const MEDALS = ["🥇", "🥈", "🥉"];

function seasonLabel(s: string) {
  const [y, m] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function LeaderboardView({ onBack, onLogin, onOpenTrip }: { onBack: () => void; onLogin: () => void; onOpenTrip: (id: string) => void }) {
  const auth = useAuth();
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [metric, setMetric] = useState<LeaderboardMetric>("xp");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [board, setBoard] = useState<LeaderboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (auth.status !== "authed") return;
    api<string[]>("/leaderboard/seasons")
      .then((s) => {
        setSeasons(s);
        setSeason((cur) => cur ?? s[0] ?? null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [auth.status]);

  const load = useCallback(() => {
    if (!season) return;
    setError(null);
    setBoard(null);
    api<LeaderboardDto>(`/leaderboard?scope=${scope}&metric=${metric}&season=${season}`)
      .then(setBoard)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [scope, metric, season]);
  useEffect(load, [load]);

  if (auth.status === "loading") return <Skeleton className="h-64" />;
  if (auth.status === "guest") {
    return (
      <EmptyState icon="🏆" title="Monthly leaderboards" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        See how your treks stack up against other travellers this month. Joining is optional.
      </EmptyState>
    );
  }

  const join = async () => {
    setJoining(true);
    try {
      auth.setMe(await api<Me>("/me", { method: "PATCH", body: { leaderboardOptIn: true } }));
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setJoining(false);
    }
  };

  const m = METRICS.find((x) => x.key === metric)!;
  const sc = SCOPES.find((x) => x.key === scope)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} className="-ml-3">
          ← Profile
        </Button>
        {seasons.length > 0 && season && (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Month</span>
            <select value={season} onChange={(e) => setSeason(e.target.value)} className="min-h-11 rounded-xl border border-line bg-surface px-3 font-semibold">
              {seasons.map((s, i) => (
                <option key={s} value={s}>
                  {i === 0 ? `This month (${seasonLabel(s)})` : seasonLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <h1 className="text-2xl font-extrabold">
        <span aria-hidden="true">🏆 </span>Leaderboard
      </h1>
      <p className="-mt-2 text-sm text-muted">Resets every month. Only GPS-checked trips count, so everyone competes on the same footing.</p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Rank by">
        {METRICS.map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={metric === x.key}
            onClick={() => setMetric(x.key)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${metric === x.key ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface hover:border-pine-600"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <Tabs tabs={SCOPES} active={scope} onChange={setScope}>
        {error ? (
          <ErrorState title="Couldn't load the leaderboard" detail={error} onRetry={load} />
        ) : !board ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading leaderboard">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : (
          <div className="space-y-4">
            {!board.me.optedIn && (
              <Card className="border-sun-500/40 bg-sun-50">
                <SectionTitle hint="Your name, avatar and level are shown to other travellers. Never your location or trips. You can leave any time from Edit profile.">
                  You're not on the board
                </SectionTitle>
                <p className="text-sm">
                  This month you have <span className="font-bold">{m.unit(board.me.value)}</span>.
                </p>
                <Button className="mt-3" onClick={() => void join()} disabled={joining}>
                  {joining ? "Joining…" : "Join the leaderboard"}
                </Button>
              </Card>
            )}

            {board.entries.length === 0 ? (
              <EmptyState icon="🏔️" title="The board is empty">
                {sc.empty}
              </EmptyState>
            ) : (
              <ol className="space-y-2" aria-label={`${sc.label}, ranked by ${m.label}`}>
                {board.entries.map((e) => (
                  <li
                    key={e.userId}
                    className={`flex items-center gap-3 rounded-2xl border p-3 ${e.isMe ? "border-pine-600 bg-pine-50" : "border-line bg-surface"}`}
                    aria-current={e.isMe ? "true" : undefined}
                  >
                    <span className="w-8 text-center text-lg font-extrabold" aria-label={`Rank ${e.rank}`}>
                      {MEDALS[e.rank - 1] ?? e.rank}
                    </span>
                    <span aria-hidden="true" className="text-2xl">
                      {e.avatar}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">
                        {e.displayName}
                        {e.isMe && <span className="font-normal text-muted"> (you)</span>}
                      </span>
                      <span className="block text-xs text-muted">Level {e.level}</span>
                    </span>
                    <span className="shrink-0 text-right font-extrabold">{m.unit(e.value)}</span>
                  </li>
                ))}
              </ol>
            )}

            {board.me.optedIn && board.me.rank && !board.entries.some((e) => e.isMe) && (
              <p className="rounded-xl bg-paper p-3 text-center text-sm">
                You're <span className="font-bold">#{board.me.rank}</span> with {m.unit(board.me.value)}.
              </p>
            )}

            {board.excludedTrips.length > 0 && (
              <Callout tone="warn" title={`${board.excludedTrips.length} of your trips this month don't count here`}>
                <p>They still count towards your level and badges.</p>
                <ul className="mt-2 space-y-1.5">
                  {board.excludedTrips.map((t) => (
                    <li key={t.tripId}>
                      <button type="button" onClick={() => onOpenTrip(t.tripId)} className="text-left underline-offset-2 hover:underline">
                        {t.reasons.join(" ")}
                      </button>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}

            <p className="text-center text-xs text-muted">
              <Badge>Top 50</Badge> Ties share a rank. Blocked travellers are hidden from you.
            </p>
          </div>
        )}
      </Tabs>
    </div>
  );
}
