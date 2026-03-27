export const FINISHED_GROUP_STATUSES = new Set(["cancelled", "closed", "dissolved", "reported"]);

const CONFIRMED_WINDOW_GROUP_STATUSES = new Set([
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
  "depart_ready",
  "in_trip",
  "receipt_pending",
  "payment_pending",
]);

export type DashboardWindowStatus = "open" | "matched" | "confirming" | "confirmed" | "cancelled";

export function resolveDashboardWindowState(args: {
  availabilityStatus: string;
  groupStatus?: string | null;
  participationStatus?: string | null;
}): {
  hidden: boolean;
  displayStatus: DashboardWindowStatus;
} {
  const { availabilityStatus, groupStatus, participationStatus } = args;

  if (availabilityStatus === "cancelled") {
    return { hidden: true, displayStatus: "cancelled" };
  }

  if (availabilityStatus !== "matched") {
    return {
      hidden: false,
      displayStatus: availabilityStatus === "open" ? "open" : "matched",
    };
  }

  if (participationStatus && participationStatus !== "active") {
    return { hidden: true, displayStatus: "matched" };
  }

  if (!groupStatus) {
    return { hidden: false, displayStatus: "matched" };
  }

  if (FINISHED_GROUP_STATUSES.has(groupStatus)) {
    return { hidden: true, displayStatus: "confirmed" };
  }

  if (groupStatus === "matched_pending_ack") {
    return { hidden: false, displayStatus: "confirming" };
  }

  if (CONFIRMED_WINDOW_GROUP_STATUSES.has(groupStatus)) {
    return { hidden: false, displayStatus: "confirmed" };
  }

  return { hidden: false, displayStatus: "matched" };
}
