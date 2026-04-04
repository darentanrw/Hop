import { describe, expect, it } from "vitest";
import { shouldPenalizeDeclinedAcknowledgement } from "../../lib/group-lifecycle";

describe("shouldPenalizeDeclinedAcknowledgement", () => {
  it("penalizes members who explicitly decline via acknowledgement status", () => {
    expect(
      shouldPenalizeDeclinedAcknowledgement({
        acknowledgementStatus: "declined",
        accepted: null,
      }),
    ).toBe(true);
  });

  it("penalizes members who reject through the boolean accepted flag", () => {
    expect(
      shouldPenalizeDeclinedAcknowledgement({
        acknowledgementStatus: null,
        accepted: false,
      }),
    ).toBe(true);
  });

  it("does not penalize members who timed out while still pending", () => {
    expect(
      shouldPenalizeDeclinedAcknowledgement({
        acknowledgementStatus: "pending",
        accepted: null,
      }),
    ).toBe(false);
  });

  it("does not penalize members whose acknowledgement fields remain null", () => {
    expect(
      shouldPenalizeDeclinedAcknowledgement({
        acknowledgementStatus: null,
        accepted: null,
      }),
    ).toBe(false);
  });

  it("does not penalize members who accepted", () => {
    expect(
      shouldPenalizeDeclinedAcknowledgement({
        acknowledgementStatus: "accepted",
        accepted: true,
      }),
    ).toBe(false);
  });
});
