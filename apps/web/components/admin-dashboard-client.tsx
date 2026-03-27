"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  REPORT_AI_STATUSES,
  REPORT_CATEGORY_LABELS,
  REPORT_REVIEW_STATUSES,
  REPORT_SEVERITY_BANDS,
  isUnresolvedReviewStatus,
} from "../lib/admin-dashboard";

type NoticeState = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

type DashboardActor = {
  userId: string;
  label: string;
  name: string | null;
  email: string | null;
};

type DashboardReport = {
  _id: string;
  category: keyof typeof REPORT_CATEGORY_LABELS | string;
  categoryLabel: string;
  description: string;
  createdAt: string;
  reviewStatus: (typeof REPORT_REVIEW_STATUSES)[number];
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: DashboardActor | null;
  aiStatus: (typeof REPORT_AI_STATUSES)[number];
  severityScore: number | null;
  severityBand: ((typeof REPORT_SEVERITY_BANDS)[number] & string) | null;
  aiRationale: string | null;
  aiRecommendedAction: string | null;
  aiScoredAt: string | null;
  aiError: string | null;
  reporter: DashboardActor;
  reportedUser: DashboardActor | null;
  group: {
    id: string;
    label: string;
    status: string | null;
    reportCount: number;
  };
};

type DashboardAuditEvent = {
  _id: string;
  action: string;
  createdAt: string;
  actorId: string;
  actorLabel: string;
  actorEmail: string | null;
};

type DashboardSummary = {
  status: "idle" | "pending" | "ready" | "failed";
  headline: string | null;
  body: string | null;
  recommendedFocus: string[];
  generatedAt: string | null;
  model: string | null;
  requestId: string | null;
  error: string | null;
  isStale: boolean;
  aiEnabled: boolean;
};

type DashboardData = {
  users: number;
  openAvailabilities: number;
  tentativeGroups: number;
  revealedGroups: number;
  totalReports: number;
  unresolvedReports: number;
  criticalOpenReports: number;
  summary: DashboardSummary;
  reports: DashboardReport[];
  auditEvents: DashboardAuditEvent[];
};

const reviewStatusOptions = [
  { value: "all", label: "All statuses" },
  ...REPORT_REVIEW_STATUSES.map((status) => ({
    value: status,
    label: status === "in_review" ? "In review" : status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

const severityOptions = [
  { value: "all", label: "All severities" },
  ...REPORT_SEVERITY_BANDS.map((band) => ({
    value: band,
    label: band.charAt(0).toUpperCase() + band.slice(1),
  })),
];

const categoryOptions = [
  { value: "all", label: "All categories" },
  ...Object.entries(REPORT_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

const aiStatusOptions = [
  { value: "all", label: "All AI states" },
  ...REPORT_AI_STATUSES.map((status) => ({
    value: status,
    label: status === "ready" ? "Ready" : status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not available";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function getSeverityLabel(report: DashboardReport) {
  if (report.aiStatus === "pending") {
    return "Scoring…";
  }

  if (report.aiStatus === "failed") {
    return "AI unavailable";
  }

  if (report.severityScore === null || !report.severityBand) {
    return "Severity unavailable";
  }

  return `${report.severityScore} · ${report.severityBand}`;
}

function getSummaryStatusLabel(summary: DashboardSummary) {
  switch (summary.status) {
    case "idle":
      return "Not generated";
    case "pending":
      return "Refreshing";
    case "ready":
      return summary.isStale ? "Ready · stale" : "Ready";
    case "failed":
      return "Refresh failed";
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

export function AdminDashboardClient() {
  const dashboard = useQuery(api.admin.adminDashboard) as DashboardData | undefined;
  const refreshDashboardSummary = useMutation(api.admin.refreshDashboardSummary);
  const startReportReview = useMutation(api.admin.startReportReview);
  const resolveReport = useMutation(api.admin.resolveReport);
  const dismissReport = useMutation(api.admin.dismissReport);

  const [reviewFilter, setReviewFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [aiStatusFilter, setAiStatusFilter] = useState("all");
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>(null);
  const [busyAction, setBusyAction] = useState<{
    reportId: string;
    action: "start" | "resolve" | "dismiss";
  } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const autoRefreshRequested = useRef(false);
  const summary =
    dashboard?.summary ??
    ({
      status: "idle",
      headline: null,
      body: null,
      recommendedFocus: [],
      generatedAt: null,
      model: null,
      requestId: null,
      error: null,
      isStale: true,
      aiEnabled: false,
    } satisfies DashboardSummary);

  useEffect(() => {
    if (!dashboard?.summary.aiEnabled) {
      return;
    }

    if (dashboard.summary.status !== "idle" || autoRefreshRequested.current) {
      return;
    }

    autoRefreshRequested.current = true;
    void refreshDashboardSummary({ force: false }).catch(() => undefined);
  }, [dashboard?.summary.aiEnabled, dashboard?.summary.status, refreshDashboardSummary]);

  const reports = dashboard?.reports ?? [];
  const filteredReports = reports.filter((report) => {
    if (reviewFilter !== "all" && report.reviewStatus !== reviewFilter) {
      return false;
    }

    if (severityFilter !== "all" && report.severityBand !== severityFilter) {
      return false;
    }

    if (categoryFilter !== "all" && report.category !== categoryFilter) {
      return false;
    }

    if (aiStatusFilter !== "all" && report.aiStatus !== aiStatusFilter) {
      return false;
    }

    return true;
  });

  function getDraftNote(report: DashboardReport) {
    return draftNotes[report._id] ?? report.reviewNote ?? "";
  }

  async function handleSummaryRefresh(force: boolean) {
    setSummaryBusy(true);
    setNotice(null);

    try {
      const result = await refreshDashboardSummary({ force });
      if (result.scheduled) {
        setNotice({ tone: "success", text: "AI dashboard summary refresh queued." });
      } else if (result.status === "pending") {
        setNotice({ tone: "info", text: "AI dashboard summary is already refreshing." });
      } else {
        setNotice({ tone: "info", text: "AI dashboard summary is already up to date." });
      }
    } catch (error) {
      setNotice({ tone: "error", text: toErrorMessage(error) });
    } finally {
      setSummaryBusy(false);
    }
  }

  async function handleReportAction(
    action: "start" | "resolve" | "dismiss",
    report: DashboardReport,
  ) {
    setBusyAction({ reportId: report._id, action });
    setNotice(null);

    try {
      if (action === "start") {
        await startReportReview({
          reportId: report._id as Id<"reports">,
        });
        setNotice({ tone: "success", text: "Report moved into review." });
      }

      if (action === "resolve") {
        await resolveReport({
          reportId: report._id as Id<"reports">,
          note: getDraftNote(report).trim() || undefined,
        });
        setDraftNotes((current) => ({ ...current, [report._id]: "" }));
        setNotice({ tone: "success", text: "Report resolved." });
      }

      if (action === "dismiss") {
        await dismissReport({
          reportId: report._id as Id<"reports">,
          note: getDraftNote(report).trim() || undefined,
        });
        setDraftNotes((current) => ({ ...current, [report._id]: "" }));
        setNotice({ tone: "success", text: "Report dismissed." });
      }
    } catch (error) {
      setNotice({ tone: "error", text: toErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="admin-dash">
      <header className="admin-dash-header">
        <div className="row" style={{ gap: 8 }}>
          <div
            className="hop-logo"
            style={{ width: 26, height: 26, fontSize: 12, borderRadius: 7 }}
          >
            H
          </div>
          <span className="pill pill-accent pill-dot" style={{ fontSize: 11 }}>
            Admin
          </span>
        </div>
        <Link href="/admin/simulator" className="btn btn-primary btn-sm">
          Open simulator →
        </Link>
      </header>

      {notice ? (
        <div
          className={`notice ${
            notice.tone === "error"
              ? "notice-error"
              : notice.tone === "success"
                ? "notice-success"
                : "notice-info"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="admin-kpi-strip">
        <div className="admin-kpi">
          <span className="admin-kpi-n">{dashboard?.users ?? "—"}</span>
          <span className="admin-kpi-l">Riders</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n text-accent">{dashboard?.openAvailabilities ?? "—"}</span>
          <span className="admin-kpi-l">Open pool</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n">{dashboard?.tentativeGroups ?? "—"}</span>
          <span className="admin-kpi-l">Tentative</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n text-success">{dashboard?.revealedGroups ?? "—"}</span>
          <span className="admin-kpi-l">Revealed</span>
        </div>
      </div>

      <section className="admin-summary-card">
        <div className="admin-summary-head">
          <div className="stack-sm">
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <h2 className="admin-summary-title">AI overview</h2>
              <span className="pill pill-muted">{getSummaryStatusLabel(summary)}</span>
            </div>
            <p className="admin-summary-copy">
              {summary.aiEnabled
                ? (summary.headline ??
                  "A cached AI dashboard summary will appear here once generated.")
                : "Set OPENAI_API_KEY in the Convex environment to enable AI report scoring and the dashboard summary."}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSummaryRefresh(true)}
            disabled={summaryBusy || !summary.aiEnabled}
          >
            {summaryBusy || summary.status === "pending" ? "Refreshing…" : "Refresh summary"}
          </button>
        </div>

        <div className="admin-summary-stats">
          <div className="admin-summary-stat">
            <span className="admin-summary-stat-v">{dashboard?.totalReports ?? 0}</span>
            <span className="admin-summary-stat-k">Total reports</span>
          </div>
          <div className="admin-summary-stat">
            <span className="admin-summary-stat-v">{dashboard?.unresolvedReports ?? 0}</span>
            <span className="admin-summary-stat-k">Unresolved</span>
          </div>
          <div className="admin-summary-stat">
            <span className="admin-summary-stat-v">{dashboard?.criticalOpenReports ?? 0}</span>
            <span className="admin-summary-stat-k">Critical open</span>
          </div>
          <div className="admin-summary-stat">
            <span className="admin-summary-stat-v">
              {summary.generatedAt ? formatTimestamp(summary.generatedAt) : "—"}
            </span>
            <span className="admin-summary-stat-k">Last generated</span>
          </div>
        </div>

        <div className="admin-summary-body">
          <div className="admin-summary-panel">
            <h3 className="admin-col-title">Summary</h3>
            <p className="admin-summary-paragraph">
              {summary.body ??
                "The AI overview will summarize queue pressure, urgent report patterns, and recent operator activity once it runs."}
            </p>
            {summary.error ? <p className="text-sm text-danger">{summary.error}</p> : null}
          </div>

          <div className="admin-summary-panel">
            <h3 className="admin-col-title">Recommended focus</h3>
            {summary.recommendedFocus.length ? (
              <ul className="admin-focus-list">
                {summary.recommendedFocus.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted text-sm">
                No AI follow-up points yet. Use the live queue below while the summary refreshes.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="admin-shell-grid">
        <section className="admin-col admin-report-panel">
          <div className="admin-panel-head">
            <div className="stack-sm">
              <h3 className="admin-col-title">Report queue</h3>
              <p className="text-sm text-muted">
                Showing {filteredReports.length} of {reports.length} reports.
              </p>
            </div>
            <div className="admin-filters">
              <label className="admin-filter">
                <span>Status</span>
                <select
                  value={reviewFilter}
                  onChange={(event) => setReviewFilter(event.target.value)}
                >
                  {reviewStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-filter">
                <span>Severity</span>
                <select
                  value={severityFilter}
                  onChange={(event) => setSeverityFilter(event.target.value)}
                >
                  {severityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-filter">
                <span>Category</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-filter">
                <span>AI</span>
                <select
                  value={aiStatusFilter}
                  onChange={(event) => setAiStatusFilter(event.target.value)}
                >
                  {aiStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="admin-report-list">
            {dashboard === undefined ? (
              <div className="admin-empty-state">Loading report queue…</div>
            ) : filteredReports.length ? (
              filteredReports.map((report) => {
                const busy = busyAction?.reportId === report._id;
                const unresolved = isUnresolvedReviewStatus(report.reviewStatus);

                return (
                  <article
                    className="admin-report-card"
                    data-review-status={report.reviewStatus}
                    data-severity-band={report.severityBand ?? "none"}
                    key={report._id}
                  >
                    <div className="admin-report-head">
                      <div className="stack-sm">
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span className="pill pill-muted">{report.categoryLabel}</span>
                          <span className="pill pill-accent">
                            {report.reviewStatus.replace("_", " ")}
                          </span>
                          <span className="pill pill-privacy">{getSeverityLabel(report)}</span>
                        </div>
                        <h4 className="admin-report-title">
                          {report.reportedUser
                            ? `${report.reportedUser.label} reported by ${report.reporter.label}`
                            : `Situation report from ${report.reporter.label}`}
                        </h4>
                      </div>
                      <span className="admin-report-time">{formatTimestamp(report.createdAt)}</span>
                    </div>

                    <div className="admin-report-meta">
                      <div className="admin-meta-block">
                        <span className="admin-meta-k">Reporter</span>
                        <span className="admin-meta-v">{report.reporter.label}</span>
                        <span className="admin-meta-sub">
                          {report.reporter.email ?? report.reporter.userId}
                        </span>
                      </div>
                      <div className="admin-meta-block">
                        <span className="admin-meta-k">Reported</span>
                        <span className="admin-meta-v">
                          {report.reportedUser ? report.reportedUser.label : "Situation only"}
                        </span>
                        <span className="admin-meta-sub">
                          {report.reportedUser?.email ??
                            (report.reportedUser
                              ? report.reportedUser.userId
                              : "No specific rider selected")}
                        </span>
                      </div>
                      <div className="admin-meta-block">
                        <span className="admin-meta-k">Group</span>
                        <span className="admin-meta-v">{report.group.label}</span>
                        <span className="admin-meta-sub">
                          {report.group.status
                            ? `${report.group.status} · ${report.group.reportCount} reports`
                            : "Status unavailable"}
                        </span>
                      </div>
                    </div>

                    <div className="admin-report-section">
                      <h5>Description</h5>
                      <p>{report.description}</p>
                    </div>

                    <div className="admin-report-section admin-ai-grid">
                      <div className="admin-ai-card">
                        <h5>AI rationale</h5>
                        <p>
                          {report.aiStatus === "ready"
                            ? (report.aiRationale ?? "No rationale returned.")
                            : report.aiStatus === "pending"
                              ? "Severity scoring is running in the background."
                              : (report.aiError ??
                                "Severity scoring is unavailable for this report.")}
                        </p>
                      </div>
                      <div className="admin-ai-card">
                        <h5>Recommended next step</h5>
                        <p>
                          {report.aiStatus === "ready"
                            ? (report.aiRecommendedAction ?? "Review the report manually.")
                            : unresolved
                              ? "Review the report manually while the AI result is pending or unavailable."
                              : "No further AI action suggested for this report state."}
                        </p>
                      </div>
                    </div>

                    {report.reviewedBy || report.reviewedAt || report.reviewNote ? (
                      <div className="admin-report-section">
                        <h5>Review history</h5>
                        <p className="admin-review-history">
                          {report.reviewedBy ? `${report.reviewedBy.label} · ` : ""}
                          {report.reviewedAt
                            ? formatTimestamp(report.reviewedAt)
                            : "Time unavailable"}
                        </p>
                        {report.reviewNote ? <p>{report.reviewNote}</p> : null}
                      </div>
                    ) : null}

                    <div className="admin-report-actions">
                      <label className="admin-note-field">
                        <span>Review note</span>
                        <textarea
                          rows={3}
                          value={getDraftNote(report)}
                          onChange={(event) =>
                            setDraftNotes((current) => ({
                              ...current,
                              [report._id]: event.target.value,
                            }))
                          }
                          disabled={!unresolved || busy}
                          placeholder="Optional note for resolving or dismissing this report"
                        />
                      </label>

                      <div className="admin-action-row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy || report.reviewStatus !== "open"}
                          onClick={() => void handleReportAction("start", report)}
                        >
                          {busyAction?.reportId === report._id && busyAction.action === "start"
                            ? "Saving…"
                            : "Start review"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy || !unresolved}
                          onClick={() => void handleReportAction("resolve", report)}
                        >
                          {busyAction?.reportId === report._id && busyAction.action === "resolve"
                            ? "Saving…"
                            : "Resolve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={busy || !unresolved}
                          onClick={() => void handleReportAction("dismiss", report)}
                        >
                          {busyAction?.reportId === report._id && busyAction.action === "dismiss"
                            ? "Saving…"
                            : "Dismiss"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="admin-empty-state">No reports match the selected filters.</div>
            )}
          </div>
        </section>

        <aside className="admin-col admin-audit-panel">
          <div className="admin-panel-head">
            <div className="stack-sm">
              <h3 className="admin-col-title">Audit trail</h3>
              <p className="text-sm text-muted">Most recent operator and system events.</p>
            </div>
          </div>

          {dashboard?.auditEvents.length ? (
            <div className="admin-audit">
              {dashboard.auditEvents.map((event) => (
                <div className="admin-audit-row" key={event._id}>
                  <div>
                    <span className="admin-audit-act">{event.action}</span>
                    <span className="admin-audit-ts">{formatTimestamp(event.createdAt)}</span>
                  </div>
                  <div className="admin-audit-actor">
                    <span>{event.actorLabel}</span>
                    {event.actorEmail ? <span>{event.actorEmail}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-empty-state">No audit events yet.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
