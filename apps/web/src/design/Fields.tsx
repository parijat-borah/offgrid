import { useId, type ReactNode } from "react";

export function Chip({ selected, onToggle, children }: { selected: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
        selected ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface text-ink hover:bg-pine-50"
      }`}
    >
      {selected && <span aria-hidden="true">✓ </span>}
      {children}
    </button>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  format?: (n: number) => string;
}) {
  const id = useId();
  const btn =
    "grid size-11 place-items-center rounded-xl border border-line bg-surface text-xl font-semibold text-pine-700 hover:bg-pine-50 disabled:opacity-40";
  return (
    <div role="group" aria-labelledby={id}>
      <p id={id} className="mb-1.5 text-sm font-semibold text-ink">
        {label}
      </p>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Decrease ${label}`}>
          −
        </button>
        <output aria-live="polite" className="min-w-16 text-center text-lg font-bold tabular-nums">
          {format(value)}
        </output>
        <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-center text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-sun-500 ${
                checked ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface text-ink hover:bg-pine-50"
              }`}
            >
              <input type="radio" className="sr-only" name={name} checked={checked} onChange={() => onChange(o.value)} />
              <span className="font-semibold">{o.label}</span>
              {o.hint && <span className={`text-xs ${checked ? "text-pine-100" : "text-muted"}`}>{o.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
