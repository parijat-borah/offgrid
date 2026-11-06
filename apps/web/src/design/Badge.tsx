import type { ReactNode } from "react";

export type Tone = "good" | "warn" | "danger" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  good: "bg-pine-50 text-pine-700 border-pine-100",
  warn: "bg-warn-50 text-warn-700 border-warn-200",
  danger: "bg-danger-50 text-danger-700 border-danger-200",
  neutral: "bg-paper text-muted border-line",
  accent: "bg-sun-50 text-ink border-line",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Callout({ tone, title, children }: { tone: Exclude<Tone, "neutral" | "accent">; title?: string; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`rounded-xl border p-3 text-sm ${TONES[tone]}`}>
      {title && <p className="mb-1 font-bold">{title}</p>}
      <div className="text-ink">{children}</div>
    </div>
  );
}
