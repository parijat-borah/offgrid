import { useSyncExternalStore } from "react";

/** Live result of a CSS media query, e.g. useMedia("(min-width: 1024px)") for "laptop layout". */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `lg` breakpoint, where the sidebar layout starts. */
export const LAPTOP = "(min-width: 1024px)";
