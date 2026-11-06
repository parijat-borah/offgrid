import type { KycStartResponse, OtpSendResponse } from "@offgrid/core";
import { Router } from "express";
import multer from "multer";
import { createHmac, randomInt } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { identityAdaptersFor } from "../../adapters/identity";
import type { Ctx } from "../../context";
import { decrypt, encrypt, newId, randomToken, safeEqual, sha256 } from "../../lib/crypto";
import { badRequest, conflict, HttpError, parse } from "../../lib/errors";
import { nowIso } from "../../lib/time";
import { requireAuth, userIdOf } from "../../middleware/auth";
import { limiter } from "../../middleware/rateLimit";
import { buildMe } from "../me/service";
import { setVerified, verifiedTiers } from "./service";

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_PER_10_MIN = 3;
const KYC_TTL_MS = 10 * 60_000;
export const KYC_NOTICE_VERSION = "2026-10-kyc";

/** Indian mobile numbers only for now: +91 followed by 10 digits starting 6–9. */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1 } }).single("selfie");

export function verificationRoutes(ctx: Ctx): Router {
  const r = Router();
  r.use(requireAuth(ctx));
  const id = ctx.identity ?? identityAdaptersFor(ctx.config.identityModes);
  // A keyed hash, so a leaked DB can't be reversed by hashing every Indian mobile number.
  const phoneHash = (e164: string) => createHmac("sha256", ctx.config.piiKey).update(e164).digest("base64url");

  async function sendCode(userId: string, channel: "phone" | "email", target: string): Promise<OtpSendResponse> {
    const recent = await ctx.db
      .selectFrom("otp_codes")
      .select(sql<number>`count(*)`.as("n"))
      .where("user_id", "=", userId)
      .where("created_at", ">=", new Date(Date.now() - 10 * 60_000).toISOString())
      .executeTakeFirstOrThrow();
    if (Number(recent.n) >= OTP_PER_10_MIN) throw new HttpError(429, "RATE_LIMITED", "Too many codes requested. Wait 10 minutes and try again.");

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const otpId = newId();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
    // Older codes stay in the table (they count towards the throttle above) but stop working:
    // only the newest code is ever checked.
    await ctx.db
      .insertInto("otp_codes")
      .values({
        id: otpId,
        user_id: userId,
        channel,
        target_enc: encrypt(target, ctx.config.piiKey),
        target_hash: channel === "phone" ? phoneHash(target) : sha256(target),
        code_hash: sha256(`${otpId}:${code}`),
        attempts: 0,
        created_at: nowIso(),
        expires_at: expiresAt,
      })
      .execute();
    try {
      await id.otp.send(channel, target, code);
    } catch (e) {
      throw new HttpError(503, "OTP_UNAVAILABLE", e instanceof Error ? e.message : "Couldn't send the code.");
    }
    return { sent: true, expiresAt, ...(id.otp.exposesCode ? { devCode: code } : {}) };
  }

  async function checkCode(userId: string, channel: "phone" | "email", code: string) {
    const otp = await ctx.db
      .selectFrom("otp_codes")
      .selectAll()
      .where("user_id", "=", userId)
      .where("channel", "=", channel)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (!otp || otp.expires_at < nowIso()) throw badRequest("That code has expired. Ask for a new one.", { code: "Expired" });
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, "RATE_LIMITED", "Too many wrong tries. Ask for a new code.");
    await ctx.db.updateTable("otp_codes").set({ attempts: otp.attempts + 1 }).where("id", "=", otp.id).execute();
    if (!safeEqual(otp.code_hash, sha256(`${otp.id}:${code}`))) throw badRequest("That code isn't right.", { code: "Wrong code" });
    await ctx.db.deleteFrom("otp_codes").where("user_id", "=", userId).where("channel", "=", channel).execute();
    return decrypt(otp.target_enc, ctx.config.piiKey);
  }

  r.post("/phone/send", limiter(ctx, 5), async (req, res) => {
    const { phone } = parse(z.object({ phone: z.string().max(20) }), req.body);
    const e164 = normalizeIndianMobile(phone);
    if (!e164) throw badRequest("Enter a 10-digit Indian mobile number.", { phone: "Invalid number" });
    const taken = await ctx.db.selectFrom("users").select("id").where("phone_hash", "=", phoneHash(e164)).executeTakeFirst();
    if (taken && taken.id !== userIdOf(res)) throw conflict("That number is already verified on another account.");
    res.json(await sendCode(userIdOf(res), "phone", e164));
  });

  r.post("/phone/verify", limiter(ctx, 10), async (req, res) => {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }), req.body);
    const userId = userIdOf(res);
    const e164 = await checkCode(userId, "phone", code);
    await ctx.db.transaction().execute(async (trx) => {
      await trx.updateTable("users").set({ phone_enc: encrypt(e164, ctx.config.piiKey), phone_hash: phoneHash(e164), updated_at: nowIso() }).where("id", "=", userId).execute();
      await setVerified(trx, userId, "phone", id.otp.name, `+91 ••••• ${e164.slice(-3)}`);
    });
    res.json(await buildMe(ctx, userId));
  });

  r.post("/email/send", limiter(ctx, 5), async (_req, res) => {
    const user = await ctx.db.selectFrom("users").select("email").where("id", "=", userIdOf(res)).executeTakeFirstOrThrow();
    res.json(await sendCode(userIdOf(res), "email", user.email));
  });

  r.post("/email/verify", limiter(ctx, 10), async (req, res) => {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") }), req.body);
    const email = await checkCode(userIdOf(res), "email", code);
    await setVerified(ctx.db, userIdOf(res), "email", id.otp.name, email.replace(/^(.).*(@.*)$/, "$1•••$2"));
    res.json(await buildMe(ctx, userIdOf(res)));
  });

  // DPDP Act: KYC needs its own, specific consent, separate from the account notice.
  r.post("/kyc/start", limiter(ctx, 5), async (req, res) => {
    parse(z.object({ consent: z.literal(true, { error: "Please agree to share your ID details first." }) }), req.body);
    const userId = userIdOf(res);
    const tiers = await verifiedTiers(ctx.db, userId);
    if (!tiers.has("phone")) throw conflict("Verify your phone number first.");
    const state = randomToken(24);
    const now = Date.now();
    await ctx.db
      .insertInto("consents")
      .values({ id: newId(), user_id: userId, purpose: "kyc", notice_version: KYC_NOTICE_VERSION, granted_at: nowIso(), withdrawn_at: null })
      .execute();
    await ctx.db
      .insertInto("kyc_sessions")
      .values({ state, user_id: userId, created_at: new Date(now).toISOString(), expires_at: new Date(now + KYC_TTL_MS).toISOString(), used: 0 })
      .execute();
    let url: string;
    try {
      url = id.kyc.authorizeUrl(state);
    } catch (e) {
      throw new HttpError(503, "KYC_UNAVAILABLE", e instanceof Error ? e.message : "ID verification isn't available.");
    }
    const body: KycStartResponse = { url, simulated: id.kyc.simulated };
    res.json(body);
  });

  r.post("/kyc/complete", limiter(ctx, 10), async (req, res) => {
    const body = parse(z.object({ state: z.string().max(100), code: z.string().max(2000) }), req.body);
    const userId = userIdOf(res);
    const session = await ctx.db.selectFrom("kyc_sessions").selectAll().where("state", "=", body.state).executeTakeFirst();
    // The state must belong to this user and be fresh and unused, or someone could replay another's consent.
    if (!session || session.user_id !== userId || session.used || session.expires_at < nowIso()) {
      throw badRequest("This verification link has expired. Please start again.");
    }
    await ctx.db.updateTable("kyc_sessions").set({ used: 1 }).where("state", "=", body.state).execute();

    let identity;
    try {
      identity = await id.kyc.exchange(body.code);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : "Verification failed.");
    }
    const user = await ctx.db.selectFrom("users").select(["birth_year_enc"]).where("id", "=", userId).executeTakeFirstOrThrow();
    const declared = Number(decrypt(user.birth_year_enc, ctx.config.piiKey));
    if (Math.abs(identity.yearOfBirth - declared) > 1) {
      throw badRequest("The year of birth on your ID doesn't match your profile. Contact support if this is a mistake.");
    }
    if (new Date().getUTCFullYear() - identity.yearOfBirth < 18) throw badRequest("OFFGRID matching is for adults only.");

    const docName = identity.docType === "aadhaar" ? "Aadhaar" : identity.docType === "driving_licence" ? "Driving licence" : "PAN";
    await ctx.db.transaction().execute(async (trx) => {
      // Only the minimum is kept: document type, last 4 characters and gender. Name and full number are discarded.
      await setVerified(trx, userId, "gov_id", id.kyc.name, `${docName} ••${identity.last4} via DigiLocker${id.kyc.simulated ? " (simulated)" : ""}`);
      await trx.updateTable("users").set({ gender: identity.gender, gender_verified: 1, updated_at: nowIso() }).where("id", "=", userId).execute();
    });
    res.json(await buildMe(ctx, userId));
  });

  // Withdrawing KYC consent removes the verification and the gender it confirmed (DPDP right to withdraw).
  r.delete("/kyc", async (_req, res) => {
    const userId = userIdOf(res);
    await ctx.db.transaction().execute(async (trx) => {
      await trx.deleteFrom("verifications").where("user_id", "=", userId).where("tier", "in", ["gov_id", "liveness"]).execute();
      await trx.updateTable("users").set({ gender_verified: 0 }).where("id", "=", userId).execute();
      await trx.updateTable("consents").set({ withdrawn_at: nowIso() }).where("user_id", "=", userId).where("purpose", "=", "kyc").where("withdrawn_at", "is", null).execute();
      // Women-only and same-gender filters depend on verified gender, so they switch off too.
      const prefs = await trx.selectFrom("match_prefs").select("prefs").where("user_id", "=", userId).executeTakeFirst();
      if (prefs) {
        const p = JSON.parse(prefs.prefs) as Record<string, unknown>;
        await trx.updateTable("match_prefs").set({ prefs: JSON.stringify({ ...p, womenOnly: false, sameGender: false }) }).where("user_id", "=", userId).execute();
      }
    });
    res.json(await buildMe(ctx, userId));
  });

  // The selfie is checked in memory and dropped: it's never written to disk or the database.
  r.post("/liveness", limiter(ctx, 5), upload, async (req, res) => {
    const userId = userIdOf(res);
    const tiers = await verifiedTiers(ctx.db, userId);
    if (!tiers.has("gov_id")) throw conflict("Verify your ID first; the selfie is matched against it.");
    if (!req.file) throw badRequest("Attach a selfie as the 'selfie' field.", { selfie: "Missing" });
    let result;
    try {
      result = await id.liveness.check(req.file.buffer);
    } catch (e) {
      throw new HttpError(503, "LIVENESS_UNAVAILABLE", e instanceof Error ? e.message : "Selfie check isn't available.");
    } finally {
      req.file.buffer.fill(0);
    }
    if (!result.passed) throw badRequest(result.reason ?? "The selfie check didn't pass. Try again in good light.", { selfie: "Failed" });
    await setVerified(ctx.db, userId, "liveness", id.liveness.name, id.liveness.simulated ? "Selfie check (simulated)" : "Selfie matched to ID");
    res.json(await buildMe(ctx, userId));
  });

  return r;
}
