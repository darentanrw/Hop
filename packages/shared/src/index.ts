export const NUS_ALLOWED_DOMAINS = ["u.nus.edu", "nus.edu.sg"] as const;
export const PICKUP_ORIGIN_ID = "nus-utown";
export const PICKUP_ORIGIN_LABEL = "NUS Utown";
export const ACK_WINDOW_MINUTES = 30;
export const MIN_TIME_OVERLAP_MINUTES = 60;
export const SMALL_GROUP_RELEASE_HOURS = 5;
export const MAX_GROUP_SIZE = 4;
export const MIN_GROUP_SIZE = 2;
export const MAX_DETOUR_MINUTES = 12;

export type SelfDeclaredGender = "woman" | "man" | "nonbinary" | "prefer_not_to_say";

export type FareBand = "S$10-15" | "S$16-20" | "S$21-25" | "S$26+";

export type GroupStatus = "tentative" | "revealed" | "dissolved";

export interface RiderProfile {
  userId: string;
  name?: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  minGroupSize: number;
  maxGroupSize: number;
}

export interface AvailabilityEntry {
  id: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  minGroupSize: number;
  maxGroupSize: number;
  sealedDestinationRef: string;
  routeDescriptorRef: string;
  estimatedFareBand: FareBand;
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
  estimatedFareBand: FareBand;
  maxDetourMinutes: number;
  averageScore: number;
  minimumScore: number;
  confirmationDeadline: string;
  createdAt: string;
  revealedAt: string | null;
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
  fareBand: FareBand;
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
