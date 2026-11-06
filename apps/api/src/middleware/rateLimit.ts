import type { RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Ctx } from "../context";

/** Per-IP limiter (per-user once logged in). Disabled in tests so suites can sign up many users. */
export function limiter(ctx: Ctx, perMinute: number): RequestHandler {
  if (!ctx.config.rateLimit) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // ipKeyGenerator groups IPv6 addresses by subnet, so one client can't dodge the limit by rotating addresses.
    keyGenerator: (req, res) => (res.locals.userId as string | undefined) ?? ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) =>
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again." } }),
  });
}
