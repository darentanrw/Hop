import { describe, expect, it } from "vitest";
import { selectBookerUserId } from "../../lib/group-lifecycle";
import {
  type BuildActionsOptions,
  type GroupLike,
  type GroupMemberLike,
  REDELEGATE_STATUSES,
  buildActions,
} from "../../lib/trip-actions";

const BOOKER = "user-booker";
const RIDER = "user-rider";

function group(overrides: Partial<GroupLike> = {}): GroupLike {
  return { status: "group_confirmed", bookerUserId: BOOKER, ...overrides };
}

function member(overrides: Partial<GroupMemberLike> = {}): GroupMemberLike {
  return { participationStatus: "active", ...overrides };
}

function opts(overrides: Partial<BuildActionsOptions> = {}): BuildActionsOptions {
  return {
    everyoneCheckedIn: false,
    graceExpired: false,
    bookerAbsentWindowPassed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildActions – canRedelegateBooker
// ---------------------------------------------------------------------------
describe("canRedelegateBooker", () => {
  describe("allowed statuses for the booker", () => {
    const allowedStatuses = ["group_confirmed", "meetup_preparation", "meetup_checkin"];

    for (const status of allowedStatuses) {
      it(`returns true when booker views group in "${status}"`, () => {
        const actions = buildActions(group({ status }), BOOKER, member(), opts());
        expect(actions.canRedelegateBooker).toBe(true);
      });
    }
  });

  describe("disallowed statuses for the booker", () => {
    const disallowed = [
      "tentative",
      "semi_locked",
      "locked",
      "matched_pending_ack",
      "depart_ready",
      "in_trip",
      "receipt_pending",
      "payment_pending",
      "closed",
      "reported",
      "cancelled",
    ];

    for (const status of disallowed) {
      it(`returns false when booker views group in "${status}"`, () => {
        const actions = buildActions(group({ status }), BOOKER, member(), opts());
        expect(actions.canRedelegateBooker).toBe(false);
      });
    }
  });

  it("returns false for a non-booker rider in any allowed status", () => {
    for (const status of ["group_confirmed", "meetup_preparation", "meetup_checkin"]) {
      const actions = buildActions(group({ status }), RIDER, member(), opts());
      expect(actions.canRedelegateBooker).toBe(false);
    }
  });

  it("returns false when bookerUserId is undefined", () => {
    const actions = buildActions(
      group({ status: "group_confirmed", bookerUserId: undefined }),
      BOOKER,
      member(),
      opts(),
    );
    expect(actions.canRedelegateBooker).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildActions – canReportBookerAbsent
// ---------------------------------------------------------------------------
describe("canReportBookerAbsent", () => {
  it("returns true for active non-booker rider in meetup_checkin after 5-min buffer", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member(),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(actions.canReportBookerAbsent).toBe(true);
  });

  it("returns false for the booker themselves", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      BOOKER,
      member(),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(actions.canReportBookerAbsent).toBe(false);
  });

  it("returns false before the 5-min absent buffer has passed", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member(),
      opts({ bookerAbsentWindowPassed: false }),
    );
    expect(actions.canReportBookerAbsent).toBe(false);
  });

  it("returns false in statuses other than meetup_checkin", () => {
    const otherStatuses = [
      "group_confirmed",
      "meetup_preparation",
      "depart_ready",
      "in_trip",
      "payment_pending",
    ];
    for (const status of otherStatuses) {
      const actions = buildActions(
        group({ status }),
        RIDER,
        member(),
        opts({ bookerAbsentWindowPassed: true }),
      );
      expect(actions.canReportBookerAbsent).toBe(false);
    }
  });

  it("returns false for a removed member", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member({ participationStatus: "removed_no_show" }),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(actions.canReportBookerAbsent).toBe(false);
  });

  it("returns false for a member who cancelled", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member({ participationStatus: "cancelled_by_user" }),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(actions.canReportBookerAbsent).toBe(false);
  });

  it("returns true when participationStatus is undefined (defaults to active)", () => {
    const actions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member({ participationStatus: undefined }),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(actions.canReportBookerAbsent).toBe(true);
  });

  it("returns false when options are not provided", () => {
    const actions = buildActions(group({ status: "meetup_checkin" }), RIDER, member());
    expect(actions.canReportBookerAbsent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REDELEGATE_STATUSES constant
// ---------------------------------------------------------------------------
describe("REDELEGATE_STATUSES", () => {
  it("contains exactly the three expected statuses", () => {
    expect(REDELEGATE_STATUSES).toEqual(
      new Set(["group_confirmed", "meetup_preparation", "meetup_checkin"]),
    );
  });

  it("does not contain pre-match or post-departure statuses", () => {
    expect(REDELEGATE_STATUSES.has("tentative")).toBe(false);
    expect(REDELEGATE_STATUSES.has("semi_locked")).toBe(false);
    expect(REDELEGATE_STATUSES.has("locked")).toBe(false);
    expect(REDELEGATE_STATUSES.has("in_trip")).toBe(false);
    expect(REDELEGATE_STATUSES.has("payment_pending")).toBe(false);
    expect(REDELEGATE_STATUSES.has("closed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectBookerUserId – used by reportBookerAbsent & redelegateBooker
// ---------------------------------------------------------------------------
describe("selectBookerUserId (booker selection for redelegation)", () => {
  it("returns null for an empty candidate list", () => {
    expect(selectBookerUserId([])).toBeNull();
  });

  it("falls back to alphabetical when no credibility data provided", () => {
    expect(selectBookerUserId(["user-c", "user-a", "user-b"])).toBe("user-a");
  });

  it("selects the candidate with the highest credibility score", () => {
    const scores = new Map([
      ["user-a", 0.6],
      ["user-b", 0.9],
      ["user-c", 0.7],
    ]);
    expect(selectBookerUserId(["user-a", "user-b", "user-c"], scores)).toBe("user-b");
  });

  it("breaks ties by alphabetical order", () => {
    const scores = new Map([
      ["user-b", 0.8],
      ["user-a", 0.8],
    ]);
    expect(selectBookerUserId(["user-b", "user-a"], scores)).toBe("user-a");
  });

  it("uses default 0.5 for candidates missing from the scores map", () => {
    const scores = new Map([["user-a", 0.5]]);
    expect(selectBookerUserId(["user-a", "user-b"], scores)).toBe("user-a");
  });

  it("picks the single candidate from a one-member list", () => {
    expect(selectBookerUserId(["user-solo"])).toBe("user-solo");
  });

  it("correctly picks from volunteers when only some have scores", () => {
    const scores = new Map([
      ["user-x", 0.7],
      ["user-y", 0.9],
    ]);
    expect(selectBookerUserId(["user-x", "user-y", "user-z"], scores)).toBe("user-y");
  });
});

// ---------------------------------------------------------------------------
// Integration-style: booker vs rider action visibility across the lifecycle
// ---------------------------------------------------------------------------
describe("booker vs rider action flags across redelegate-relevant statuses", () => {
  it("booker can redelegate but cannot report absent in group_confirmed", () => {
    const bookerActions = buildActions(
      group({ status: "group_confirmed" }),
      BOOKER,
      member(),
      opts(),
    );
    expect(bookerActions.canRedelegateBooker).toBe(true);
    expect(bookerActions.canReportBookerAbsent).toBe(false);

    const riderActions = buildActions(
      group({ status: "group_confirmed" }),
      RIDER,
      member(),
      opts(),
    );
    expect(riderActions.canRedelegateBooker).toBe(false);
    expect(riderActions.canReportBookerAbsent).toBe(false);
  });

  it("both redelegate and report-absent available in meetup_checkin (after 5-min buffer)", () => {
    const bookerActions = buildActions(
      group({ status: "meetup_checkin" }),
      BOOKER,
      member(),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(bookerActions.canRedelegateBooker).toBe(true);
    expect(bookerActions.canReportBookerAbsent).toBe(false);

    const riderActions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member(),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(riderActions.canRedelegateBooker).toBe(false);
    expect(riderActions.canReportBookerAbsent).toBe(true);
  });

  it("meetup_checkin before 5-min buffer: booker can redelegate, rider cannot report", () => {
    const bookerActions = buildActions(
      group({ status: "meetup_checkin" }),
      BOOKER,
      member(),
      opts({ bookerAbsentWindowPassed: false }),
    );
    expect(bookerActions.canRedelegateBooker).toBe(true);
    expect(bookerActions.canReportBookerAbsent).toBe(false);

    const riderActions = buildActions(
      group({ status: "meetup_checkin" }),
      RIDER,
      member(),
      opts({ bookerAbsentWindowPassed: false }),
    );
    expect(riderActions.canRedelegateBooker).toBe(false);
    expect(riderActions.canReportBookerAbsent).toBe(false);
  });

  it("neither action available in depart_ready", () => {
    const bookerActions = buildActions(
      group({ status: "depart_ready" }),
      BOOKER,
      member(),
      opts({ bookerAbsentWindowPassed: true }),
    );
    expect(bookerActions.canRedelegateBooker).toBe(false);
    expect(bookerActions.canReportBookerAbsent).toBe(false);
  });
});
