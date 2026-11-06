// localStorage can throw (private mode, quota, blocked site data), so every access is guarded.
// It only holds per-device conveniences; accounts and server sync arrive in Phase 2.

export const KEYS = {
  lastInput: "offgrid.lastInput.v1",
  packing: (placeId: string, month: number) => `offgrid.packing.v1.${placeId}.${month}`,
};

export function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just won't remember */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
