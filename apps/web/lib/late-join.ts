import {
  ACK_WINDOW_MINUTES,
  type GroupStatus,
  MIN_TIME_OVERLAP_MINUTES,
  overlapMinutes,
} from "@hop/shared";

type TimeWindow = {
  windowStart: string;
  windowEnd: string;
};

type LateJoinableGroup = TimeWindow & {
  status: GroupStatus;
  confirmationDeadline: string;
};

export function isGroupJoinableForLateJoin(
  group: Pick<LateJoinableGroup, "status" | "confirmationDeadline">,
  now = Date.now(),
) {
  if (group.status === "semi_locked" || group.status === "tentative") {
    return true;
  }

  if (group.status === "matched_pending_ack") {
    return new Date(group.confirmationDeadline).getTime() > now;
  }

  return false;
}

export function canGroupAcceptLateJoin(
  group: LateJoinableGroup,
  joiner: TimeWindow,
  now = Date.now(),
) {
  const joinerStartsBeforeGroup =
    new Date(joiner.windowStart).getTime() <= new Date(group.windowStart).getTime();
  const joinerEndsAfterGroup =
    new Date(joiner.windowEnd).getTime() >= new Date(group.windowEnd).getTime();

  return (
    isGroupJoinableForLateJoin(group, now) &&
    overlapMinutes(joiner, group) > MIN_TIME_OVERLAP_MINUTES &&
    joinerStartsBeforeGroup &&
    joinerEndsAfterGroup
  );
}

export function shouldResetAcknowledgementsForLateJoin(status: GroupStatus) {
  return status === "matched_pending_ack";
}

export function buildLateJoinConfirmationDeadline(now = Date.now()) {
  return new Date(now + ACK_WINDOW_MINUTES * 60_000).toISOString();
}
