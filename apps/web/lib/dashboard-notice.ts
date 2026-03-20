const ACTIVE_RIDE_NOTICE = "You already have an active ride. Finish it before scheduling another.";
const UNPAID_RIDE_NOTICE =
  "You have an outstanding payment from a previous ride. Settle up before scheduling another.";

interface DashboardNoticeEligibility {
  hasActiveGroup?: boolean;
  unpaidCount?: number;
}

export function getDashboardNotice({
  hasActiveTrip,
  eligibility,
}: {
  hasActiveTrip: boolean;
  eligibility: DashboardNoticeEligibility | null;
}): string | null {
  if (hasActiveTrip) {
    return null;
  }

  if (eligibility?.hasActiveGroup) {
    return ACTIVE_RIDE_NOTICE;
  }

  if (eligibility?.unpaidCount) {
    return UNPAID_RIDE_NOTICE;
  }

  return null;
}
