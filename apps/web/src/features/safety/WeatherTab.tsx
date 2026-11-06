import { forecastWarnings, formatTemp, groupWarnings, weatherLabel, worstByDate, type Place, type SafetyRules } from "@offgrid/core";
import { useState } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState, Skeleton } from "../../design/States";
import { ageLabel, useForecast } from "../../lib/weather";

const DOT: Record<number, string> = { 1: "bg-line", 2: "bg-warn-200", 3: "bg-danger-700" };

export function WeatherTab({ place, rules }: { place: Place; rules: SafetyRules }) {
  const { state, refresh } = useForecast(place.id);
  const [at, setAt] = useState<"base" | "high">("high");

  if (state.status === "loading") return <Skeleton className="h-64" />;
  if (state.status === "none") {
    return (
      <EmptyState icon="🌦️" title="No forecast saved yet" action={navigator.onLine ? <Button onClick={() => void refresh()}>Try again</Button> : undefined}>
        {state.error ?? "Open this plan once with signal and the 7-day forecast is saved for the trail."}
      </EmptyState>
    );
  }

  const series = state.data[at];
  const warnings = forecastWarnings(series.days, { label: series.label, elevationM: series.elevationM }, place, rules);
  const worst = worstByDate(warnings);
  const groups = groupWarnings(warnings).filter((g) => g.severity >= 2);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
  const stale = Date.now() - state.savedAt > 6 * 3_600_000;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1" role="group" aria-label="Forecast location">
        {(["base", "high"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={at === k}
            onClick={() => setAt(k)}
            className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${at === k ? "bg-pine-700 text-white" : "text-ink"}`}
          >
            {state.data[k].label}
          </button>
        ))}
      </div>

      {stale && (
        <Callout tone="warn">
          This forecast is from {ageLabel(state.savedAt)}. Mountain weather changes fast, so refresh it when you have signal.
        </Callout>
      )}
      {state.error && <p className="text-xs text-muted">Couldn't refresh: {state.error}</p>}

      {groups.length > 0 && (
        <Callout tone={groups.some((g) => g.severity === 3) ? "danger" : "warn"} title="Weather warnings">
          <ul className="list-disc space-y-1 pl-5">
            {groups.map((g) => (
              <li key={g.kind}>
                <span className="font-semibold">
                  {g.dates.length === 1 ? day(g.dates[0]!) : `${day(g.dates[0]!)} – ${day(g.dates.at(-1)!)} (${g.dates.length} days)`}:
                </span>{" "}
                {g.dates.length > 1 ? `Worst: ${g.text}` : g.text}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Card flush>
        <ol className="divide-y divide-line">
          {series.days.map((d) => {
            const { label, icon } = weatherLabel(d.code);
            const sev = worst.get(d.date);
            return (
              <li key={d.date} className="flex items-center gap-3 p-3">
                <span className="w-14 text-sm">
                  <span className="block font-semibold">{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short" })}</span>
                  <span className="text-xs text-muted">{new Date(d.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                </span>
                <span aria-hidden="true" className="text-2xl">
                  {icon}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium">{label}</span>
                  <span className="text-xs text-muted">
                    {d.snowCm >= 0.5 ? `${Math.round(d.snowCm)} cm snow` : `${Math.round(d.precipMm)} mm rain`}
                    {d.precipProb !== null ? ` · ${d.precipProb}%` : ""} · gusts {Math.round(d.gustKmh)} km/h
                  </span>
                </span>
                <span className="text-right text-sm tabular-nums">
                  <span className="block font-bold">{formatTemp(d.tMaxC).replace(" °C", "°")}</span>
                  <span className="text-muted">{formatTemp(d.tMinC).replace(" °C", "°")}</span>
                </span>
                {sev && sev >= 2 && <span className={`size-2.5 shrink-0 rounded-full ${DOT[sev]}`} aria-label={sev === 3 ? "Severe warning" : "Warning"} />}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          Updated {ageLabel(state.savedAt)}. Weather data by{" "}
          <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo.com
          </a>
          {state.data.source === "mock" ? " (simulated)" : ""}, adjusted to {series.elevationM.toLocaleString("en-IN")} m.
        </span>
        <Button variant="ghost" disabled={state.refreshing || !navigator.onLine} onClick={() => void refresh()}>
          {state.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
    </div>
  );
}
