import { calculateCredibilityScore, isCredibilitySuspended } from "@hop/shared";

export const REPORT_REVIEW_STATUSES = ["open", "in_review", "resolved", "dismissed"] as const;

export const REPORT_AI_STATUSES = ["pending", "ready", "failed"] as const;

export const REPORT_SEVERITY_BANDS = ["low", "medium", "high", "critical"] as const;

export const ADMIN_INSIGHT_KEY = "dashboard_overview";
export const ADMIN_INSIGHT_STATUSES = ["pending", "ready", "failed"] as const;

export type ReportReviewStatus = (typeof REPORT_REVIEW_STATUSES)[number];
export type ReportAiStatus = (typeof REPORT_AI_STATUSES)[number];
export type ReportSeverityBand = (typeof REPORT_SEVERITY_BANDS)[number];
export type AdminInsightStatus = (typeof ADMIN_INSIGHT_STATUSES)[number];
export type AdminCredibilitySnapshot = {
  score: number;
  suspended: boolean;
  successfulTrips: number;
  cancelledTrips: number;
  confirmedReportCount: number;
};

export const REPORT_CATEGORY_LABELS = {
  no_show: "No-show",
  non_payment: "Non-payment",
  unsafe_behavior: "Unsafe behaviour",
  harassment: "Harassment",
  misconduct: "Misconduct",
  other: "Other",
} as const;

type AdminPersonLike = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type CredibilityLike = {
  successfulTrips?: number | null;
  cancelledTrips?: number | null;
  confirmedReportCount?: number | null;
};

type SortableReport = {
  reviewStatus: ReportReviewStatus;
  severityScore: number | null;
  severityBand: ReportSeverityBand | null;
  createdAt: string;
};

export function getReportCategoryLabel(category: keyof typeof REPORT_CATEGORY_LABELS | string) {
  return REPORT_CATEGORY_LABELS[category as keyof typeof REPORT_CATEGORY_LABELS] ?? "Other";
}

export function buildAdminCredibilitySnapshot(
  user: CredibilityLike | null | undefined,
): AdminCredibilitySnapshot | null {
  if (!user) {
    return null;
  }

  const successfulTrips = user.successfulTrips ?? 0;
  const cancelledTrips = user.cancelledTrips ?? 0;
  const confirmedReportCount = user.confirmedReportCount ?? 0;
  const score = calculateCredibilityScore({
    successfulTrips,
    cancelledTrips,
    confirmedReportCount,
  });

  return {
    score,
    suspended: isCredibilitySuspended(score),
    successfulTrips,
    cancelledTrips,
    confirmedReportCount,
  };
}

export function isLowCredibilityScore(score: number) {
  return score < 50;
}

export function getCredibilityScoreLabel(score: number) {
  if (score < 55) return "Low";
  if (score < 75) return "Fair";
  if (score < 90) return "Good";
  return "Excellent";
}

export function normalizeReportReviewStatus(value: unknown): ReportReviewStatus {
  if (value === "pending") {
    return "open";
  }

  if (value === "confirmed") {
    return "resolved";
  }

  return REPORT_REVIEW_STATUSES.includes(value as ReportReviewStatus)
    ? (value as ReportReviewStatus)
    : "open";
}

export function normalizeReportAiStatus(value: unknown): ReportAiStatus {
  return REPORT_AI_STATUSES.includes(value as ReportAiStatus)
    ? (value as ReportAiStatus)
    : "failed";
}

export function normalizeReportSeverityBand(value: unknown): ReportSeverityBand | null {
  return REPORT_SEVERITY_BANDS.includes(value as ReportSeverityBand)
    ? (value as ReportSeverityBand)
    : null;
}

export function clampSeverityScore(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function inferSeverityBandFromScore(score: number): ReportSeverityBand {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function isUnresolvedReviewStatus(status: ReportReviewStatus) {
  return status === "open" || status === "in_review";
}

export function getReviewStatusSortRank(status: ReportReviewStatus) {
  switch (status) {
    case "open":
      return 0;
    case "in_review":
      return 1;
    case "resolved":
      return 2;
    case "dismissed":
      return 3;
  }
}

export function getSeverityBandSortRank(band: ReportSeverityBand | null) {
  switch (band) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

export function sortAdminReports<T extends SortableReport>(reports: T[]) {
  return [...reports].sort((left, right) => {
    const reviewRank =
      getReviewStatusSortRank(left.reviewStatus) - getReviewStatusSortRank(right.reviewStatus);
    if (reviewRank !== 0) {
      return reviewRank;
    }

    const leftScore = left.severityScore ?? -1;
    const rightScore = right.severityScore ?? -1;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    const severityRank =
      getSeverityBandSortRank(left.severityBand) - getSeverityBandSortRank(right.severityBand);
    if (severityRank !== 0) {
      return severityRank;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export function buildAdminPersonLabel(person: AdminPersonLike, fallback = "Hop member") {
  const name = person.name?.trim();
  if (name) {
    return name;
  }

  const email = person.email?.trim();
  if (email) {
    return email;
  }

  return `${fallback} ${person.id.slice(-6)}`;
}

export function truncateAdminSummaryText(value: string, maxLength = 160) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function getAdminSummaryTtlMs(raw = process.env.OPENAI_ADMIN_SUMMARY_TTL_MINUTES) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15 * 60_000;
  }

  return parsed * 60_000;
}

export function isAdminInsightStale(
  generatedAt: string | null | undefined,
  ttlMs = getAdminSummaryTtlMs(),
  now = Date.now(),
) {
  if (!generatedAt) {
    return true;
  }

  const generatedAtMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedAtMs)) {
    return true;
  }

  return generatedAtMs + ttlMs <= now;
}
