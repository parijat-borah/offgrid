import { Migrator, sql, type Kysely, type Migration, type MigrationProvider } from "kysely";

// Migrations live in code (not files) so tests and the server run the exact same steps.
// They use portable column types, so the same steps run on Postgres when we switch dialects.
const migrations: Record<string, Migration> = {
  "001_users_trips_xp": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("users")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("email", "text", (c) => c.notNull().unique())
        .addColumn("password_hash", "text", (c) => c.notNull())
        .addColumn("display_name", "text", (c) => c.notNull())
        .addColumn("avatar", "text", (c) => c.notNull())
        .addColumn("bio", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("home_city", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("style_tags", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("birth_year_enc", "text", (c) => c.notNull())
        .addColumn("fitness_level", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("xp", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("level", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("mascot_species", "text", (c) => c.notNull())
        .addColumn("leaderboard_opt_in", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("role", "text", (c) => c.notNull().defaultTo("user"))
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("sessions")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("family_id", "text", (c) => c.notNull())
        .addColumn("token_hash", "text", (c) => c.notNull())
        .addColumn("user_agent", "text")
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("expires_at", "text", (c) => c.notNull())
        .addColumn("revoked_at", "text")
        .addColumn("replaced_by", "text")
        .execute();
      await db.schema.createIndex("sessions_user").on("sessions").column("user_id").execute();
      await db.schema.createIndex("sessions_family").on("sessions").column("family_id").execute();

      await db.schema
        .createTable("consents")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("purpose", "text", (c) => c.notNull())
        .addColumn("notice_version", "text", (c) => c.notNull())
        .addColumn("granted_at", "text", (c) => c.notNull())
        .addColumn("withdrawn_at", "text")
        .execute();

      await db.schema
        .createTable("trips")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("owner_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("place_id", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("start_date", "text")
        .addColumn("planner_input", "text", (c) => c.notNull())
        .addColumn("budget_pp", "integer", (c) => c.notNull())
        .addColumn("actual_spend_pp", "integer")
        .addColumn("validation", "text")
        .addColumn("validation_reasons", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("distance_km", "real")
        .addColumn("elevation_gain_m", "integer")
        .addColumn("notes", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("xp_awarded", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("started_at", "text")
        .addColumn("completed_at", "text")
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("trips_owner_status").on("trips").columns(["owner_id", "status"]).execute();

      await db.schema
        .createTable("trip_points")
        .addColumn("trip_id", "text", (c) => c.notNull().references("trips.id").onDelete("cascade"))
        .addColumn("ts", "integer", (c) => c.notNull())
        .addColumn("lat", "real", (c) => c.notNull())
        .addColumn("lon", "real", (c) => c.notNull())
        .addColumn("alt", "real")
        .addColumn("accuracy", "real")
        .addColumn("source", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("trip_points_pk", ["trip_id", "ts"])
        .execute();

      await db.schema
        .createTable("xp_events")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("amount", "integer", (c) => c.notNull())
        .addColumn("reason", "text", (c) => c.notNull())
        .addColumn("ref_id", "text")
        .addColumn("season", "text", (c) => c.notNull())
        .addColumn("created_at", "text", (c) => c.notNull())
        // The ledger can never pay out twice for the same trip or badge.
        .addUniqueConstraint("xp_events_once", ["user_id", "reason", "ref_id"])
        .execute();
      await db.schema.createIndex("xp_events_season").on("xp_events").columns(["season", "user_id"]).execute();

      await db.schema
        .createTable("user_badges")
        .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("badge_id", "text", (c) => c.notNull())
        .addColumn("awarded_at", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("user_badges_pk", ["user_id", "badge_id"])
        .execute();
    },
    async down(db: Kysely<unknown>) {
      for (const t of ["user_badges", "xp_events", "trip_points", "trips", "consents", "sessions", "users"]) {
        await sql`drop table if exists ${sql.table(t)}`.execute(db);
      }
    },
  },
};

migrations["002_community_places"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("submissions")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("region_id", "text", (c) => c.notNull())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("category", "text", (c) => c.notNull())
      .addColumn("lat", "real", (c) => c.notNull())
      .addColumn("lon", "real", (c) => c.notNull())
      .addColumn("public_lat", "real", (c) => c.notNull())
      .addColumn("public_lon", "real", (c) => c.notNull())
      .addColumn("approximate", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("tips", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("tags", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("seasonality", "text")
      .addColumn("price_band", "integer")
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("duplicate_of", "text")
      .addColumn("duplicate_candidates", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("score", "real", (c) => c.notNull().defaultTo(0))
      .addColumn("upvotes", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("flags", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("reviewed_by", "text")
      .addColumn("reviewed_at", "text")
      .addColumn("review_note", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("updated_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("submissions_status").on("submissions").columns(["region_id", "status"]).execute();
    await db.schema.createIndex("submissions_user").on("submissions").column("user_id").execute();

    await db.schema
      .createTable("submission_votes")
      .addColumn("submission_id", "text", (c) => c.notNull().references("submissions.id").onDelete("cascade"))
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("value", "integer", (c) => c.notNull())
      .addColumn("weight", "real", (c) => c.notNull())
      .addColumn("reason", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("submission_votes_pk", ["submission_id", "user_id"])
      .execute();

    await db.schema
      .createTable("submission_photos")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("submission_id", "text", (c) => c.notNull().references("submissions.id").onDelete("cascade"))
      .addColumn("file", "text", (c) => c.notNull())
      .addColumn("width", "integer", (c) => c.notNull())
      .addColumn("height", "integer", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    for (const t of ["submission_photos", "submission_votes", "submissions"]) {
      await sql`drop table if exists ${sql.table(t)}`.execute(db);
    }
  },
};

migrations["003_hazard_reports"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("hazard_reports")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("region_id", "text", (c) => c.notNull())
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("severity", "integer", (c) => c.notNull())
      .addColumn("description", "text", (c) => c.notNull())
      .addColumn("lat", "real", (c) => c.notNull())
      .addColumn("lon", "real", (c) => c.notNull())
      .addColumn("radius_m", "integer", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("confirmations", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("clears", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("hazard_reports_active").on("hazard_reports").columns(["region_id", "status", "expires_at"]).execute();

    await db.schema
      .createTable("hazard_actions")
      .addColumn("report_id", "text", (c) => c.notNull().references("hazard_reports.id").onDelete("cascade"))
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("action", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("hazard_actions_pk", ["report_id", "user_id"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table if exists hazard_actions`.execute(db);
    await sql`drop table if exists hazard_reports`.execute(db);
  },
};

migrations["004_social_and_verification"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("users").addColumn("gender", "text", (c) => c.notNull().defaultTo("prefer_not")).execute();
    await db.schema.alterTable("users").addColumn("gender_verified", "integer", (c) => c.notNull().defaultTo(0)).execute();
    await db.schema.alterTable("users").addColumn("traveller_type", "text").execute();
    await db.schema.alterTable("users").addColumn("phone_enc", "text").execute();
    await db.schema.alterTable("users").addColumn("phone_hash", "text").execute();
    await db.schema.createIndex("users_phone_hash").unique().on("users").column("phone_hash").execute();
    await db.schema.alterTable("trips").addColumn("looking_for_companions", "integer", (c) => c.notNull().defaultTo(0)).execute();

    await db.schema
      .createTable("verifications")
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("tier", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("provider", "text", (c) => c.notNull())
      .addColumn("detail", "text")
      .addColumn("verified_at", "text")
      .addPrimaryKeyConstraint("verifications_pk", ["user_id", "tier"])
      .execute();

    await db.schema
      .createTable("otp_codes")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("channel", "text", (c) => c.notNull())
      .addColumn("target_enc", "text", (c) => c.notNull())
      .addColumn("target_hash", "text", (c) => c.notNull())
      .addColumn("code_hash", "text", (c) => c.notNull())
      .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("kyc_sessions")
      .addColumn("state", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("expires_at", "text", (c) => c.notNull())
      .addColumn("used", "integer", (c) => c.notNull().defaultTo(0))
      .execute();

    await db.schema
      .createTable("match_prefs")
      .addColumn("user_id", "text", (c) => c.primaryKey().references("users.id").onDelete("cascade"))
      .addColumn("prefs", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("match_requests")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("from_user", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("to_user", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("from_trip", "text", (c) => c.notNull().references("trips.id").onDelete("cascade"))
      .addColumn("to_trip", "text", (c) => c.notNull().references("trips.id").onDelete("cascade"))
      .addColumn("message", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("decided_at", "text")
      .addColumn("conversation_id", "text")
      .execute();
    await db.schema.createIndex("match_requests_to").on("match_requests").columns(["to_user", "status"]).execute();
    await db.schema.createIndex("match_requests_from").on("match_requests").columns(["from_user", "status"]).execute();

    await db.schema
      .createTable("conversations")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_a", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("user_b", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("request_id", "text", (c) => c.notNull())
      .addColumn("place_id", "text", (c) => c.notNull())
      .addColumn("a_shared", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("b_shared", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("a_read_at", "text")
      .addColumn("b_read_at", "text")
      .addColumn("closed_at", "text")
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("messages")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("conversation_id", "text", (c) => c.notNull().references("conversations.id").onDelete("cascade"))
      .addColumn("sender_id", "text", (c) => c.references("users.id").onDelete("cascade"))
      .addColumn("body", "text", (c) => c.notNull())
      .addColumn("masked", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("messages_conv").on("messages").columns(["conversation_id", "created_at"]).execute();

    await db.schema
      .createTable("reports")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("reporter_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("target_type", "text", (c) => c.notNull())
      .addColumn("target_id", "text", (c) => c.notNull())
      .addColumn("target_user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("reason", "text", (c) => c.notNull())
      .addColumn("details", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .addColumn("resolved_by", "text")
      .addColumn("resolved_at", "text")
      .addColumn("resolution_note", "text")
      .execute();

    await db.schema
      .createTable("blocks")
      .addColumn("blocker_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("blocked_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("blocks_pk", ["blocker_id", "blocked_id"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    for (const t of ["blocks", "reports", "messages", "conversations", "match_requests", "match_prefs", "kyc_sessions", "otp_codes", "verifications"]) {
      await sql`drop table if exists ${sql.table(t)}`.execute(db);
    }
  },
};

migrations["005_fairplay_and_ratings"] = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("trips").addColumn("leaderboard_eligible", "integer", (c) => c.notNull().defaultTo(0)).execute();
    await db.schema.alterTable("trips").addColumn("fairplay_reasons", "text", (c) => c.notNull().defaultTo("[]")).execute();
    await db.schema.createIndex("trips_completed").on("trips").columns(["status", "completed_at"]).execute();
    await db.schema
      .createTable("peer_ratings")
      .addColumn("rater_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("ratee_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("conversation_id", "text", (c) => c.notNull().references("conversations.id").onDelete("cascade"))
      .addColumn("stars", "integer", (c) => c.notNull())
      .addColumn("tags", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("created_at", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("peer_ratings_pk", ["rater_id", "ratee_id", "conversation_id"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table if exists peer_ratings`.execute(db);
  },
};

migrations["006_beacons_and_sos"] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("trusted_contacts")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("phone_enc", "text", (c) => c.notNull())
      .addColumn("phone_last3", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("trusted_contacts_user").on("trusted_contacts").column("user_id").execute();

    // A beacon belongs to one account at a time. Its HMAC key is shown once at pairing and stored encrypted.
    await db.schema
      .createTable("beacons")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("owner_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("key_enc", "text", (c) => c.notNull())
      .addColumn("highest_seq", "integer")
      .addColumn("battery", "integer")
      .addColumn("last_lat", "real")
      .addColumn("last_lon", "real")
      .addColumn("last_at", "text")
      .addColumn("last_seen_at", "text")
      .addColumn("paired_at", "text", (c) => c.notNull())
      .execute();

    await db.schema
      .createTable("beacon_events")
      .addColumn("beacon_id", "text", (c) => c.notNull().references("beacons.id").onDelete("cascade"))
      .addColumn("seq", "integer", (c) => c.notNull())
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("lat", "real")
      .addColumn("lon", "real")
      .addColumn("gps_time", "text")
      .addColumn("battery", "integer", (c) => c.notNull())
      .addColumn("hops_left", "integer", (c) => c.notNull())
      .addColumn("relay_id", "text")
      .addColumn("received_at", "text", (c) => c.notNull())
      // (beacon, seq) is the de-duplication key: the same packet arrives once per relay that heard it.
      .addPrimaryKeyConstraint("beacon_events_pk", ["beacon_id", "seq"])
      .execute();

    await db.schema
      .createTable("sos_incidents")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("source", "text", (c) => c.notNull())
      .addColumn("beacon_id", "text", (c) => c.references("beacons.id").onDelete("set null"))
      .addColumn("trip_id", "text", (c) => c.references("trips.id").onDelete("set null"))
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("battery", "integer")
      .addColumn("token_hash", "text", (c) => c.notNull().unique())
      .addColumn("token_enc", "text", (c) => c.notNull())
      .addColumn("started_at", "text", (c) => c.notNull())
      .addColumn("ended_at", "text")
      .execute();
    await db.schema.createIndex("sos_user_status").on("sos_incidents").columns(["user_id", "status"]).execute();

    await db.schema
      .createTable("sos_points")
      .addColumn("incident_id", "text", (c) => c.notNull().references("sos_incidents.id").onDelete("cascade"))
      .addColumn("lat", "real", (c) => c.notNull())
      .addColumn("lon", "real", (c) => c.notNull())
      .addColumn("at", "text", (c) => c.notNull())
      .addColumn("via", "text", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("sos_points_incident").on("sos_points").columns(["incident_id", "at"]).execute();

    // What we sent to whom, so the owner can see it and nothing is sent twice.
    await db.schema
      .createTable("sos_notifications")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("incident_id", "text", (c) => c.notNull().references("sos_incidents.id").onDelete("cascade"))
      .addColumn("contact_id", "text", (c) => c.references("trusted_contacts.id").onDelete("set null"))
      .addColumn("to_label", "text", (c) => c.notNull())
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("body", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("created_at", "text", (c) => c.notNull())
      .execute();
  },
  async down(db: Kysely<unknown>) {
    for (const t of ["sos_notifications", "sos_points", "sos_incidents", "beacon_events", "beacons", "trusted_contacts"]) {
      await sql`drop table if exists ${sql.table(t)}`.execute(db);
    }
  },
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

export async function migrateToLatest(db: Kysely<unknown>): Promise<void> {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === "Error") console.error(`Migration ${r.migrationName} failed`);
  }
  if (error) throw error;
}
