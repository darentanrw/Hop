import {
  CREDIBILITY_CANCEL_POINTS,
  CREDIBILITY_CONFIRMED_REPORT_PENALTY,
  CREDIBILITY_MAX_SCORE,
  CREDIBILITY_MIN_SCORE,
  CREDIBILITY_STARTING_POINTS,
  CREDIBILITY_SUCCESS_POINTS,
  CREDIBILITY_SUSPENSION_THRESHOLD,
  calculateCredibilityScore,
  isCredibilitySuspended,
} from "@hop/shared";
import { describe, expect, it } from "vitest";

/** Raw score before clamping (mirrors `calculateCredibilityScore` logic for assertions). */
function rawCredibilityScore(args: {
  successfulTrips: number;
  cancelledTrips: number;
  confirmedReportCount: number;
}): number {
  return (
    CREDIBILITY_STARTING_POINTS +
    CREDIBILITY_SUCCESS_POINTS * args.successfulTrips -
    CREDIBILITY_CANCEL_POINTS * args.cancelledTrips -
    CREDIBILITY_CONFIRMED_REPORT_PENALTY * args.confirmedReportCount
  );
}

describe("credibility score constants", () => {
  it("uses the intended deltas for tuning", () => {
    expect(CREDIBILITY_STARTING_POINTS).toBe(75);
    expect(CREDIBILITY_SUCCESS_POINTS).toBe(5);
    expect(CREDIBILITY_CANCEL_POINTS).toBe(10);
    expect(CREDIBILITY_CONFIRMED_REPORT_PENALTY).toBe(25);
    expect(CREDIBILITY_MIN_SCORE).toBe(0);
    expect(CREDIBILITY_MAX_SCORE).toBe(100);
    expect(CREDIBILITY_SUSPENSION_THRESHOLD).toBe(30);
  });
});

describe("isCredibilitySuspended", () => {
  it("is false at the threshold and above", () => {
    expect(isCredibilitySuspended(CREDIBILITY_SUSPENSION_THRESHOLD)).toBe(false);
    expect(isCredibilitySuspended(100)).toBe(false);
  });

  it("is true strictly below the threshold", () => {
    expect(isCredibilitySuspended(CREDIBILITY_SUSPENSION_THRESHOLD - 1)).toBe(true);
    expect(isCredibilitySuspended(0)).toBe(true);
  });
});

describe("calculateCredibilityScore — baseline", () => {
  it("returns starting points when all counters are zero", () => {
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      }),
    ).toBe(CREDIBILITY_STARTING_POINTS);
  });
});

describe("calculateCredibilityScore — successes only", () => {
  it.each([
    [1, 80],
    [2, 85],
    [3, 90],
    [4, 95],
    [5, 100],
  ] as const)("successfulTrips=%i → score %i (under cap)", (successfulTrips, expected) => {
    expect(
      calculateCredibilityScore({
        successfulTrips,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      }),
    ).toBe(expected);
  });

  it("hits ceiling at 100 with exactly five net success points from baseline", () => {
    expect(
      rawCredibilityScore({ successfulTrips: 5, cancelledTrips: 0, confirmedReportCount: 0 }),
    ).toBe(100);
    expect(
      calculateCredibilityScore({
        successfulTrips: 5,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      }),
    ).toBe(CREDIBILITY_MAX_SCORE);
  });

  it("stays at 100 when raw would exceed max", () => {
    expect(
      calculateCredibilityScore({
        successfulTrips: 6,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      }),
    ).toBe(CREDIBILITY_MAX_SCORE);
    expect(
      rawCredibilityScore({ successfulTrips: 6, cancelledTrips: 0, confirmedReportCount: 0 }),
    ).toBe(105);
  });

  it("each additional success adds exactly SUCCESS_POINTS until capped", () => {
    for (let s = 1; s <= 4; s += 1) {
      const prev = calculateCredibilityScore({
        successfulTrips: s - 1,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      });
      const next = calculateCredibilityScore({
        successfulTrips: s,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      });
      expect(next - prev).toBe(CREDIBILITY_SUCCESS_POINTS);
    }
    const atFour = calculateCredibilityScore({
      successfulTrips: 4,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    const atFive = calculateCredibilityScore({
      successfulTrips: 5,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(atFive - atFour).toBe(CREDIBILITY_SUCCESS_POINTS);
    const atSix = calculateCredibilityScore({
      successfulTrips: 6,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(atSix).toBe(atFive);
  });
});

describe("calculateCredibilityScore — cancellations only", () => {
  it.each([
    [1, 65],
    [2, 55],
    [3, 45],
    [4, 35],
    [5, 25],
    [6, 15],
    [7, 5],
  ] as const)("cancelledTrips=%i → score %i (above floor)", (cancelledTrips, expected) => {
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips,
        confirmedReportCount: 0,
      }),
    ).toBe(expected);
  });

  it("hits floor at zero with eight cancellations from baseline", () => {
    expect(
      rawCredibilityScore({ successfulTrips: 0, cancelledTrips: 8, confirmedReportCount: 0 }),
    ).toBe(-5);
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 8,
        confirmedReportCount: 0,
      }),
    ).toBe(CREDIBILITY_MIN_SCORE);
  });

  it("each additional cancel subtracts CANCEL_POINTS until floored", () => {
    for (let c = 1; c <= 7; c += 1) {
      const prev = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: c - 1,
        confirmedReportCount: 0,
      });
      const next = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: c,
        confirmedReportCount: 0,
      });
      expect(next - prev).toBe(-CREDIBILITY_CANCEL_POINTS);
    }
    const atSeven = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 7,
      confirmedReportCount: 0,
    });
    const atEight = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 8,
      confirmedReportCount: 0,
    });
    expect(atEight - atSeven).toBe(-5);
    const atNine = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 9,
      confirmedReportCount: 0,
    });
    expect(atNine).toBe(atEight);
  });
});

describe("calculateCredibilityScore — confirmed reports only", () => {
  it.each([
    [1, 50],
    [2, 25],
  ] as const)("confirmedReportCount=%i from baseline", (confirmedReportCount, expected) => {
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        confirmedReportCount,
      }),
    ).toBe(expected);
  });

  it("three confirmed reports from baseline reaches exactly zero", () => {
    expect(
      rawCredibilityScore({ successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 3 }),
    ).toBe(0);
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        confirmedReportCount: 3,
      }),
    ).toBe(CREDIBILITY_MIN_SCORE);
  });

  it("four confirmed reports clamps at zero", () => {
    expect(
      rawCredibilityScore({ successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 4 }),
    ).toBe(-25);
    expect(
      calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        confirmedReportCount: 4,
      }),
    ).toBe(CREDIBILITY_MIN_SCORE);
  });

  it("delta between profiles differing only by one confirmed report equals penalty when not clamped", () => {
    const a = calculateCredibilityScore({
      successfulTrips: 4,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    const b = calculateCredibilityScore({
      successfulTrips: 4,
      cancelledTrips: 0,
      confirmedReportCount: 1,
    });
    expect(a - b).toBe(CREDIBILITY_CONFIRMED_REPORT_PENALTY);
  });
});

describe("calculateCredibilityScore — combined formula", () => {
  it("matches explicit raw formula when inside bounds", () => {
    const args = {
      successfulTrips: 8,
      cancelledTrips: 2,
      confirmedReportCount: 1,
    };
    expect(calculateCredibilityScore(args)).toBe(rawCredibilityScore(args));
    expect(calculateCredibilityScore(args)).toBe(
      CREDIBILITY_STARTING_POINTS +
        8 * CREDIBILITY_SUCCESS_POINTS -
        2 * CREDIBILITY_CANCEL_POINTS -
        CREDIBILITY_CONFIRMED_REPORT_PENALTY,
    );
  });

  it("equal successes and cancellations: each pair nets −5 (cancel weighs 2× success)", () => {
    expect(
      calculateCredibilityScore({
        successfulTrips: 5,
        cancelledTrips: 5,
        confirmedReportCount: 0,
      }),
    ).toBe(
      CREDIBILITY_STARTING_POINTS + 5 * CREDIBILITY_SUCCESS_POINTS - 5 * CREDIBILITY_CANCEL_POINTS,
    );
  });

  it("additive: extra successes and cancels in lockstep change score by −5 per pair (not a ratio)", () => {
    const a = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    const b = calculateCredibilityScore({
      successfulTrips: 15,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(a).toBe(CREDIBILITY_MAX_SCORE);
    expect(b).toBe(CREDIBILITY_MAX_SCORE);
    const low = calculateCredibilityScore({
      successfulTrips: 5,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    const lowPlusPairs = calculateCredibilityScore({
      successfulTrips: 7,
      cancelledTrips: 2,
      confirmedReportCount: 0,
    });
    expect(lowPlusPairs - low).toBe(2 * CREDIBILITY_SUCCESS_POINTS - 2 * CREDIBILITY_CANCEL_POINTS);
  });

  it("is commutative in the sense that raw is linear in counters", () => {
    const base = { successfulTrips: 2, cancelledTrips: 1, confirmedReportCount: 1 };
    expect(calculateCredibilityScore(base)).toBe(rawCredibilityScore(base));
  });
});

describe("calculateCredibilityScore — clamp boundaries", () => {
  it("never returns below min or above max", () => {
    const extremes = [
      { successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 0 },
      { successfulTrips: 10_000, cancelledTrips: 0, confirmedReportCount: 0 },
      { successfulTrips: 0, cancelledTrips: 10_000, confirmedReportCount: 0 },
      { successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 100 },
      { successfulTrips: 100, cancelledTrips: 100, confirmedReportCount: 100 },
    ];
    for (const input of extremes) {
      const s = calculateCredibilityScore(input);
      expect(s).toBeGreaterThanOrEqual(CREDIBILITY_MIN_SCORE);
      expect(s).toBeLessThanOrEqual(CREDIBILITY_MAX_SCORE);
    }
  });
});

describe("calculateCredibilityScore — determinism", () => {
  it("returns the same value for the same input object shape", () => {
    const profile = {
      successfulTrips: 5,
      cancelledTrips: 3,
      confirmedReportCount: 1,
    };
    expect(calculateCredibilityScore(profile)).toBe(calculateCredibilityScore({ ...profile }));
  });
});
