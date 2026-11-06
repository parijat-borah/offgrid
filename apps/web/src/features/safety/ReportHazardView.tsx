import { HAZARD_LABELS, type HazardKind, type RegionPack } from "@offgrid/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Chip, Segmented } from "../../design/Fields";
import { EmptyState } from "../../design/States";
import { errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { db } from "../../lib/db";
import { savedCenter, useGeolocation } from "../../lib/geo";
import { enqueue, processOutbox } from "../../lib/outbox";
import { MapView } from "../map/MapView";

const KINDS: HazardKind[] = ["landslide", "road_closure", "river_crossing", "flash_flood", "avalanche", "bear", "leopard", "snake", "lightning", "extreme_cold"];

export function ReportHazardView({ pack, onLogin, onDone }: { pack: RegionPack; onLogin: () => void; onDone: () => void }) {
  const auth = useAuth();
  const region = pack.planner.region;
  const start = savedCenter({ lat: pack.planner.places[0]!.lat, lon: pack.planner.places[0]!.lon, label: "" });
  const [kind, setKind] = useState<HazardKind>("landslide");
  const [severity, setSeverity] = useState<1 | 2 | 3>(2);
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "queued" | null>(null);
  const geo = useGeolocation();
  const descId = useId();

  useEffect(() => {
    if (geo.state.status === "ok") setPin(geo.state.pos);
  }, [geo.state]);

  if (auth.status !== "authed") {
    return (
      <EmptyState icon="⚠️" title="Report a hazard" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        Reports need an account so other travellers can trust them. In an emergency, call 112 first.
      </EmptyState>
    );
  }

  const ttl = pack.safety.hazard_reports.default_ttl_hours[kind];

  if (done) {
    return (
      <EmptyState icon={done === "sent" ? "🛟" : "📦"} title={done === "sent" ? "Thanks, travellers nearby can see it now" : "Saved on your phone"} action={<Button onClick={onDone}>Back to Nearby</Button>}>
        {done === "sent"
          ? `It's marked as an unverified traveller report and expires in ${ttl} hours unless others confirm it's still there.`
          : "We couldn't reach the server. It'll post automatically as soon as there's signal."}
      </EmptyState>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 10) return setError("Say what you saw (at least 10 characters).");
    if (!pin) return setError("Drop a pin where the hazard is, or use your location.");
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    if (pin.lon < minLon || pin.lon > maxLon || pin.lat < minLat || pin.lat > maxLat) return setError(`That location is outside ${region.name}.`);
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await enqueue({
        id,
        kind: "hazard",
        label: `Report: ${HAZARD_LABELS[kind]}`,
        method: "PUT",
        path: `/hazards/${id}`,
        body: { kind, severity, description: description.trim(), lat: pin.lat, lon: pin.lon },
      });
      if (navigator.onLine) await processOutbox();
      const left = await db.outbox.get(id);
      if (left?.failed) setError(left.lastError ?? "The server didn't accept the report.");
      else setDone(left ? "queued" : "sent");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Report a hazard</h1>
        <p className="text-sm text-muted">Warn travellers behind you about a slide, a swollen stream or an animal on the trail.</p>
      </div>
      <Callout tone="danger">If someone is hurt or in danger, call 112 first.</Callout>
      {error && <Callout tone="danger">{error}</Callout>}

      <Card className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">What is it?</legend>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k} selected={kind === k} onToggle={() => setKind(k)}>
                {HAZARD_LABELS[k]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Segmented<1 | 2 | 3>
          label="How serious?"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: 1, label: "Heads-up", hint: "Be aware" },
            { value: 2, label: "Caution", hint: "Slow down" },
            { value: 3, label: "Danger", hint: "Avoid / turn back" },
          ]}
        />
        <div>
          <label htmlFor={descId} className="mb-1 block text-sm font-semibold">
            What did you see?
          </label>
          <textarea
            id={descId}
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface p-3 text-base"
            placeholder="e.g. Fresh slide blocking the road 2 km after the bridge; cars turning back."
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionTitle hint="Tap the map where it is, or use where you're standing.">Where?</SectionTitle>
        <MapView
          center={pin ?? start}
          zoom={13}
          markers={pin ? [{ id: "pin", lat: pin.lat, lon: pin.lon, color: "#b42318", label: "Hazard", radiusM: pack.safety.hazard_reports.radius_m }] : []}
          onPick={setPin}
          label="Map: tap to place the hazard"
        />
        <Button variant="secondary" onClick={geo.locate} disabled={geo.state.status === "locating"}>
          📍 {geo.state.status === "locating" ? "Locating…" : "Use my location"}
        </Button>
        {geo.state.status === "error" && <Callout tone="warn">{geo.state.message}</Callout>}
      </Card>

      <p className="text-xs text-muted">
        Shows immediately as an unverified traveller report and expires in {ttl} hours unless others confirm it.
      </p>
      <Button type="submit" block disabled={busy} className="min-h-12 text-base">
        {busy ? "Posting…" : "Post warning"}
      </Button>
    </form>
  );
}
