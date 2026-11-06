import type { LatLon } from "@offgrid/core";

/**
 * A tiny route drawing with no map tiles, so it costs nothing on 2G. Longitude is scaled
 * by cos(latitude) to keep the shape true; full maps arrive with the offline map pack.
 */
export function RouteSparkline({ route, className = "", label = "Route drawing from your GPS track" }: { route: LatLon[]; className?: string; label?: string }) {
  if (route.length < 2) {
    return (
      <div className={`grid place-items-center rounded-xl bg-paper text-xs text-muted ${className}`}>No GPS track</div>
    );
  }
  const k = Math.cos((route[0]!.lat * Math.PI) / 180);
  const xs = route.map((p) => p.lon * k);
  const ys = route.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const W = 100;
  const H = 60;
  const pad = 6;
  const scale = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const pts = route.map((_, i) => [ox + (xs[i]! - minX) * scale, H - (oy + (ys[i]! - minY) * scale)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [sx, sy] = pts[0]!;
  const far = pts.reduce((best, p) => (Math.hypot(p[0] - sx, p[1] - sy) > Math.hypot(best[0] - sx, best[1] - sy) ? p : best));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`rounded-xl bg-pine-50 ${className}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="#17613f" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx} cy={sy} r="3" fill="#17613f" />
      <path d={`M${far[0]} ${far[1] - 7} L${far[0] + 6} ${far[1] - 4.5} L${far[0]} ${far[1] - 2} Z`} fill="#b5530f" />
      <line x1={far[0]} y1={far[1]} x2={far[0]} y2={far[1] - 7} stroke="#6b4f2a" strokeWidth="1.2" />
    </svg>
  );
}
