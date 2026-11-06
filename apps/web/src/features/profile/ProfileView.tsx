import { formatINR, formatNumber, type PlannerData, type TripDto } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { MyPlacesCard } from "../community/MyPlacesCard";
import { typeById } from "../social/types";
import { VerificationCard } from "../verify/VerificationCard";
import { SPECIES_NAMES, Wanderling } from "../mascot/Wanderling";
import { VALIDATION_LABEL } from "../trips/LevelUpDialog";
import { RouteSparkline } from "../trips/RouteSparkline";
import { EditProfileDialog, STYLE_LABELS } from "./EditProfileDialog";
import { YourDataCard } from "./YourDataCard";

export function ProfileView({
  data,
  onLogin,
  onOpenTrip,
  onPlan,
  onAddPlace,
  onModerate,
  onQuiz,
  onLeaderboard,
  onBeacon,
}: {
  data: PlannerData;
  onLogin: () => void;
  onOpenTrip: (id: string) => void;
  onPlan: () => void;
  onAddPlace: () => void;
  onModerate: () => void;
  onQuiz: () => void;
  onLeaderboard: () => void;
  onBeacon: () => void;
}) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [feed, setFeed] = useState<TripDto[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  const loadFeed = useCallback(() => {
    setFeedError(null);
    api<TripDto[]>("/trips?status=completed")
      .then(setFeed)
      .catch((e: unknown) => setFeedError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (auth.status === "authed") loadFeed();
  }, [auth.status, loadFeed]);

  if (auth.status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading profile">
        <Skeleton className="h-48" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (auth.status === "guest" || !auth.me) {
    return auth.serverDown ? (
      <ErrorState title="Can't reach the OFFGRID server" detail="Your profile needs a connection. The trip planner still works offline." onRetry={() => void auth.reload()} />
    ) : (
      <EmptyState icon="🐾" title="Your traveller profile" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        Save trips, earn XP for the treks you complete, collect badges and watch your Wanderling evolve.
      </EmptyState>
    );
  }

  const me = auth.me;
  const placeName = (id: string) => data.places.find((p) => p.id === id)?.name ?? id;
  const stats: [string, string][] = [
    ["Trips", String(me.stats.tripsCompleted)],
    ["Treks", String(me.stats.treksCompleted)],
    ["Distance", `${formatNumber(me.stats.kmTotal)} km`],
    ["Climbed", `${formatNumber(me.stats.elevationGainM)} m`],
    ["Highest", me.stats.highestAltitudeM ? `${formatNumber(me.stats.highestAltitudeM)} m` : "—"],
    ["States", String(me.stats.statesVisited.length)],
    ["Spent", formatINR(me.stats.moneySpent)],
    ["GPS-verified", String(me.stats.verifiedTrips)],
  ];
  const earned = me.badges.filter((b) => b.earned);
  const locked = me.badges.filter((b) => !b.earned).sort((a, b) => b.progress - a.progress);

  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:gap-8">
      {/* Laptop: who you are on the left, what you've done on the right. Phones: one column in that order. */}
      <div className="space-y-5 lg:col-span-5 xl:col-span-4">
        <Card className="text-center">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setEditing(true)} className="-mt-2 -mr-2">
              ✎ Edit
            </Button>
          </div>
          <div className="-mt-6 flex justify-center">
            <Wanderling species={me.mascotSpecies} stage={me.stage.id} stageName={me.stage.name} size={150} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-pine-700">
            {me.stage.name} · {SPECIES_NAMES[me.mascotSpecies]}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold">
            <span aria-hidden="true">{me.avatar} </span>
            {me.displayName}
          </h1>
          {me.homeCity && <p className="text-sm text-muted">From {me.homeCity}</p>}
          <div className="mt-1 flex flex-wrap justify-center gap-1.5">
            {me.verifications.some((v) => v.tier === "gov_id" && v.verified) && <Badge tone="good">🪪 ID Verified</Badge>}
            {me.trust >= 60 && <Badge tone="good">⭐ Trusted Traveller</Badge>}
            {typeById(me.travellerType) ? (
              <button type="button" onClick={onQuiz} className="rounded-full" aria-label="Retake the traveller-type quiz">
                <Badge tone="accent">
                  {typeById(me.travellerType)!.icon} {typeById(me.travellerType)!.name}
                </Badge>
              </button>
            ) : (
              <Button variant="ghost" onClick={onQuiz}>
                What kind of traveller are you? Take the quiz →
              </Button>
            )}
          </div>
          {me.bio && <p className="mx-auto mt-2 max-w-md text-sm">{me.bio}</p>}
          {me.styleTags.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {me.styleTags.map((t) => (
                <Badge key={t}>{STYLE_LABELS[t]}</Badge>
              ))}
            </div>
          )}

          <div className="mt-4 text-left">
            <div className="flex items-baseline justify-between">
              <p className="font-bold">Level {me.level.level}</p>
              <p className="text-sm text-muted">
                {formatNumber(me.level.xp)} XP · {me.level.toNext} to level {me.level.level + 1}
              </p>
            </div>
            <div
              className="mt-1 h-3 overflow-hidden rounded-full bg-line"
              role="meter"
              aria-label="Progress to next level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={me.level.pct}
            >
              <div className="h-full rounded-full bg-pine-600 transition-all" style={{ width: `${me.level.pct}%` }} />
            </div>
            {me.nextStage && (
              <p className="mt-1 text-xs text-muted">
                Evolves into <span className="font-semibold">{me.nextStage.name}</span> at level {me.nextStage.min_level}.
              </p>
            )}
          </div>
        </Card>

        <VerificationCard />

        <Card className="flex items-center justify-between gap-3">
          <span className="text-sm">
            <span className="block font-semibold">📡 SOS beacon and emergency contacts</span>
            <span className="text-muted">Who hears from you if something goes wrong, even with no signal.</span>
          </span>
          <Button variant="secondary" onClick={onBeacon}>
            Set up
          </Button>
        </Card>
      </div>

      <div className="min-w-0 space-y-5 lg:col-span-7 xl:col-span-8">
        {me.nudges.length > 0 && (
          <Card className="border-sun-500/40 bg-sun-50">
            <SectionTitle>Explore more</SectionTitle>
            <ul className="space-y-1.5 text-sm">
              {me.nudges.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden="true">→</span>
                  {n}
                </li>
              ))}
            </ul>
            <Button className="mt-3" onClick={onPlan}>
              Plan your next trip
            </Button>
          </Card>
        )}

        <Card>
          <SectionTitle
            hint={
              me.streakMonths >= 2
                ? `🔥 ${me.streakMonths}-month streak: a verified trip every month. Keep it going for bonus XP.`
                : "New challenges every month. Only GPS-verified trips count."
            }
          >
            This month's challenges
          </SectionTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {me.challenges.map((c) => (
              <li key={c.id} className={`rounded-xl border p-3 ${c.done ? "border-pine-100 bg-pine-50" : "border-line bg-paper"}`}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-2xl">
                    {c.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-tight">{c.name}</p>
                    <p className="text-xs text-muted">{c.done ? `Done · +${c.xp} XP` : `${c.current} of ${c.target} · +${c.xp} XP`}</p>
                  </div>
                  {c.done && <span aria-label="Completed">✅</span>}
                </div>
                <p className="mt-1 text-xs">{c.description}</p>
                {!c.done && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <div className="h-full rounded-full bg-sun-500" style={{ width: `${Math.round((c.current / c.target) * 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-3" onClick={onLeaderboard}>
            🏆 See the leaderboard
          </Button>
        </Card>

        <Card>
          <SectionTitle>Stats</SectionTitle>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-paper p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-lg font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <SectionTitle hint={`${earned.length} of ${me.badges.length} earned. Badges count only GPS-verified or partly verified trips.`}>Badges</SectionTitle>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {[...earned, ...locked].map((b) => (
              <li key={b.id} className={`rounded-xl border p-3 ${b.earned ? "border-pine-100 bg-pine-50" : "border-line bg-paper"}`}>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`text-2xl ${b.earned ? "" : "opacity-40 grayscale"}`}>
                    {b.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight">{b.name}</p>
                    <p className="text-xs text-muted">{b.earned ? `Earned · +${b.xp} XP` : "Locked"}</p>
                  </div>
                </div>
                <p className="mt-1 text-xs">{b.description}</p>
                {!b.earned && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <div className="h-full rounded-full bg-sun-500" style={{ width: `${Math.round(b.progress * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted">To go: {b.remaining}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle>Journey timeline</SectionTitle>
          {feedError ? (
            <ErrorState title="Couldn't load your timeline" detail={feedError} onRetry={loadFeed} />
          ) : !feed ? (
            <Skeleton className="h-24" />
          ) : feed.length === 0 ? (
            <EmptyState icon="🏁" title="No finished trips yet" action={<Button onClick={onPlan}>Plan a trip</Button>}>
              Completed trips appear here with their route.
            </EmptyState>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-pine-100 pl-4">
              {feed.map((t) => (
                <li key={t.id} className="relative">
                  <span aria-hidden="true" className="absolute top-3 -left-[23px] size-3 rounded-full border-2 border-surface bg-pine-600" />
                  <button type="button" onClick={() => onOpenTrip(t.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-pine-50">
                    <RouteSparkline route={t.route} className="h-14 w-20 shrink-0" />
                    <span className="min-w-0">
                      <span className="block font-bold">{placeName(t.placeId)}</span>
                      <span className="block text-xs text-muted">
                        {t.completedAt && new Date(t.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {t.distanceKm ?? "?"} km
                      </span>
                      {t.validation && (
                        <span className="mt-1 flex gap-1.5">
                          <Badge tone={VALIDATION_LABEL[t.validation].tone}>{VALIDATION_LABEL[t.validation].label}</Badge>
                          <Badge tone="accent">+{t.xpAwarded} XP</Badge>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <MyPlacesCard onAdd={onAddPlace} onModerate={onModerate} isModerator={me.role === "moderator" || me.role === "admin"} />

        <YourDataCard onLoggedOut={onPlan} />
      </div>

      <EditProfileDialog key={editing ? "open" : "closed"} me={me} open={editing} onClose={() => setEditing(false)} onSaved={auth.setMe} />
    </div>
  );
}
