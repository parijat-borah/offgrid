import {
  formatINR,
  formatNumber,
  type Budget,
  type Itinerary,
  type PackingGroup,
} from "@offgrid/core";
import { useEffect, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { readJSON, removeKey, writeJSON } from "../../lib/storage";

const KIND_LABEL = { plan: null, acclimatise: "Acclimatise", side_trip: "Side trip", rest: "Rest day" } as const;

export function ItineraryTab({ itinerary }: { itinerary: Itinerary }) {
  return (
    <div className="space-y-3">
      {itinerary.warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
      <ol className="space-y-3">
        {itinerary.days.map((d) => (
          <li key={d.day}>
            <Card className={d.warnings.length ? "border-warn-200" : ""}>
              <div className="flex items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-pine-50 text-center leading-none text-pine-700">
                  <span>
                    <span className="block text-[10px] font-semibold uppercase">Day</span>
                    <span className="text-lg font-extrabold">{d.day}</span>
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold">{d.title}</h2>
                    {KIND_LABEL[d.kind] && <Badge tone="accent">{KIND_LABEL[d.kind]}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{d.detail}</p>
                  <p className="mt-1.5 text-xs font-medium text-muted">
                    {d.trek_km > 0 ? `${d.trek_km} km on foot · ` : ""}Sleep at {formatNumber(d.sleep_alt_m)} m
                  </p>
                  {d.warnings.map((w) => (
                    <p key={w} className="mt-2 rounded-lg bg-warn-50 p-2 text-sm text-warn-700">
                      <span aria-hidden="true">! </span>
                      {w}
                    </p>
                  ))}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      {itinerary.spareDays > 0 && (
        <p className="text-sm text-muted">
          You have {itinerary.spareDays} spare {itinerary.spareDays === 1 ? "day" : "days"}. Pair this with a nearby trip, or keep
          them as weather buffer.
        </p>
      )}
    </div>
  );
}

export function BudgetTab({ budget, userBudget }: { budget: Budget; userBudget: number }) {
  const pct = Math.min(100, Math.round((budget.totalPerPerson / userBudget) * 100));
  const over = budget.totalPerPerson > userBudget;
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted">Per person</p>
          <p className="text-2xl font-extrabold">{formatINR(budget.totalPerPerson)}</p>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-line"
          role="meter"
          aria-label="Share of your budget"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={`h-full rounded-full ${over ? "bg-sun-500" : "bg-pine-600"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {over
            ? `${formatINR(budget.totalPerPerson - userBudget)} over your ${formatINR(userBudget)} budget`
            : `${formatINR(userBudget - budget.totalPerPerson)} left from your ${formatINR(userBudget)} budget`}
        </p>
      </Card>

      <Card flush>
        <table className="w-full text-sm">
          <caption className="sr-only">Cost breakdown per person</caption>
          <tbody className="divide-y divide-line">
            {budget.lines.map((l) => (
              <tr key={l.key}>
                <th scope="row" className="p-3 text-left font-medium">
                  {l.label}
                  <span className="block text-xs font-normal text-muted">{l.note}</span>
                </th>
                <td className="p-3 text-right tabular-nums">{formatINR(l.perPerson)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="p-3 text-left font-medium">
                Buffer ({budget.bufferPct}%)
                <span className="block text-xs font-normal text-muted">For delays, price changes and surprises</span>
              </th>
              <td className="p-3 text-right tabular-nums">{formatINR(budget.bufferPerPerson)}</td>
            </tr>
            <tr className="bg-pine-50">
              <th scope="row" className="p-3 text-left font-bold">
                Total per person
              </th>
              <td className="p-3 text-right font-bold tabular-nums">{formatINR(budget.totalPerPerson)}</td>
            </tr>
            {budget.groupSize > 1 && (
              <tr className="bg-pine-50">
                <th scope="row" className="p-3 text-left font-bold">
                  Total for {budget.groupSize} people
                </th>
                <td className="p-3 text-right font-bold tabular-nums">{formatINR(budget.totalGroup)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted">
        Estimate only, prices checked {budget.lastVerified}. Source: {budget.source}.
      </p>
    </div>
  );
}

export function PackingTab({ groups, storageKey }: { groups: PackingGroup[]; storageKey: string }) {
  const [checked, setChecked] = useState<Set<string>>(() => {
    const saved = readJSON(storageKey);
    return new Set(Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : []);
  });
  useEffect(() => writeJSON(storageKey, [...checked]), [checked, storageKey]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = groups.reduce((n, g) => n + g.items.filter((i) => checked.has(i.id)).length, 0);
  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" aria-live="polite">
          {done} of {total} packed
        </p>
        <Button
          variant="ghost"
          disabled={done === 0}
          onClick={() => {
            setChecked(new Set());
            removeKey(storageKey);
          }}
        >
          Reset
        </Button>
      </div>
      {groups.map((g) => (
        <Card key={g.category} className="p-2">
          <h2 className="px-2 pt-1 pb-2 text-sm font-bold">{g.label}</h2>
          <ul>
            {g.items.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-pine-50">
                  <input
                    type="checkbox"
                    checked={checked.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-0.5 size-5 shrink-0 accent-pine-700"
                  />
                  <span className={checked.has(item.id) ? "text-muted line-through" : ""}>
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="block text-xs text-muted">{item.why}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
