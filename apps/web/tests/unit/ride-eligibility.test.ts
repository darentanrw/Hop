import { describe, expect, it } from "vitest";
import {
  ACTIVE_GROUP_STATUSES,
  type FullEligibility,
  type GroupLike,
  type MembershipLike,
  checkRideEligibility,
  getEligibilityError,
} from "../../lib/ride-eligibility";

function pair(membership: Partial<MembershipLike>, group: Partial<GroupLike> | null) {
  return {
    membership: {
      userId: "user-1",
      participationStatus: "active" as string | undefined,
      amountDueCents: 0,
      paymentStatus: "none",
      paymentVerifiedAt: null as string | null,
      ...membership,
    },
    group: group ? { status: "closed", bookerUserId: "booker-1", ...group } : null,
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

  it("does not block for a pre-departure group once its ride window has ended", () => {
    const result = checkRideEligibility([
      pair(
        {},
        { status: "meetup_checkin", windowEnd: new Date(Date.now() - 60_000).toISOString() },
      ),
    ]);
    expect(result.blocked).toBe(false);
    expect(result.hasActiveGroup).toBe(false);
  });

  it("keeps post-departure groups active even when their ride window has ended", () => {
    const result = checkRideEligibility([
      pair({}, { status: "in_trip", windowEnd: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.hasActiveGroup).toBe(true);
  });

  it("blocks for every active group status", () => {
    for (const status of ACTIVE_GROUP_STATUSES) {
      const membership =
        status === "payment_pending" ? { amountDueCents: 500, paymentStatus: "owed" } : {};
      const result = checkRideEligibility([pair(membership, { status })]);
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
        {
          amountDueCents: 500,
          paymentStatus: "verified",
          paymentVerifiedAt: "2026-03-20T00:00:00Z",
        },
        { status: "payment_pending" },
      ),
    ]);
    expect(result.unpaidCount).toBe(0);
  });

  it("releases a verified rider from active-ride blocking during payment pending", () => {
    const result = checkRideEligibility([
      pair(
        {
          amountDueCents: 500,
          paymentStatus: "verified",
          paymentVerifiedAt: "2026-03-20T00:00:00Z",
        },
        { status: "payment_pending" },
      ),
    ]);
    expect(result).toEqual({ blocked: false, hasActiveGroup: false, unpaidCount: 0 });
  });

  it("keeps an unpaid rider blocked during payment pending", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: 500, paymentStatus: "submitted" }, { status: "payment_pending" }),
    ]);
    expect(result).toEqual({ blocked: true, hasActiveGroup: true, unpaidCount: 1 });
  });

  it("keeps the booker blocked during payment pending until the group closes", () => {
    const result = checkRideEligibility([
      pair(
        {
          userId: "booker-1",
          amountDueCents: 0,
          paymentStatus: "not_required",
        },
        { status: "payment_pending", bookerUserId: "booker-1" },
      ),
    ]);
    expect(result).toEqual({ blocked: true, hasActiveGroup: true, unpaidCount: 0 });
  });

  it("releases a zero-balance rider once settlement no longer requires them", () => {
    const result = checkRideEligibility([
      pair(
        {
          userId: "rider-2",
          amountDueCents: 0,
          paymentStatus: "none",
        },
        { status: "payment_pending", bookerUserId: "booker-1" },
      ),
    ]);
    expect(result).toEqual({ blocked: false, hasActiveGroup: false, unpaidCount: 0 });
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

  it("reported group is not considered active", () => {
    const result = checkRideEligibility([pair({}, { status: "reported" })]);
    expect(result.hasActiveGroup).toBe(false);
  });

  it("unpaid balance in reported group still counts as unpaid", () => {
    const result = checkRideEligibility([
      pair(
        { participationStatus: "removed_no_show", amountDueCents: 800, paymentVerifiedAt: null },
        { status: "reported" },
      ),
    ]);
    expect(result.unpaidCount).toBe(1);
    expect(result.blocked).toBe(true);
  });

  it("negative amountDueCents is not counted as unpaid", () => {
    const result = checkRideEligibility([
      pair({ amountDueCents: -100, paymentVerifiedAt: null }, { status: "payment_pending" }),
    ]);
    expect(result.unpaidCount).toBe(0);
  });
});

describe("getEligibilityError", () => {
  function elig(overrides: Partial<FullEligibility> = {}): FullEligibility {
    return {
      blocked: false,
      hasActiveGroup: false,
      hasOpenWindow: false,
      unpaidCount: 0,
      ...overrides,
    };
  }

  it("returns null when user is fully eligible", () => {
    expect(getEligibilityError(elig())).toBeNull();
  });

  it("returns active group error when hasActiveGroup is true", () => {
    const error = getEligibilityError(elig({ blocked: true, hasActiveGroup: true }));
    expect(error).toMatch(/active ride/i);
  });

  it("returns open window error when hasOpenWindow is true", () => {
    const error = getEligibilityError(elig({ blocked: true, hasOpenWindow: true }));
    expect(error).toMatch(/open ride window/i);
  });

  it("returns unpaid error when unpaidCount > 0", () => {
    const error = getEligibilityError(elig({ blocked: true, unpaidCount: 2 }));
    expect(error).toMatch(/payment/i);
  });

  it("active group takes priority over open window", () => {
    const error = getEligibilityError(
      elig({ blocked: true, hasActiveGroup: true, hasOpenWindow: true }),
    );
    expect(error).toMatch(/active ride/i);
    expect(error).not.toMatch(/open ride window/i);
  });

  it("active group takes priority over unpaid", () => {
    const error = getEligibilityError(
      elig({ blocked: true, hasActiveGroup: true, unpaidCount: 1 }),
    );
    expect(error).toMatch(/active ride/i);
    expect(error).not.toMatch(/payment/i);
  });

  it("open window takes priority over unpaid", () => {
    const error = getEligibilityError(elig({ blocked: true, hasOpenWindow: true, unpaidCount: 1 }));
    expect(error).toMatch(/open ride window/i);
    expect(error).not.toMatch(/payment/i);
  });

  it("all three conditions: active group wins", () => {
    const error = getEligibilityError(
      elig({ blocked: true, hasActiveGroup: true, hasOpenWindow: true, unpaidCount: 3 }),
    );
    expect(error).toMatch(/active ride/i);
  });

  it("returns null when blocked is true but all flags are false/zero", () => {
    const error = getEligibilityError(elig({ blocked: true }));
    expect(error).toBeNull();
  });

  it("returns null when unpaidCount is exactly 0", () => {
    const error = getEligibilityError(elig({ unpaidCount: 0 }));
    expect(error).toBeNull();
  });
});

describe("createAvailability error selection", () => {
  it("checkRideEligibility + open window produces correct error sequence", () => {
    const noGroups = checkRideEligibility([]);
    expect(noGroups.blocked).toBe(false);
    const errorWhenClear = getEligibilityError({ ...noGroups, hasOpenWindow: false });
    expect(errorWhenClear).toBeNull();

    const errorWhenOpenWindow = getEligibilityError({ ...noGroups, hasOpenWindow: true });
    expect(errorWhenOpenWindow).toMatch(/open ride window/i);
  });

  it("active group supersedes open window in combined flow", () => {
    const withActive = checkRideEligibility([pair({}, { status: "in_trip" })]);
    expect(withActive.hasActiveGroup).toBe(true);
    const error = getEligibilityError({ ...withActive, hasOpenWindow: true });
    expect(error).toMatch(/active ride/i);
  });

  it("unpaid only shows when no active group and no open window", () => {
    const withUnpaid = checkRideEligibility([
      pair(
        { participationStatus: "removed_no_show", amountDueCents: 500, paymentVerifiedAt: null },
        { status: "payment_pending" },
      ),
    ]);
    expect(withUnpaid.hasActiveGroup).toBe(false);
    expect(withUnpaid.unpaidCount).toBe(1);
    const error = getEligibilityError({ ...withUnpaid, hasOpenWindow: false });
    expect(error).toMatch(/payment/i);
  });

  it("clean history with no open window = null", () => {
    const clean = checkRideEligibility([
      pair({}, { status: "closed" }),
      pair({}, { status: "cancelled" }),
    ]);
    const error = getEligibilityError({ ...clean, hasOpenWindow: false });
    expect(error).toBeNull();
  });
});
