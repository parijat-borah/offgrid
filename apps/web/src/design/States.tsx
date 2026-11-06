import type { ReactNode } from "react";
import { Button } from "./Button";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-xl ${className}`} />;
}

export function EmptyState({ icon = "🧭", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center">
      <div aria-hidden="true" className="text-4xl">
        {icon}
      </div>
      <h2 className="mt-2 text-lg font-bold">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger-200 bg-danger-50 px-5 py-8 text-center">
      <div aria-hidden="true" className="text-4xl">
        ⚠️
      </div>
      <h2 className="mt-2 text-lg font-bold text-danger-700">{title}</h2>
      {detail && <pre className="mx-auto mt-2 max-w-md whitespace-pre-wrap text-left text-xs text-ink">{detail}</pre>}
      {onRetry && (
        <div className="mt-4">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}
