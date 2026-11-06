import {
  DIFFICULTY_LABELS,
  formatINR,
  formatNumber,
  monthName,
  simulateTrack,
  type CompleteTripResponse,
  type PlannerData,
  type TripDto,
} from "@offgrid/core";
import { lazy, Suspense, useCallback, useEffect, useId, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { LevelUpDialog, VALIDATION_LABEL } from "./LevelUpDialog";
import { PlaceHero } from "../places/PlacePhotos";
import { RouteSparkline } from "./RouteSparkline";
import { useTracker } from "./useTracker";

const TrailMap = lazy(() => import("../places/TrailMap").then((m) => ({ default: m.TrailMap })));

// The simulated-GPS button exists so the full flow can be demoed indoors. It is always labelled.
const DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true";

export function TripDetailView({
  data,
  tripId,
  onBack,
  onProfile,
  onBuddies,
  onExpenses,
}: {
  data: PlannerData;
  tripId: string;
  onBack: () => void;
  onProfile: () => void;
  onBuddies: (tripId: string) => void;
  onExpenses: (tripId: string) => void;
}) {
  const auth = useAuth();
  const [trip, setTrip] = useState<TripDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spend, setSpend] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CompleteTripResponse | null>(null);
  const tracker = useTracker(tripId, trip?.status === "active");
  const spendId = useId();
  const notesId = useId();
  const dateId = useId();

  const load = useCallback(() => {
    setLoadError(null);
    api<TripDto>(`/trips/${tripId}`)
      .then(setTrip)
      .catch((e: unknown) => setLoadError(errorMessage(e)));
  }, [tripId]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return loadError.includes("not found") ? (
      <EmptyState icon="🗺️" title="Trip not found" action={<Button onClick={onBack}>My trips</Button>} />
    ) : (
      <ErrorState title="Couldn't load this trip" detail={loadError} onRetry={load} />
    );
  }
  if (!trip) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading trip">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const place = data.places.find((p) => p.id === trip.placeId);
  if (!place) return <EmptyState icon="🗺️" title="This place is no longer in the data pack" action={<Button onClick={onBack}>My trips</Button>} />;

  const start = () =>
    run(async () => {
      setTrip(await api<TripDto>(`/trips/${trip.id}/start`, { method: "POST" }));
    });

  const simulate = () =>
    run(async () => {
      await api(`/trips/${trip.id}/points`, { method: "POST", body: { points: simulateTrack(place), source: "simulated" } });
      setTrip(await api<TripDto>(`/trips/${trip.id}`));
    });

  const complete = () =>
    run(async () => {
      await tracker.flush();
      tracker.stop();
      const spendNum = spend.trim() ? Number(spend.replace(/[,\s₹]/g, "")) : undefined;
      if (spendNum !== undefined && (!Number.isFinite(spendNum) || spendNum < 0)) throw new Error("Enter what you spent as a number, or leave it empty.");
      const res = await api<CompleteTripResponse>(`/trips/${trip.id}/complete`, {
        method: "POST",
        body: { ...(spendNum !== undefined ? { actualSpendPp: Math.round(spendNum) } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) },
      });
      setTrip(res.trip);
      auth.setMe(res.me);
      setResult(res);
    });

  const cancel = () =>
    run(async () => {
      await api(`/trips/${trip.id}`, { method: "DELETE" });
      onBack();
    });

  const saved = trip.actualSpendPp !== null ? trip.budgetPp - trip.actualSpendPp : null;

  return (
    <article className="space-y-5">
      <Button variant="ghost" onClick={onBack} className="-ml-2">
        ← My trips
      </Button>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{place.district}</p>
        <h1 className="text-3xl leading-tight font-extrabold sm:text-4xl">{place.name}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{DIFFICULTY_LABELS[place.difficulty]}</Badge>
          <Badge>
            {trip.plannerInput.days} days · {monthName(trip.plannerInput.month)}
          </Badge>
          <Badge>Planned {formatINR(trip.budgetPp)} pp</Badge>
        </div>
      </header>

      {/* Laptop: what to do on the left, the photo and the route map on the right. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-8">
        <aside className="space-y-5 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:self-start" aria-label="Place and route">
          <PlaceHero photos={data.media.photos[place.id]} name={place.name} />

          {trip.status !== "cancelled" && (
            <Card className="space-y-2">
              <SectionTitle hint={trip.status === "completed" && trip.route.length > 1 ? "Your recorded track over the mapped trail." : undefined}>Route</SectionTitle>
              <Suspense fallback={<RouteSparkline route={trip.route} className="h-40 w-full" />}>
                <TrailMap place={place} data={data} track={trip.status === "completed" ? trip.route : undefined} className="h-64" />
              </Suspense>
            </Card>
          )}
        </aside>

        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
          {actionError && <Callout tone="danger">{actionError}</Callout>}

          {trip.status === "planned" && (
            <Card className="space-y-2">
              <label htmlFor={dateId} className="block text-sm font-semibold">
                Start date
              </label>
              <input
                id={dateId}
                type="date"
                value={trip.startDate ?? ""}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) =>
                  void run(async () => {
                    setTrip(await api<TripDto>(`/trips/${trip.id}`, { method: "PUT", body: { placeId: trip.placeId, plannerInput: trip.plannerInput, startDate: e.target.value || null } }));
                  })
                }
                className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base"
              />
              <p className="text-xs text-muted">With a date, you'll get weather alerts for the 7 days before you go.</p>
            </Card>
          )}

          {(trip.status === "planned" || trip.status === "active") && (
            <Card className="flex items-center justify-between gap-3">
              <span className="text-sm">
                <span className="block font-semibold">Travel buddies</span>
                <span className="text-muted">
                  {trip.lookingForCompanions ? "Others going on these dates can find you." : "Find verified travellers heading here on the same dates."}
                </span>
              </span>
              <Button variant="secondary" onClick={() => onBuddies(trip.id)}>
                Find buddies
              </Button>
            </Card>
          )}

          {trip.status !== "cancelled" && (
            <Card className="flex items-center justify-between gap-3">
              <span className="text-sm">
                <span className="block font-semibold">Group expenses</span>
                <span className="text-muted">Track who paid for what and settle up with UPI. Works offline.</span>
              </span>
              <Button variant="secondary" onClick={() => onExpenses(trip.id)}>
                Split
              </Button>
            </Card>
          )}

          {trip.status === "planned" && (
            <Card className="space-y-3">
              <SectionTitle hint="GPS-verified trips earn full XP. Manual entries earn 25%, up to 2 a month.">Ready to go?</SectionTitle>
              <Button block onClick={start} disabled={busy}>
                ▶ Start trip
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={complete} disabled={busy}>
                  Mark done (manual)
                </Button>
                <Button variant="secondary" onClick={cancel} disabled={busy}>
                  Cancel trip
                </Button>
              </div>
            </Card>
          )}

          {trip.status === "active" && (
            <>
              <Card className="space-y-3">
                <SectionTitle hint="Keep OFFGRID open while you walk. Phones pause web GPS in the background; points are saved on your phone until there's signal.">
                  GPS track
                </SectionTitle>
                <p className="text-sm" aria-live="polite">
                  <span className="font-bold">{trip.pointsCount + tracker.uploaded}</span> points uploaded
                  {tracker.buffered > 0 && <span className="text-warn-700"> · {tracker.buffered} waiting for signal</span>}
                  {tracker.recording && <span className="text-pine-700"> · recording…</span>}
                </p>
                {tracker.error && <Callout tone="warn">{tracker.error}</Callout>}
                <Button block variant={tracker.recording ? "secondary" : "primary"} onClick={tracker.recording ? tracker.stop : tracker.start}>
                  {tracker.recording ? "■ Stop recording" : "● Record GPS"}
                </Button>
                {DEMO && (
                  <Button block variant="ghost" onClick={simulate} disabled={busy}>
                    🧪 Add a simulated GPS track (demo only)
                  </Button>
                )}
              </Card>

              <Card className="space-y-3">
                <SectionTitle>Finish the trip</SectionTitle>
                <div>
                  <label htmlFor={spendId} className="mb-1 block text-sm font-semibold">
                    What did you spend per person? (optional)
                  </label>
                  <div className="flex items-center rounded-xl border border-line bg-surface">
                    <span aria-hidden="true" className="pl-3 font-semibold text-muted">
                      ₹
                    </span>
                    <input id={spendId} inputMode="numeric" value={spend} onChange={(e) => setSpend(e.target.value)} className="min-h-12 w-full rounded-xl bg-transparent px-2 text-base outline-none" placeholder={String(trip.budgetPp)} />
                  </div>
                  <p className="mt-1 text-xs text-muted">Helps other travellers budget, and counts toward Budget Hero.</p>
                </div>
                <div>
                  <label htmlFor={notesId} className="mb-1 block text-sm font-semibold">
                    Notes (optional)
                  </label>
                  <textarea id={notesId} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border border-line bg-surface p-3 text-base" placeholder="Best chai stop, trail conditions…" />
                </div>
                <Button block onClick={complete} disabled={busy} className="min-h-12 text-base">
                  🏁 Finish trip
                </Button>
              </Card>
            </>
          )}

          {trip.status === "completed" && trip.validation && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge tone={VALIDATION_LABEL[trip.validation].tone}>{VALIDATION_LABEL[trip.validation].label}</Badge>
                <span className="text-lg font-extrabold text-pine-700">+{trip.xpAwarded} XP</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted">Distance</dt>
                  <dd className="font-bold">{trip.distanceKm ?? place.distance_km} km</dd>
                </div>
                <div>
                  <dt className="text-muted">Climb</dt>
                  <dd className="font-bold">{formatNumber(trip.elevationGainM ?? place.elevation_gain_m)} m</dd>
                </div>
                <div>
                  <dt className="text-muted">Spent per person</dt>
                  <dd className="font-bold">{trip.actualSpendPp !== null ? formatINR(trip.actualSpendPp) : "Not recorded"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Finished</dt>
                  <dd className="font-bold">{trip.completedAt ? new Date(trip.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</dd>
                </div>
              </dl>
              {saved !== null && saved > 0 && <Callout tone="good">You spent {formatINR(saved)} less than planned. Nice budgeting!</Callout>}
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {trip.validationReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {trip.notes && <p className="rounded-xl bg-paper p-3 text-sm">{trip.notes}</p>}
            </Card>
          )}

        </div>
      </div>

      <LevelUpDialog result={result} onClose={() => setResult(null)} onProfile={onProfile} />
    </article>
  );
}
