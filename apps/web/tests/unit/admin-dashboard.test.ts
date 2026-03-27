import { afterEach, describe, expect, test } from "vitest";
import {
  buildAdminCredibilitySnapshot,
  buildAdminInsightPatch,
  buildAdminPersonLabel,
  getAdminSummaryRefreshKey,
  getCredibilityScoreLabel,
  isAdminInsightStale,
  isUnresolvedReviewStatus,
  normalizeReportReviewStatus,
  shouldAutoRefreshAdminSummary,
  sortAdminReports,
} from "../../lib/admin-dashboard";

describe("admin dashboard helpers", () => {
  afterEach(() => {
    process.env.OPENAI_ADMIN_SUMMARY_TTL_MINUTES = undefined;
  });

  test("sorts unresolved reports ahead of resolved ones, then by severity and recency", () => {
    const sorted = sortAdminReports([
      {
        reviewStatus: "resolved" as const,
        severityScore: 98,
        severityBand: "critical" as const,
        createdAt: "2026-03-27T08:30:00.000Z",
        label: "resolved-critical",
      },
      {
        reviewStatus: "open" as const,
        severityScore: 74,
        severityBand: "high" as const,
        createdAt: "2026-03-27T09:30:00.000Z",
        label: "open-high-newer",
      },
      {
        reviewStatus: "open" as const,
        severityScore: 74,
        severityBand: "high" as const,
        createdAt: "2026-03-27T08:00:00.000Z",
        label: "open-high-older",
      },
      {
        reviewStatus: "in_review" as const,
        severityScore: 12,
        severityBand: "low" as const,
        createdAt: "2026-03-27T10:00:00.000Z",
        label: "in-review-low",
      },
    ]);

    expect(sorted.map((report) => report.label)).toEqual([
      "open-high-newer",
      "open-high-older",
      "in-review-low",
      "resolved-critical",
    ]);
  });

  test("maps legacy review statuses onto the current moderation workflow", () => {
    expect(normalizeReportReviewStatus("confirmed")).toBe("resolved");
    expect(normalizeReportReviewStatus("pending")).toBe("open");
    expect(isUnresolvedReviewStatus(normalizeReportReviewStatus("confirmed"))).toBe(false);
    expect(isUnresolvedReviewStatus(normalizeReportReviewStatus("pending"))).toBe(true);
  });

  test("builds display labels from name, then email, then a safe fallback suffix", () => {
    expect(
      buildAdminPersonLabel({
        id: "user_123456",
        name: "Ada Lovelace",
        email: "ada@u.nus.edu",
      }),
    ).toBe("Ada Lovelace");

    expect(
      buildAdminPersonLabel({
        id: "user_123456",
        name: "   ",
        email: "ops@u.nus.edu",
      }),
    ).toBe("ops@u.nus.edu");

    expect(
      buildAdminPersonLabel({
        id: "user_abcdef",
        name: null,
        email: null,
      }),
    ).toBe("Hop member abcdef");
  });

  test("builds credibility snapshots from rider history and labels the score", () => {
    expect(
      buildAdminCredibilitySnapshot({
        successfulTrips: 2,
        cancelledTrips: 1,
        confirmedReportCount: 1,
      }),
    ).toEqual({
      score: 50,
      suspended: false,
      successfulTrips: 2,
      cancelledTrips: 1,
      confirmedReportCount: 1,
    });

    expect(buildAdminCredibilitySnapshot(undefined)).toBeNull();
    expect(getCredibilityScoreLabel(54)).toBe("Low");
    expect(getCredibilityScoreLabel(60)).toBe("Fair");
    expect(getCredibilityScoreLabel(84)).toBe("Good");
    expect(getCredibilityScoreLabel(95)).toBe("Excellent");
  });

  test("treats missing or expired summaries as stale", () => {
    process.env.OPENAI_ADMIN_SUMMARY_TTL_MINUTES = "15";

    expect(isAdminInsightStale(null, undefined, Date.parse("2026-03-27T10:00:00.000Z"))).toBe(true);

    expect(
      isAdminInsightStale(
        "2026-03-27T09:50:00.000Z",
        undefined,
        Date.parse("2026-03-27T10:00:00.000Z"),
      ),
    ).toBe(false);

    expect(
      isAdminInsightStale(
        "2026-03-27T09:30:00.000Z",
        undefined,
        Date.parse("2026-03-27T10:00:00.000Z"),
      ),
    ).toBe(true);
  });

  test("preserves cached summary fields when recording a refresh failure", () => {
    expect(buildAdminInsightPatch({ status: "failed", error: "OpenAI timed out." })).toEqual({
      status: "failed",
      error: "OpenAI timed out.",
    });

    expect(
      buildAdminInsightPatch({
        status: "ready",
        summaryHeadline: "Queue stable",
        summaryBody: "No new high-risk reports.",
        recommendedFocus: ["Clear the oldest payment dispute."],
        generatedAt: "2026-03-27T10:00:00.000Z",
        model: "gpt-4.1-mini",
        requestId: "resp_123",
        error: undefined,
      }),
    ).toEqual({
      status: "ready",
      summaryHeadline: "Queue stable",
      summaryBody: "No new high-risk reports.",
      recommendedFocus: ["Clear the oldest payment dispute."],
      generatedAt: "2026-03-27T10:00:00.000Z",
      model: "gpt-4.1-mini",
      requestId: "resp_123",
      error: undefined,
    });
  });

  test("auto-refreshes idle, stale, and failed summaries only once per cached snapshot", () => {
    expect(
      shouldAutoRefreshAdminSummary({
        aiEnabled: true,
        status: "idle",
        isStale: true,
      }),
    ).toBe(true);

    expect(
      shouldAutoRefreshAdminSummary({
        aiEnabled: true,
        status: "ready",
        isStale: true,
      }),
    ).toBe(true);

    expect(
      shouldAutoRefreshAdminSummary({
        aiEnabled: true,
        status: "failed",
        isStale: true,
      }),
    ).toBe(true);

    expect(
      shouldAutoRefreshAdminSummary({
        aiEnabled: true,
        status: "pending",
        isStale: true,
      }),
    ).toBe(false);

    expect(
      shouldAutoRefreshAdminSummary({
        aiEnabled: false,
        status: "failed",
        isStale: true,
      }),
    ).toBe(false);

    expect(
      getAdminSummaryRefreshKey({
        generatedAt: "2026-03-27T10:00:00.000Z",
        requestId: "resp_123",
      }),
    ).toBe("2026-03-27T10:00:00.000Z:resp_123");
  });
});
