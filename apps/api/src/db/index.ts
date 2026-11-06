import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { migrateToLatest } from "./migrations";
import type { DB } from "./types";

export type Db = Kysely<DB>;

/** Opens SQLite (a file, or ":memory:" for tests) and brings the schema up to date. */
export async function openDb(file: string): Promise<Db> {
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  await migrateToLatest(db as unknown as Kysely<unknown>);
  return db;
}
