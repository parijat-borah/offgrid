import { formatINR, monthShort, type PlannerData, type TripDto, type TripStatus } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { PageHeader } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { VALIDATION_LABEL } from "./LevelUpDialog";
import { PlaceHero } from "../places/PlacePhotos";
import { RouteSparkline } from "./RouteSparkline";

type Tab = Exclude<TripStatus, "cancelled">;
const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "On a trip" },
  { key: "planned", label: "Planned" },
  { key: "completed", label: "Done" },
];

export function TripsView({ data, onOpen, onPlan }: { data: PlannerData; onOpen: (id: string) => void; onPlan: () => void }) {
  const [trips, setTrips] = useState<TripDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<TripDto[]>("/trips")
      .then((t) => {
        setTrips(t);
        setTab((cur) => cur ?? (t.some((x) => x.status === "active") ? "active" : t.some((x) => x.status === "planned") ? "planned" : "completed"));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState title="Couldn't load your trips" detail={error} onRetry={load} />;
  if (!trips || !tab) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading trips">
        <Skeleton className="h-11" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const shown = trips.filter((t) => t.status === tab);
  const placeName = (id: string) => data.places.find((p) => p.id === id)?.name ?? id;

  const startLabel = (t: TripDto) =>
    t.startDate ? new Date(t.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : monthShort(t.plannerInput.month);

  return (
    <div className="space-y-6">
      <PageHeader title="My trips" subtitle="Plans you've saved, the trip you're on, and everything you've finished." actions={<Button onClick={onPlan}>＋ Plan a new trip</Button>} />

      <div className="inline-grid w-full grid-cols-3 gap-1 rounded-2xl border border-line bg-surface p-1 sm:w-auto" role="group" aria-label="Filter trips">
        {TABS.map((t) => {
          const n = trips.filter((x) => x.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-10 rounded-xl px-4 text-sm font-semibold ${tab === t.key ? "bg-pine-700 text-white" : "text-ink hover:bg-pine-50"}`}
            >
              {t.label} <span className="opacity-75">({n})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={tab === "completed" ? "🏁" : "🎒"}
          title={tab === "completed" ? "No finished trips yet" : tab === "active" ? "You're not on a trip" : "No planned trips"}
          action={<Button onClick={onPlan}>Plan a trip</Button>}
        >
          {tab === "completed" ? "Finish a trip to earn XP, badges and a route on your timeline." : "Plan a trip and tap “Save trip” to see it here."}
        </EmptyState>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <li key={t.id} className="flex">
              {/* The button is the card, so there's no block element inside a button. */}
              <button
                type="button"
                onClick={() => onOpen(t.id)}
                className="flex w-full flex-col overflow-hidden rounded-2xl border border-line/80 bg-surface text-left shadow-[var(--shadow-card)] transition-shadow hover:border-pine-600 hover:shadow-[var(--shadow-lift)]"
                aria-label={`Open trip to ${placeName(t.placeId)}`}
              >
                <span className="relative block">
                  <PlaceHero photos={data.media.photos[t.placeId]} name={placeName(t.placeId)} className="aspect-[16/9] rounded-none" inButton />
                  {t.status === "active" && (
                    <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-sun-500 px-2.5 py-1 text-xs font-bold text-white">
                      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-white" />
                      On the trail
                    </span>
                  )}
                  {t.status === "completed" && t.route.length > 1 && (
                    <span className="absolute top-3 right-3 rounded-xl bg-white/95 p-1 shadow">
                      <RouteSparkline route={t.route} className="h-10 w-16" />
                    </span>
                  )}
                </span>
                <span className="flex flex-1 flex-col gap-2 p-4">
                  <span className="block">
                    <span className="block font-display text-lg leading-tight font-extrabold">{placeName(t.placeId)}</span>
                    <span className="block text-sm text-muted">
                      {startLabel(t)} · {t.plannerInput.days} days · {formatINR(t.budgetPp)} pp
                    </span>
                  </span>
                  {t.status === "completed" && t.validation && (
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={VALIDATION_LABEL[t.validation].tone}>{VALIDATION_LABEL[t.validation].label}</Badge>
                      <Badge tone="accent">+{t.xpAwarded} XP</Badge>
                      {t.distanceKm !== null && <Badge>{t.distanceKm} km</Badge>}
                    </span>
                  )}
                  {t.status === "active" && <Badge tone="warn">In progress · {t.pointsCount} GPS points</Badge>}
                  {t.status === "planned" && <span className="text-sm font-semibold text-pine-700">Open plan, buddies and expenses →</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
