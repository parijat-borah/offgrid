import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiFailure, upload } from "./api";
import { db, type OutboxOp } from "./db";

type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: OutboxOp[] = [];
let running: Promise<void> | null = null;

async function refreshSnapshot() {
  snapshot = await db.outbox.orderBy("createdAt").toArray().catch(() => []);
  listeners.forEach((l) => l());
}

export async function enqueue(op: Omit<OutboxOp, "createdAt" | "attempts" | "lastError" | "failed">) {
  await db.outbox.put({ ...op, createdAt: Date.now(), attempts: 0, lastError: null, failed: false });
  await refreshSnapshot();
}

export async function discard(id: string) {
  await db.outbox.delete(id);
  await refreshSnapshot();
}

export async function retry(id: string) {
  await db.outbox.update(id, { failed: false, lastError: null });
  await refreshSnapshot();
  return processOutbox();
}

async function send(op: OutboxOp) {
  await api(op.path, { method: op.method, body: op.body });
  // Photo ids come from the client, so a retry after a dropped connection never duplicates one.
  for (const photo of op.photos ?? []) {
    const form = new FormData();
    form.append("photo", photo.blob, `${photo.id}.jpg`);
    await upload(`${op.path}/photos/${photo.id}`, form);
  }
}

/**
 * Replay queued writes in order. Network errors stop the run (we're offline; try later).
 * A 4xx means the server will never accept it as-is, so it's marked failed for the user to see.
 */
export function processOutbox(): Promise<void> {
  running ??= (async () => {
    try {
      const ops = await db.outbox.orderBy("createdAt").toArray();
      for (const op of ops) {
        if (op.failed) continue;
        try {
          await send(op);
          await db.outbox.delete(op.id);
        } catch (e) {
          const status = e instanceof ApiFailure ? e.status : 0;
          const message = e instanceof Error ? e.message : String(e);
          const transient = status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
          await db.outbox.update(op.id, { attempts: op.attempts + 1, lastError: message, failed: !transient });
          if (transient) break;
        }
      }
    } finally {
      running = null;
      await refreshSnapshot();
    }
  })();
  return running;
}

export function useOutbox(): OutboxOp[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** Mount once: load the queue, and flush it on start-up and whenever the connection returns. */
export function useOutboxSync(enabled: boolean) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    void refreshSnapshot();
    if (!enabled) return;
    void processOutbox().finally(() => setStarted(true));
    const onOnline = () => void processOutbox();
    window.addEventListener("online", onOnline);
    // "online" only fires when the device regains a network. A server that was down, or a
    // captive portal, never fires it, so retry pending writes every minute as well.
    const timer = setInterval(() => {
      if (snapshot.some((o) => !o.failed)) void processOutbox();
    }, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [enabled]);
  return started;
}
