import type { RegionPack, TripAlert, TripDto } from "@offgrid/core";
import { useEffect } from "react";
import { Badge } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { EmptyState } from "../../design/States";
import { useOnline } from "../../lib/useOnline";

const TONE = { 1: "neutral", 2: "warn", 3: "danger" } as const;

export function AlertsView({
  pack,
  alerts,
  trips,
  authed,
  permission,
  onRequestPermission,
  onSeen,
  onOpenTrip,
  onLogin,
  onPlan,
}: {
  pack: RegionPack;
  alerts: TripAlert[];
  trips: TripDto[];
  authed: boolean;
  permission: NotificationPermission | "unsupported";
  onRequestPermission: () => void;
  onSeen: () => void;
  onOpenTrip: (id: string) => void;
  onLogin: () => void;
  onPlan: () => void;
}) {
  const online = useOnline();
  // Opening the list counts as seeing every alert in it (re-run only when the list grows).
  const count = alerts.length;
  useEffect(() => onSeen(), [count]);

  if (!authed) {
    return (
      <EmptyState icon="🔔" title="Alerts for your trips" action={<Button onClick={onLogin}>Log in or sign up</Button>}>
        Save a trip and we'll warn you about storms, snow, slides and wildlife on your route, even offline.
      </EmptyState>
    );
  }
  if (trips.length === 0) {
    return (
      <EmptyState icon="🔔" title="No planned or active trips" action={<Button onClick={onPlan}>Plan a trip</Button>}>
        Alerts appear here for trips you've saved.
      </EmptyState>
    );
  }

  const placeName = (id: string) => pack.planner.places.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Trip alerts</h1>
        <p className="text-sm text-muted">
          Weather for trips under way or starting within 7 days, plus hazards on your routes.{" "}
          {online ? "" : "You're offline, so these come from your last sync."}
        </p>
      </div>

      {permission === "default" && (
        <Card className="flex items-center justify-between gap-3 bg-pine-50">
          <p className="text-sm">Get a notification on this phone when a serious alert appears.</p>
          <Button onClick={onRequestPermission}>Turn on</Button>
        </Card>
      )}
      {permission === "denied" && <p className="text-xs text-muted">Notifications are blocked in your browser settings; alerts still show here.</p>}

      {trips.map((t) => {
        const mine = alerts.filter((a) => a.tripId === t.id);
        return (
          <Card key={t.id} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">
                {placeName(t.placeId)} <span className="text-sm font-normal text-muted">· {t.status === "active" ? "on the trail" : t.startDate ? `from ${t.startDate}` : "planned"}</span>
              </h2>
              <Button variant="ghost" onClick={() => onOpenTrip(t.id)}>
                Open
              </Button>
            </div>
            {mine.length === 0 ? (
              <p className="text-sm text-muted">No alerts. Check again before you set out.</p>
            ) : (
              <ul className="space-y-2">
                {mine.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={TONE[a.severity]}>{a.kind === "weather" ? "Weather" : "Hazard"}</Badge>
                      <span className="font-semibold">{a.title}</span>
                    </div>
                    <p className="mt-0.5">{a.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            {t.status === "planned" && !t.startDate && <p className="text-xs text-muted">Add a start date to get weather alerts for this trip.</p>}
          </Card>
        );
      })}
    </div>
  );
}
