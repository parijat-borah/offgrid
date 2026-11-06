import { trustBreakdown, type TrustPart, type VerificationStatus, type VerificationTier } from "@offgrid/core";
import { sql } from "kysely";
import type { Db } from "../../db";

const TIERS: VerificationTier[] = ["phone", "email", "gov_id", "liveness"];

export async function verificationStatuses(db: Db, userId: string): Promise<VerificationStatus[]> {
  const rows = await db.selectFrom("verifications").selectAll().where("user_id", "=", userId).execute();
  return TIERS.map((tier) => {
    const r = rows.find((x) => x.tier === tier && x.status === "verified");
    return { tier, verified: !!r, verifiedAt: r?.verified_at ?? null, detail: r?.detail ?? null };
  });
}

export async function verifiedTiers(db: Db, userId: string): Promise<Set<VerificationTier>> {
  return new Set((await verificationStatuses(db, userId)).filter((v) => v.verified).map((v) => v.tier));
}

/** Everything that feeds trust, from what we can actually verify, plus ratings from real travel buddies. */
export async function trustFor(db: Db, userId: string): Promise<{ score: number; parts: TrustPart[] }> {
  const [tiers, trips, upheld, ratings] = await Promise.all([
    verifiedTiers(db, userId),
    db
      .selectFrom("trips")
      .select(sql<number>`count(*)`.as("n"))
      .where("owner_id", "=", userId)
      .where("validation", "=", "verified")
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("reports")
      .select(sql<number>`count(*)`.as("n"))
      .where("target_user_id", "=", userId)
      .where("status", "=", "upheld")
      .executeTakeFirstOrThrow(),
    db.selectFrom("peer_ratings").select([sql<number | null>`avg(stars)`.as("avg"), sql<number>`count(*)`.as("n")]).where("ratee_id", "=", userId).executeTakeFirstOrThrow(),
  ]);
  return trustBreakdown({
    phoneVerified: tiers.has("phone"),
    emailVerified: tiers.has("email"),
    govIdVerified: tiers.has("gov_id"),
    livenessVerified: tiers.has("liveness"),
    verifiedTrips: Number(trips.n),
    avgRating: Number(ratings.n) > 0 ? Number(ratings.avg) : null,
    upheldReports: Number(upheld.n),
  });
}

export async function setVerified(db: Db, userId: string, tier: VerificationTier, provider: string, detail: string | null) {
  const now = new Date().toISOString();
  await db
    .insertInto("verifications")
    .values({ user_id: userId, tier, status: "verified", provider, detail, verified_at: now })
    .onConflict((oc) => oc.columns(["user_id", "tier"]).doUpdateSet({ status: "verified", provider, detail, verified_at: now }))
    .execute();
}
