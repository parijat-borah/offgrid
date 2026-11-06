import type { NextFunction, Request, Response } from "express";
import type { Ctx } from "../context";
import { unauthorized } from "../lib/errors";
import { verifyAccessToken } from "../modules/auth/tokens";

/** Requires "Authorization: Bearer <access token>" and puts the user id in res.locals.userId. */
export function requireAuth(ctx: Ctx) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw unauthorized();
    res.locals.userId = await verifyAccessToken(ctx, token);
    next();
  };
}

/** For public endpoints that show a little more to logged-in users. A bad token is ignored, not rejected. */
export function optionalAuth(ctx: Ctx) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization") ?? "";
    if (header.startsWith("Bearer ")) {
      res.locals.userId = await verifyAccessToken(ctx, header.slice(7)).catch(() => undefined);
    }
    next();
  };
}

export const userIdOf = (res: Response): string => res.locals.userId as string;
