export const nowIso = () => new Date().toISOString();

/** "2026-10" style season key; leaderboards reset monthly (Phase 6). */
export const seasonOf = (d: Date = new Date()) => d.toISOString().slice(0, 7);

export function monthStartIso(d: Date = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
