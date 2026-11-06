import { SignJWT, jwtVerify } from "jose";
import type { Ctx } from "../../context";
import { newId, randomToken, safeEqual, sha256 } from "../../lib/crypto";
import { unauthorized } from "../../lib/errors";
import { nowIso } from "../../lib/time";

export const REFRESH_COOKIE = "og_rt";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
const ISSUER = "offgrid-api";

export async function issueAccessToken(ctx: Ctx, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ctx.config.accessTokenTtl)
    .sign(ctx.config.jwtAccessSecret);
}

export async function verifyAccessToken(ctx: Ctx, token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, ctx.config.jwtAccessSecret, { issuer: ISSUER, algorithms: ["HS256"] });
    if (!payload.sub) throw new Error("no subject");
    return payload.sub;
  } catch {
    throw unauthorized();
  }
}

/** Refresh tokens are opaque: "<sessionId>.<secret>". Only a hash of the secret is stored. */
export async function createSession(ctx: Ctx, userId: string, familyId: string | null, userAgent: string | null) {
  const id = newId();
  const secret = randomToken();
  const now = new Date();
  await ctx.db
    .insertInto("sessions")
    .values({
      id,
      user_id: userId,
      family_id: familyId ?? id,
      token_hash: sha256(secret),
      user_agent: userAgent?.slice(0, 200) ?? null,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ctx.config.refreshTtlDays * 86_400_000).toISOString(),
      revoked_at: null,
      replaced_by: null,
    })
    .execute();
  return { sessionId: id, cookieValue: `${id}.${secret}` };
}

/**
 * Rotate a refresh token. Presenting a token that was already rotated means it was
 * copied, so the whole family (every session descended from that login) is revoked.
 */
export async function rotateSession(ctx: Ctx, cookieValue: string | undefined, userAgent: string | null) {
  const [id, secret] = (cookieValue ?? "").split(".");
  if (!id || !secret) throw unauthorized();
  const session = await ctx.db.selectFrom("sessions").selectAll().where("id", "=", id).executeTakeFirst();
  if (!session || !safeEqual(session.token_hash, sha256(secret))) throw unauthorized();

  if (session.revoked_at || session.replaced_by) {
    await ctx.db
      .updateTable("sessions")
      .set({ revoked_at: nowIso() })
      .where("family_id", "=", session.family_id)
      .where("revoked_at", "is", null)
      .execute();
    throw unauthorized("This session was used somewhere else. Please log in again.");
  }
  if (session.expires_at < nowIso()) throw unauthorized();

  const next = await createSession(ctx, session.user_id, session.family_id, userAgent);
  await ctx.db.updateTable("sessions").set({ replaced_by: next.sessionId }).where("id", "=", id).execute();
  return { userId: session.user_id, cookieValue: next.cookieValue };
}

export async function revokeSession(ctx: Ctx, cookieValue: string | undefined) {
  const [id] = (cookieValue ?? "").split(".");
  if (!id) return;
  await ctx.db.updateTable("sessions").set({ revoked_at: nowIso() }).where("id", "=", id).execute();
}
