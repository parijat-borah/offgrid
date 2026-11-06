import {
  DIFFICULTY_LABELS,
  formatINR,
  monthName,
  monthShort,
  recommend,
  VIBE_LABELS,
  type PlaceMedia,
  type PlannerData,
  type PlannerInput,
  type Recommendation,
} from "@offgrid/core";
import { useMemo } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, PageHeader, SectionTitle } from "../../design/Card";
import { EmptyState } from "../../design/States";
import { PlaceHero, PlaceThumb } from "../places/PlacePhotos";
import { RouteSparkline } from "../trips/RouteSparkline";
import { ReasonList } from "./ReasonList";

/** The search as removable-looking chips, with one place to change it. */
export function InputSummary({ input, onEdit }: { input: PlannerInput; onEdit: () => void }) {
  const parts = [
    formatINR(input.budgetPerPerson),
    `${input.days} ${input.days === 1 ? "day" : "days"}`,
    monthShort(input.month),
    DIFFICULTY_LABELS[input.fitness],
    `${input.groupSize} ${input.groupSize === 1 ? "person" : "people"}`,
    ...input.vibes.map((v) => VIBE_LABELS[v]),
  ];
  return (
    <span className="flex flex-wrap items-center gap-1.5" aria-label="Your filters">
      {parts.map((p) => (
        <span key={p} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink">
          {p}
        </span>
      ))}
      <Button variant="ghost" onClick={onEdit} className="min-h-9 px-3">
        Edit filters
      </Button>
    </span>
  );
}

function RecommendationCard({ rec, rank, media, onOpen }: { rec: Recommendation; rank: number; media: PlaceMedia; onOpen: () => void }) {
  const { place, budget, season } = rec;
  const trail = media.trails[place.id];
  const hasPhoto = !!media.photos[place.id]?.length;
  return (
    <Card flush className="flex w-full flex-col overflow-hidden">
      <div className={hasPhoto ? "relative" : "relative h-14 bg-pine-50"}>
        <PlaceHero photos={media.photos[place.id]} name={place.name} eager={rank === 1} className="aspect-[16/10] rounded-none" />
        <span className="absolute top-3 left-3 rounded-full bg-pine-900/85 px-2.5 py-1 text-xs font-bold text-white backdrop-blur">#{rank} pick</span>
        <span className="absolute top-3 right-3 flex items-baseline gap-1 rounded-full bg-white/95 px-3 py-1 text-pine-800 shadow">
          <span className="sr-only">Match score {rec.score} out of 100</span>
          <span aria-hidden="true" className="text-base font-extrabold">
            {rec.score}
          </span>
          <span aria-hidden="true" className="text-[11px] font-semibold text-muted">
            match
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{place.district}</p>
          <h2 className="text-xl leading-tight font-extrabold">{place.name}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{place.summary}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone={place.difficulty === 1 ? "good" : place.difficulty === 2 ? "accent" : "danger"}>{DIFFICULTY_LABELS[place.difficulty]}</Badge>
          <Badge>{rec.plannedDays} days</Badge>
          <Badge>{place.max_altitude_m.toLocaleString("en-IN")} m</Badge>
          {season.status === "risky" && <Badge tone="warn">Risky season</Badge>}
        </div>

        {trail && (
          <div className="flex items-center gap-3 rounded-xl bg-paper p-2">
            <RouteSparkline route={trail.coords.map(([lat, lon]) => ({ lat, lon }))} className="h-12 w-20 shrink-0" label={`Shape of the ${place.name} trail`} />
            <p className="text-xs">
              <span className="block font-semibold">🥾 {trail.length_km} km trail from {trail.start.name}</span>
              <span className="text-muted">Map, directions and GPX in the plan</span>
            </p>
          </div>
        )}

        <div className="flex-1">
          <ReasonList reasons={rec.reasons} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-sm leading-tight">
            <span className="block text-xl font-extrabold">{formatINR(budget.totalPerPerson)}</span>
            <span className="text-xs text-muted">per person, estimated</span>
          </p>
          <Button onClick={onOpen} aria-label={`See the plan for ${place.name}`}>
            See plan →
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ResultsView({
  data,
  input,
  onOpen,
  onEdit,
  onCompare,
}: {
  data: PlannerData;
  input: PlannerInput;
  onOpen: (placeId: string) => void;
  onEdit: () => void;
  onCompare: (a: string, b: string) => void;
}) {
  const result = useMemo(() => recommend(input, data, 3), [input, data]);
  const more = result.ranked.slice(3, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your matches"
        title={result.top.length ? `Top ${result.top.length === 1 ? "pick" : `${result.top.length} picks`} for ${monthName(input.month)}` : "No matches yet"}
        subtitle={<InputSummary input={input} onEdit={onEdit} />}
        actions={
          result.top.length >= 2 ? (
            <Button variant="secondary" onClick={() => onCompare(result.top[0]!.place.id, result.top[1]!.place.id)}>
              ⚖️ Compare top 2
            </Button>
          ) : undefined
        }
      />

      {result.top.length === 0 ? (
        <EmptyState icon="🏔️" title="Nothing fits all your filters" action={<Button onClick={onEdit}>Change filters</Button>}>
          {result.suggestions.length > 0 ? (
            <ul className="space-y-1 text-left">
              {result.suggestions.map((s) => (
                <li key={s}>→ {s}</li>
              ))}
            </ul>
          ) : (
            <p>Try a different month, more days or a higher budget.</p>
          )}
        </EmptyState>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {result.top.map((rec, i) => (
            <li key={rec.place.id} className="flex">
              <RecommendationCard rec={rec} rank={i + 1} media={data.media} onOpen={() => onOpen(rec.place.id)} />
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {more.length > 0 && (
          <Card className="lg:col-span-2">
            <SectionTitle hint="Ranked lower, but still within your budget, days and season.">Also fits</SectionTitle>
            <ul className="grid gap-x-4 sm:grid-cols-2">
              {more.map((r) => (
                <li key={r.place.id}>
                  <button type="button" onClick={() => onOpen(r.place.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-pine-50">
                    <PlaceThumb photos={data.media.photos[r.place.id]} name={r.place.name} className="size-14" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.place.name}</span>
                      <span className="block text-xs text-muted">
                        {DIFFICULTY_LABELS[r.place.difficulty]} · {r.plannedDays} days · {formatINR(r.budget.totalPerPerson)}
                      </span>
                    </span>
                    <span className="rounded-full bg-pine-50 px-2 py-0.5 text-xs font-bold text-pine-700">{r.score}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className={`space-y-5 ${more.length === 0 ? "lg:col-span-3" : ""}`}>
          {result.suggestions.length > 0 && (
            <Card>
              <SectionTitle>Want more options?</SectionTitle>
              <ul className="space-y-1.5 text-sm text-muted">
                {result.suggestions.map((s) => (
                  <li key={s}>→ {s}</li>
                ))}
              </ul>
            </Card>
          )}
          {result.eliminated.length > 0 && (
            <details className="rounded-2xl border border-line/80 bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
              <summary className="min-h-11 cursor-pointer content-center text-sm font-bold">Why not the other {result.eliminated.length}?</summary>
              <ul className="mt-2 space-y-2 text-sm">
                {result.eliminated.map((e) => (
                  <li key={e.place.id}>
                    <span className="font-semibold">{e.place.name}</span>
                    <span className="block text-muted">{e.reasons.map((r) => r.message).join(" ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
