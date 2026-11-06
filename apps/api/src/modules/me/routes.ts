import { AVATARS, GENDERS, scoreTravellerType, TRAVEL_STYLES } from "@offgrid/core";
import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../../context";
import { badRequest, conflict, parse, unauthorized } from "../../lib/errors";
import { verifyPassword } from "../../lib/passwords";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from "../auth/tokens";
import { buildMe, exportData } from "./service";

const PatchMeSchema = z
  .object({
    displayName: z.string().trim().min(2).max(40),
    avatar: z.enum(AVATARS),
    bio: z.string().trim().max(280),
    homeCity: z.string().trim().max(60),
    styleTags: z.array(z.enum(TRAVEL_STYLES)).max(5),
    mascotSpecies: z.enum(["snow_leopard", "monal", "red_panda"]),
    fitnessLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    leaderboardOptIn: z.boolean(),
    gender: z.enum(GENDERS),
  })
  .partial()
  .strict();

export function meRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));

  r.get("/", async (_req, res) => {
    res.json(await buildMe(ctx, userIdOf(res)));
  });

  r.patch("/", limiter(ctx, 30), async (req, res) => {
    const body = parse(PatchMeSchema, req.body);
    const set: Record<string, string | number> = { updated_at: nowIso() };
    if (body.displayName !== undefined) set.display_name = body.displayName;
    if (body.avatar !== undefined) set.avatar = body.avatar;
    if (body.bio !== undefined) set.bio = body.bio;
    if (body.homeCity !== undefined) set.home_city = body.homeCity;
    if (body.styleTags !== undefined) set.style_tags = JSON.stringify([...new Set(body.styleTags)]);
    if (body.mascotSpecies !== undefined) set.mascot_species = body.mascotSpecies;
    if (body.fitnessLevel !== undefined) set.fitness_level = body.fitnessLevel;
    if (body.leaderboardOptIn !== undefined) set.leaderboard_opt_in = body.leaderboardOptIn ? 1 : 0;
    if (body.gender !== undefined) {
      const u = await ctx.db.selectFrom("users").select("gender_verified").where("id", "=", userIdOf(res)).executeTakeFirstOrThrow();
      // Once confirmed from an ID, gender drives safety filters, so it can't be changed by hand.
      if (u.gender_verified) throw conflict("Your gender comes from your verified ID. Withdraw ID verification to change it.");
      set.gender = body.gender;
    }
    await ctx.db.updateTable("users").set(set).where("id", "=", userIdOf(res)).execute();
    res.json(await buildMe(ctx, userIdOf(res)));
  });

  r.post("/traveller-type", limiter(ctx, 10), async (req, res) => {
    const { answers } = parse(z.object({ answers: z.array(z.number().int().min(0).max(10)).max(20) }), req.body);
    let result;
    try {
      result = scoreTravellerType(ctx.content.travellerTypes, answers);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : "Answer every question.");
    }
    await ctx.db.updateTable("users").set({ traveller_type: result.type.id, updated_at: nowIso() }).where("id", "=", userIdOf(res)).execute();
    res.json(await buildMe(ctx, userIdOf(res)));
  });

  r.get("/export", limiter(ctx, 5), async (_req, res) => {
    res.setHeader("Content-Disposition", 'attachment; filename="offgrid-my-data.json"');
    res.json(await exportData(ctx, userIdOf(res)));
  });

  // DPDP Act right to erasure. Deletion is immediate and cascades to trips, GPS points,
  // XP, badges, sessions and consents. Requires the password so a stolen access token can't do it.
  r.delete("/", limiter(ctx, 5), async (req, res) => {
    const { password } = parse(z.object({ password: z.string().max(128) }), req.body);
    const user = await ctx.db.selectFrom("users").select(["password_hash"]).where("id", "=", userIdOf(res)).executeTakeFirst();
    if (!user || !(await verifyPassword(user.password_hash, password))) throw unauthorized("Password is wrong.");
    await ctx.db.deleteFrom("users").where("id", "=", userIdOf(res)).execute();
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    res.status(204).end();
  });

  return r;
}
