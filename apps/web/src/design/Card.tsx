import type { HTMLAttributes, ReactNode } from "react";

/** `flush` drops the padding, for cards whose photo runs edge to edge. */
export function Card({ className = "", flush = false, ...props }: HTMLAttributes<HTMLElement> & { flush?: boolean }) {
  return <section className={`rounded-2xl border border-line/80 bg-surface shadow-[var(--shadow-card)] ${flush ? "" : "p-4 sm:p-5"} ${className}`} {...props} />;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-extrabold text-ink">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Top of a screen: optional eyebrow, the title, a short line of context and actions on the right (below on phones). */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold tracking-wider text-pine-700 uppercase">{eyebrow}</p>}
        <h1 className="text-2xl leading-tight font-extrabold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
