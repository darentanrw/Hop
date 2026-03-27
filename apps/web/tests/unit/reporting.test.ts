import { describe, expect, it } from "vitest";
import { buildGroupPatchForNewReport } from "../../lib/reporting";

describe("buildGroupPatchForNewReport", () => {
  it("starts the report count at one when the group has no prior reports", () => {
    expect(buildGroupPatchForNewReport()).toEqual({ reportCount: 1 });
  });

  it("increments an existing report count", () => {
    expect(buildGroupPatchForNewReport(2)).toEqual({ reportCount: 3 });
  });

  it("does not override the ride lifecycle status", () => {
    expect(buildGroupPatchForNewReport(2)).not.toHaveProperty("status");
  });
});
