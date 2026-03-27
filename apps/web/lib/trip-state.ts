const PRE_DEPARTURE_GROUP_STATUSES = new Set([
  "tentative",
  "semi_locked",
  "locked",
  "revealed",
  "matched_pending_ack",
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
  "depart_ready",
]);

type GroupWindowLike = {
  status: string;
  windowEnd?: string | null;
};

export function isGroupPastWindowBeforeDeparture(group: GroupWindowLike, now: number = Date.now()) {
  if (!PRE_DEPARTURE_GROUP_STATUSES.has(group.status)) {
    return false;
  }

  if (!group.windowEnd) {
    return false;
  }

  return new Date(group.windowEnd).getTime() <= now;
}
