import { describe, expect, it } from "vitest";
import {
  ACTIVE_GROUP_STATUSES,
  type GroupLike,
  type MembershipLike,
  checkRideEligibility,
} from "../../lib/ride-eligibility";

function pair(membership: Partial<MembershipLike>, group: Partial<GroupLike> | null) {
  return {
    membership: {
      participationStatus: "active" as string | undefined,
      amountDueCents: 0,
      paymentVerifiedAt: null as string | null,
      ...membership,
    },
    group: group ? { status: "closed", ...group } : null,
  };
}

describe("ACTIVE_GROUP_STATUSES", () => {
  const expected = [
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
  ];

  for (const status of expected) {
    it(`includes "${status}"`, () => {
      expect(ACTIVE_GROUP_STATUSES.has(status)).toBe(true);
    });
  }

  for (const terminal of ["cancelled", "closed", "dissolved"]) {
    it(`excludes terminal status "${terminal}"`, () => {
      expect(ACTIVE_GROUP_STATUSES.has(terminal)).toBe(false);
    });
  }
});

describe("checkRideEligibility", () => {
  it("returns not blocked when user has no memberships", () => {
    const result = checkRideEligibility([]);
    expect(result).toEqual({ blocked: false, hasActiveGroup: false, unpaidCount: 0 });
  });

  it("returns not blocked when group doc is null (deleted)", () => {
    const result = checkRideEligibility([pair({}, null)]);
    expect(result).toEqual({ blocked: false, hasActiveGroup: false, unpaidCount: 0 });
  });

  it("blocks when user is active member of an in-progress group", () => {
    const result = checkRideEligibility([pair({}, { status: "group_confirmed" })]);
    expect(result.blocked).toBe(true);
    expect(result.hasActiveGroup).toBe(true);
    expect(result.unpaidCount).toBe(0);
  });

  it("blocks for every active group status", () => {
    for (const status of ACTIVE_GROUP_STATUSES) {
      const result = checkRideEligibility([pair({}, { status })]);
      expect(result.hasActiveGroup).toBe(true);
      expect(result.blocked).toBe(true);
    }
  });

  it("does not block for terminal statuses (cancelled, closed, dissolved)", () => {
    for (const status of ["cancelled", "closed", "dissolved"]) {
      const result = checkRideEligibility([pair({}, { status })]);
      expect(result.hasActiveGroup).toBe(false);
      expect(result.blocked).toBe(false);
    }
  });

  it("does not block when member has left the group (participationStatus != active)", () => {
    const result = checkRideEligibility([
      pair({ participationStatus: "removed_no_show" }, { status: "in_trip" }),
    ]);
    expect(result.hasActiveGroup).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it("treats missing participationStatus as active", () => {
    const result = checkRideEligibility([
      pair({ participationStatus: undefined }, { status: "meetup_checkin" }),
    ]);
    expect(result.hasActiveGroup).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it("blocks when user has unpaid balance in a non-terminal group", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 500, paymentVerifiedAt: null }, { status: "payment_pending" }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.unpaidCount).toBe(1);
  });

  it("does not count unpaid balance if payment is verified", () => {
    const result = checkRideEligibility([
      pair(
        { amountDueCents: 500, paymentVerifiedAt: "2026-03-20T00:00:00Z" },
        { status: "payment_pending" },
      ),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("does not count unpaid balance in cancelled groups", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 500, paymentVerifiedAt: null }, { status: "cancelled" }),
    ]);
    expect(result.unpaidCount).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it("does not count unpaid balance in dissolved groups", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 500, paymentVerifiedAt: null }, { status: "dissolved" }),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("does not count unpaid balance in closed groups", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 500, paymentVerifiedAt: null }, { status: "closed" }),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("does not count zero amountDueCents as unpaid", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 0, paymentVerifiedAt: null }, { status: "payment_pending" }),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("treats missing amountDueCents as zero", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: undefined, paymentVerifiedAt: null }, { status: "payment_pending" }),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("both active group and unpaid count are reported together", () => {
    const result = checkRideEligibility([
      pair({}, { status: "in_trip" }),
      pair(
        {
          participationStatus: "removed_no_show",
          amountDueCents: 300,
          paymentVerifiedAt: null,
        },
        { status: "payment_pending" },
      ),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.hasActiveGroup).toBe(true);
    expect(result.unpaidCount).toBe(1);
  });

  it("a single membership can flag both active group and unpaid", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 1200, paymentVerifiedAt: null }, { status: "payment_pending" }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.hasActiveGroup).toBe(true);
    expect(result.unpaidCount).toBe(1);
  });

  it("multiple unpaid memberships are counted correctly", () => {
    const result = checkRideEligibility([
      pair(
        { participationStatus: "removed_no_show", amountDueCents: 400, paymentVerifiedAt: null },
        { status: "closed" },
      ),
      pair(
        { participationStatus: "removed_no_show", amountDueCents: 600, paymentVerifiedAt: null },
        { status: "reported" },
      ),
    ]);
    expect(result.unpaidCount).toBe(1);
  });

  it("mixed: past closed group + active group = blocked by active group", () => {
    const result = checkRideEligibility([
      pair({}, { status: "closed" }),
      pair({}, { status: "meetup_preparation" }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.hasActiveGroup).toBe(true);
    expect(result.unpaidCount).toBe(0);
  });

  it("only past closed groups with no balance = not blocked", () => {
    const result = checkRideEligibility([
      pair({}, { status: "closed" }),
      pair({}, { status: "cancelled" }),
      pair({}, { status: "dissolved" }),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.hasActiveGroup).toBe(false);
    expect(result.unpaidCount).toBe(0);
  });

  it("left member of active group is not blocked", () => {
    const result = checkRideEligibility([
      pair({ participationStatus: "left" }, { status: "in_trip" }),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.hasActiveGroup).toBe(false);
  });

  it("removed_voluntary member of active group is not blocked", () => {
    const result = checkRideEligibility([
      pair({ participationStatus: "removed_voluntary" }, { status: "depart_ready" }),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.hasActiveGroup).toBe(false);
  });
});
