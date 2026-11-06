import {
  MONTH_NAMES,
  POI_CATEGORIES,
  POI_CATEGORY_LABELS,
  POI_TAG_LABELS,
  POI_TAGS,
  type PoiCategory,
  type PoiTag,
  type RegionPack,
  type SubmissionDto,
} from "@offgrid/core";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Chip } from "../../design/Fields";
import { EmptyState } from "../../design/States";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { db } from "../../lib/db";
import { formatDistance, savedCenter, useGeolocation } from "../../lib/geo";
import { shrinkImage } from "../../lib/image";
import { enqueue, processOutbox, useOutbox } from "../../lib/outbox";
import { MapView } from "../map/MapView";

const CATEGORIES = POI_CATEGORIES.filter((c) => c !== "event");
const MAX_PHOTOS = 3;
const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";

interface Photo {
  id: string;
  blob: Blob;
  url: string;
}

type Outcome = { kind: "sent"; submission: SubmissionDto } | { kind: "queued" } | { kind: "failed"; message: string };

export function SubmitPlaceView({ pack, onLogin, onDone }: { pack: RegionPack; onLogin: () => void; onDone: () => void }) {
  const auth = useAuth();
  const region = pack.planner.region;
  const start = savedCenter({ lat: pack.planner.places[0]!.lat, lon: pack.planner.places[0]!.lon, label: "" });
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PoiCategory>("viewpoint");
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [tips, setTips] = useState("");
  const [tags, setTags] = useState<PoiTag[]>([]);
  const [months, setMonths] = useState<number[]>([]);
  const [priceBand, setPriceBand] = useState<1 | 2 | 3 | null>(null);
  const [approximate, setApproximate] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [subId, setSubId] = useState(() => crypto.randomUUID());
  const geo = useGeolocation();
  const outbox = useOutbox();
  const ids = { name: useId(), cat: useId(), tips: useId(), photos: useId() };

  useEffect(() => {
    if (geo.state.status === "ok") setPin(geo.state.pos);
  }, [geo.state]);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  // Once a queued submission uploads (e.g. after coming back online), show the server's verdict.
  useEffect(() => {
    if (outcome?.kind !== "queued" || outbox.some((o) => o.id === subId)) return;
    api<SubmissionDto[]>("/submissions/mine")
      .then((mine) => {
        const s = mine.find((m) => m.id === subId);
        if (s) setOutcome({ kind: "sent", submission: s });
      })
      .catch(() => undefined);
  }, [outbox, outcome, subId]);

  if (auth.status !== "authed") {
    return (
      <EmptyState icon="🧭" title="Add a hidden place" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        You need an account to add places, so the community knows who to thank and who to ask.
      </EmptyState>
    );
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    try {
      const room = MAX_PHOTOS - photos.length;
      const next: Photo[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        const blob = await shrinkImage(f);
        next.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((p) => [...p, ...next]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Give the place a name (at least 2 characters).");
    if (!pin) return setError("Drop a pin on the map or use your location.");
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    if (pin.lon < minLon || pin.lon > maxLon || pin.lat < minLat || pin.lat > maxLat) return setError(`That pin is outside ${region.name}.`);

    setBusy(true);
    try {
      // Every submission goes through the outbox, online or not, so there's one code path to trust.
      await enqueue({
        id: subId,
        kind: "submission",
        label: `Add “${name.trim()}”`,
        method: "PUT",
        path: `/submissions/${subId}`,
        body: { name: name.trim(), category, lat: pin.lat, lon: pin.lon, tips: tips.trim(), tags, seasonality: months.length ? months : null, priceBand, approximate },
        photos: photos.map(({ id, blob }) => ({ id, blob })),
      });
      if (navigator.onLine) await processOutbox();
      const left = await db.outbox.get(subId);
      if (!left) {
        const mine = await api<SubmissionDto[]>("/submissions/mine");
        setOutcome({ kind: "sent", submission: mine.find((m) => m.id === subId)! });
      } else if (left.failed) {
        setOutcome({ kind: "failed", message: left.lastError ?? "The server didn't accept it." });
      } else {
        setOutcome({ kind: "queued" });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setName("");
    setTips("");
    setTags([]);
    setMonths([]);
    setPriceBand(null);
    setApproximate(false);
    setPhotos([]);
    setPin(null);
    setOutcome(null);
    setSubId(crypto.randomUUID());
  };

  if (outcome) {
    const s = outcome.kind === "sent" ? outcome.submission : null;
    return (
      <div className="space-y-4">
        {outcome.kind === "queued" && (
          <EmptyState icon="📦" title="Saved on your phone" action={<Button onClick={onDone}>Back to Nearby</Button>}>
            We couldn't reach the server, so it'll upload automatically, with photos, as soon as there's signal.
          </EmptyState>
        )}
        {outcome.kind === "failed" && (
          <Callout tone="danger" title="The server didn't accept this place">
            {outcome.message} You can fix it and try again from the sync list at the top of the screen.
          </Callout>
        )}
        {s && s.status === "duplicate" && (
          <EmptyState icon="🔁" title="Looks like this place is already listed" action={<Button onClick={onDone}>Back to Nearby</Button>}>
            We found “{s.duplicateCandidates[0]?.name}” {formatDistance((s.duplicateCandidates[0]?.distanceM ?? 0) / 1000)} away. Thanks for checking!
          </EmptyState>
        )}
        {s && s.status === "pending" && (
          <EmptyState icon="🙏" title="Thanks! Sent for review" action={<Button onClick={onDone}>Back to Nearby</Button>}>
            Other travellers will confirm it. When it's verified, it appears for everyone and you earn +{pack.moderation.contribution_xp} XP.
          </EmptyState>
        )}
        {s && s.duplicateCandidates.length > 0 && s.status === "pending" && (
          <Card>
            <SectionTitle hint="If it's one of these, you can withdraw yours from your profile.">Similar places nearby</SectionTitle>
            <ul className="space-y-1 text-sm">
              {s.duplicateCandidates.map((d) => (
                <li key={d.id}>
                  {d.name} · {formatDistance(d.distanceM / 1000)} away
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Button variant="secondary" block onClick={reset}>
          Add another place
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Add a hidden place</h1>
        <p className="text-sm text-muted">Somewhere useful that isn't on the map: a café, a viewpoint, a water point, a camping spot, a local guide.</p>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}

      <Card className="space-y-4">
        <div>
          <label htmlFor={ids.name} className="mb-1 block text-sm font-semibold">
            Name
          </label>
          <input id={ids.name} className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring above Rioti meadow" />
        </div>
        <div>
          <label htmlFor={ids.cat} className="mb-1 block text-sm font-semibold">
            Type
          </label>
          <select id={ids.cat} className={input} value={category} onChange={(e) => setCategory(e.target.value as PoiCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {POI_CATEGORY_LABELS[c].icon} {POI_CATEGORY_LABELS[c].label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionTitle hint="Tap the map to drop a pin, or use where you're standing.">Location</SectionTitle>
        <MapView
          center={pin ?? start}
          zoom={14}
          markers={pin ? [{ id: "pin", lat: pin.lat, lon: pin.lon, color: "#d9661d", label: "Your pin" }] : []}
          onPick={setPin}
          label="Map: tap to place the pin"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={geo.locate} disabled={geo.state.status === "locating"}>
            📍 {geo.state.status === "locating" ? "Locating…" : "Use my location"}
          </Button>
          {pin && (
            <span className="text-xs text-muted">
              {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}
            </span>
          )}
        </div>
        {geo.state.status === "error" && <Callout tone="warn">{geo.state.message}</Callout>}
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" checked={approximate} onChange={(e) => setApproximate(e.target.checked)} className="mt-0.5 size-5 accent-pine-700" />
          <span>
            <span className="font-semibold">Show only an approximate area (about 2 km)</span>
            <span className="block text-muted">
              For sacred or fragile spots that could be harmed by crowds. Only you and moderators see the exact pin, and photo
              location data is removed.
            </span>
          </span>
        </label>
      </Card>

      <Card className="space-y-4">
        <div>
          <label htmlFor={ids.tips} className="mb-1 block text-sm font-semibold">
            Tips for other travellers
          </label>
          <textarea id={ids.tips} rows={3} maxLength={1000} className="w-full rounded-xl border border-line bg-surface p-3 text-base" value={tips} onChange={(e) => setTips(e.target.value)} placeholder="How to find it, best time, what it costs…" />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Good to know</legend>
          <div className="flex flex-wrap gap-2">
            {POI_TAGS.filter((t) => t !== "wheelchair").map((t) => (
              <Chip key={t} selected={tags.includes(t)} onToggle={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                {POI_TAG_LABELS[t]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Price</legend>
          <div className="flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((p) => (
              <Chip key={p} selected={priceBand === p} onToggle={() => setPriceBand(priceBand === p ? null : p)}>
                {"₹".repeat(p)}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold">Open in which months?</legend>
          <p className="mb-2 text-xs text-muted">Leave empty if it's open all year.</p>
          <div className="grid grid-cols-6 gap-1.5">
            {MONTH_NAMES.map((m, i) => (
              <button
                key={m}
                type="button"
                aria-pressed={months.includes(i + 1)}
                aria-label={m}
                onClick={() => setMonths((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1]))}
                className={`min-h-11 rounded-lg border text-xs font-semibold ${months.includes(i + 1) ? "border-pine-700 bg-pine-700 text-white" : "border-line bg-surface"}`}
              >
                {m.slice(0, 3)}
              </button>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-3">
        <SectionTitle hint={`Up to ${MAX_PHOTOS}. Photos are shrunk on your phone and stripped of location data.`}>Photos</SectionTitle>
        {photos.length > 0 && (
          <ul className="flex gap-2">
            {photos.map((p) => (
              <li key={p.id} className="relative">
                <img src={p.url} alt="" className="size-24 rounded-xl object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}
                  className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-ink text-white"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_PHOTOS && (
          <label htmlFor={ids.photos} className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-dashed border-line px-4 text-sm font-semibold text-pine-700 hover:bg-pine-50">
            📷 Add photos
            <input id={ids.photos} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void addPhotos(e.target.files)} />
          </label>
        )}
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted">
        <Badge tone="accent">+{pack.moderation.contribution_xp} XP</Badge> when the community verifies it.
      </div>
      <Button type="submit" block disabled={busy} className="min-h-12 text-base">
        {busy ? "Sending…" : navigator.onLine ? "Submit place" : "Save and send when online"}
      </Button>
    </form>
  );
}
