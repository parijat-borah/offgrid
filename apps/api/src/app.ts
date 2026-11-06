import compression from "compression";
import cookieParser from "cookie-parser";
import { MulterError } from "multer";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Ctx } from "./context";
import { HttpError } from "./lib/errors";
import { authRoutes } from "./modules/auth/routes";
import { beaconRoutes } from "./modules/beacons/routes";
import { meRoutes } from "./modules/me/routes";
import { hazardRoutes } from "./modules/hazards/routes";
import { leaderboardRoutes } from "./modules/leaderboard/routes";
import { moderationRoutes } from "./modules/moderation/routes";
import { weatherRoutes } from "./modules/weather/routes";
import { conversationRoutes, matchRoutes, safetyRoutes } from "./modules/social/routes";
import { verificationRoutes } from "./modules/verification/routes";
import { regionRoutes } from "./modules/regions/routes";
import { contactRoutes, sosRoutes } from "./modules/sos/routes";
import { submissionRoutes } from "./modules/submissions/routes";
import { tripRoutes } from "./modules/trips/routes";

export function createApp(ctx: Ctx) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: ctx.config.corsOrigins, credentials: true }));
  // The region pack is ~300 KB of JSON; gzip brings it to roughly a sixth for 2G/3G users.
  // Chat streams must never be compressed: gzip buffers output, which would hold messages back.
  app.use(compression({ filter: (req, res) => !req.path.endsWith("/stream") && compression.filter(req, res) }));
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.get("/health", async (_req, res) => {
    await ctx.db.selectFrom("users").select("id").limit(1).execute();
    res.json({ ok: true, packVersion: ctx.content.planner.region.pack_version });
  });
  api.use("/auth", authRoutes(ctx));
  api.use("/me", meRoutes(ctx));
  api.use("/trips", tripRoutes(ctx));
  api.use("/regions", regionRoutes(ctx));
  api.use("/submissions", submissionRoutes(ctx));
  api.use("/moderation", moderationRoutes(ctx));
  api.use("/weather", weatherRoutes(ctx));
  api.use("/hazards", hazardRoutes(ctx));
  api.use("/verification", verificationRoutes(ctx));
  api.use("/match", matchRoutes(ctx));
  api.use("/conversations", conversationRoutes(ctx));
  api.use("/safety", safetyRoutes(ctx));
  api.use("/leaderboard", leaderboardRoutes(ctx));
  api.use("/contacts", contactRoutes(ctx));
  api.use("/sos", sosRoutes(ctx));
  api.use("/beacons", beaconRoutes(ctx));
  // File names are random UUIDs, so they can be cached forever.
  api.use(
    "/uploads",
    express.static(ctx.config.uploadDir, { index: false, immutable: true, maxAge: "30d", fallthrough: false }),
  );
  app.use("/api/v1", api);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } });
  });

  // Express 5 forwards rejected promises here, so handlers can simply throw.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
      return;
    }
    if (err instanceof MulterError) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      res.status(tooBig ? 413 : 400).json({ error: { code: "BAD_UPLOAD", message: tooBig ? "Photos must be under 5 MB." : err.message } });
      return;
    }
    if (err && typeof err === "object" && "status" in err && err.status === 404 && "path" in err) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "No such file." } });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: { code: "BAD_JSON", message: "Request body is not valid JSON." } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
  });

  return app;
}
