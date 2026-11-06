import { comparePlaces, type PlannerData, type PlannerInput } from "@offgrid/core";
import { useId, useMemo } from "react";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState } from "../../design/States";
import { PlaceHero } from "../places/PlacePhotos";
import { InputSummary } from "./ResultsView";

/** Two places side by side for this traveller's own budget, month, days and fitness. */
export function CompareView({
  data,
  input,
  a,
  b,
  onPick,
  onOpen,
  onBack,
  onEdit,
}: {
  data: PlannerData;
  input: PlannerInput;
  a: string;
  b: string;
  onPick: (a: string, b: string) => void;
  onOpen: (placeId: string) => void;
  onBack: () => void;
  onEdit: () => void;
}) {
  const pa = data.places.find((p) => p.id === a);
  const pb = data.places.find((p) => p.id === b);
  const cmp = useMemo(() => (pa && pb && pa.id !== pb.id ? comparePlaces(pa, pb, input, data) : null), [pa, pb, input, data]);
  const aId = useId();
  const bId = useId();
  const places = [...data.places].sort((x, y) => x.name.localeCompare(y.name));
  const select = "min-h-11 w-full rounded-xl border border-line bg-surface px-2 text-sm font-bold";

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="-ml-3">
        ← Results
      </Button>
      <h1 className="text-2xl font-extrabold">
        <span aria-hidden="true">⚖️ </span>Compare
      </h1>
      <InputSummary input={input} onEdit={onEdit} />

      <div className="grid grid-cols-2 gap-2">
        {[
          { id: aId, value: a, label: "First place", set: (v: string) => onPick(v, b) },
          { id: bId, value: b, label: "Second place", set: (v: string) => onPick(a, v) },
        ].map((s) => (
          <div key={s.id}>
            <label htmlFor={s.id} className="sr-only">
              {s.label}
            </label>
            <select id={s.id} value={s.value} onChange={(e) => s.set(e.target.value)} className={select}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!cmp ? (
        <EmptyState icon="⚖️" title="Pick two different places">
          Choose two places above to see them side by side.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <PlaceHero photos={data.media.photos[cmp.a.id]} name={cmp.a.name} className="aspect-[4/3] rounded-xl" />
            <PlaceHero photos={data.media.photos[cmp.b.id]} name={cmp.b.name} className="aspect-[4/3] rounded-xl" />
          </div>

          {cmp.verdict.length > 0 && (
            <Card className="border-pine-100 bg-pine-50">
              <ul className="space-y-1 text-sm">
                {cmp.verdict.map((v) => (
                  <li key={v} className="flex gap-2">
                    <span aria-hidden="true">→</span>
                    {v}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card flush className="overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                {cmp.a.name} compared with {cmp.b.name}. A tick marks the better option for you.
              </caption>
              <thead>
                <tr className="border-b border-line bg-paper">
                  <th scope="col" className="w-[30%] p-2 text-left text-xs font-semibold text-muted">
                    <span className="sr-only">Detail</span>
                  </th>
                  <th scope="col" className="p-2 text-left font-bold">
                    {cmp.a.name}
                  </th>
                  <th scope="col" className="p-2 text-left font-bold">
                    {cmp.b.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.key} className="border-b border-line last:border-0 align-top">
                    <th scope="row" className="p-2 text-left text-xs font-semibold text-muted">
                      {r.label}
                    </th>
                    {(["a", "b"] as const).map((side) => (
                      <td key={side} className={`break-words p-2 ${r.better === side ? "bg-pine-50 font-semibold text-pine-800" : ""}`}>
                        {r.better === side && (
                          <span aria-label="Better for you" className="mr-1">
                            ✓
                          </span>
                        )}
                        <span className="inline-block first-letter:uppercase">{r[side]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onOpen(cmp.a.id)}>
              Plan {cmp.a.name}
            </Button>
            <Button variant="secondary" onClick={() => onOpen(cmp.b.id)}>
              Plan {cmp.b.name}
            </Button>
          </div>
          <p className="text-center text-xs text-muted">Costs are estimates for your group size and days. Always check local road and weather status.</p>
        </>
      )}
    </div>
  );
}
