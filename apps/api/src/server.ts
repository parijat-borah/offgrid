import { createApp } from "./app";
import { loadContent } from "./content";
import { openDb } from "./db";
import { loadConfig } from "./env";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env: rely on real environment variables */
}

const config = loadConfig();
const db = await openDb(config.databaseFile);
const app = createApp({ db, config, content: loadContent() });

app.listen(config.port, () => {
  console.log(`OFFGRID API listening on http://localhost:${config.port}/api/v1 (${config.env})`);
});
