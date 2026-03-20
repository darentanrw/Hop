export const ACTIVE_GROUP_STATUSES = new Set([
  "tentative",
  "semi_locked",
  "locked",
  "matched_pending_ack",
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
  "depart_ready",
  "in_trip",
  "receipt_pending",
  "payment_pending",
]);

const TERMINAL_STATUSES = new Set(["cancelled", "closed", "dissolved"]);

export interface MembershipLike {
  userId?: string;
  participationStatus?: string;
  amountDueCents?: number;
  paymentStatus?: string;
  paymentVerifiedAt?: string | null;
}

export interface GroupLike {
  status: string;
  bookerUserId?: string | null;
}

export interface RideEligibility {
  blocked: boolean;
  hasActiveGroup: boolean;
  unpaidCount: number;
}

export interface FullEligibility extends RideEligibility {
  hasOpenWindow: boolean;
}

/**
 * Returns the user-facing error message for the highest-priority blocking
 * condition, or null if the user is eligible to create a new ride window.
 */
export function getEligibilityError(eligibility: FullEligibility): string | null {
  if (eligibility.hasActiveGroup) {
    return "You already have an active ride. Finish it before scheduling another.";
  }
  if (eligibility.hasOpenWindow) {
    return "You already have an open ride window. Cancel it before creating another.";
  }
  if (eligibility.unpaidCount > 0) {
    return "Clear your previous trip payment before scheduling another ride.";
  }
  return null;
}

/**
 * Pure function: given a list of (membership, group) pairs for a user,
 * returns whether the user is eligible to create a new ride window.
 */
export function checkRideEligibility(
  pairs: { membership: MembershipLike; group: GroupLike | null }[],
): RideEligibility {
  let hasActiveGroup = false;
  let unpaidCount = 0;

  for (const { membership, group } of pairs) {
    if (!group) continue;

    const isActive = isMembershipInActiveRide(membership, group);

    if (isActive) {
      hasActiveGroup = true;
    }

    const hasUnpaidBalance =
      (membership.amountDueCents ?? 0) > 0 &&
      membership.paymentStatus !== "verified" &&
      !membership.paymentVerifiedAt &&
      !TERMINAL_STATUSES.has(group.status);

    if (hasUnpaidBalance) {
      unpaidCount += 1;
    }
  }

  return {
    blocked: hasActiveGroup || unpaidCount > 0,
    hasActiveGroup,
    unpaidCount,
  };
}

export function isMembershipInActiveRide(
  membership: MembershipLike,
  group: GroupLike | null,
): boolean {
  if (!group) {
    return false;
  }

  if ((membership.participationStatus ?? "active") !== "active") {
    return false;
  }

  if (!ACTIVE_GROUP_STATUSES.has(group.status)) {
    return false;
  }

  if (group.status !== "payment_pending") {
    return true;
  }

  const canResolveBooker =
    typeof membership.userId === "string" && typeof group.bookerUserId === "string";
  const isBooker = canResolveBooker && membership.userId === group.bookerUserId;
  if (isBooker) {
    return true;
  }

  const amountDueCents = membership.amountDueCents ?? 0;
  const paymentSettled =
    membership.paymentStatus === "verified" ||
    membership.paymentStatus === "not_required" ||
    Boolean(membership.paymentVerifiedAt) ||
    (canResolveBooker && amountDueCents <= 0);

  return !paymentSettled;
}
