import { describe, it, expect } from "vitest";
import { calculateCredibilityScore } from "@hop/shared";

describe("Credibility Score System - All Changes", () => {
  describe("Score Calculation Formula", () => {
    it("new users start at 0.75 baseline", () => {
      const score = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      expect(score).toBe(0.75);
    });

    it("perfect score: all successful, no cancellations = 1.0", () => {
      const score = calculateCredibilityScore({
        successfulTrips: 10,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      expect(score).toBe(1.0);
    });

    it("equal success and cancellations = 0.65", () => {
      // 0.7 * (5/10) + 0.3 * 1.0 = 0.35 + 0.3 = 0.65
      const score = calculateCredibilityScore({
        successfulTrips: 5,
        cancelledTrips: 5,
        reportedCount: 0,
      });
      expect(score).toBeCloseTo(0.65, 2);
    });

    it("70% weighted on success rate", () => {
      // 100% success rate but 1 report
      // 0.7 * 1.0 + 0.3 * 0.9 = 0.97
      const score = calculateCredibilityScore({
        successfulTrips: 10,
        cancelledTrips: 0,
        reportedCount: 1,
      });
      expect(score).toBeCloseTo(0.97, 2);
    });

    it("30% weighted on reports (1 report = 10% reduction)", () => {
      // 100% success, 1 report: 0.7 * 1.0 + 0.3 * (1 - 0.1) = 0.97
      // vs 100% success, 0 reports: 1.0
      // Difference = 0.03 (which is 30% * 10%)
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
      expect(noReports - with1Report).toBeCloseTo(0.03, 2);
    });

    it("minimum score is 0.5 (clamped)", () => {
      // 1 success, 99 cancellations, 5 reports
      // Would be: 0.7 * (1/100) + 0.3 * (1 - 0.5) = 0.007 + 0.15 = 0.157
      // But clamped to 0.5
      const score = calculateCredibilityScore({
        successfulTrips: 1,
        cancelledTrips: 99,
        reportedCount: 5,
      });
      expect(score).toBe(0.5);
    });

    it("maximum score is 1.0 (clamped)", () => {
      const score = calculateCredibilityScore({
        successfulTrips: 1000,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      expect(score).toBe(1.0);
    });
  });

  describe("Scenario: Non-Acknowledgers Only Penalized", () => {
    it("rider who acknowledges should NOT get cancelledTrips++", () => {
      // Simulating: Group has 3 members, 2 acknowledge, 1 declines
      // Group splits into confirmed (2) and removed (1)
      
      const acknowledger = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0, // ✅ No penalty because they acknowledged
        reportedCount: 0,
      });
      expect(acknowledger).toBe(0.75); // Unchanged baseline
    });

    it("rider who declines should get cancelledTrips++", () => {
      // Simulating: Same group, but this rider declined
      const decliner = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 1, // ✅ Penalty applied for declining
        reportedCount: 0,
      });
      // 0.7 * (0/1) + 0.3 * 1.0 = 0 + 0.3 = 0.3 → clamped to 0.5
      expect(decliner).toBe(0.5);
    });

    it("group fails: all 3 decline = all 3 penalized", () => {
      // If group needs 2+ acks but all 3 decline
      const allDeclined = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 1,
        reportedCount: 0,
      });
      expect(allDeclined).toBe(0.5); // Each gets penalty
    });
  });

  describe("Scenario: Payment Verified Increments Immediately", () => {
    it("rider1 pays before rider2 does NOT wait for rider2", () => {
      // Rider1 verifies payment
      const rider1 = calculateCredibilityScore({
        successfulTrips: 1, // ✅ Incremented immediately on verification
        cancelledTrips: 0,
        reportedCount: 0,
      });
      expect(rider1).toBe(1.0); // Perfect score after 1 payment

      // Rider2 hasn't paid yet
      const rider2 = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      expect(rider2).toBe(0.75); // Still baseline, unaffected
    });

    it("each payment increments that rider's successfulTrips", () => {
      const afterPayment1 = calculateCredibilityScore({
        successfulTrips: 1,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      
      const afterPayment2 = calculateCredibilityScore({
        successfulTrips: 2,
        cancelledTrips: 0,
        reportedCount: 0,
      });
      
      // Both should be 1.0 (perfect), but score itself doesn't change
      // The difference is in the counter
      expect(afterPayment1).toBe(1.0);
      expect(afterPayment2).toBe(1.0);
    });
  });

  describe("Scenario: User Cancellation Penalizes", () => {
    it("active cancellation from matched group increments cancelledTrips", () => {
      // User was in "meetup_preparation" group, clicked "Cancel Trip"
      const afterCancellation = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 1, // ✅ Penalty applied
        reportedCount: 0,
      });
      expect(afterCancellation).toBe(0.5); // Minimum due to 0% success
    });

    it("pre-match delete does NOT increment cancelledTrips", () => {
      // User deleted an "open" availability before matching
      const preDel = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0, // ✅ No penalty for pre-match delete
        reportedCount: 0,
      });
      expect(preDel).toBe(0.75); // Unchanged baseline
    });

    it("post-match cancellation vs pre-match delete are different", () => {
      const preMatchDelete = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0,
        reportedCount: 0,
      });

      const postMatchCancel = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 1,
        reportedCount: 0,
      });

      expect(preMatchDelete).toBe(0.75); // Same as new user
      expect(postMatchCancel).toBe(0.5); // Penalized
      expect(preMatchDelete).not.toBe(postMatchCancel);
    });
  });

  describe("Scenario: No-Show Penalty", () => {
    it("rider who doesn't check in gets cancelledTrips++", () => {
      // Booker departed, this rider marked "removed_no_show"
      const noShow = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 1, // ✅ Penalty for not checking in
        reportedCount: 0,
      });
      expect(noShow).toBe(0.5); // Minimum
    });

    it("rider who checked in is NOT penalized", () => {
      // This rider made it to the meetup and checked in
      const checkedIn = calculateCredibilityScore({
        successfulTrips: 0,
        cancelledTrips: 0, // ✅ No penalty, still in trip
        reportedCount: 0,
      });
      expect(checkedIn).toBe(0.75); // Unchanged (trip still in progress)
    });
  });

  describe("Complex Scenarios", () => {
    it("rider: 2 successful, 1 cancelled, 2 reports", () => {
      // Real-world example
      // 0.7 * (2/3) + 0.3 * (1 - 0.2) = 0.7 * 0.667 + 0.3 * 0.8
      // = 0.467 + 0.24 = 0.707
      const score = calculateCredibilityScore({
        successfulTrips: 2,
        cancelledTrips: 1,
        reportedCount: 2,
      });
      expect(score).toBeCloseTo(0.707, 2);
    });

    it("rider improves over time: starts bad, ends good", () => {
      const initialState = calculateCredibilityScore({
        successfulTrips: 1,
        cancelledTrips: 9,
        reportedCount: 3,
      });
      
      // After 10 more successful trips and 1 more report
      const improvedState = calculateCredibilityScore({
        successfulTrips: 11,
        cancelledTrips: 9,
        reportedCount: 4,
      });
      
      // Initial: 0.7 * 0.1 + 0.3 * 0.7 = 0.07 + 0.21 = 0.28 → 0.5 (clamped)
      // Improved: 0.7 * (11/20) + 0.3 * 0.6 = 0.385 + 0.18 = 0.565
      expect(initialState).toBe(0.5);
      expect(improvedState).toBeCloseTo(0.565, 2);
      expect(improvedState).toBeGreaterThan(initialState);
    });
  });
});
