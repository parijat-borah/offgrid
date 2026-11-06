import { monthName, type SeasonStatus } from "@offgrid/core";

const STYLE: Record<SeasonStatus, string> = {
  good: "bg-pine-600 text-white",
  risky: "bg-warn-200 text-warn-700",
  closed: "bg-line text-muted line-through",
};
const LABEL: Record<SeasonStatus, string> = { good: "Good", risky: "Risky", closed: "Closed" };

export function SeasonStrip({ calendar, highlight }: { calendar: SeasonStatus[]; highlight: number }) {
  return (
    <div>
      <ol className="grid grid-cols-12 gap-1" aria-label="Season by month">
        {calendar.map((s, i) => {
          const m = i + 1;
          return (
            <li
              key={m}
              title={`${monthName(m)}: ${LABEL[s]}`}
              className={`flex h-9 items-center justify-center rounded-md text-xs font-bold ${STYLE[s]} ${
                m === highlight ? "ring-3 ring-sun-500 ring-offset-1" : ""
              }`}
            >
              <span aria-hidden="true">{monthName(m)[0]}</span>
              <span className="sr-only">
                {monthName(m)}: {LABEL[s]}
                {m === highlight ? " (your month)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <div aria-hidden="true" className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        {(Object.keys(LABEL) as SeasonStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded-sm ${STYLE[s]}`} /> {LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm ring-2 ring-sun-500" /> Your month
        </span>
      </div>
    </div>
  );
}
