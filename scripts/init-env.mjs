// Creates apps/api/.env with fresh random secrets on first run. Never overwrites an existing file.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = `${root}apps/api/.env`;
if (existsSync(target)) process.exit(0);

const secret = (bytes) => randomBytes(bytes).toString("base64");
const env = readFileSync(`${root}.env.example`, "utf8")
  .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${secret(48)}`)
  .replace(/^PII_ENCRYPTION_KEY=.*$/m, `PII_ENCRYPTION_KEY=${secret(32)}`);

writeFileSync(target, env, { mode: 0o600 });
console.log("Created apps/api/.env with new random secrets.");
