import { describe, it, expect } from "vitest";
import { calculateCredibilityScore } from "@hop/shared";

describe("calculateCredibilityScore", () => {
  it("new users start at 0.75", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 0,
      reportedCount: 0,
    });
    expect(score).toBe(0.75);
  });

  it("perfect score: 100% success, no reports = 1.0", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      reportedCount: 0,
    });
    // 0.7 * (10/10) + 0.3 * (1 - 0*0.1) = 0.7 * 1.0 + 0.3 * 1.0 = 1.0
    expect(score).toBe(1.0);
  });

  it("50% success rate, no reports = 0.65", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 5,
      cancelledTrips: 5,
      reportedCount: 0,
    });
    // 0.7 * (5/10) + 0.3 * (1 - 0*0.1) = 0.7 * 0.5 + 0.3 * 1.0 = 0.35 + 0.3 = 0.65
    expect(score).toBeCloseTo(0.65, 2);
  });

  it("100% success with 1 report = 0.97", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      reportedCount: 1,
    });
    // 0.7 * 1.0 + 0.3 * (1 - 0.1) = 0.7 + 0.3 * 0.9 = 0.7 + 0.27 = 0.97
    expect(score).toBeCloseTo(0.97, 2);
  });

  it("each report reduces score by 10%", () => {
    const noReports = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      reportedCount: 0,
    });
    const with1Report = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      reportedCount: 1,
    });
    const with2Reports = calculateCredibilityScore({
      successfulTrips: 10,
      cancelledTrips: 0,
      reportedCount: 2,
    });

    expect(noReports).toBe(1.0);
    expect(with1Report).toBeCloseTo(0.97, 2); // 0.7 + 0.3*0.9
    expect(with2Reports).toBeCloseTo(0.94, 2); // 0.7 + 0.3*0.8
    expect(with1Report).toBeLessThan(noReports);
    expect(with2Reports).toBeLessThan(with1Report);
  });

  it("multiple reports can reduce below 0.5 but clamped to 0.5", () => {
    const veryBad = calculateCredibilityScore({
      successfulTrips: 1,
      cancelledTrips: 100,
      reportedCount: 20,
    });
    // 0.7 * (1/101) + 0.3 * max(0, 1 - 20*0.1)
    // = 0.7 * 0.0099 + 0.3 * max(0, -1)
    // = 0.00693 + 0.3 * 0
    // = 0.00693 → clamped to 0.5
    expect(veryBad).toBe(0.5);
  });

  it("clamped between 0.5 and 1.0", () => {
    const terrible = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 100,
      reportedCount: 10,
    });
    const excellent = calculateCredibilityScore({
      successfulTrips: 1000,
      cancelledTrips: 0,
      reportedCount: 0,
    });

    expect(terrible).toBeGreaterThanOrEqual(0.5);
    expect(terrible).toBeLessThanOrEqual(1.0);
    expect(excellent).toBeGreaterThanOrEqual(0.5);
    expect(excellent).toBeLessThanOrEqual(1.0);
  });

  it("realistic: 80% success, 2 reports", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 8,
      cancelledTrips: 2,
      reportedCount: 2,
    });
    // 0.7 * (8/10) + 0.3 * (1 - 2*0.1)
    // = 0.7 * 0.8 + 0.3 * 0.8
    // = 0.56 + 0.24 = 0.8
    expect(score).toBeCloseTo(0.8, 2);
  });

  it("scores are consistent across multiple calls", () => {
    const profile = {
      successfulTrips: 5,
      cancelledTrips: 3,
      reportedCount: 1,
    };
    const score1 = calculateCredibilityScore(profile);
    const score2 = calculateCredibilityScore(profile);
    expect(score1).toBe(score2);
  });
});
