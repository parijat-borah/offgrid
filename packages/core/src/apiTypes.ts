// Response shapes shared by the API and the web client, so both sides agree at compile time.
import type { Avatar, Badge, MascotSpecies, MascotStage, TravelStyle, Validation } from "./game/schemas";
import type { LevelProgress } from "./game/xp";
import type { PlannerInput } from "./schemas";
import type { LatLon } from "./geo";
import type { DuplicateCandidate } from "./poi/community";
import type { PoiCategory, PoiTag } from "./poi/schemas";
import type { DailyForecast, Hazard } from "./safety/schemas";
import type { TrustPart } from "./poi/community";
import type { Gender } from "./social/schemas";
import type { ChallengeProgress } from "./game/fairplay";

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface ProfileFields {
  displayName: string;
  avatar: Avatar;
  bio: string;
  homeCity: string;
  styleTags: TravelStyle[];
  mascotSpecies: MascotSpecies;
  fitnessLevel: 1 | 2 | 3;
  leaderboardOptIn: boolean;
}

export interface BadgeView extends Badge {
  earned: boolean;
  awardedAt: string | null;
  progress: number;
  remaining: string | null;
}

export interface StatsView {
  tripsCompleted: number;
  treksCompleted: number;
  verifiedTrips: number;
  kmTotal: number;
  elevationGainM: number;
  highestAltitudeM: number;
  statesVisited: string[];
  districtsVisited: string[];
  moneySpent: number;
}

export type VerificationTier = "phone" | "email" | "gov_id" | "liveness";

export interface VerificationStatus {
  tier: VerificationTier;
  verified: boolean;
  verifiedAt: string | null;
  detail: string | null;
}

export interface Me extends ProfileFields {
  id: string;
  email: string;
  role: "user" | "moderator" | "admin";
  /** 0–100; weights votes on community places and is shown to travel buddies. */
  trust: number;
  trustParts: TrustPart[];
  gender: Gender;
  /** True once gender comes from a government ID; it can no longer be edited by hand. */
  genderVerified: boolean;
  travellerType: string | null;
  verifications: VerificationStatus[];
  /** This month's challenges and progress. */
  challenges: ChallengeProgress[];
  /** Consecutive months, including this one, with a GPS-verified trip. */
  streakMonths: number;
  birthYear: number;
  createdAt: string;
  level: LevelProgress;
  stage: MascotStage;
  nextStage: MascotStage | null;
  stats: StatsView;
  badges: BadgeView[];
  nudges: string[];
}

export type TripStatus = "planned" | "active" | "completed" | "cancelled";

export interface TripDto {
  id: string;
  placeId: string;
  status: TripStatus;
  startDate: string | null;
  plannerInput: PlannerInput;
  budgetPp: number;
  actualSpendPp: number | null;
  validation: Validation | null;
  validationReasons: string[];
  distanceKm: number | null;
  elevationGainM: number | null;
  notes: string;
  xpAwarded: number;
  /** Opted in to buddy-finding for this trip. */
  lookingForCompanions: boolean;
  pointsCount: number;
  /** Downsampled track for drawing the route preview. */
  route: LatLon[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  me: Me;
}

export type SubmissionStatus = "pending" | "verified" | "flagged" | "rejected" | "duplicate" | "withdrawn";

export interface SubmissionDto {
  id: string;
  name: string;
  category: PoiCategory;
  /** Public coordinates: fuzzed to a ~2 km grid cell when `approximate` is true. */
  lat: number;
  lon: number;
  approximate: boolean;
  tips: string;
  tags: PoiTag[];
  seasonality: number[] | null;
  priceBand: 1 | 2 | 3 | null;
  status: SubmissionStatus;
  photos: string[];
  upvotes: number;
  flags: number;
  score: number;
  myVote: 1 | -1 | null;
  mine: boolean;
  duplicateCandidates: DuplicateCandidate[];
  reviewNote: string | null;
  createdAt: string;
}

export interface SubmitResponse {
  submission: SubmissionDto;
  possibleDuplicates: DuplicateCandidate[];
}

export interface VoteResponse {
  submission: SubmissionDto;
  /** Set when this vote tipped the place into "verified" or "flagged". */
  transitioned: SubmissionStatus | null;
}

export interface ModerationItem extends SubmissionDto {
  exactLat: number;
  exactLon: number;
  submittedBy: { id: string; displayName: string; trust: number };
  votes: { value: 1 | -1; weight: number; reason: string | null; createdAt: string }[];
}

export interface ForecastSeries {
  label: string;
  elevationM: number;
  days: DailyForecast[];
}

export interface PlaceWeather {
  placeId: string;
  /** "open-meteo" in production; "mock" in tests and when WEATHER_MODE=mock. */
  source: string;
  fetchedAt: string;
  base: ForecastSeries;
  high: ForecastSeries;
}

export interface HazardReportDto extends Hazard {
  mine: boolean;
  myAction: "confirm" | "clear" | null;
  clears: number;
}

export interface OtpSendResponse {
  sent: true;
  expiresAt: string;
  /** MOCK ONLY: present when OTP_MODE=mock so demos work without SMS. Never set in production. */
  devCode?: string;
}

export interface KycStartResponse {
  /** Where to send the traveller: DigiLocker's consent page, or our simulated one in mock mode. */
  url: string;
  simulated: boolean;
}

/** A possible travel buddy. Deliberately limited: no exact age, no gender, no contact details, no location. */
export interface CandidateDto {
  userId: string;
  tripId: string;
  displayName: string;
  avatar: string;
  ageBand: string;
  travellerType: { id: string; name: string; icon: string } | null;
  level: number;
  mascotSpecies: string;
  idVerified: boolean;
  phoneVerified: boolean;
  trust: number;
  tripsCompleted: number;
  styleTags: string[];
  startDate: string;
  days: number;
  score: number;
  reasons: string[];
  /** Set when there's already a request between these two trips. */
  requestStatus: "pending" | "accepted" | "declined" | null;
}

export interface PersonLite {
  userId: string;
  displayName: string;
  avatar: string;
  idVerified: boolean;
  trust: number;
  /** From travel buddies after shared trips; null until someone has rated them. */
  rating: { avg: number; count: number } | null;
  travellerType: { id: string; name: string; icon: string } | null;
}

export interface MatchRequestDto {
  id: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  placeId: string;
  myTripId: string;
  theirStartDate: string | null;
  other: PersonLite;
  message: string;
  createdAt: string;
  conversationId: string | null;
}

export interface ConversationDto {
  id: string;
  placeId: string;
  other: PersonLite & { phone: string | null };
  iShared: boolean;
  theyShared: boolean;
  closed: boolean;
  unread: number;
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
  createdAt: string;
  /** Rating opens once your trip with them has ended. */
  canRate: boolean;
  myRating: number | null;
}

export type LeaderboardMetric = "xp" | "km" | "elevation" | "contributions";
export type LeaderboardScope = "global" | "region" | "friends";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatar: string;
  level: number;
  value: number;
  isMe: boolean;
}

export interface LeaderboardDto {
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  season: string;
  entries: LeaderboardEntry[];
  me: { optedIn: boolean; rank: number | null; value: number };
  /** Trips left off this board by the fair-play checks, with the reasons (yours only). */
  excludedTrips: { tripId: string; reasons: string[] }[];
}

export const RATING_TAGS = ["punctual", "safe", "fun", "fair_with_money", "good_navigator", "respectful"] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

export interface MessageDto {
  id: string;
  conversationId: string;
  mine: boolean;
  system: boolean;
  body: string;
  masked: boolean;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  targetType: "user" | "message" | "conversation";
  reason: string;
  details: string;
  createdAt: string;
  reporter: { id: string; displayName: string };
  reported: { id: string; displayName: string; trust: number; upheldBefore: number };
  /** For message reports: the reported message, visible to moderators only. */
  messageBody: string | null;
}

export interface CompleteTripResponse {
  trip: TripDto;
  xpAwarded: number;
  xpNote: string;
  validation: Validation;
  reasons: string[];
  levelUp: { from: number; to: number } | null;
  stageChange: { from: MascotStage; to: MascotStage } | null;
  newBadges: Badge[];
  me: Me;
}

// ---- Phase 7: beacon and SOS ----

export interface BeaconDto {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
  battery: number | null;
  last: { lat: number; lon: number; at: string } | null;
}

/** The key is shown exactly once, at pairing, and must be written to the beacon. */
export interface BeaconPairResponse {
  beacon: BeaconDto;
  keyHex: string;
  /** The line to send over USB serial (or paste into the serial monitor) to store the key. */
  serialCommand: string;
}

export interface TrustedContactDto {
  id: string;
  name: string;
  /** "+91 ••••• 824" */
  phoneMasked: string;
  createdAt: string;
}

export type SosStatus = "active" | "cancelled" | "resolved";

export interface SosPoint {
  lat: number;
  lon: number;
  at: string;
  via: "beacon" | "app";
}

export interface SosIncidentDto {
  id: string;
  status: SosStatus;
  source: "beacon" | "app";
  beaconId: string | null;
  startedAt: string;
  endedAt: string | null;
  last: SosPoint | null;
  contactsNotified: number;
  /** Link the contacts received. Only returned to the owner. */
  statusUrl: string | null;
  /** Demo mode only: the SMS text each contact would receive, so the demo can show it. */
  demoMessages: { to: string; body: string; at: string }[] | null;
}

/** What a trusted contact sees from the link in the SMS. No login, so only what helps a rescue. */
export interface SosPublicDto {
  displayName: string;
  status: SosStatus;
  startedAt: string;
  endedAt: string | null;
  last: SosPoint | null;
  track: SosPoint[];
  battery: number | null;
  trip: { placeId: string; placeName: string; startDate: string | null; days: number } | null;
  hospitals: { name: string; distanceKm: number; lat: number; lon: number; emergency24h: boolean }[];
  emergency: { label: string; number: string }[];
}

export interface RelayResult {
  index: number;
  status: "accepted" | "duplicate" | "rejected";
  reason?: string;
}
