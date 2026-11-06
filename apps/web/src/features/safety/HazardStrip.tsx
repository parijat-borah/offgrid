import { HAZARD_LABELS, hazardsNear, type Hazard, type HazardReportDto, type LatLon, type RegionPack } from "@offgrid/core";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDistance } from "../../lib/geo";
import { useOnline } from "../../lib/useOnline";

const RADIUS_KM = 10;
const TONE = { 1: "neutral", 2: "warn", 3: "danger" } as const;

/**
 * Hazards near the Nearby search point. Curated risks and the community reports in the pack work
 * offline; when online we also fetch live reports, so a slide reported an hour ago shows up.
 */
export function HazardStrip({ pack, center, onReport }: { pack: RegionPack; center: LatLon & { label: string }; onReport: () => void }) {
  const auth = useAuth();
  const online = useOnline();
  const [live, setLive] = useState<HazardReportDto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!online) return;
    api<HazardReportDto[]>(`/hazards?lat=${center.lat}&lon=${center.lon}&radius_km=${RADIUS_KM + 10}`)
      .then(setLive)
      .catch(() => undefined);
  }, [online, center.lat, center.lon]);
  useEffect(load, [load]);

  const now = new Date();
  const liveById = new Map(live.map((h) => [h.id, h]));
  // Live data wins over the pack copy of the same report (fresher counts and expiry).
  const merged: Hazard[] = [...pack.hazards.filter((h) => !liveById.has(h.id)), ...live];
  const hits = hazardsNear(center, merged, now, now.getMonth() + 1, RADIUS_KM);

  const act = async (h: HazardReportDto, action: "confirm" | "clear") => {
    try {
      const updated = await api<HazardReportDto>(`/hazards/${h.id.replace(/^report-/, "")}/${action}`, { method: "POST" });
      setLive((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
      setMsg(action === "confirm" ? "Thanks, the warning stays up longer." : "Thanks. Once others agree, it's removed.");
      load();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };

  return (
    <details className={`rounded-2xl border p-4 ${hits.some((x) => x.hazard.severity === 3) ? "border-danger-200 bg-danger-50" : hits.length ? "border-warn-200 bg-warn-50" : "border-line bg-surface"}`} open={hits.some((x) => x.hazard.severity === 3)}>
      <summary className="min-h-8 cursor-pointer text-sm font-bold">
        ⚠ {hits.length ? `${hits.length} ${hits.length === 1 ? "hazard" : "hazards"}` : "No hazards"} within {RADIUS_KM} km of {center.label}
      </summary>
      <ul className="mt-2 space-y-3">
        {hits.map(({ hazard, distanceKm }) => {
          const report = liveById.get(hazard.id);
          return (
            <li key={hazard.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={TONE[hazard.severity]}>{HAZARD_LABELS[hazard.kind]}</Badge>
                <span className="text-xs text-muted">{distanceKm > 0 ? formatDistance(distanceKm) + " away" : "You're in this area"}</span>
                {hazard.source === "community" && <Badge tone="accent">Traveller report · {hazard.confirmations ?? 0} confirmed</Badge>}
              </div>
              <p className="mt-1 font-semibold">{hazard.title}</p>
              <p>{hazard.description}</p>
              {hazard.expires_at && <p className="text-xs text-muted">Expires {new Date(hazard.expires_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>}
              {report && auth.status === "authed" && online && (
                <div className="mt-1 flex gap-2">
                  {!report.mine && (
                    <Button variant="secondary" disabled={report.myAction === "confirm"} onClick={() => void act(report, "confirm")}>
                      Still there
                    </Button>
                  )}
                  <Button variant="ghost" disabled={report.myAction === "clear"} onClick={() => void act(report, "clear")}>
                    It's gone
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {msg && (
        <p role="status" className="mt-2 text-xs text-muted">
          {msg}
        </p>
      )}
      <Button variant="secondary" className="mt-3" onClick={onReport}>
        ⚠ Report a hazard
      </Button>
    </details>
  );
}
