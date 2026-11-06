import { authHeader, refreshSession } from "./api";

/**
 * Read a server-sent-events stream with fetch. EventSource can't send an Authorization header,
 * and putting the token in the URL would leak it into logs. Reconnects with backoff, and
 * refreshes the access token once if it has expired.
 */
export function openStream(path: string, onEvent: (event: string, data: string) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let delay = 1000;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        let res = await fetch(`/api/v1${path}`, { headers: { Accept: "text/event-stream", ...authHeader() }, signal: controller.signal });
        if (res.status === 401 && (await refreshSession())) {
          res = await fetch(`/api/v1${path}`, { headers: { Accept: "text/event-stream", ...authHeader() }, signal: controller.signal });
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let event = "message";
            const data: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (data.length) onEvent(event, data.join("\n"));
          }
        }
      } catch {
        /* dropped connection or offline: retry below */
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
