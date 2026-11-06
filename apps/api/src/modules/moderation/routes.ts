import type { ReportItem } from "@offgrid/core";
import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../../context";
import { badRequest, HttpError, notFound, parse } from "../../lib/errors";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { moderationItems, transition } from "../submissions/service";
import { userTrust } from "../xp/service";

const ActionSchema = z.object({
  action: z.enum(["approve", "reject", "duplicate"]),
  duplicateOf: z.string().max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

export function moderationRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  r.use(async (_req, res, next) => {
    const user = await ctx.db.selectFrom("users").select("role").where("id", "=", userIdOf(res)).executeTakeFirst();
    if (!user || (user.role !== "moderator" && user.role !== "admin")) throw new HttpError(403, "FORBIDDEN", "Moderators only.");
    next();
  });

  // Flagged first (possible harm), then oldest pending.
  r.get("/queue", async (_req, res) => {
    const rows = await ctx.db
      .selectFrom("submissions")
      .selectAll()
      .where("status", "in", ["flagged", "pending"])
      .orderBy((eb) => eb.case().when("status", "=", "flagged").then(0).else(1).end())
      .orderBy("created_at")
      .limit(100)
      .execute();
    res.json(await moderationItems(ctx, rows));
  });

  r.post("/submissions/:id", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const body = parse(ActionSchema, req.body);
    if (body.action === "duplicate" && !body.duplicateOf) throw badRequest("Say which place it duplicates.", { duplicateOf: "Required" });
    const row = await ctx.db.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw notFound("Submission not found.");
    if (row.user_id === userIdOf(res)) throw new HttpError(403, "FORBIDDEN", "You can't moderate your own submission.");

    const status = body.action === "approve" ? "verified" : body.action === "reject" ? "rejected" : "duplicate";
    await ctx.db.transaction().execute(async (trx) => {
      if (body.action === "duplicate") await trx.updateTable("submissions").set({ duplicate_of: body.duplicateOf! }).where("id", "=", id).execute();
      await transition(trx, ctx, row, status, { by: userIdOf(res), note: body.note ?? null });
    });
    const updated = await ctx.db.selectFrom("submissions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    res.json((await moderationItems(ctx, [updated]))[0]);
  });

  // Reports about people: message text is shown here, to moderators only, as evidence.
  r.get("/reports", async (_req, res) => {
    const rows = await ctx.db.selectFrom("reports").selectAll().where("status", "=", "open").orderBy("created_at").limit(100).execute();
    const items: ReportItem[] = [];
    for (const rep of rows) {
      const reporter = await ctx.db.selectFrom("users").select(["id", "display_name"]).where("id", "=", rep.reporter_id).executeTakeFirst();
      const reported = await ctx.db.selectFrom("users").select(["id", "display_name"]).where("id", "=", rep.target_user_id).executeTakeFirst();
      const upheld = await ctx.db.selectFrom("reports").select("id").where("target_user_id", "=", rep.target_user_id).where("status", "=", "upheld").execute();
      const msg = rep.target_type === "message" ? await ctx.db.selectFrom("messages").select("body").where("id", "=", rep.target_id).executeTakeFirst() : null;
      items.push({
        id: rep.id,
        targetType: rep.target_type as ReportItem["targetType"],
        reason: rep.reason,
        details: rep.details,
        createdAt: rep.created_at,
        reporter: { id: reporter?.id ?? "", displayName: reporter?.display_name ?? "Deleted" },
        reported: { id: reported?.id ?? "", displayName: reported?.display_name ?? "Deleted", trust: reported ? await userTrust(ctx.db, reported.id) : 0, upheldBefore: upheld.length },
        messageBody: msg?.body ?? null,
      });
    }
    res.json(items);
  });

  // Upheld reports cost the reported person 15 trust points each (see trustBreakdown).
  r.post("/reports/:id", async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const body = parse(z.object({ action: z.enum(["uphold", "dismiss"]), note: z.string().trim().max(500).optional() }), req.body);
    const rep = await ctx.db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst();
    if (!rep) throw notFound("Report not found.");
    if (rep.target_user_id === userIdOf(res)) throw new HttpError(403, "FORBIDDEN", "You can't moderate reports about yourself.");
    await ctx.db
      .updateTable("reports")
      .set({ status: body.action === "uphold" ? "upheld" : "dismissed", resolved_by: userIdOf(res), resolved_at: new Date().toISOString(), resolution_note: body.note ?? null })
      .where("id", "=", id)
      .execute();
    res.json({ id, status: body.action === "uphold" ? "upheld" : "dismissed" });
  });

  return r;
}
