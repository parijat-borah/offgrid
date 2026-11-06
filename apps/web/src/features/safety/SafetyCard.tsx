import {
  formatNumber,
  HAZARD_LABELS,
  hazardsForPlace,
  monthName,
  nearestHospitals,
  type Itinerary,
  type PlannerInput,
  type Place,
  type RegionPack,
  type SeasonStatus,
} from "@offgrid/core";
import { useEffect, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { formatDistance } from "../../lib/geo";
import { readJSON, writeJSON } from "../../lib/storage";
import { SeasonStrip } from "../planner/SeasonStrip";

const SEVERITY_TONE = { 1: "neutral", 2: "warn", 3: "danger" } as const;
const SEVERITY_LABEL = { 1: "Low", 2: "Moderate", 3: "High" } as const;

/** A short message for a trusted contact: what, where, when back, and what to do if not. */
function tellSomeoneText(place: Place, input: PlannerInput, itinerary: Itinerary, emergency: string): string {
  const lines = [
    `I'm going to ${place.name} (${place.district}, HP) in ${monthName(input.month)} for ${itinerary.plannedDays} days, ${input.groupSize === 1 ? "solo" : `with ${input.groupSize - 1} others`}.`,
    ...itinerary.days.map((d) => `Day ${d.day}: ${d.title} (sleep ${formatNumber(d.sleep_alt_m)} m)`),
    `If you don't hear from me by the evening of the last day, call ${emergency} and the police in ${place.base_town}.`,
    "Sent from OFFGRID.",
  ];
  return lines.join("\n");
}

export function SafetyCard({
  pack,
  place,
  input,
  itinerary,
  calendar,
}: {
  pack: RegionPack;
  place: Place;
  input: PlannerInput;
  itinerary: Itinerary;
  calendar: SeasonStatus[];
}) {
  const region = pack.planner.region;
  const guide = pack.guide;
  // Curated risks are matched to the trip's month; community reports only count while they're live.
  const hits = hazardsForPlace(place, pack.hazards, new Date(), input.month, pack.safety.alert_radius_km);
  const hospitals = nearestHospitals(place, pack.hospitals, 2);
  const highAltitude = place.max_altitude_m >= 2500;
  const checklistKey = `offgrid.tellsomeone.v1.${place.id}`;
  const [checked, setChecked] = useState<number[]>(() => {
    const v = readJSON(checklistKey);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  });
  const [shared, setShared] = useState<string | null>(null);
  useEffect(() => writeJSON(checklistKey, checked), [checked, checklistKey]);

  const share = async () => {
    const text = tellSomeoneText(place, input, itinerary, region.emergency[0]?.number ?? "112");
    try {
      if (navigator.share) {
        await navigator.share({ title: `My trip to ${place.name}`, text });
        setShared("Shared");
        return;
      }
      // WhatsApp is how most Indian families would actually receive this.
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      setShared("Opened WhatsApp");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setShared("Copied to clipboard");
      }
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="mb-2 text-sm font-bold">Emergency numbers</h3>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {region.emergency.map((e) => (
            <li key={e.number}>
              <a href={`tel:${e.number}`} className="flex min-h-12 items-center justify-between rounded-xl border border-line px-3 hover:bg-pine-50">
                <span className="text-sm">{e.label}</span>
                <span className="text-lg font-extrabold text-danger-700">{e.number}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold">Nearest hospitals</h3>
        <ul className="space-y-2">
          {hospitals.map(({ hospital, distanceKm }) => (
            <li key={hospital.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <span className="block font-semibold">{hospital.name}</span>
                <span className="text-xs text-muted">
                  ~{formatDistance(distanceKm)} in a straight line · {hospital.emergency_24h ? "24-hour emergency" : "Daytime only"}
                </span>
              </span>
              <a
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-semibold text-pine-700 hover:bg-pine-50"
                href={`geo:${hospital.lat},${hospital.lon}?q=${hospital.lat},${hospital.lon}(${encodeURIComponent(hospital.name)})`}
              >
                Directions
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Road distance in the hills is often 2–3× the straight line. For an ambulance, call 108.</p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold">
          Hazards in {monthName(input.month)} <span className="font-normal text-muted">({hits.length})</span>
        </h3>
        {hits.length === 0 ? (
          <p className="text-sm text-muted">No specific hazards recorded for this route and month. Stay alert anyway.</p>
        ) : (
          <ul className="space-y-3">
            {hits.map(({ hazard, distanceKm }) => (
              <li key={hazard.id}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={SEVERITY_TONE[hazard.severity]}>{SEVERITY_LABEL[hazard.severity]}</Badge>
                  <Badge>{HAZARD_LABELS[hazard.kind]}</Badge>
                  {hazard.source === "community" && <Badge tone="accent">Traveller report · {hazard.confirmations ?? 0} confirmed</Badge>}
                </div>
                <p className="mt-1 text-sm font-semibold">{hazard.title}</p>
                <p className="text-sm">{hazard.description}</p>
                <p className="text-xs text-muted">
                  {distanceKm > 0 ? `${formatDistance(distanceKm)} from ${place.name}. ` : ""}
                  {hazard.source_note}
                </p>
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-3 list-disc space-y-1 border-t border-line pt-3 pl-5 text-sm">
          {place.safety_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>

      <details className="rounded-2xl border border-line bg-surface p-4" open={place.max_altitude_m >= 3500}>
        <summary className="min-h-8 cursor-pointer text-sm font-bold">
          Altitude sickness guide {highAltitude ? `(this trip reaches ${formatNumber(place.max_altitude_m)} m)` : ""}
        </summary>
        <div className="mt-2 space-y-3 text-sm">
          <p>{guide.altitude.intro}</p>
          <ul className="list-disc space-y-1 pl-5">
            {guide.altitude.prevent.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {guide.altitude.levels.map((l, i) => (
            <Callout key={l.name} tone={i === 0 ? "warn" : "danger"} title={l.name}>
              <p>
                <span className="font-semibold">Signs:</span> {l.signs}
              </p>
              <p>
                <span className="font-semibold">Do:</span> {l.action}
              </p>
            </Callout>
          ))}
          <p className="font-semibold">{guide.altitude.rule}</p>
          <p className="text-xs text-muted">{guide.source}</p>
        </div>
      </details>

      <Card className="space-y-2">
        <h3 className="text-sm font-bold">Tell someone before you go</h3>
        <ul>
          {guide.tell_someone.map((item, i) => (
            <li key={item}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked.includes(i)}
                  onChange={() => setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}
                  className="mt-0.5 size-5 shrink-0 accent-pine-700"
                />
                <span className={checked.includes(i) ? "text-muted line-through" : ""}>{item}</span>
              </label>
            </li>
          ))}
        </ul>
        <Button block onClick={() => void share()}>
          📤 Share my plan with someone
        </Button>
        {shared && (
          <p role="status" className="text-center text-xs text-muted">
            {shared}
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold">When to go</h3>
        <SeasonStrip calendar={calendar} highlight={input.month} />
        <p className="mt-3 text-sm">
          <span className="font-semibold">Permits:</span> {place.permit_notes}
        </p>
      </Card>

      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        {guide.weather_rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
