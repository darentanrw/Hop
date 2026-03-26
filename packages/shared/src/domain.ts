export const NUS_ALLOWED_DOMAINS = ["u.nus.edu", "nus.edu.sg"] as const;
export const PICKUP_ORIGIN_ID = "nus-utown";
export const PICKUP_ORIGIN_LABEL = "NUS Utown";
export const PICKUP_ORIGIN_LAT = 1.3049;
export const PICKUP_ORIGIN_LNG = 103.7734;
export const ACK_WINDOW_MINUTES = 30;
export const MIN_TIME_OVERLAP_MINUTES = 0;
export const SMALL_GROUP_RELEASE_HOURS = 36;
/** Maximum passengers in one vehicle (total seats across all accounts in a group). */
export const MAX_GROUP_SIZE = 4;
/** Minimum passengers required for a valid ride group. */
export const MIN_GROUP_SIZE = 2;
/** Maximum people under one account's booking (e.g. you + friends in one car). */
export const MAX_PARTY_SIZE = 3;
export const MAX_DETOUR_MINUTES = 12;
export const MEETUP_GRACE_MINUTES = 5;
export const PAYMENT_WINDOW_HOURS = 24;
export const MAX_SPREAD_KM = 8;
export const MAX_DISTINCT_LOCATIONS = 3;
export const LOCK_HOURS_BEFORE = 3;
export const HARD_LOCK_MINUTES_BEFORE = 30;
export const GEOHASH_PRECISION = 6;

/**
 * Calculate user credibility score (0.5–1.0) based on trip history.
 * Weighted factors: 70% trip success rate, 30% report impact.
 * Each report reduces the report impact factor by 10 percentage points,
 * which translates to up to 3 percentage points off the final score per report
 * when the success rate is 100%. New users with no trips start at 0.75.
 */
export function calculateCredibilityScore(user: {
  successfulTrips: number;
  cancelledTrips: number;
  reportedCount: number;
}): number {
  const totalTrips = user.successfulTrips + user.cancelledTrips;
  if (totalTrips === 0) {
    return 0.75; // New user baseline
  }

  const successRate = user.successfulTrips / totalTrips;
  const reportFactor = Math.max(0, 1 - user.reportedCount * 0.1);
  const credibility = 0.7 * successRate + 0.3 * reportFactor;

  return Math.max(0.5, Math.min(1.0, credibility));
}

export type SelfDeclaredGender = "woman" | "man" | "nonbinary" | "prefer_not_to_say";

export type GroupStatus =
  | "tentative"
  | "semi_locked"
  | "locked"
  | "revealed"
  | "dissolved"
  | "matched_pending_ack"
  | "group_confirmed"
  | "meetup_preparation"
  | "meetup_checkin"
  | "depart_ready"
  | "in_trip"
  | "receipt_pending"
  | "payment_pending"
  | "closed"
  | "reported"
  | "cancelled";

export interface RiderProfile {
  userId: string;
  name?: string;
  email?: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  successfulTrips?: number;
  cancelledTrips?: number;
  reportedCount?: number;
}

export interface AvailabilityEntry {
  id: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  /** Passengers traveling on this booking (1–MAX_PARTY_SIZE); counts toward vehicle capacity. */
  partySize?: number;
  sealedDestinationRef: string;
  routeDescriptorRef: string;
  createdAt: string;
  status: "open" | "matched" | "cancelled";
}

export interface TentativeGroupMember {
  userId: string;
  availabilityId: string;
  displayName: string;
  accepted: boolean | null;
  acknowledgedAt: string | null;
}

export interface TentativeGroup {
  id: string;
  status: GroupStatus;
  pickupOriginId: string;
  pickupLabel: string;
  windowStart: string;
  windowEnd: string;
  groupSize: number;
  maxDetourMinutes: number;
  averageScore: number;
  minimumScore: number;
  confirmationDeadline: string;
  createdAt: string;
  revealedAt: string | null;
  generalAreaLabels?: string[];
}

export interface GroupSummaryResponse {
  group: TentativeGroup;
  members: TentativeGroupMember[];
  revealReady: boolean;
}

export interface AddressEnvelope {
  recipientUserId: string;
  senderUserId: string;
  senderName: string;
  ciphertext: string;
}

export interface CompatibilityEdge {
  leftRef: string;
  rightRef: string;
  score: number;
  routeOverlap: number;
  destinationProximity: number;
  detourMinutes: number;
  spreadDistanceKm: number;
}

export interface OtpRequestResponse {
  requestId: string;
  expiresAt: string;
}

export function isAllowedUniversityEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return NUS_ALLOWED_DOMAINS.includes(domain as (typeof NUS_ALLOWED_DOMAINS)[number]);
}

export function getEmailDomain(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** NUS e-prefix format (e.g. e1234567@u.nus.edu) can have aliases. Name-based (e.g. darentan@) requires exact match. */
export function isNusAliasFormat(email: string) {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  return /^e[a-z0-9]+$/.test(local);
}

export function clampGroupSize(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_GROUP_SIZE, Math.max(MIN_GROUP_SIZE, Math.floor(value)));
}

export function clampPartySize(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(MAX_PARTY_SIZE, Math.max(1, n));
}

export function sumPartySizes(members: readonly { partySize?: number | null }[]): number {
  return members.reduce((sum, m) => sum + (m.partySize ?? 1), 0);
}

/**
 * Total passenger seats for a group; prefers stored `passengerSeatTotal`, else sums member `partySize`,
 * else falls back to legacy `groupSize` (account count when party sizes were always 1).
 */
export function groupPassengerSeatTotal(
  group: { passengerSeatTotal?: number | null; groupSize: number },
  members: readonly { partySize?: number | null }[],
): number {
  if (group.passengerSeatTotal != null && group.passengerSeatTotal !== undefined) {
    return group.passengerSeatTotal;
  }
  const fromMembers = sumPartySizes(members);
  if (fromMembers > 0) {
    return fromMembers;
  }
  return group.groupSize;
}

export function overlapMinutes(
  left: Pick<AvailabilityEntry, "windowStart" | "windowEnd">,
  right: Pick<AvailabilityEntry, "windowStart" | "windowEnd">,
) {
  const start = Math.max(
    new Date(left.windowStart).getTime(),
    new Date(right.windowStart).getTime(),
  );
  const end = Math.min(new Date(left.windowEnd).getTime(), new Date(right.windowEnd).getTime());
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function arePreferencesCompatible(
  left: Pick<AvailabilityEntry, "sameGenderOnly" | "selfDeclaredGender">,
  right: Pick<AvailabilityEntry, "sameGenderOnly" | "selfDeclaredGender">,
) {
  if (left.sameGenderOnly || right.sameGenderOnly) {
    return left.selfDeclaredGender === right.selfDeclaredGender;
  }
  return true;
}
