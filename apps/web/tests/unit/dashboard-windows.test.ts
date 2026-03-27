import { describe, expect, it } from "vitest";
import { resolveDashboardWindowState } from "../../lib/dashboard-windows";

describe("resolveDashboardWindowState", () => {
  it("keeps open windows visible even if there is old ride history", () => {
    expect(
      resolveDashboardWindowState({
        availabilityStatus: "open",
        groupStatus: "closed",
        participationStatus: "active",
      }),
    ).toEqual({
      hidden: false,
      displayStatus: "open",
    });
  });

  it("shows matched windows awaiting acknowledgement as confirming", () => {
    expect(
      resolveDashboardWindowState({
        availabilityStatus: "matched",
        groupStatus: "matched_pending_ack",
        participationStatus: "active",
      }),
    ).toEqual({
      hidden: false,
      displayStatus: "confirming",
    });
  });

  it("shows active matched rides past acknowledgement as confirmed", () => {
    expect(
      resolveDashboardWindowState({
        availabilityStatus: "matched",
        groupStatus: "payment_pending",
        participationStatus: "active",
      }),
    ).toEqual({
      hidden: false,
      displayStatus: "confirmed",
    });
  });

  it("hides matched windows once the linked ride is finished", () => {
    expect(
      resolveDashboardWindowState({
        availabilityStatus: "matched",
        groupStatus: "closed",
        participationStatus: "active",
      }),
    ).toEqual({
      hidden: true,
      displayStatus: "confirmed",
    });
  });

  it("hides matched windows when the rider is no longer active in that group", () => {
    expect(
      resolveDashboardWindowState({
        availabilityStatus: "matched",
        groupStatus: "in_trip",
        participationStatus: "removed_no_show",
      }),
    ).toEqual({
      hidden: true,
      displayStatus: "matched",
    });
  });
});
