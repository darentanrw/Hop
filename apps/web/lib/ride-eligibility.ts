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
  "reported",
]);

const TERMINAL_STATUSES = new Set(["cancelled", "closed", "dissolved"]);

export interface MembershipLike {
  participationStatus?: string;
  amountDueCents?: number;
  paymentVerifiedAt?: string | null;
}

export interface GroupLike {
  status: string;
}

export interface RideEligibility {
  blocked: boolean;
  hasActiveGroup: boolean;
  unpaidCount: number;
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

    const isActive =
      ACTIVE_GROUP_STATUSES.has(group.status) &&
      (membership.participationStatus ?? "active") === "active";

    if (isActive) {
      hasActiveGroup = true;
    }

    const hasUnpaidBalance =
      (membership.amountDueCents ?? 0) > 0 &&
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
