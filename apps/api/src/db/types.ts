import type { Generated } from "kysely";

// Row shapes as stored. JSON columns are TEXT; booleans are 0/1 (SQLite has no bool type).

export interface UsersTable {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar: string;
  bio: string;
  home_city: string;
  style_tags: string;
  /** AES-256-GCM ciphertext of the birth year (data minimisation: year only). */
  birth_year_enc: string;
  fitness_level: number;
  xp: number;
  level: number;
  mascot_species: string;
  leaderboard_opt_in: number;
  role: string;
  /** Self-declared unless gender_verified (then from a government ID via DigiLocker). */
  gender: Generated<string>;
  gender_verified: Generated<number>;
  traveller_type: string | null;
  /** AES-GCM; decrypted only to send an OTP or to reveal to a chat partner after both agree. */
  phone_enc: string | null;
  /** HMAC-style hash for "is this number already used" lookups without decrypting. */
  phone_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  /** All sessions created by rotating one login share a family; reuse of a spent token kills the family. */
  family_id: string;
  token_hash: string;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

export interface ConsentsTable {
  id: string;
  user_id: string;
  purpose: string;
  notice_version: string;
  granted_at: string;
  withdrawn_at: string | null;
}

export interface TripsTable {
  id: string;
  owner_id: string;
  place_id: string;
  status: string;
  start_date: string | null;
  planner_input: string;
  budget_pp: number;
  actual_spend_pp: number | null;
  validation: string | null;
  validation_reasons: string;
  distance_km: number | null;
  elevation_gain_m: number | null;
  notes: string;
  xp_awarded: number;
  looking_for_companions: Generated<number>;
  /** Passed the leaderboard fair-play checks (counted on boards); 0 = counts for level only. */
  leaderboard_eligible: Generated<number>;
  fairplay_reasons: Generated<string>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripPointsTable {
  trip_id: string;
  ts: number;
  lat: number;
  lon: number;
  alt: number | null;
  accuracy: number | null;
  source: string;
}

export interface XpEventsTable {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  ref_id: string | null;
  season: string;
  created_at: string;
}

export interface UserBadgesTable {
  user_id: string;
  badge_id: string;
  awarded_at: string;
}

export interface SubmissionsTable {
  id: string;
  user_id: string;
  region_id: string;
  name: string;
  category: string;
  /** Exact location: only the contributor and moderators ever see it. */
  lat: number;
  lon: number;
  /** What everyone else sees: equal to lat/lon unless `approximate`, then snapped to a ~2 km grid. */
  public_lat: number;
  public_lon: number;
  approximate: number;
  tips: string;
  tags: string;
  seasonality: string | null;
  price_band: number | null;
  status: string;
  duplicate_of: string | null;
  duplicate_candidates: string;
  score: number;
  upvotes: number;
  flags: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionVotesTable {
  submission_id: string;
  user_id: string;
  value: number;
  /** Frozen at vote time, so later trust changes don't silently rewrite history. */
  weight: number;
  reason: string | null;
  created_at: string;
}

export interface SubmissionPhotosTable {
  id: string;
  submission_id: string;
  file: string;
  width: number;
  height: number;
  created_at: string;
}

export interface HazardReportsTable {
  id: string;
  user_id: string;
  region_id: string;
  kind: string;
  severity: number;
  description: string;
  lat: number;
  lon: number;
  radius_m: number;
  status: string;
  confirmations: number;
  clears: number;
  created_at: string;
  expires_at: string;
}

export interface HazardActionsTable {
  report_id: string;
  user_id: string;
  action: string;
  created_at: string;
}

export interface VerificationsTable {
  user_id: string;
  tier: string;
  status: string;
  provider: string;
  /** Shown to the user, e.g. "Aadhaar ••1234 via DigiLocker". Never the full ID number. */
  detail: string | null;
  verified_at: string | null;
}

export interface OtpCodesTable {
  id: string;
  user_id: string;
  channel: string;
  target_enc: string;
  target_hash: string;
  code_hash: string;
  attempts: number;
  created_at: string;
  expires_at: string;
}

export interface KycSessionsTable {
  state: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used: number;
}

export interface MatchPrefsTable {
  user_id: string;
  prefs: string;
}

export interface MatchRequestsTable {
  id: string;
  from_user: string;
  to_user: string;
  from_trip: string;
  to_trip: string;
  message: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  conversation_id: string | null;
}

export interface ConversationsTable {
  id: string;
  user_a: string;
  user_b: string;
  request_id: string;
  place_id: string;
  a_shared: number;
  b_shared: number;
  a_read_at: string | null;
  b_read_at: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface MessagesTable {
  id: string;
  conversation_id: string;
  /** Null for system messages (safety tips, "connected"). */
  sender_id: string | null;
  body: string;
  masked: number;
  created_at: string;
}

export interface ReportsTable {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  target_user_id: string;
  reason: string;
  details: string;
  status: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface BlocksTable {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface PeerRatingsTable {
  rater_id: string;
  ratee_id: string;
  conversation_id: string;
  stars: number;
  tags: string;
  created_at: string;
}

export interface TrustedContactsTable {
  id: string;
  user_id: string;
  name: string;
  phone_enc: string;
  phone_last3: string;
  created_at: string;
}

export interface BeaconsTable {
  id: string;
  owner_id: string;
  name: string;
  key_enc: string;
  highest_seq: number | null;
  battery: number | null;
  last_lat: number | null;
  last_lon: number | null;
  last_at: string | null;
  last_seen_at: string | null;
  paired_at: string;
}

export interface BeaconEventsTable {
  beacon_id: string;
  seq: number;
  kind: string;
  lat: number | null;
  lon: number | null;
  gps_time: string | null;
  battery: number;
  hops_left: number;
  relay_id: string | null;
  received_at: string;
}

export interface SosIncidentsTable {
  id: string;
  user_id: string;
  source: string;
  beacon_id: string | null;
  trip_id: string | null;
  status: string;
  battery: number | null;
  token_hash: string;
  token_enc: string;
  started_at: string;
  ended_at: string | null;
}

export interface SosPointsTable {
  incident_id: string;
  lat: number;
  lon: number;
  at: string;
  via: string;
}

export interface SosNotificationsTable {
  id: string;
  incident_id: string;
  contact_id: string | null;
  to_label: string;
  kind: string;
  body: string;
  status: string;
  created_at: string;
}

export interface DB {
  trusted_contacts: TrustedContactsTable;
  beacons: BeaconsTable;
  beacon_events: BeaconEventsTable;
  sos_incidents: SosIncidentsTable;
  sos_points: SosPointsTable;
  sos_notifications: SosNotificationsTable;
  peer_ratings: PeerRatingsTable;
  verifications: VerificationsTable;
  otp_codes: OtpCodesTable;
  kyc_sessions: KycSessionsTable;
  match_prefs: MatchPrefsTable;
  match_requests: MatchRequestsTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
  reports: ReportsTable;
  blocks: BlocksTable;
  hazard_reports: HazardReportsTable;
  hazard_actions: HazardActionsTable;
  submissions: SubmissionsTable;
  submission_votes: SubmissionVotesTable;
  submission_photos: SubmissionPhotosTable;
  users: UsersTable;
  sessions: SessionsTable;
  consents: ConsentsTable;
  trips: TripsTable;
  trip_points: TripPointsTable;
  xp_events: XpEventsTable;
  user_badges: UserBadgesTable;
}
