import type { Hazard, HazardKind, HazardReportDto } from "@offgrid/core";
import type { Db } from "../../db";
import type { HazardReportsTable } from "../../db/types";

export function toHazard(r: HazardReportsTable): Hazard {
  return {
    id: `report-${r.id}`,
    region_id: r.region_id,
    kind: r.kind as HazardKind,
    severity: r.severity as 1 | 2 | 3,
    // Alerts and lists already lead with the hazard kind, so the title says who reported it.
    title: "Reported by a traveller",
    description: r.description,
    lat: r.lat,
    lon: r.lon,
    radius_m: r.radius_m,
    months: null,
    place_ids: [],
    source: "community",
    source_note: "Traveller report. Not verified by officials.",
    reported_at: r.created_at,
    expires_at: r.expires_at,
    confirmations: r.confirmations,
  };
}

export async function activeReports(db: Db, regionId: string, now = new Date().toISOString()) {
  return db
    .selectFrom("hazard_reports")
    .selectAll()
    .where("region_id", "=", regionId)
    .where("status", "=", "active")
    .where("expires_at", ">", now)
    .orderBy("created_at", "desc")
    .limit(500)
    .execute();
}

export async function reportDtos(db: Db, rows: HazardReportsTable[], viewerId: string | undefined): Promise<HazardReportDto[]> {
  const actions =
    viewerId && rows.length
      ? await db.selectFrom("hazard_actions").select(["report_id", "action"]).where("user_id", "=", viewerId).where("report_id", "in", rows.map((r) => r.id)).execute()
      : [];
  const mine = new Map(actions.map((a) => [a.report_id, a.action as "confirm" | "clear"]));
  return rows.map((r) => ({ ...toHazard(r), mine: r.user_id === viewerId, myAction: mine.get(r.id) ?? null, clears: r.clears }));
}
