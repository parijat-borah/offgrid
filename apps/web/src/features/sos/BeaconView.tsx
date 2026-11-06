import type { BeaconDto, BeaconPairResponse, RelayResult, TrustedContactDto } from "@offgrid/core";
import { useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api, ApiFailure, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { beaconConnection, bluetoothSupported, connectBluetooth, pairOverUsb, serialSupported, setBeaconConnection, subscribeBeacon } from "../../lib/beaconLink";
import { enqueue } from "../../lib/outbox";

const DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true";
const input = "min-h-11 w-full rounded-xl border border-line bg-surface px-3";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

function ContactsCard() {
  const [list, setList] = useState<TrustedContactDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const phoneId = useId();

  const load = useCallback(() => {
    setError(null);
    api<TrustedContactDto[]>("/contacts").then(setList).catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setList(await api<TrustedContactDto[]>("/contacts", { method: "POST", body: { name, phone, theyAgreed: agreed } }));
      setName("");
      setPhone("");
      setAgreed(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: TrustedContactDto) => {
    if (!confirm(`Remove ${c.name}? They won't be told if you raise an SOS.`)) return;
    api<TrustedContactDto[]>(`/contacts/${c.id}`, { method: "DELETE" }).then(setList).catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <Card>
      <SectionTitle hint="They get an SMS with your location and a live map if you raise an SOS. Up to 5. Ask them first.">Emergency contacts</SectionTitle>
      {!list && !error ? (
        <Skeleton className="h-16" />
      ) : (
        <>
          {list && list.length === 0 && <Callout tone="warn">No contacts yet. Without one, an SOS reaches nobody but you.</Callout>}
          <ul className="divide-y divide-line">
            {list?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-semibold">{c.name}</span>
                  <span className="text-xs text-muted">{c.phoneMasked}</span>
                </span>
                <Button variant="ghost" onClick={() => void remove(c)} aria-label={`Remove ${c.name}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {(list?.length ?? 0) < 5 && (
            <form onSubmit={add} className="mt-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={nameId} className="mb-1 block text-sm font-semibold">
                    Name
                  </label>
                  <input id={nameId} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Maa" className={input} autoComplete="off" />
                </div>
                <div>
                  <label htmlFor={phoneId} className="mb-1 block text-sm font-semibold">
                    Mobile number
                  </label>
                  <input id={phoneId} value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" autoComplete="off" className={input} />
                </div>
              </div>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
                They've agreed to be my emergency contact and to get SMS from OFFGRID if I raise an SOS.
              </label>
              <Button type="submit" disabled={busy || !name.trim() || !phone.trim() || !agreed}>
                {busy ? "Adding…" : "Add contact"}
              </Button>
            </form>
          )}
        </>
      )}
      {error && (
        <div className="mt-2">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
    </Card>
  );
}

/** The phone as a relay: whatever the beacon hears (its own SOS, or another trekker's) goes up when there's signal. */
function BluetoothCard() {
  const conn = useSyncExternalStore(subscribeBeacon, beaconConnection);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const push = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })} ${s}`, ...l].slice(0, 8));

  const onPacket = async (hex: string) => {
    const kind = hex.slice(2, 4) === "02" ? "SOS" : hex.slice(2, 4) === "03" ? "cancel" : "ping";
    try {
      const { results } = await api<{ results: RelayResult[] }>("/beacons/relay", { method: "POST", body: { relayId: "phone", packets: [hex] } });
      push(`${kind} from ${hex.slice(4, 12)} → server: ${results[0]?.status ?? "?"}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.status !== 0) {
        push(`${kind} rejected: ${e.message}`);
        return;
      }
      // No signal: keep it and send later. The relay endpoint de-duplicates, so retries are harmless.
      await enqueue({ id: crypto.randomUUID(), kind: "relay", label: `Beacon ${kind}`, method: "POST", path: "/beacons/relay", body: { relayId: "phone", packets: [hex] } });
      push(`${kind} from ${hex.slice(4, 12)} saved, sends when there's signal`);
    }
  };

  const connect = async () => {
    setError(null);
    try {
      const c = await connectBluetooth(
        (hex) => void onPacket(hex),
        () => {
          setBeaconConnection(null);
          push("Beacon disconnected");
        },
      );
      setBeaconConnection(c);
      push(`Connected to ${c.name}`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return; // user closed the picker
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    }
  };

  return (
    <Card>
      <SectionTitle hint="Your phone passes on whatever your beacon hears, including other trekkers' SOS, as soon as it has signal. Chrome on Android.">
        Bluetooth link
      </SectionTitle>
      {!bluetoothSupported() ? (
        <Callout tone="warn">This browser can't use Bluetooth. Use Chrome on Android. The beacon still works on its own over radio.</Callout>
      ) : conn ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="good">🟢 {conn.name}</Badge>
          <Button variant="secondary" onClick={() => void conn.send("PING").then(() => push("Asked the beacon for a ping"))}>
            Test ping
          </Button>
          <Button variant="ghost" onClick={() => conn.disconnect()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => void connect()}>
          Connect to my beacon
        </Button>
      )}
      {error && (
        <div className="mt-2">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      {log.length > 0 && (
        <ol className="mt-3 space-y-1 font-mono text-xs text-muted" aria-label="Bluetooth activity">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function BeaconView({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const auth = useAuth();
  const [beacons, setBeacons] = useState<BeaconDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [paired, setPaired] = useState<BeaconPairResponse | null>(null);
  const [usb, setUsb] = useState<{ ok: boolean; reply: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const idId = useId();
  const nameId = useId();

  const load = useCallback(() => {
    setError(null);
    api<BeaconDto[]>("/beacons").then(setBeacons).catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (auth.status === "authed") load();
  }, [auth.status, load]);

  if (auth.status === "loading") return <Skeleton className="h-64" />;
  if (auth.status === "guest") {
    return (
      <EmptyState icon="📡" title="SOS beacon and emergency contacts" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        Pair an OFFGRID beacon and add the people who should hear from you if something goes wrong.
      </EmptyState>
    );
  }

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    setPairError(null);
    setUsb(null);
    try {
      const res = await api<BeaconPairResponse>("/beacons/pair", { method: "POST", body: { id: id.trim().toLowerCase(), name: name.trim() || "My beacon" } });
      setPaired(res);
      setId("");
      setName("");
      load();
    } catch (err) {
      setPairError(errorMessage(err));
    }
  };

  const unpair = async (b: BeaconDto) => {
    if (!confirm(`Unpair ${b.name}? Its key stops working at once, and its SOS packets will be ignored until you pair it again.`)) return;
    await api(`/beacons/${b.id}`, { method: "DELETE" }).catch((e: unknown) => setError(errorMessage(e)));
    load();
  };

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(what));
  };

  const simCommand = paired ? `npm start -w @offgrid/beacon-sim -- --pair "${paired.serialCommand}"` : "";

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="-ml-3">
        ← Back
      </Button>
      <div>
        <h1 className="text-2xl font-extrabold">
          <span aria-hidden="true">📡 </span>SOS beacon
        </h1>
        <p className="text-sm text-muted">A pocket radio that sends your SOS and location over LoRa where phones have no signal. It complements 112; it doesn't replace it.</p>
      </div>

      <ContactsCard />

      <Card>
        <SectionTitle hint="Location pings every 5 minutes. Hold the button 3 seconds for SOS (every 30 s), and 3 seconds again to cancel.">My beacons</SectionTitle>
        {error ? (
          <ErrorState title="Couldn't load your beacons" detail={error} onRetry={load} />
        ) : !beacons ? (
          <Skeleton className="h-16" />
        ) : beacons.length === 0 ? (
          <p className="text-sm text-muted">No beacon paired yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {beacons.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {b.name} <span className="font-mono text-xs text-muted">{b.id}</span>
                  </span>
                  <span className="block text-xs text-muted">
                    Last heard {ago(b.lastSeenAt)}
                    {b.battery !== null && ` · 🔋 ${b.battery}%`}
                    {b.last && ` · ${b.last.lat.toFixed(4)}, ${b.last.lon.toFixed(4)}`}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => void unpair(b)}>
                  Unpair
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={pair} className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">Pair a beacon</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={idId} className="mb-1 block text-xs text-muted">
                Beacon ID (8 characters on the sticker, or type ID in its serial console)
              </label>
              <input id={idId} value={id} maxLength={8} onChange={(e) => setId(e.target.value)} placeholder="0a1b2c3d" className={`${input} font-mono`} autoComplete="off" spellCheck={false} />
            </div>
            <div>
              <label htmlFor={nameId} className="mb-1 block text-xs text-muted">
                Name (optional)
              </label>
              <input id={nameId} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Blue beacon" className={input} autoComplete="off" />
            </div>
          </div>
          {pairError && <Callout tone="danger">{pairError}</Callout>}
          <Button type="submit" disabled={!/^[0-9a-fA-F]{8}$/.test(id.trim())}>
            Pair
          </Button>
        </form>
      </Card>

      <BluetoothCard />

      <Dialog open={paired !== null} title="Write the key to your beacon" onClose={() => setPaired(null)}>
        {paired && (
          <div className="space-y-3 text-sm">
            <p>
              This key is shown <span className="font-bold">only once</span>. It lets the server trust packets from <span className="font-mono">{paired.beacon.id}</span>. Write it to the beacon now.
            </p>
            {serialSupported() ? (
              <Button
                block
                onClick={() =>
                  void pairOverUsb(paired.serialCommand)
                    .then(setUsb)
                    .catch((e: unknown) => {
                      if (!(e instanceof DOMException && e.name === "NotFoundError")) setUsb({ ok: false, reply: e instanceof Error ? e.message : "USB failed" });
                    })
                }
              >
                🔌 Send to beacon over USB
              </Button>
            ) : (
              <Callout tone="warn">USB pairing needs Chrome or Edge on a computer. You can also paste the line below into any serial monitor at 115200 baud.</Callout>
            )}
            {usb && <Callout tone={usb.ok ? "good" : "danger"}>{usb.ok ? "Paired! The beacon replied “OK paired” and sent its first ping." : usb.reply}</Callout>}
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Serial command</p>
              <code className="block break-all rounded-xl bg-paper p-2 font-mono text-xs">{paired.serialCommand}</code>
              <Button variant="ghost" className="-ml-2" onClick={() => copy(paired.serialCommand, "serial")}>
                {copied === "serial" ? "✓ Copied" : "Copy"}
              </Button>
            </div>
            {DEMO && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted">No hardware? Run the simulator (demo mode)</p>
                <code className="block break-all rounded-xl bg-paper p-2 font-mono text-xs">{simCommand}</code>
                <Button variant="ghost" className="-ml-2" onClick={() => copy(simCommand, "sim")}>
                  {copied === "sim" ? "✓ Copied" : "Copy"}
                </Button>
              </div>
            )}
            <Button block variant="secondary" onClick={() => setPaired(null)}>
              Done
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
