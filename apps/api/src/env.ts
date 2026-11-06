export interface Config {
  env: "development" | "production" | "test";
  port: number;
  databaseFile: string;
  corsOrigins: string[];
  jwtAccessSecret: Uint8Array;
  accessTokenTtl: string;
  refreshTtlDays: number;
  piiKey: Buffer;
  rateLimit: boolean;
  cookieSecure: boolean;
  uploadDir: string;
  weatherMode: "openmeteo" | "mock";
  identityModes: { otp: string; kyc: string; liveness: string };
  smsMode: string;
  /** Where the web app lives, for links in SOS messages. */
  publicWebUrl: string;
}

/** Fail fast on missing or weak secrets: a server running with a blank key is worse than one that won't start. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV ?? "development") as Config["env"];
  const required = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set. Run \`npm run dev\` once to generate apps/api/.env, or set it yourself.`);
    return v;
  };

  const jwt = Buffer.from(required("JWT_ACCESS_SECRET"), "base64");
  if (jwt.length < 32) throw new Error("JWT_ACCESS_SECRET must decode to at least 32 bytes");
  const piiKey = Buffer.from(required("PII_ENCRYPTION_KEY"), "base64");
  if (piiKey.length !== 32) throw new Error("PII_ENCRYPTION_KEY must decode to exactly 32 bytes");

  return {
    env: mode,
    port: Number(env.PORT ?? 4000),
    databaseFile: env.DATABASE_FILE ?? "./offgrid.db",
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
    jwtAccessSecret: new Uint8Array(jwt),
    accessTokenTtl: "15m",
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    piiKey,
    rateLimit: mode !== "test",
    cookieSecure: mode === "production",
    uploadDir: env.UPLOAD_DIR ?? "./uploads",
    // Tests never hit the network.
    weatherMode: env.WEATHER_MODE === "mock" || (mode === "test" && env.WEATHER_MODE !== "openmeteo") ? "mock" : "openmeteo",
    identityModes: identityModes(env, mode),
    smsMode: smsMode(env, mode),
    publicWebUrl: (env.PUBLIC_WEB_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  };
}

/** A mock SMS sender would leave people believing their family was alerted, so it can't run in production. */
function smsMode(env: NodeJS.ProcessEnv, mode: Config["env"]) {
  const m = env.SMS_MODE ?? (mode === "production" ? "real" : "mock");
  if (mode === "production" && m === "mock") throw new Error("SMS_MODE=mock is not allowed with NODE_ENV=production.");
  return m;
}

/** Mock identity services print OTPs and accept made-up IDs, so they must never run in production. */
function identityModes(env: NodeJS.ProcessEnv, mode: Config["env"]) {
  const pick = (v: string | undefined) => v ?? (mode === "production" ? "real" : "mock");
  const modes = { otp: pick(env.OTP_MODE), kyc: pick(env.KYC_MODE), liveness: pick(env.LIVENESS_MODE) };
  if (mode === "production" && Object.values(modes).includes("mock")) {
    throw new Error("OTP_MODE / KYC_MODE / LIVENESS_MODE=mock is not allowed with NODE_ENV=production.");
  }
  return modes;
}
