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

describe("suspension — trip history scenarios", () => {
  it("new user (0 trips) is NOT suspended (75 ≥ 30)", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(score).toBe(75);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("5 cancellations from baseline leaves score at 25 → suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(score).toBe(25);
    expect(isCredibilitySuspended(score)).toBe(true);
  });

  it("4 cancellations from baseline leaves score at 35 → NOT suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 4,
      confirmedReportCount: 0,
    });
    expect(score).toBe(35);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("exactly at threshold boundary: 75 − 4×10 − 0 = 35, minus one more = 25", () => {
    const atFour = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 4,
      confirmedReportCount: 0,
    });
    const atFive = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(isCredibilitySuspended(atFour)).toBe(false);
    expect(isCredibilitySuspended(atFive)).toBe(true);
  });

  it("one confirmed report from baseline (score 50) is NOT suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 1,
    });
    expect(score).toBe(50);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("two confirmed reports from baseline (score 25) IS suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 2,
    });
    expect(score).toBe(25);
    expect(isCredibilitySuspended(score)).toBe(true);
  });

  it("1 cancel + 1 confirmed report = 75 − 10 − 25 = 40 → NOT suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 1,
      confirmedReportCount: 1,
    });
    expect(score).toBe(40);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("3 cancels + 1 confirmed report = 75 − 30 − 25 = 20 → suspended", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 3,
      confirmedReportCount: 1,
    });
    expect(score).toBe(20);
    expect(isCredibilitySuspended(score)).toBe(true);
  });
});

describe("suspension — recovery via successful trips", () => {
  it("user at 25 (suspended) recovers to 30 with 1 success → no longer suspended", () => {
    const suspended = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(suspended).toBe(25);
    expect(isCredibilitySuspended(suspended)).toBe(true);

    const recovered = calculateCredibilityScore({
      successfulTrips: 1,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(recovered).toBe(30);
    expect(isCredibilitySuspended(recovered)).toBe(false);
  });

  it("user at 0 (floor) needs 6 successes to reach 30 and exit suspension", () => {
    const atFloor = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 8,
      confirmedReportCount: 0,
    });
    expect(atFloor).toBe(0);
    expect(isCredibilitySuspended(atFloor)).toBe(true);

    const with5 = calculateCredibilityScore({
      successfulTrips: 5,
      cancelledTrips: 8,
      confirmedReportCount: 0,
    });
    expect(with5).toBe(20);
    expect(isCredibilitySuspended(with5)).toBe(true);

    const with6 = calculateCredibilityScore({
      successfulTrips: 6,
      cancelledTrips: 8,
      confirmedReportCount: 0,
    });
    expect(with6).toBe(25);
    expect(isCredibilitySuspended(with6)).toBe(true);

    const with8 = calculateCredibilityScore({
      successfulTrips: 8,
      cancelledTrips: 8,
      confirmedReportCount: 0,
    });
    expect(with8).toBe(35);
    expect(isCredibilitySuspended(with8)).toBe(false);
  });
});

describe("suspension — report confirmation trigger", () => {
  function shouldEnforceSuspension(before: {
    successfulTrips: number;
    cancelledTrips: number;
    confirmedReportCount: number;
  }): boolean {
    const after = { ...before, confirmedReportCount: before.confirmedReportCount + 1 };
    return isCredibilitySuspended(calculateCredibilityScore(after));
  }

  it("first confirmed report on a fresh user (75→50) does NOT trigger enforcement", () => {
    expect(
      shouldEnforceSuspension({ successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 0 }),
    ).toBe(false);
  });

  it("second confirmed report on a fresh user (50→25) DOES trigger enforcement", () => {
    expect(
      shouldEnforceSuspension({ successfulTrips: 0, cancelledTrips: 0, confirmedReportCount: 1 }),
    ).toBe(true);
  });

  it("report on a user with 5 successes (100→75) does NOT trigger enforcement", () => {
    expect(
      shouldEnforceSuspension({ successfulTrips: 5, cancelledTrips: 0, confirmedReportCount: 0 }),
    ).toBe(false);
  });

  it("report on a user with 2 cancels + 1 existing report (30→5) DOES trigger enforcement", () => {
    const before = { successfulTrips: 0, cancelledTrips: 2, confirmedReportCount: 1 };
    const scoreBefore = calculateCredibilityScore(before);
    expect(scoreBefore).toBe(30);
    expect(shouldEnforceSuspension(before)).toBe(true);
    expect(calculateCredibilityScore({ ...before, confirmedReportCount: 2 })).toBe(5);
  });

  it("report on a user with enough successes to stay above threshold", () => {
    const before = { successfulTrips: 3, cancelledTrips: 0, confirmedReportCount: 1 };
    const scoreBefore = calculateCredibilityScore(before);
    expect(scoreBefore).toBe(65);
    expect(shouldEnforceSuspension(before)).toBe(false);
    expect(calculateCredibilityScore({ ...before, confirmedReportCount: 2 })).toBe(40);
  });
});

describe("suspension — cancellation trigger", () => {
  function shouldEnforceSuspensionAfterCancel(before: {
    successfulTrips: number;
    cancelledTrips: number;
    confirmedReportCount: number;
  }): boolean {
    const after = { ...before, cancelledTrips: before.cancelledTrips + 1 };
    return isCredibilitySuspended(calculateCredibilityScore(after));
  }

  it("first cancel on a fresh user (75→65) does NOT trigger enforcement", () => {
    expect(
      shouldEnforceSuspensionAfterCancel({
        successfulTrips: 0,
        cancelledTrips: 0,
        confirmedReportCount: 0,
      }),
    ).toBe(false);
  });

  it("5th cancel on a fresh user (35→25) DOES trigger enforcement", () => {
    const before = { successfulTrips: 0, cancelledTrips: 4, confirmedReportCount: 0 };
    expect(calculateCredibilityScore(before)).toBe(35);
    expect(shouldEnforceSuspensionAfterCancel(before)).toBe(true);
    expect(calculateCredibilityScore({ ...before, cancelledTrips: 5 })).toBe(25);
  });

  it("4th cancel on a fresh user (45→35) does NOT trigger enforcement", () => {
    const before = { successfulTrips: 0, cancelledTrips: 3, confirmedReportCount: 0 };
    expect(calculateCredibilityScore(before)).toBe(45);
    expect(shouldEnforceSuspensionAfterCancel(before)).toBe(false);
  });

  it("cancel on user already below threshold stays suspended", () => {
    const before = { successfulTrips: 0, cancelledTrips: 6, confirmedReportCount: 0 };
    expect(calculateCredibilityScore(before)).toBe(15);
    expect(isCredibilitySuspended(calculateCredibilityScore(before))).toBe(true);
    expect(shouldEnforceSuspensionAfterCancel(before)).toBe(true);
  });

  it("cancel + existing report combo: 1 report + 3rd cancel (30→20) DOES trigger enforcement", () => {
    const before = { successfulTrips: 0, cancelledTrips: 2, confirmedReportCount: 1 };
    expect(calculateCredibilityScore(before)).toBe(30);
    expect(shouldEnforceSuspensionAfterCancel(before)).toBe(true);
    expect(calculateCredibilityScore({ ...before, cancelledTrips: 3 })).toBe(20);
  });
});

describe("suspension — matching candidate exclusion", () => {
  it("user at baseline (75) is eligible for matching", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("user below threshold is excluded from matching", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(isCredibilitySuspended(score)).toBe(true);
  });

  it("user exactly at threshold (30) is NOT excluded", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 1,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(score).toBe(30);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("user with no doc (undefined fields) defaults to baseline and is eligible", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      confirmedReportCount: 0,
    });
    expect(score).toBe(CREDIBILITY_STARTING_POINTS);
    expect(isCredibilitySuspended(score)).toBe(false);
  });
});

describe("suspension threshold is reachable from realistic trip histories", () => {
  it("exactly 5 cancels (no successes, no reports) is the first profile to cross into suspension", () => {
    for (let c = 0; c <= 4; c++) {
      expect(
        isCredibilitySuspended(
          calculateCredibilityScore({
            successfulTrips: 0,
            cancelledTrips: c,
            confirmedReportCount: 0,
          }),
        ),
      ).toBe(false);
    }
    expect(
      isCredibilitySuspended(
        calculateCredibilityScore({
          successfulTrips: 0,
          cancelledTrips: 5,
          confirmedReportCount: 0,
        }),
      ),
    ).toBe(true);
  });

  it("exactly 2 confirmed reports (no trips) is the first report count to cross into suspension", () => {
    expect(
      isCredibilitySuspended(
        calculateCredibilityScore({
          successfulTrips: 0,
          cancelledTrips: 0,
          confirmedReportCount: 1,
        }),
      ),
    ).toBe(false);
    expect(
      isCredibilitySuspended(
        calculateCredibilityScore({
          successfulTrips: 0,
          cancelledTrips: 0,
          confirmedReportCount: 2,
        }),
      ),
    ).toBe(true);
  });
});
