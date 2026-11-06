// Make someone a moderator (or admin, or back to user):
//   npm run set-role -w @offgrid/api -- someone@example.com moderator
import { openDb } from "../db";
import { loadConfig } from "../env";

try {
  process.loadEnvFile(".env");
} catch {
  /* rely on real env vars */
}

const [email, role] = process.argv.slice(2);
if (!email || !["user", "moderator", "admin"].includes(role ?? "")) {
  console.error("Usage: set-role <email> <user|moderator|admin>");
  process.exit(1);
}

const db = await openDb(loadConfig().databaseFile);
const res = await db.updateTable("users").set({ role: role! }).where("email", "=", email.toLowerCase()).executeTakeFirst();
console.log(Number(res.numUpdatedRows) === 1 ? `${email} is now ${role}.` : `No user with email ${email}.`);
await db.destroy();
