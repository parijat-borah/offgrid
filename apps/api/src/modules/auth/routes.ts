import { AVATARS, type AuthResponse } from "@offgrid/core";
import { Router, type Response } from "express";
import { z } from "zod";
import type { Ctx } from "../../context";
import { encrypt, newId } from "../../lib/crypto";
import { badRequest, conflict, parse, unauthorized } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/passwords";
import { nowIso } from "../../lib/time";
import { limiter } from "../../middleware/rateLimit";
import { buildMe } from "../me/service";
import { createSession, issueAccessToken, REFRESH_COOKIE, REFRESH_COOKIE_PATH, revokeSession, rotateSession } from "./tokens";

export const NOTICE_VERSION = "2026-10";
const thisYear = () => new Date().getUTCFullYear();

const SignupSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(10, "Use at least 10 characters.").max(128),
  displayName: z.string().trim().min(2, "At least 2 characters.").max(40),
  birthYear: z.number().int().min(1920).max(thisYear()),
  acceptTerms: z.literal(true, { error: "Please accept the terms and privacy notice." }),
  confirmAdult: z.literal(true, { error: "OFFGRID is for travellers aged 18 and over." }),
});

const LoginSchema = z.object({ email: z.string().max(254), password: z.string().max(128) });

export function authRoutes(ctx: Ctx): Router {
  const r = Router();
  const authLimit = limiter(ctx, 5);

  const setCookie = (res: Response, value: string) =>
    res.cookie(REFRESH_COOKIE, value, {
      httpOnly: true,
      secure: ctx.config.cookieSecure,
      sameSite: "strict",
      path: REFRESH_COOKIE_PATH,
      maxAge: ctx.config.refreshTtlDays * 86_400_000,
    });

  const respond = async (res: Response, userId: string, status = 200) => {
    const body: AuthResponse = { accessToken: await issueAccessToken(ctx, userId), me: await buildMe(ctx, userId) };
    res.status(status).json(body);
  };

  r.post("/signup", authLimit, async (req, res) => {
    const body = parse(SignupSchema, req.body);
    // Year-only birth date: we can't know the exact age, so anyone who might be under 18 is refused.
    if (thisYear() - body.birthYear < 19) {
      const msg = "You must be 18 or older to use OFFGRID.";
      throw badRequest(msg, { birthYear: msg });
    }
    const email = body.email.toLowerCase();
    const exists = await ctx.db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
    if (exists) throw conflict("An account with this email already exists.");

    const id = newId();
    const now = nowIso();
    await ctx.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("users")
        .values({
          id,
          email,
          password_hash: await hashPassword(body.password),
          display_name: body.displayName,
          avatar: AVATARS[0],
          bio: "",
          home_city: "",
          style_tags: "[]",
          birth_year_enc: encrypt(String(body.birthYear), ctx.config.piiKey),
          fitness_level: 1,
          xp: 0,
          level: 1,
          mascot_species: "snow_leopard",
          leaderboard_opt_in: 0,
          role: "user",
          created_at: now,
          updated_at: now,
        })
        .execute();
      // DPDP Act: record exactly what was consented to, and against which notice version.
      await trx
        .insertInto("consents")
        .values({ id: newId(), user_id: id, purpose: "account", notice_version: NOTICE_VERSION, granted_at: now, withdrawn_at: null })
        .execute();
    });

    const session = await createSession(ctx, id, null, req.get("user-agent") ?? null);
    setCookie(res, session.cookieValue);
    await respond(res, id, 201);
  });

  r.post("/login", authLimit, async (req, res) => {
    const body = parse(LoginSchema, req.body);
    const user = await ctx.db
      .selectFrom("users")
      .select(["id", "password_hash"])
      .where("email", "=", body.email.trim().toLowerCase())
      .executeTakeFirst();
    const ok = await verifyPassword(user?.password_hash ?? null, body.password);
    if (!user || !ok) throw unauthorized("Email or password is wrong.");
    const session = await createSession(ctx, user.id, null, req.get("user-agent") ?? null);
    setCookie(res, session.cookieValue);
    await respond(res, user.id);
  });

  r.post("/refresh", limiter(ctx, 30), async (req, res) => {
    const cookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    try {
      const rotated = await rotateSession(ctx, cookie, req.get("user-agent") ?? null);
      setCookie(res, rotated.cookieValue);
      await respond(res, rotated.userId);
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      throw e;
    }
  });

  r.post("/logout", async (req, res) => {
    await revokeSession(ctx, req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    res.status(204).end();
  });

  return r;
}
