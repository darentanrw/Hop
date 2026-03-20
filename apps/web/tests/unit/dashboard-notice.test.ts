import { describe, expect, it } from "vitest";
import { getDashboardNotice } from "../../lib/dashboard-notice";

describe("getDashboardNotice", () => {
  it("does not show the active-ride notice when there is an active trip to display", () => {
    expect(
      getDashboardNotice({
        hasActiveTrip: true,
        eligibility: { hasActiveGroup: true, unpaidCount: 0 },
      }),
    ).toBeNull();
  });

  it("shows the active-ride notice when eligibility is blocked and there is no active trip", () => {
    expect(
      getDashboardNotice({
        hasActiveTrip: false,
        eligibility: { hasActiveGroup: true, unpaidCount: 0 },
      }),
    ).toBe("You already have an active ride. Finish it before scheduling another.");
  });

  it("shows the unpaid notice when there is no active trip", () => {
    expect(
      getDashboardNotice({
        hasActiveTrip: false,
        eligibility: { hasActiveGroup: false, unpaidCount: 1 },
      }),
    ).toBe(
      "You have an outstanding payment from a previous ride. Settle up before scheduling another.",
    );
  });
});
