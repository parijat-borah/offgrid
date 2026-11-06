import type { RawRegionPack } from "@offgrid/core";
import { Router } from "express";
import { createHash } from "node:crypto";
import type { Ctx } from "../../context";
import { notFound } from "../../lib/errors";
import { activeReports, toHazard } from "../hazards/service";
import { communityPois } from "../submissions/service";

/**
 * The offline region pack: planner content, game rules and every point of interest
 * (curated, OpenStreetMap and verified community places) in one cacheable download.
 */
export async function buildPack(ctx: Ctx): Promise<RawRegionPack> {
  const region = ctx.content.planner.region;
  const community = await communityPois(ctx.db, region.id);
  // Active traveller hazard reports ship in the pack too, so warnings reach people offline.
  // Each carries its own expiry, so the phone hides it once it lapses.
  const reports = (await activeReports(ctx.db, region.id)).map(toHazard);
  const body = { ...ctx.content.raw, pois: [...ctx.content.pois, ...community], hazards: [...ctx.content.hazards, ...reports] };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("base64url").slice(0, 12);
  return { version: `${region.pack_version}+${hash}`, ...body } as RawRegionPack;
}

export function regionRoutes(ctx: Ctx): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const region = ctx.content.planner.region;
    res.json([{ id: region.id, name: region.name, packVersion: region.pack_version, bbox: region.bbox }]);
  });

  r.get("/:id/pack", async (req, res) => {
    if (req.params.id !== ctx.content.planner.region.id) throw notFound("Unknown region.");
    const pack = await buildPack(ctx);
    const etag = `"${pack.version}"`;
    res.setHeader("ETag", etag);
    // Clients revalidate every time; an unchanged pack costs one 304.
    res.setHeader("Cache-Control", "no-cache");
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    res.json(pack);
  });

  return r;
}
