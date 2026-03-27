import { describe, expect, test } from "vitest";
import {
  buildLateJoinConfirmationDeadline,
  canGroupAcceptLateJoin,
  isGroupJoinableForLateJoin,
  shouldResetAcknowledgementsForLateJoin,
} from "../../lib/late-join";

const baseGroup = {
  status: "semi_locked" as const,
  windowStart: "2026-03-28T10:00:00.000Z",
  windowEnd: "2026-03-28T12:00:00.000Z",
  confirmationDeadline: "2026-03-28T09:30:00.000Z",
};

describe("late join helpers", () => {
  test("matched_pending_ack groups remain joinable before their deadline", () => {
    expect(
      isGroupJoinableForLateJoin(
        {
          status: "matched_pending_ack",
          confirmationDeadline: "2026-03-28T09:30:00.000Z",
        },
        Date.parse("2026-03-28T09:00:00.000Z"),
      ),
    ).toBe(true);
  });

  test("matched_pending_ack groups stop being joinable after their deadline", () => {
    expect(
      isGroupJoinableForLateJoin(
        {
          status: "matched_pending_ack",
          confirmationDeadline: "2026-03-28T09:30:00.000Z",
        },
        Date.parse("2026-03-28T09:30:00.000Z"),
      ),
    ).toBe(false);
  });

  test("late join rejects windows that do not cover the group's slot", () => {
    expect(
      canGroupAcceptLateJoin(
        {
          ...baseGroup,
          status: "matched_pending_ack",
        },
        {
          windowStart: "2026-03-28T11:00:00.000Z",
          windowEnd: "2026-03-28T13:00:00.000Z",
        },
        Date.parse("2026-03-28T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  test("late join accepts joiners that cover the whole group slot", () => {
    expect(
      canGroupAcceptLateJoin(
        {
          ...baseGroup,
          status: "matched_pending_ack",
        },
        {
          windowStart: "2026-03-28T09:30:00.000Z",
          windowEnd: "2026-03-28T13:00:00.000Z",
        },
        Date.parse("2026-03-28T09:00:00.000Z"),
      ),
    ).toBe(true);
  });

  test("acknowledgements reset only when joining a matched_pending_ack group", () => {
    expect(shouldResetAcknowledgementsForLateJoin("matched_pending_ack")).toBe(true);
    expect(shouldResetAcknowledgementsForLateJoin("semi_locked")).toBe(false);
    expect(shouldResetAcknowledgementsForLateJoin("tentative")).toBe(false);
  });

  test("late join deadline resets to 30 minutes from the latest join", () => {
    expect(buildLateJoinConfirmationDeadline(Date.parse("2026-03-28T09:00:00.000Z"))).toBe(
      "2026-03-28T09:30:00.000Z",
    );
  });
});
