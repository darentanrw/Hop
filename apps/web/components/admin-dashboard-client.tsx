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
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}

function relativeTime(value: string | null) {
  if (!value) return "—";
  const ms = Date.now() - Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSeverityLabel(report: DashboardReport) {
  if (report.aiStatus === "pending") return "Scoring…";
  if (report.aiStatus === "failed") return "AI n/a";
  if (report.severityScore === null || !report.severityBand) return "—";
  return `${report.severityScore} · ${report.severityBand}`;
}

function getSummaryStatusLabel(summary: DashboardSummary) {
  switch (summary.status) {
    case "idle":
      return "Not generated";
    case "pending":
      return "Refreshing";
    case "ready":
      return summary.isStale ? "Stale" : "Ready";
    case "failed":
      return "Failed";
  }
}

function getSummaryStatusTone(summary: DashboardSummary) {
  switch (summary.status) {
    case "idle":
      return "muted";
    case "pending":
      return "accent";
    case "ready":
      return summary.isStale ? "warning" : "success";
    case "failed":
      return "danger";
  }
}

function getReviewStatusTone(status: string) {
  switch (status) {
    case "open":
      return "accent";
    case "in_review":
      return "privacy";
    case "resolved":
      return "success";
    case "dismissed":
      return "muted";
    default:
      return "muted";
  }
}

function getSeverityTone(band: string | null) {
  switch (band) {
    case "critical":
      return "danger";
    case "high":
      return "accent";
    case "medium":
      return "privacy";
    case "low":
      return "muted";
    default:
      return "muted";
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
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
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
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
    if (!dashboard?.summary.aiEnabled) return;
    if (dashboard.summary.status !== "idle" || autoRefreshRequested.current) return;
    autoRefreshRequested.current = true;
    void refreshDashboardSummary({ force: false }).catch(() => undefined);
  }, [dashboard?.summary.aiEnabled, dashboard?.summary.status, refreshDashboardSummary]);

  const reports = dashboard?.reports ?? [];
  const filteredReports = reports.filter((report) => {
    if (reviewFilter !== "all" && report.reviewStatus !== reviewFilter) return false;
    if (severityFilter !== "all" && report.severityBand !== severityFilter) return false;
    if (categoryFilter !== "all" && report.category !== categoryFilter) return false;
    if (aiStatusFilter !== "all" && report.aiStatus !== aiStatusFilter) return false;
    return true;
  });

  const activeFilters = [reviewFilter, severityFilter, categoryFilter, aiStatusFilter].filter(
    (f) => f !== "all",
  ).length;

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
        await startReportReview({ reportId: report._id as Id<"reports"> });
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

  const isExpanded = (id: string) => expandedReport === id;
  const toggleExpand = (id: string) =>
    setExpandedReport((prev) => (prev === id ? null : id));

  return (
    <div className="adm">
      {/* Header */}
      <header className="adm-header">
        <div className="adm-header-left">
          <div
            className="hop-logo"
            style={{ width: 28, height: 28, fontSize: 12, borderRadius: 8 }}
          >
            H
          </div>
          <div className="adm-header-title">
            <h1 className="adm-wordmark">Hop</h1>
            <span className="adm-badge">Admin</span>
          </div>
        </div>
        <Link href="/admin/simulator" className="btn btn-secondary btn-sm">
          Simulator
          <span className="adm-arrow">→</span>
        </Link>
      </header>

      {/* Toast notice */}
      {notice ? (
        <div
          className={`adm-toast adm-toast--${notice.tone}`}
          onClick={() => setNotice(null)}
          role="status"
        >
          <span className="adm-toast-dot" />
          {notice.text}
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="adm-kpis">
        <div className="adm-kpi" data-tone="default">
          <div className="adm-kpi-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          <span className="adm-kpi-val">{dashboard?.users ?? "—"}</span>
          <span className="adm-kpi-lbl">Riders</span>
        </div>
        <div className="adm-kpi" data-tone="accent">
          <div className="adm-kpi-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <circle cx="8" cy="8" r="2" fill="currentColor" />
            </svg>
          </div>
          <span className="adm-kpi-val">{dashboard?.openAvailabilities ?? "—"}</span>
          <span className="adm-kpi-lbl">Open pool</span>
        </div>
        <div className="adm-kpi" data-tone="privacy">
          <div className="adm-kpi-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="5" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M5 5V4a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
          <span className="adm-kpi-val">{dashboard?.tentativeGroups ?? "—"}</span>
          <span className="adm-kpi-lbl">Tentative</span>
        </div>
        <div className="adm-kpi" data-tone="success">
          <div className="adm-kpi-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 8.5l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <span className="adm-kpi-val">{dashboard?.revealedGroups ?? "—"}</span>
          <span className="adm-kpi-lbl">Revealed</span>
        </div>

        {/* Report KPIs */}
        <div className="adm-kpi" data-tone="default">
          <span className="adm-kpi-val">{dashboard?.totalReports ?? "—"}</span>
          <span className="adm-kpi-lbl">Reports</span>
        </div>
        <div className="adm-kpi" data-tone="accent">
          <span className="adm-kpi-val">{dashboard?.unresolvedReports ?? "—"}</span>
          <span className="adm-kpi-lbl">Unresolved</span>
        </div>
        <div className="adm-kpi" data-tone="danger">
          <span className="adm-kpi-val">{dashboard?.criticalOpenReports ?? "—"}</span>
          <span className="adm-kpi-lbl">Critical</span>
        </div>
      </div>

      {/* AI Overview */}
      <section className="adm-ai" data-status={summary.status} data-stale={summary.isStale}>
        <div className="adm-ai-header">
          <div className="adm-ai-title-row">
            <h2 className="adm-section-title">AI overview</h2>
            <span className={`pill pill-${getSummaryStatusTone(summary)} pill-dot`}>
              {getSummaryStatusLabel(summary)}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSummaryRefresh(true)}
            disabled={summaryBusy || !summary.aiEnabled}
          >
            {summaryBusy || summary.status === "pending" ? (
              <>
                <span className="adm-spinner" />
                Refreshing…
              </>
            ) : (
              "Refresh"
            )}
          </button>
        </div>

        <p className="adm-ai-headline">
          {summary.aiEnabled
            ? (summary.headline ??
              "A cached AI dashboard summary will appear here once generated.")
            : "Set OPENAI_API_KEY in the Convex environment to enable AI report scoring and the dashboard summary."}
        </p>

        {summary.body || summary.recommendedFocus.length || summary.error ? (
          <div className="adm-ai-body">
            {summary.body ? (
              <div className="adm-ai-panel">
                <h3 className="adm-label">Summary</h3>
                <p className="adm-ai-text">{summary.body}</p>
              </div>
            ) : null}
            {summary.recommendedFocus.length ? (
              <div className="adm-ai-panel">
                <h3 className="adm-label">Focus areas</h3>
                <ul className="adm-focus-list">
                  {summary.recommendedFocus.map((entry) => (
                    <li key={entry}>
                      <span className="adm-focus-marker" />
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.error ? (
              <p className="adm-ai-error">{summary.error}</p>
            ) : null}
          </div>
        ) : null}

        {summary.generatedAt ? (
          <span className="adm-ai-meta">
            Generated {relativeTime(summary.generatedAt)}
            {summary.model ? ` · ${summary.model}` : ""}
          </span>
        ) : null}
      </section>

      {/* Main content grid */}
      <div className="adm-grid">
        {/* Report queue */}
        <section className="adm-reports">
          <div className="adm-reports-header">
            <div className="adm-reports-title-row">
              <h2 className="adm-section-title">Report queue</h2>
              <span className="adm-count">
                {filteredReports.length}
                {activeFilters > 0 ? ` of ${reports.length}` : ""}
              </span>
            </div>
            <div className="adm-filters">
              {[
                { label: "Status", value: reviewFilter, set: setReviewFilter, opts: reviewStatusOptions },
                { label: "Severity", value: severityFilter, set: setSeverityFilter, opts: severityOptions },
                { label: "Category", value: categoryFilter, set: setCategoryFilter, opts: categoryOptions },
                { label: "AI", value: aiStatusFilter, set: setAiStatusFilter, opts: aiStatusOptions },
              ].map((filter) => (
                <label className="adm-filter" key={filter.label}>
                  <span>{filter.label}</span>
                  <select
                    value={filter.value}
                    onChange={(e) => filter.set(e.target.value)}
                    data-active={filter.value !== "all" ? "" : undefined}
                  >
                    {filter.opts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="adm-report-scroll">
            {dashboard === undefined ? (
              <div className="adm-empty">
                <span className="adm-spinner" />
                Loading reports…
              </div>
            ) : filteredReports.length === 0 ? (
              <div className="adm-empty">No reports match the selected filters.</div>
            ) : (
              filteredReports.map((report) => {
                const busy = busyAction?.reportId === report._id;
                const unresolved = isUnresolvedReviewStatus(report.reviewStatus);
                const expanded = isExpanded(report._id);
                const severityTone = getSeverityTone(report.severityBand);
                const reviewTone = getReviewStatusTone(report.reviewStatus);

                return (
                  <article
                    className="adm-report"
                    data-severity={report.severityBand ?? "none"}
                    data-status={report.reviewStatus}
                    key={report._id}
                  >
                    {/* Severity accent bar */}
                    <div className={`adm-report-accent adm-report-accent--${severityTone}`} />

                    <div className="adm-report-content">
                      {/* Compact header — always visible */}
                      <button
                        type="button"
                        className="adm-report-row"
                        onClick={() => toggleExpand(report._id)}
                        aria-expanded={expanded}
                      >
                        <div className="adm-report-primary">
                          <span className={`adm-severity-chip adm-severity-chip--${severityTone}`}>
                            {report.severityScore !== null ? report.severityScore : "—"}
                          </span>
                          <div className="adm-report-info">
                            <span className="adm-report-title">
                              {report.reportedUser
                                ? `${report.reportedUser.label} reported by ${report.reporter.label}`
                                : `Situation report from ${report.reporter.label}`}
                            </span>
                            <span className="adm-report-sub">
                              {report.categoryLabel} · {report.group.label}
                            </span>
                          </div>
                        </div>
                        <div className="adm-report-badges">
                          <span className={`pill pill-${reviewTone}`}>
                            {report.reviewStatus.replace("_", " ")}
                          </span>
                          <span className="adm-report-time">{relativeTime(report.createdAt)}</span>
                          <span className={`adm-chevron ${expanded ? "adm-chevron--open" : ""}`}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M4 5.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        </div>
                      </button>

                      {/* Expanded details */}
                      {expanded ? (
                        <div className="adm-report-detail">
                          {/* Description */}
                          <div className="adm-report-desc">
                            <p>{report.description}</p>
                          </div>

                          {/* People and group meta */}
                          <div className="adm-meta-grid">
                            <div className="adm-meta">
                              <span className="adm-label">Reporter</span>
                              <span className="adm-meta-name">{report.reporter.label}</span>
                              <span className="adm-meta-sub">
                                {report.reporter.email ?? report.reporter.userId}
                              </span>
                            </div>
                            <div className="adm-meta">
                              <span className="adm-label">Reported</span>
                              <span className="adm-meta-name">
                                {report.reportedUser ? report.reportedUser.label : "Situation only"}
                              </span>
                              <span className="adm-meta-sub">
                                {report.reportedUser?.email ??
                                  (report.reportedUser
                                    ? report.reportedUser.userId
                                    : "No specific rider")}
                              </span>
                            </div>
                            <div className="adm-meta">
                              <span className="adm-label">Group</span>
                              <span className="adm-meta-name">{report.group.label}</span>
                              <span className="adm-meta-sub">
                                {report.group.status
                                  ? `${report.group.status} · ${report.group.reportCount} reports`
                                  : "Status unavailable"}
                              </span>
                            </div>
                          </div>

                          {/* AI insights */}
                          <div className="adm-ai-insights">
                            <div className="adm-insight">
                              <span className="adm-label">AI rationale</span>
                              <p>
                                {report.aiStatus === "ready"
                                  ? (report.aiRationale ?? "No rationale returned.")
                                  : report.aiStatus === "pending"
                                    ? "Severity scoring is running…"
                                    : (report.aiError ?? "Unavailable for this report.")}
                              </p>
                            </div>
                            <div className="adm-insight">
                              <span className="adm-label">Recommended action</span>
                              <p>
                                {report.aiStatus === "ready"
                                  ? (report.aiRecommendedAction ?? "Review the report manually.")
                                  : unresolved
                                    ? "Review manually while AI is pending."
                                    : "No further action suggested."}
                              </p>
                            </div>
                          </div>

                          {/* Severity bar */}
                          {report.severityScore !== null ? (
                            <div className="adm-severity-bar-wrap">
                              <span className="adm-label">Severity</span>
                              <div className="adm-severity-bar">
                                <div
                                  className={`adm-severity-fill adm-severity-fill--${severityTone}`}
                                  style={{ width: `${report.severityScore}%` }}
                                />
                              </div>
                              <span className="adm-severity-val">{getSeverityLabel(report)}</span>
                            </div>
                          ) : null}

                          {/* Review history */}
                          {report.reviewedBy || report.reviewedAt || report.reviewNote ? (
                            <div className="adm-review-history">
                              <span className="adm-label">Review history</span>
                              <p>
                                {report.reviewedBy ? `${report.reviewedBy.label} · ` : ""}
                                {report.reviewedAt
                                  ? formatTimestamp(report.reviewedAt)
                                  : "Time unavailable"}
                              </p>
                              {report.reviewNote ? (
                                <p className="adm-review-note">"{report.reviewNote}"</p>
                              ) : null}
                            </div>
                          ) : null}

                          {/* Actions */}
                          {unresolved ? (
                            <div className="adm-actions">
                              <label className="adm-note-field">
                                <span className="adm-label">Note</span>
                                <textarea
                                  rows={2}
                                  value={getDraftNote(report)}
                                  onChange={(e) =>
                                    setDraftNotes((curr) => ({
                                      ...curr,
                                      [report._id]: e.target.value,
                                    }))
                                  }
                                  disabled={busy}
                                  placeholder="Optional review note…"
                                />
                              </label>
                              <div className="adm-action-btns">
                                {report.reviewStatus === "open" ? (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    disabled={busy}
                                    onClick={() => void handleReportAction("start", report)}
                                  >
                                    {busyAction?.reportId === report._id &&
                                    busyAction.action === "start"
                                      ? "Saving…"
                                      : "Start review"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={busy}
                                  onClick={() => void handleReportAction("resolve", report)}
                                >
                                  {busyAction?.reportId === report._id &&
                                  busyAction.action === "resolve"
                                    ? "Saving…"
                                    : "Resolve"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  disabled={busy}
                                  onClick={() => void handleReportAction("dismiss", report)}
                                >
                                  {busyAction?.reportId === report._id &&
                                  busyAction.action === "dismiss"
                                    ? "Saving…"
                                    : "Dismiss"}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* Audit trail */}
        <aside className="adm-audit">
          <h2 className="adm-section-title">Audit trail</h2>
          <p className="adm-audit-sub">Recent operator and system events</p>

          {dashboard?.auditEvents.length ? (
            <div className="adm-timeline">
              {dashboard.auditEvents.map((event, i) => (
                <div
                  className="adm-timeline-item"
                  key={event._id}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="adm-timeline-dot" />
                  {i < dashboard.auditEvents.length - 1 ? (
                    <div className="adm-timeline-line" />
                  ) : null}
                  <div className="adm-timeline-body">
                    <span className="adm-timeline-action">{event.action}</span>
                    <span className="adm-timeline-actor">
                      {event.actorLabel}
                      {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                    </span>
                    <span className="adm-timeline-time">{relativeTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="adm-empty">No audit events yet.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
