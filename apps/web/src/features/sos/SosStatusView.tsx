import type { PlannerData, SosPublicDto } from "@offgrid/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Callout } from "../../design/Badge";
import { Card, SectionTitle } from "../../design/Card";
import { ErrorState, Skeleton } from "../../design/States";
import { api, ApiFailure, errorMessage } from "../../lib/api";
import { MapView, type MapLine, type MapMarker } from "../map/MapView";

const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const POLL_MS = 20_000;

/**
 * What a trusted contact sees from the SMS link: no login, refreshes itself, and puts the actions
 * that help a rescue (call, directions, nearest hospital) first.
 */
export function SosStatusView({ token, data }: { token: string; data: PlannerData }) {
  const [view, setView] = useState<SosPublicDto | null>(null);
  const [error, setError] = useState<{ gone: boolean; message: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api<SosPublicDto>(`/sos/public/${token}`));
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError({ gone: e instanceof ApiFailure && e.status === 404, message: errorMessage(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!view) return [];
    const trail = view.track.slice(0, -1).map((p, i) => ({ id: `t${i}`, lat: p.lat, lon: p.lon, color: "#9aa5a0", label: `${time(p.at)} (${p.via})` }));
    const hospitals = view.hospitals.map((h, i) => ({ id: `h${i}`, lat: h.lat, lon: h.lon, color: "#1f6fb2", label: `🏥 ${h.name}` }));
    const last = view.last ? [{ id: "last", lat: view.last.lat, lon: view.last.lon, color: "#b42318", label: `${view.displayName}, ${time(view.last.at)}` }] : [];
    return [...trail, ...hospitals, ...last];
  }, [view]);

  // The trek they planned, as a dashed line: rescuers can see where they probably are relative to the trail.
  const planned = view?.trip ? data.media.trails[view.trip.placeId] : undefined;
  const lines = useMemo<MapLine[]>(() => (planned ? [{ id: "planned", coords: planned.coords, color: "#17613f", label: `Planned trail from ${planned.start.name}`, dashed: true }] : []), [planned]);

  if (error?.gone) return <ErrorState title="This SOS link has expired" detail="Links stop working 72 hours after the SOS ends. If you're still worried, call 112." />;
  if (error && !view) return <ErrorState title="Couldn't load the SOS status" detail={error.message} onRetry={() => void load()} />;
  if (!view) return <Skeleton className="h-96" />;

  const active = view.status === "active";
  const dirs = view.last ? `https://www.google.com/maps/dir/?api=1&destination=${view.last.lat},${view.last.lon}` : null;

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-4 text-white ${active ? "bg-danger-700" : "bg-pine-700"}`} role="status" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-90">OFFGRID emergency alert</p>
        <h1 className="text-2xl font-extrabold">{active ? `${view.displayName} needs help` : `${view.displayName} is safe`}</h1>
        <p className="text-sm opacity-90">
          {active ? `SOS raised ${time(view.startedAt)}.` : `SOS ${view.status === "cancelled" ? "cancelled" : "resolved"} ${view.endedAt ? time(view.endedAt) : ""}.`} Updates every 20 seconds
          {updatedAt ? ` · checked ${new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}.
        </p>
      </div>

      {active && (
        <Card className="space-y-2">
          <p className="font-bold">What to do</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Try calling {view.displayName}.</li>
            <li>If you can't reach them, call 112 and read out the location below.</li>
            <li>Keep this page open. It shows each new location as it arrives.</li>
          </ol>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {view.emergency.slice(0, 2).map((e) => (
              <a key={e.number} href={`tel:${e.number}`} className="flex min-h-12 flex-col items-center justify-center rounded-xl bg-danger-700 px-2 text-white">
                <span className="text-lg font-extrabold">📞 {e.number}</span>
                <span className="text-[11px]">{e.label}</span>
              </a>
            ))}
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <SectionTitle>Last known location</SectionTitle>
        {view.last ? (
          <>
            <p className="text-sm">
              <span className="font-mono font-bold">
                {view.last.lat.toFixed(5)}, {view.last.lon.toFixed(5)}
              </span>
              <span className="text-muted"> · {time(view.last.at)} · via {view.last.via === "beacon" ? "OFFGRID beacon (radio)" : "phone"}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {view.battery !== null && <Badge tone={view.battery < 20 ? "danger" : "neutral"}>🔋 {view.battery}%</Badge>}
              <Badge>{view.track.length} location{view.track.length === 1 ? "" : "s"} received</Badge>
            </div>
            <MapView center={view.last} zoom={13} markers={markers} lines={lines} label={`Map of ${view.displayName}'s last location`} className="h-80" />
            {planned && (
              <p className="text-xs text-muted">
                Dashed green: the {view.trip?.placeName} trail they planned, from {planned.start.name} ({planned.length_km} km). Trail line © OpenStreetMap contributors.
              </p>
            )}
            {dirs && (
              <a href={dirs} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-pine-50">
                🧭 Directions to this point ↗
              </a>
            )}
          </>
        ) : (
          <Callout tone="warn">No location yet. Their GPS may not have a fix. Positions appear here as soon as one arrives.</Callout>
        )}
        {view.trip && (
          <p className="text-sm">
            <span className="font-semibold">Their plan:</span> {view.trip.placeName}, {view.trip.days} day{view.trip.days > 1 ? "s" : ""}
            {view.trip.startDate ? ` from ${new Date(view.trip.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}.
          </p>
        )}
      </Card>

      {view.hospitals.length > 0 && (
        <Card>
          <SectionTitle hint="Straight-line distance; mountain roads are longer.">Nearest hospitals</SectionTitle>
          <ul className="divide-y divide-line text-sm">
            {view.hospitals.map((h) => (
              <li key={h.name} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-semibold">{h.name}</span>
                  <span className="text-xs text-muted">{h.emergency24h ? "24-hour emergency" : "Daytime only"}</span>
                </span>
                <span className="shrink-0 font-bold">{h.distanceKm} km</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-xs text-muted">
        You're seeing this because {view.displayName} listed you as an emergency contact on OFFGRID. This page shows only what helps find them, and stops working 72 hours after the SOS ends.
      </p>
    </div>
  );
}
