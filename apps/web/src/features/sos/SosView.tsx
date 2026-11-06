import type { PlannerData, SosIncidentDto, TrustedContactDto } from "@offgrid/core";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Skeleton } from "../../design/States";
import { api, ApiFailure, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { beaconConnection, subscribeBeacon } from "../../lib/beaconLink";
import { enqueue, processOutbox, useOutbox } from "../../lib/outbox";

const COUNTDOWN = 5;

function currentPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

async function batteryLevel(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
  try {
    return nav.getBattery ? Math.round((await nav.getBattery()).level * 100) : null;
  } catch {
    return null;
  }
}

/**
 * The SOS screen. 112 always comes first: OFFGRID adds people who know your plan, it doesn't replace
 * emergency services. With signal the SOS goes straight to the server; without, it waits in the outbox
 * and a paired beacon carries it over LoRa instead.
 */
export function SosView({ data, onLogin, onBeacon }: { data: PlannerData; onLogin: () => void; onBeacon: () => void }) {
  const auth = useAuth();
  const [incident, setIncident] = useState<SosIncidentDto | null | undefined>(undefined);
  const [contacts, setContacts] = useState<TrustedContactDto[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pendingId = useRef<string | null>(null);
  const beacon = useSyncExternalStore(subscribeBeacon, beaconConnection);
  const outbox = useOutbox();
  const emergency = data.region.emergency;

  const load = useCallback(async () => {
    try {
      const [inc, cs] = await Promise.all([api<SosIncidentDto | null>("/sos/active"), api<TrustedContactDto[]>("/contacts")]);
      setIncident(inc);
      setContacts(cs);
    } catch (e) {
      // Offline: still let them raise an SOS (it queues) and call 112.
      setIncident((cur) => cur ?? null);
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    if (auth.status === "authed") void load();
  }, [auth.status, load]);

  const send = useCallback(async () => {
    setCount(null);
    setError(null);
    const id = pendingId.current ?? crypto.randomUUID();
    pendingId.current = id;
    // Tell the beacon first: it needs no signal, and the phone's own request may never get out.
    beacon?.send("SOS").catch(() => undefined);
    const [point, battery] = await Promise.all([currentPosition(), batteryLevel()]);
    const body = { point, battery };
    try {
      setIncident(await api<SosIncidentDto>(`/sos/${id}`, { method: "PUT", body }));
    } catch (e) {
      if (e instanceof ApiFailure && e.status !== 0 && e.status < 500) {
        setError(e.message);
        return;
      }
      await enqueue({ id, kind: "sos", label: "SOS alert", method: "PUT", path: `/sos/${id}`, body });
      setQueued(true);
      void processOutbox();
    }
  }, [beacon]);

  // A queued SOS leaves the outbox once it's delivered: show the live incident instead of "queued".
  const sosQueued = outbox.some((o) => o.kind === "sos" && !o.failed);
  useEffect(() => {
    if (queued && !sosQueued) {
      setQueued(false);
      void load();
    }
  }, [queued, sosQueued, load]);

  // Countdown: 5 seconds to cancel an accidental press.
  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      void send();
      return;
    }
    const t = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(t);
  }, [count, send]);

  // While an SOS is active and this screen is open, keep the contacts' map up to date.
  useEffect(() => {
    if (incident?.status !== "active") return;
    const t = setInterval(async () => {
      const point = await currentPosition();
      if (!point) return;
      api<SosIncidentDto>(`/sos/${incident.id}`, { method: "PUT", body: { point, battery: await batteryLevel() } })
        .then(setIncident)
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(t);
  }, [incident?.id, incident?.status]);

  const imSafe = async () => {
    if (!incident || !confirm("Mark yourself safe? Your contacts get a message that the SOS is over.")) return;
    beacon?.send("CANCEL").catch(() => undefined);
    try {
      setIncident(await api<SosIncidentDto>(`/sos/${incident.id}/cancel`, { method: "POST" }));
      pendingId.current = null;
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const callBlock = (
    <Card className="border-danger-200 bg-danger-50">
      <p className="text-sm font-bold text-danger-700">In danger right now? Call first.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {emergency.map((e) => (
          <a key={e.number} href={`tel:${e.number}`} className="flex min-h-12 flex-col items-center justify-center rounded-xl bg-danger-700 px-2 py-1 text-white">
            <span className="text-lg font-extrabold">📞 {e.number}</span>
            <span className="text-[11px] leading-tight">{e.label}</span>
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink">112 works on any mobile network, even without your own SIM's signal, as long as some network reaches you.</p>
    </Card>
  );

  if (auth.status === "loading") return <Skeleton className="h-64" />;
  if (auth.status === "guest") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold">🆘 Emergency</h1>
        {callBlock}
        <Card>
          <SectionTitle hint="With an account, an SOS texts your emergency contacts your location and a live map, and a paired beacon can send it with no signal at all.">
            Set up OFFGRID SOS
          </SectionTitle>
          <Button onClick={onLogin}>Log in or sign up</Button>
        </Card>
      </div>
    );
  }

  const active = incident?.status === "active";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">🆘 Emergency</h1>
      {callBlock}

      {incident === undefined ? (
        <Skeleton className="h-40" />
      ) : active ? (
        <Card className="space-y-3 border-danger-200" aria-live="polite">
          <p className="flex items-center gap-2 text-lg font-extrabold text-danger-700">
            <span aria-hidden="true" className="relative flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger-700 opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-danger-700" />
            </span>
            SOS is active
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-paper p-2.5">
              <dt className="text-xs text-muted">Started</dt>
              <dd className="font-bold">{new Date(incident.startedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} via {incident.source === "beacon" ? "beacon" : "phone"}</dd>
            </div>
            <div className="rounded-xl bg-paper p-2.5">
              <dt className="text-xs text-muted">Contacts told</dt>
              <dd className="font-bold">{incident.contactsNotified}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-paper p-2.5">
              <dt className="text-xs text-muted">Last location sent</dt>
              <dd className="font-bold">
                {incident.last
                  ? `${incident.last.lat.toFixed(5)}, ${incident.last.lon.toFixed(5)} · ${new Date(incident.last.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} (${incident.last.via})`
                  : "None yet. Move to open sky so the GPS can get a fix."}
              </dd>
            </div>
          </dl>
          {incident.contactsNotified === 0 && (
            <Callout tone="warn" title="Nobody was messaged">
              You have no emergency contacts. Call 112, and add contacts so this can reach someone next time.
            </Callout>
          )}
          {incident.statusUrl && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(incident.statusUrl!).then(() => setCopied(true));
                }}
              >
                {copied ? "✓ Link copied" : "🔗 Copy live-status link"}
              </Button>
              <a href={incident.statusUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-pine-700 hover:bg-pine-50">
                Open what contacts see ↗
              </a>
            </div>
          )}
          <p className="text-xs text-muted">Keep this screen open if you can: your location is re-sent every minute. Your beacon keeps sending on its own.</p>
          <Button block onClick={() => void imSafe()}>
            ✅ I'm safe, cancel the SOS
          </Button>
        </Card>
      ) : (
        <Card className="space-y-3 text-center">
          {count === null ? (
            <>
              <button
                type="button"
                onClick={() => setCount(COUNTDOWN)}
                className="mx-auto grid size-44 place-items-center rounded-full bg-danger-700 text-white shadow-lg ring-8 ring-danger-200 hover:bg-danger-700/90 focus-visible:ring-sun-500"
                aria-describedby="sos-help"
              >
                <span className="text-4xl font-extrabold tracking-wider">SOS</span>
              </button>
              <p id="sos-help" className="text-sm text-muted">
                Sends your location to {contacts?.length ? `your ${contacts.length} emergency contact${contacts.length > 1 ? "s" : ""}` : "your emergency contacts"} after a 5-second countdown.
              </p>
            </>
          ) : (
            <div role="alert" className="space-y-3">
              <p className="text-6xl font-extrabold text-danger-700 tabular-nums">{count}</p>
              <p className="font-bold">Sending SOS…</p>
              <Button block variant="secondary" onClick={() => setCount(null)}>
                Cancel, it was a mistake
              </Button>
            </div>
          )}
          {queued && (
            <Callout tone="warn" title="No signal: your SOS is queued">
              It sends by itself the moment any network reaches this phone.
              {beacon ? " Your beacon is also sending it over radio." : " A paired OFFGRID beacon would send it over radio with no signal at all."}
            </Callout>
          )}
          {incident && incident.status !== "active" && (
            <p className="text-sm text-muted">Your last SOS ended {incident.endedAt ? new Date(incident.endedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}.</p>
          )}
        </Card>
      )}

      {error && <Callout tone="danger">{error}</Callout>}

      {incident?.demoMessages && incident.demoMessages.length > 0 && (
        <Card>
          <SectionTitle hint="Demo mode: no real SMS is sent. This is exactly what each contact would receive.">Messages to your contacts</SectionTitle>
          <ul className="space-y-2">
            {incident.demoMessages.map((m) => (
              <li key={`${m.to}-${m.at}`} className="rounded-xl bg-paper p-3 text-sm">
                <p className="text-xs font-semibold text-muted">
                  To {m.to} · {new Date(m.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </p>
                <p className="mt-1 break-words">{m.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex items-center justify-between gap-3">
        <span className="text-sm">
          <span className="block font-semibold">{beacon ? `🟢 ${beacon.name} connected` : "Beacon and contacts"}</span>
          <span className="text-muted">
            {contacts ? `${contacts.length} emergency contact${contacts.length === 1 ? "" : "s"}` : "Emergency contacts"} · pair an OFFGRID beacon for SOS with no signal
          </span>
        </span>
        <Button variant="secondary" onClick={onBeacon}>
          Set up
        </Button>
      </Card>
    </div>
  );
}
