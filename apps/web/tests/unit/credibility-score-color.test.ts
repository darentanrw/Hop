import {
  CREDIBILITY_SUSPENSION_THRESHOLD,
  calculateCredibilityScore,
  isCredibilitySuspended,
} from "@hop/shared";
import { describe, expect, it } from "vitest";
import { credibilityScoreNumberColor } from "../../lib/credibility-score-color";

describe("credibilityScoreNumberColor", () => {
  it.each([0, 1, 29, 30, 49])("uses danger for rounded score %i (< 50)", (score) => {
    expect(credibilityScoreNumberColor(score)).toBe("var(--danger)");
  });

  it.each([50, 51, 75, 100])("uses success for rounded score %i (≥ 50)", (score) => {
    expect(credibilityScoreNumberColor(score)).toBe("var(--success)");
  });

  it("rounds fractional scores before choosing colour", () => {
    expect(credibilityScoreNumberColor(49.4)).toBe("var(--danger)");
    expect(credibilityScoreNumberColor(49.6)).toBe("var(--success)");
  });

  it("boundary 49.5 rounds up to 50 in JavaScript", () => {
    expect(Math.round(49.5)).toBe(50);
    expect(credibilityScoreNumberColor(49.5)).toBe("var(--success)");
  });
});

describe("suspension threshold vs display colour (integration)", () => {
  it("scores below suspension threshold are always danger-coloured", () => {
    const below = CREDIBILITY_SUSPENSION_THRESHOLD - 1;
    expect(isCredibilitySuspended(below)).toBe(true);
    expect(credibilityScoreNumberColor(below)).toBe("var(--danger)");
  });

  it("score at threshold is not suspended but still danger until 50", () => {
    expect(isCredibilitySuspended(CREDIBILITY_SUSPENSION_THRESHOLD)).toBe(false);
    expect(credibilityScoreNumberColor(CREDIBILITY_SUSPENSION_THRESHOLD)).toBe("var(--danger)");
  });

  it("new-user baseline is well above suspension and uses success colour", () => {
    const baseline = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(isCredibilitySuspended(baseline)).toBe(false);
    expect(credibilityScoreNumberColor(baseline)).toBe("var(--success)");
  });
});
