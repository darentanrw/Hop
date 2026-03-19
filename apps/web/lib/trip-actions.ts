export interface GroupLike {
  status: string;
  bookerUserId?: string;
}

export interface GroupMemberLike {
  participationStatus?: string;
  acknowledgementStatus?: string;
  destinationLockedAt?: string;
  amountDueCents?: number;
  paymentStatus?: string;
}

export const REDELEGATE_STATUSES = new Set([
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
]);

export const BOOKER_ABSENT_BUFFER_MS = 5 * 60_000;

export interface BuildActionsOptions {
  everyoneCheckedIn: boolean;
  graceExpired: boolean;
  bookerAbsentWindowPassed: boolean;
}

export function buildActions(
  group: GroupLike,
  currentUserId: string,
  currentUserMember: GroupMemberLike | null,
  options?: BuildActionsOptions,
) {
  const currentStatus = group.status;
  const isBooker = group.bookerUserId === currentUserId;
  const canDepartNow =
    currentStatus === "depart_ready" ||
    (currentStatus === "meetup_checkin" &&
      Boolean(options?.everyoneCheckedIn || options?.graceExpired));

  return {
    canAcknowledge:
      currentStatus === "matched_pending_ack" &&
      currentUserMember?.participationStatus !== "removed_no_ack" &&
      currentUserMember?.acknowledgementStatus !== "accepted",
    canSubmitDestination: false,
    canShowQr:
      (currentStatus === "meetup_checkin" || currentStatus === "depart_ready") &&
      !isBooker &&
      Boolean(currentUserMember?.destinationLockedAt) &&
      (currentUserMember?.participationStatus ?? "active") === "active",
    canScanQr: (currentStatus === "meetup_checkin" || currentStatus === "depart_ready") && isBooker,
    canStartCheckIn:
      (currentStatus === "group_confirmed" || currentStatus === "meetup_preparation") && isBooker,
    canDepart: canDepartNow && isBooker,
    canUploadReceipt:
      (currentStatus === "in_trip" || currentStatus === "receipt_pending") && isBooker,
    canSubmitPaymentProof:
      currentStatus === "payment_pending" &&
      !isBooker &&
      (currentUserMember?.amountDueCents ?? 0) > 0 &&
      currentUserMember?.paymentStatus !== "verified",
    canVerifyPayments: currentStatus === "payment_pending" && isBooker,
    canRedelegateBooker: isBooker && REDELEGATE_STATUSES.has(currentStatus),
    // Non-checked-in callers are intentionally allowed: the booker runs the QR
    // scanner, so nobody can check in when the booker is absent.
    canReportBookerAbsent:
      !isBooker &&
      currentStatus === "meetup_checkin" &&
      Boolean(options?.bookerAbsentWindowPassed) &&
      (currentUserMember?.participationStatus ?? "active") === "active",
    canReport: currentStatus !== "matched_pending_ack" && Boolean(currentUserMember),
  };
}
