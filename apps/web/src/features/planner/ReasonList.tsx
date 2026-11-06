import type { Reason } from "@offgrid/core";

const ICON: Record<Reason["tone"], { icon: string; label: string; cls: string }> = {
  good: { icon: "✓", label: "Good", cls: "text-pine-700" },
  neutral: { icon: "•", label: "Note", cls: "text-muted" },
  warn: { icon: "!", label: "Caution", cls: "text-warn-700" },
};

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {reasons.map((r) => (
        <li key={r.text} className="flex gap-2">
          <span aria-hidden="true" className={`w-4 shrink-0 text-center font-bold ${ICON[r.tone].cls}`}>
            {ICON[r.tone].icon}
          </span>
          <span>
            <span className="sr-only">{ICON[r.tone].label}: </span>
            {r.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
