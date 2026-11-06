import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Native <dialog> with showModal(): focus trap, Esc to close and an inert background for free. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto rounded-2xl bg-surface p-0 text-ink shadow-xl"
      // Inline because min() needs spaces around "-", which Tailwind arbitrary values drop.
      style={{ width: wide ? "min(100% - 2rem, 36rem)" : "min(100% - 2rem, 28rem)", maxWidth: "none" }}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-2 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <Button variant="ghost" aria-label="Close" onClick={onClose} className="-mt-2 -mr-2">
              ✕
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
