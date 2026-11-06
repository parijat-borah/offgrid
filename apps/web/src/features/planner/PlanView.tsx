import {
  budgetBreakdown,
  buildItinerary,
  checkSeason,
  DIFFICULTY_LABELS,
  encodeShare,
  formatINR,
  formatNumber,
  hardFilter,
  monthName,
  packingList,
  planToText,
  seasonCalendar,
  type PlannerInput,
  type RegionPack,
} from "@offgrid/core";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { EmptyState, Skeleton } from "../../design/States";
import { Tabs } from "../../design/Tabs";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { KEYS } from "../../lib/storage";
import { SafetyCard } from "../safety/SafetyCard";
import { WeatherTab } from "../safety/WeatherTab";
import { PlaceGallery } from "../places/PlacePhotos";
import { BudgetTab, ItineraryTab, PackingTab } from "./PlanTabs";

// Leaflet only loads when someone opens the Route tab.
const TrailMap = lazy(() => import("../places/TrailMap").then((m) => ({ default: m.TrailMap })));

type TabKey = "itinerary" | "route" | "weather" | "budget" | "packing" | "safety";
const TABS = [
  { key: "itinerary", label: "Itinerary" },
  { key: "route", label: "Route" },
  { key: "weather", label: "Weather" },
  { key: "budget", label: "Budget" },
  { key: "packing", label: "Packing" },
  { key: "safety", label: "Safety" },
] satisfies { key: TabKey; label: string }[];

export function PlanView({
  pack,
  input,
  placeId,
  onBack,
  onSaved,
  onRequireLogin,
  onCompare,
}: {
  pack: RegionPack;
  input: PlannerInput;
  placeId: string;
  onBack: () => void;
  onSaved: (tripId: string) => void;
  onRequireLogin: () => void;
  onCompare: () => void;
}) {
  const data = pack.planner;
  const auth = useAuth();
  const [tab, setTab] = useState<TabKey>("itinerary");
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const place = data.places.find((p) => p.id === placeId);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const plan = useMemo(() => {
    if (!place) return null;
    const itinerary = buildItinerary(place, input.days, input.fitness, data.rules);
    return {
      itinerary,
      season: checkSeason(place, input.month, data.passes),
      calendar: seasonCalendar(place, data.passes),
      budget: budgetBreakdown(place, itinerary.plannedDays, input.groupSize, data.rules),
      packing: packingList(place, input.month, itinerary.plannedDays, data.packing),
      // A shared link can point at a place that no longer fits the filters; say so instead of hiding it.
      blockers: hardFilter(place, input, data).reasons,
    };
  }, [place, input, data]);

  if (!place || !plan) {
    return (
      <EmptyState icon="🗺️" title="We couldn't find that place" action={<Button onClick={onBack}>Back to results</Button>}>
        The link may be from an older version of the app.
      </EmptyState>
    );
  }

  const shareUrl = `${location.origin}${location.pathname}?view=plan&${encodeShare(input, place.id)}`;

  const download = () => {
    const text = planToText({ input, place, region: data.region, ...plan, shareUrl });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `offgrid-${place.id}.txt` });
    a.click();
    URL.revokeObjectURL(url);
    setToast("Plan downloaded");
  };

  const save = async () => {
    if (auth.status !== "authed") {
      onRequireLogin();
      return;
    }
    setSaving(true);
    try {
      // The client picks the id, so a retried save after a dropped connection can't create a duplicate.
      const id = crypto.randomUUID();
      await api(`/trips/${id}`, { method: "PUT", body: { placeId: place.id, plannerInput: input } });
      onSaved(id);
    } catch (e) {
      setToast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `OFFGRID: ${place.name}`, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setToast("Link copied");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setToast("Couldn't share. Copy the address bar instead.");
    }
  };

  const stats: [string, string][] = [
    ["Days", String(plan.itinerary.plannedDays)],
    ["Max altitude", `${formatNumber(place.max_altitude_m)} m`],
    ["On foot", place.distance_km > 0 ? `${place.distance_km} km` : "Minimal"],
    ["Per person", formatINR(plan.budget.totalPerPerson)],
  ];

  return (
    <article className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2">
          ← Back to results
        </Button>
        <Button variant="ghost" onClick={onCompare} className="lg:hidden">
          ⚖️ Compare
        </Button>
      </div>

      {/* Laptop: content on the left, a sticky panel with the numbers and actions on the right.
          Phones: the same blocks stack in reading order. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="space-y-5 lg:col-start-1 lg:row-start-1">
          <header>
            <p className="text-xs font-semibold tracking-wider text-pine-700 uppercase">
              {place.district} · {data.region.name}
            </p>
            <h1 className="text-3xl leading-tight font-extrabold sm:text-4xl">{place.name}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted sm:text-base">{place.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.media.trails[place.id] && <Badge tone="good">🥾 Trail map</Badge>}
              <Badge tone={place.difficulty === 1 ? "good" : place.difficulty === 2 ? "accent" : "danger"}>{DIFFICULTY_LABELS[place.difficulty]}</Badge>
              <Badge>{monthName(input.month)}</Badge>
              <Badge>
                {input.groupSize} {input.groupSize === 1 ? "person" : "people"}
              </Badge>
            </div>
          </header>

          <PlaceGallery photos={data.media.photos[place.id]} name={place.name} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" aria-label="Trip summary">
          <div className="rounded-2xl border border-line/80 bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {stats.map(([k, v]) => (
                <div key={k} className="rounded-xl bg-paper p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-lg font-extrabold">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 space-y-2">
              <Button block onClick={save} disabled={saving} className="min-h-12 text-base">
                {saving ? "Saving…" : auth.status === "authed" ? "🎒 Save trip" : "🎒 Log in to save this trip"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={download}>
                  ⬇ .txt
                </Button>
                <Button variant="secondary" onClick={share}>
                  🔗 Share
                </Button>
              </div>
              <Button variant="ghost" block onClick={onCompare} className="hidden lg:inline-flex">
                ⚖️ Compare with another place
              </Button>
            </div>
          </div>
          <p className="hidden px-1 text-xs text-muted lg:block">Costs are estimates for {input.groupSize === 1 ? "one person" : `${input.groupSize} people`}, including travel from Delhi, stay, food and permits.</p>
        </aside>

        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-2">
          {plan.blockers.length > 0 && (
            <Callout tone="danger" title="This trip doesn't fit your filters">
              <ul className="list-disc pl-5">
                {plan.blockers.map((b) => (
                  <li key={b.message}>{b.message}</li>
                ))}
              </ul>
            </Callout>
          )}
          {plan.blockers.length === 0 && plan.season.status === "risky" && (
            <Callout tone="warn" title={`Risky in ${monthName(input.month)}`}>
              {plan.season.reasons.join(" ")}
            </Callout>
          )}
          {plan.itinerary.overpacked && (
            <Callout tone="warn" title="Some days are tough">
              Check the warnings on the highlighted days below. Adding a day often fixes it.
            </Callout>
          )}

          <Tabs tabs={TABS} active={tab} onChange={setTab}>
            {tab === "itinerary" && <ItineraryTab itinerary={plan.itinerary} />}
            {tab === "route" && (
              <Suspense fallback={<Skeleton className="h-96" />}>
                <TrailMap place={place} data={data} hazards={pack.hazards} className="h-80 lg:h-[28rem]" />
              </Suspense>
            )}
            {tab === "budget" && <BudgetTab budget={plan.budget} userBudget={input.budgetPerPerson} />}
            {tab === "packing" && <PackingTab key={KEYS.packing(place.id, input.month)} groups={plan.packing} storageKey={KEYS.packing(place.id, input.month)} />}
            {tab === "weather" && <WeatherTab place={place} rules={pack.safety} />}
            {tab === "safety" && <SafetyCard pack={pack} place={place} input={input} itinerary={plan.itinerary} calendar={plan.calendar} />}
          </Tabs>
        </div>
      </div>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 lg:bottom-8 lg:pl-64">
        {toast && <p className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-lg">{toast}</p>}
      </div>
    </article>
  );
}
