import { getAuthUserId } from "@convex-dev/auth/server";
import { MAX_GROUP_SIZE, MIN_GROUP_SIZE, sumPartySizes } from "@hop/shared";
import { v } from "convex/values";
import {
  generateAdminDashboardSummary,
  getAdminAiConfig,
  scoreAdminReportSeverity,
} from "../lib/admin-ai";
import {
  ADMIN_INSIGHT_KEY,
  type AdminCredibilitySnapshot,
  type AdminInsightStatus,
  type ReportAiStatus,
  type ReportReviewStatus,
  type ReportSeverityBand,
  buildAdminCredibilitySnapshot,
  buildAdminInsightPatch,
  buildAdminPersonLabel,
  getReportCategoryLabel,
  inferSeverityBandFromScore,
  isAdminInsightStale,
  isLowCredibilityScore,
  isUnresolvedReviewStatus,
  normalizeReportAiStatus,
  normalizeReportReviewStatus,
  normalizeReportSeverityBand,
  sortAdminReports,
  truncateAdminSummaryText,
} from "../lib/admin-dashboard";
import { selectBookerUserId } from "../lib/group-lifecycle";
import { isMembershipInActiveRide } from "../lib/ride-eligibility";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { isAdminUserEmail, requireAdmin } from "./adminAccess";

const LOCAL_QA_BOT_PREFIX = "local-qa-bot-";

const defaultPreferences = {
  selfDeclaredGender: "prefer_not_to_say" as const,
  sameGenderOnly: false,
  minGroupSize: MIN_GROUP_SIZE,
  maxGroupSize: MAX_GROUP_SIZE,
};

type GroupDoc = Doc<"groups">;
type UserDoc = Doc<"users">;
type AdminInsightDoc = Doc<"adminInsights">;

type AdminActorView = {
  userId: string;
  label: string;
  name: string | null;
  email: string | null;
  credibility: AdminCredibilitySnapshot | null;
};

type AdminReportView = {
  _id: Id<"reports">;
  category: Doc<"reports">["category"];
  categoryLabel: string;
  description: string;
  createdAt: string;
  reviewStatus: ReportReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: AdminActorView | null;
  aiStatus: ReportAiStatus;
  severityScore: number | null;
  severityBand: ReportSeverityBand | null;
  aiRationale: string | null;
  aiRecommendedAction: string | null;
  aiScoredAt: string | null;
  aiError: string | null;
  reporter: AdminActorView;
  reportedUser: AdminActorView | null;
  group: {
    id: string;
    label: string;
    status: GroupDoc["status"] | null;
    reportCount: number;
  };
};

type AdminAuditEventView = {
  _id: Id<"auditEvents">;
  action: string;
  createdAt: string;
  actorId: string;
  actorLabel: string;
  actorEmail: string | null;
};

type AdminDashboardKpis = {
  users: number;
  openAvailabilities: number;
  tentativeGroups: number;
  revealedGroups: number;
  totalReports: number;
  unresolvedReports: number;
  criticalOpenReports: number;
};

type AdminDashboardCredibility = {
  suspendedRiders: number;
  lowCredibilityRiders: number;
};

type AdminDashboardSnapshot = {
  kpis: AdminDashboardKpis;
  credibility: AdminDashboardCredibility;
  reports: AdminReportView[];
  auditEvents: AdminAuditEventView[];
};

type SeededLocalQaReportTemplate = {
  reporterIndex: number;
  reportedIndex?: number;
  category: Doc<"reports">["category"];
  descriptionTemplate: string;
  createdOffsetMinutes: number;
  reviewStatus: ReportReviewStatus;
  reviewStartedOffsetMinutes?: number;
  reviewedOffsetMinutes?: number;
  reviewNoteTemplate?: string;
  ai:
    | {
        status: "ready";
        scoredOffsetMinutes: number;
        severityScore: number;
        rationaleTemplate: string;
        recommendedActionTemplate: string;
      }
    | {
        status: "pending";
      }
    | {
        status: "failed";
        scoredOffsetMinutes: number;
        errorTemplate: string;
      };
};

const SEEDED_LOCAL_QA_NAME_SETS = [
  ["Alicia Tan", "Marcus Lim", "Siti Rahman", "Daniel Goh"],
  ["Priya Menon", "Ethan Koh", "Nur Aisyah", "Jia Hao Ong"],
] as const;

const SEEDED_LOCAL_QA_REPORT_TEMPLATES = [
  [
    {
      reporterIndex: 0,
      reportedIndex: 1,
      category: "unsafe_behavior",
      descriptionTemplate:
        "{{reported}} kept pushing the group to move from the main {{pickup}} pickup to a darker service road and got confrontational when we said we wanted to stay near the plaza.",
      createdOffsetMinutes: 12,
      reviewStatus: "open",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 18,
        severityScore: 92,
        rationaleTemplate:
          "Multiple riders described pressure to move to an isolated pickup point and escalating aggression when they refused.",
        recommendedActionTemplate:
          "Contact {{reporter}} and {{reported}} today and pause new matches until the safety complaint is reviewed.",
      },
    },
    {
      reporterIndex: 2,
      reportedIndex: 1,
      category: "harassment",
      descriptionTemplate:
        "{{reported}} sent repeated personal comments in the group chat after {{reporter}} asked to keep the pickup point unchanged. The tone felt targeted rather than just stressed.",
      createdOffsetMinutes: 16,
      reviewStatus: "in_review",
      reviewedOffsetMinutes: 46,
      ai: {
        status: "ready",
        scoredOffsetMinutes: 22,
        severityScore: 78,
        rationaleTemplate:
          "The complaint alleges repeated targeted comments in a live ride coordination channel, which creates a conduct concern that still needs corroboration.",
        recommendedActionTemplate:
          "Review the group chat log, preserve screenshots, and warn {{reported}} if the behaviour is corroborated.",
      },
    },
    {
      reporterIndex: 3,
      category: "other",
      descriptionTemplate:
        "No single rider to name here, but pickup coordination broke down because the meetup point kept changing between the plaza and the carpark entrance. We lost almost twenty minutes and nobody knew who was actually coordinating.",
      createdOffsetMinutes: 19,
      reviewStatus: "open",
      ai: {
        status: "pending",
      },
    },
    {
      reporterIndex: 1,
      reportedIndex: 2,
      category: "non_payment",
      descriptionTemplate:
        "{{reported}} said they needed a few extra minutes to transfer their share and asked the rest of us to cover first.",
      createdOffsetMinutes: 23,
      reviewStatus: "dismissed",
      reviewStartedOffsetMinutes: 40,
      reviewedOffsetMinutes: 61,
      reviewNoteTemplate:
        "Payment screenshot and recipient confirmation matched after manual review, so this report was dismissed.",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 28,
        severityScore: 22,
        rationaleTemplate:
          "This is a payment-delay complaint with no allegation of threat, coercion, or repeat misconduct.",
        recommendedActionTemplate:
          "Verify payment evidence before taking further action against {{reported}}.",
      },
    },
    {
      reporterIndex: 0,
      reportedIndex: 3,
      category: "no_show",
      descriptionTemplate:
        "{{reported}} only replied after the rest of the group had already been waiting for more than ten minutes at {{pickup}}.",
      createdOffsetMinutes: 26,
      reviewStatus: "resolved",
      reviewStartedOffsetMinutes: 39,
      reviewedOffsetMinutes: 55,
      reviewNoteTemplate:
        "Two riders confirmed the delay and the lateness was recorded against the member.",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 30,
        severityScore: 48,
        rationaleTemplate:
          "The report describes a late meetup that disrupted coordination but does not suggest broader safety risk.",
        recommendedActionTemplate:
          "Document the incident and send {{reported}} a reminder about meetup timing expectations.",
      },
    },
  ],
  [
    {
      reporterIndex: 0,
      reportedIndex: 3,
      category: "non_payment",
      descriptionTemplate:
        "{{reported}} asked everyone to pay first once the receipt was uploaded, then stopped responding when we asked whether the transfer had actually gone through.",
      createdOffsetMinutes: 8,
      reviewStatus: "open",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 14,
        severityScore: 71,
        rationaleTemplate:
          "The rider appears to be withholding payment confirmation after asking others to front the fare.",
        recommendedActionTemplate:
          "Request proof of payment from {{reported}} and confirm receipt with the booker before closing this item.",
      },
    },
    {
      reporterIndex: 1,
      reportedIndex: 0,
      category: "no_show",
      descriptionTemplate:
        "{{reported}} missed the agreed pickup timing and only responded after the driver had already looped past the stop once.",
      createdOffsetMinutes: 10,
      reviewStatus: "resolved",
      reviewStartedOffsetMinutes: 27,
      reviewedOffsetMinutes: 42,
      reviewNoteTemplate:
        "The rest of the group confirmed the delayed pickup and the report was resolved with a warning.",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 17,
        severityScore: 44,
        rationaleTemplate:
          "The complaint shows coordination impact and wasted driver time but limited evidence of intentional harm.",
        recommendedActionTemplate:
          "Record the incident and close it if the other riders confirm the same timeline.",
      },
    },
    {
      reporterIndex: 2,
      reportedIndex: 1,
      category: "misconduct",
      descriptionTemplate:
        "{{reported}} kept trying to reorder drop-offs mid-trip without checking with the rest of the group and argued when told the route was already locked.",
      createdOffsetMinutes: 12,
      reviewStatus: "open",
      ai: {
        status: "failed",
        scoredOffsetMinutes: 20,
        errorTemplate: "Timed out while waiting for the moderation model response.",
      },
    },
    {
      reporterIndex: 3,
      reportedIndex: 1,
      category: "unsafe_behavior",
      descriptionTemplate:
        "{{reported}} raised their voice at another rider during the trip and told the driver to ignore the planned stop order. The rest of the group were visibly uncomfortable after that.",
      createdOffsetMinutes: 16,
      reviewStatus: "open",
      ai: {
        status: "ready",
        scoredOffsetMinutes: 24,
        severityScore: 89,
        rationaleTemplate:
          "The report combines aggressive behaviour with attempts to override the agreed route during an active shared ride.",
        recommendedActionTemplate:
          "Prioritise human review and contact the affected riders before allowing {{reported}} into another trip.",
      },
    },
    {
      reporterIndex: 0,
      reportedIndex: 2,
      category: "harassment",
      descriptionTemplate:
        "{{reported}} kept mocking {{reporter}} in chat for asking about the fare split screenshots and continued after the ride ended.",
      createdOffsetMinutes: 20,
      reviewStatus: "in_review",
      reviewedOffsetMinutes: 37,
      ai: {
        status: "pending",
      },
    },
  ],
] satisfies readonly (readonly SeededLocalQaReportTemplate[])[];

function cleanOptionalText(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function incrementConfirmedReportCountForReport(ctx: MutationCtx, report: Doc<"reports">) {
  if (!report.reportedUserId) {
    return;
  }

  const reportedUserId = report.reportedUserId as Id<"users">;
  const reportedUser = await ctx.db.get(reportedUserId);
  if (!reportedUser) {
    return;
  }

  await ctx.db.patch(reportedUserId, {
    confirmedReportCount: (reportedUser.confirmedReportCount ?? 0) + 1,
  });
}

function getGroupLabel(group: GroupDoc | null) {
  if (!group) {
    return "Unknown group";
  }

  const name = group.groupName?.trim();
  return name || `Group ${group._id.slice(-6)}`;
}

function buildActorView(
  userId: string | undefined | null,
  usersById: Map<string, UserDoc>,
  fallback: string,
) {
  if (!userId) {
    return null;
  }

  const user = usersById.get(userId);
  return {
    userId,
    label: buildAdminPersonLabel(
      {
        id: userId,
        name: user?.name ?? null,
        email: user?.email ?? null,
      },
      fallback,
    ),
    name: cleanOptionalText(user?.name),
    email: cleanOptionalText(user?.email),
    credibility: buildAdminCredibilitySnapshot(user),
  } satisfies AdminActorView;
}

function buildAuditActorView(actorId: string, usersById: Map<string, UserDoc>) {
  if (actorId === "system") {
    return {
      actorLabel: "system",
      actorEmail: null,
    };
  }

  const actor = buildActorView(actorId, usersById, "Actor");
  if (actor) {
    return {
      actorLabel: actor.label,
      actorEmail: actor.email,
    };
  }

  return {
    actorLabel: `actor ${actorId.slice(-6)}`,
    actorEmail: null,
  };
}

async function getAdminInsightDoc(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("adminInsights")
    .withIndex("key", (q) => q.eq("key", ADMIN_INSIGHT_KEY))
    .first();
}

async function saveAdminInsight(
  ctx: MutationCtx,
  patch: {
    status: AdminInsightStatus;
    summaryHeadline?: string | undefined;
    summaryBody?: string | undefined;
    recommendedFocus?: string[] | undefined;
    generatedAt?: string | undefined;
    model?: string | undefined;
    requestId?: string | undefined;
    error?: string | undefined;
  },
) {
  const existing = await getAdminInsightDoc(ctx);
  const payload = buildAdminInsightPatch(patch);

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("adminInsights", {
    key: ADMIN_INSIGHT_KEY,
    ...payload,
  });
}

async function markAdminInsightPending(ctx: MutationCtx) {
  const existing = await getAdminInsightDoc(ctx);
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "pending",
      error: undefined,
    });
    return existing._id;
  }

  return await ctx.db.insert("adminInsights", {
    key: ADMIN_INSIGHT_KEY,
    status: "pending",
  });
}

function buildSummaryView(summary: AdminInsightDoc | null) {
  const aiConfig = getAdminAiConfig();

  return {
    status: summary?.status ?? ("idle" as const),
    headline: summary?.summaryHeadline ?? null,
    body: summary?.summaryBody ?? null,
    recommendedFocus: summary?.recommendedFocus ?? [],
    generatedAt: summary?.generatedAt ?? null,
    model: summary?.model ?? null,
    requestId: summary?.requestId ?? null,
    error: summary?.error ?? null,
    isStale: isAdminInsightStale(summary?.generatedAt ?? null, aiConfig.summaryTtlMs),
    aiEnabled: aiConfig.enabled,
  };
}

async function buildAdminDashboardSnapshot(
  ctx: QueryCtx | MutationCtx,
): Promise<AdminDashboardSnapshot> {
  const [users, availabilities, groups, reports, auditEvents] = await Promise.all([
    ctx.db.query("users").collect(),
    ctx.db.query("availabilities").collect(),
    ctx.db.query("groups").collect(),
    ctx.db.query("reports").collect(),
    ctx.db.query("auditEvents").order("desc").take(20),
  ]);

  const usersById = new Map(users.map((user) => [user._id as string, user]));
  const groupsById = new Map(groups.map((group) => [group._id as string, group]));
  const credibilitySnapshots = users
    .map((user) => buildAdminCredibilitySnapshot(user))
    .filter((snapshot): snapshot is AdminCredibilitySnapshot => snapshot !== null);

  const reportViews = sortAdminReports(
    reports.map((report) => {
      const group = groupsById.get(report.groupId as string) ?? null;
      const reporter =
        buildActorView(report.reporterUserId, usersById, "Reporter") ??
        ({
          userId: report.reporterUserId,
          label: buildAdminPersonLabel({ id: report.reporterUserId }, "Reporter"),
          name: null,
          email: null,
          credibility: null,
        } satisfies AdminActorView);
      const severityScore =
        typeof report.severityScore === "number" ? Math.round(report.severityScore) : null;
      const severityBand =
        normalizeReportSeverityBand(report.severityBand) ??
        (severityScore !== null ? inferSeverityBandFromScore(severityScore) : null);
      const aiStatus = report.aiStatus
        ? normalizeReportAiStatus(report.aiStatus)
        : severityScore !== null || severityBand !== null
          ? "ready"
          : "failed";

      return {
        _id: report._id,
        category: report.category,
        categoryLabel: getReportCategoryLabel(report.category),
        description: report.description,
        createdAt: report.createdAt,
        reviewStatus: normalizeReportReviewStatus(report.reviewStatus),
        reviewNote: cleanOptionalText(report.reviewNote),
        reviewedAt: report.reviewedAt ?? null,
        reviewedBy: buildActorView(report.reviewedByUserId, usersById, "Admin"),
        aiStatus,
        severityScore,
        severityBand,
        aiRationale: cleanOptionalText(report.aiRationale),
        aiRecommendedAction: cleanOptionalText(report.aiRecommendedAction),
        aiScoredAt: report.aiScoredAt ?? null,
        aiError:
          cleanOptionalText(report.aiError) ??
          (aiStatus === "failed" ? "Severity scoring is unavailable for this report." : null),
        reporter,
        reportedUser: buildActorView(report.reportedUserId, usersById, "Reported rider"),
        group: {
          id: report.groupId,
          label: getGroupLabel(group),
          status: group?.status ?? null,
          reportCount: group?.reportCount ?? 0,
        },
      } satisfies AdminReportView;
    }),
  );

  const unresolvedReports = reportViews.filter((report) =>
    isUnresolvedReviewStatus(report.reviewStatus),
  );

  return {
    kpis: {
      users: users.length,
      openAvailabilities: availabilities.filter((availability) => availability.status === "open")
        .length,
      tentativeGroups: groups.filter((group) => group.status === "tentative").length,
      revealedGroups: groups.filter((group) => group.status === "revealed").length,
      totalReports: reportViews.length,
      unresolvedReports: unresolvedReports.length,
      criticalOpenReports: unresolvedReports.filter((report) => report.severityBand === "critical")
        .length,
    },
    credibility: {
      suspendedRiders: credibilitySnapshots.filter((snapshot) => snapshot.suspended).length,
      lowCredibilityRiders: credibilitySnapshots.filter((snapshot) =>
        isLowCredibilityScore(snapshot.score),
      ).length,
    },
    reports: reportViews,
    auditEvents: auditEvents.map((event) => {
      const actor = buildAuditActorView(event.actorId, usersById);

      return {
        _id: event._id,
        action: event.action,
        createdAt: event.createdAt,
        actorId: event.actorId,
        actorLabel: actor.actorLabel,
        actorEmail: actor.actorEmail,
      } satisfies AdminAuditEventView;
    }),
  };
}

function buildSummarySource(snapshot: AdminDashboardSnapshot) {
  const unresolvedReports = snapshot.reports.filter((report) =>
    isUnresolvedReviewStatus(report.reviewStatus),
  );
  const unresolvedReportsWithSuspendedParticipants = unresolvedReports.filter(
    (report) =>
      report.reporter.credibility?.suspended === true ||
      report.reportedUser?.credibility?.suspended === true,
  ).length;
  const unresolvedReportsWithLowCredibilityParticipants = unresolvedReports.filter(
    (report) =>
      (report.reporter.credibility
        ? isLowCredibilityScore(report.reporter.credibility.score)
        : false) ||
      (report.reportedUser?.credibility
        ? isLowCredibilityScore(report.reportedUser.credibility.score)
        : false),
  ).length;

  const byCategory = unresolvedReports.reduce<Record<string, number>>((counts, report) => {
    counts[report.category] = (counts[report.category] ?? 0) + 1;
    return counts;
  }, {});

  const bySeverity = unresolvedReports.reduce<Record<string, number>>((counts, report) => {
    const key = report.aiStatus === "ready" ? (report.severityBand ?? "unscored") : report.aiStatus;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    kpis: snapshot.kpis,
    credibility: {
      suspendedRiders: snapshot.credibility.suspendedRiders,
      lowCredibilityRiders: snapshot.credibility.lowCredibilityRiders,
      unresolvedReportsWithSuspendedParticipants,
      unresolvedReportsWithLowCredibilityParticipants,
    },
    unresolvedReportCounts: {
      total: unresolvedReports.length,
      aiPending: unresolvedReports.filter((report) => report.aiStatus === "pending").length,
      aiFailed: unresolvedReports.filter((report) => report.aiStatus === "failed").length,
      byCategory,
      bySeverity,
    },
    topUrgentReports: unresolvedReports.slice(0, 5).map((report) => ({
      reportId: report._id,
      category: report.category,
      createdAt: report.createdAt,
      severityScore: report.severityScore,
      severityBand: report.severityBand,
      aiStatus: report.aiStatus,
      groupStatus: report.group.status,
      descriptionExcerpt: truncateAdminSummaryText(report.description),
      reporter: report.reporter.credibility
        ? {
            credibilityScore: report.reporter.credibility.score,
            suspended: report.reporter.credibility.suspended,
            confirmedReportCount: report.reporter.credibility.confirmedReportCount,
          }
        : null,
      reportedUser: report.reportedUser?.credibility
        ? {
            credibilityScore: report.reportedUser.credibility.score,
            suspended: report.reportedUser.credibility.suspended,
            confirmedReportCount: report.reportedUser.credibility.confirmedReportCount,
          }
        : null,
    })),
    recentAuditEvents: snapshot.auditEvents.slice(0, 8).map((event) => ({
      action: event.action,
      createdAt: event.createdAt,
    })),
  };
}

async function scheduleDashboardSummaryRefresh(ctx: MutationCtx, reason: string) {
  await ctx.scheduler.runAfter(0, internal.admin.refreshDashboardSummaryInternal, {
    reason,
  });
}

function ensureLocalQaEnabled() {
  if (process.env.ENABLE_LOCAL_QA !== "true") {
    throw new Error("Local QA controls are disabled.");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isLocalQaUserEmail(email: string | undefined | null) {
  return email?.trim().toLowerCase().startsWith("local-qa-") === true;
}

function offsetIso(baseIso: string, offsetMinutes: number) {
  const baseMs = Date.parse(baseIso);
  if (Number.isNaN(baseMs)) {
    return nowIso();
  }

  return new Date(baseMs + offsetMinutes * 60_000).toISOString();
}

function fillSeedTemplate(template: string, values: Record<string, string | undefined | null>) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{{${key}}}`, value?.trim() || ""),
    template,
  );
}

async function requireAuthenticatedUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

function getQaWindow() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

async function ensureLocalQaUser(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");

  const fallbackEmail =
    user.email?.trim().toLowerCase() || `local-qa-${userId.slice(-6)}@u.nus.edu`;
  const patch: Partial<Doc<"users">> = {
    email: fallbackEmail,
    emailDomain: "u.nus.edu",
    emailVerified: true,
    onboardingComplete: true,
    name: user.name?.trim() || "Local QA Rider",
  };

  await ctx.db.patch(userId, patch);

  const existingPreference = await ctx.db
    .query("preferences")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .first();

  if (existingPreference) {
    await ctx.db.patch(existingPreference._id, defaultPreferences);
  } else {
    await ctx.db.insert("preferences", {
      userId,
      ...defaultPreferences,
    });
  }

  return {
    userId,
    name: patch.name as string,
    email: patch.email as string,
  };
}

async function listLocalQaBotUsers(ctx: QueryCtx | MutationCtx) {
  const users = await ctx.db.query("users").collect();
  return users.filter((user) => user.email?.startsWith(LOCAL_QA_BOT_PREFIX));
}

async function cancelOpenAvailabilitiesForUser(ctx: MutationCtx, userId: Id<"users">) {
  const availabilities = await ctx.db
    .query("availabilities")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();

  for (const availability of availabilities) {
    if (availability.status === "open") {
      await ctx.db.patch(availability._id, { status: "cancelled" });
    }
  }
}

async function createQaBot(ctx: MutationCtx, index: number) {
  const stamp = Date.now().toString(36);
  const userId = await ctx.db.insert("users", {
    name: `QA Bot ${index}`,
    email: `${LOCAL_QA_BOT_PREFIX}${stamp}-${index}@u.nus.edu`,
    emailDomain: "u.nus.edu",
    emailVerified: true,
    onboardingComplete: true,
    isAnonymous: true,
    emailVerificationTime: Date.now(),
    successfulTrips: 0,
    cancelledTrips: 0,
    reportedCount: 0,
    confirmedReportCount: 0,
  });

  return {
    userId,
    name: `QA Bot ${index}`,
  };
}

async function createQaAvailability(
  ctx: MutationCtx,
  userId: Id<"users">,
  matcherDestination: {
    sealedDestinationRef: string;
    routeDescriptorRef: string;
  },
) {
  const { windowStart, windowEnd } = getQaWindow();

  return await ctx.db.insert("availabilities", {
    userId,
    windowStart,
    windowEnd,
    ...defaultPreferences,
    sealedDestinationRef: matcherDestination.sealedDestinationRef,
    routeDescriptorRef: matcherDestination.routeDescriptorRef,
    createdAt: nowIso(),
    status: "open",
  });
}

async function findActiveGroupForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  const pairs = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      group: await ctx.db.get(membership.groupId),
    })),
  );

  return (
    pairs
      .filter(
        ({ membership, group }) =>
          group !== null &&
          (group.status === "reported" || isMembershipInActiveRide(membership, group)),
      )
      .map(({ group }) => group)
      .filter((group): group is GroupDoc => Boolean(group))
      .sort((left, right) => right._creationTime - left._creationTime)[0] ?? null
  );
}

export const bootstrapLocalQaUser = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    const user = await ensureLocalQaUser(ctx, userId);
    return { ok: true, user };
  },
});

export const adminAccess = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireAdminOrNull(ctx);
    return {
      isAuthenticated: Boolean(actor?.userId),
      isAdmin: actor?.isAdmin === true,
      email: actor?.user?.email ?? null,
    };
  },
});

export const adminDashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [snapshot, summary] = await Promise.all([
      buildAdminDashboardSnapshot(ctx),
      getAdminInsightDoc(ctx),
    ]);

    return {
      ...snapshot.kpis,
      credibility: snapshot.credibility,
      summary: buildSummaryView(summary),
      reports: snapshot.reports,
      auditEvents: snapshot.auditEvents,
    };
  },
});

export const adminDashboardSummarySource = internalQuery({
  args: {},
  handler: async (ctx) => {
    const snapshot = await buildAdminDashboardSnapshot(ctx);
    return buildSummarySource(snapshot);
  },
});

export const getReportSeverityPayload = internalQuery({
  args: {
    reportId: v.id("reports"),
  },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (!report) {
      return null;
    }

    const group = await ctx.db.get(report.groupId);
    return {
      reportId,
      category: report.category,
      description: report.description,
      createdAt: report.createdAt,
      groupStatus: group?.status ?? null,
      groupReportCount: group?.reportCount ?? 0,
      reporterLabel: "reporter_member",
      reportedLabel: report.reportedUserId ? "reported_member" : "situation_only",
      targetsSpecificUser: Boolean(report.reportedUserId),
    };
  },
});

export const markDashboardSummaryPending = internalMutation({
  args: {},
  handler: async (ctx) => {
    await markAdminInsightPending(ctx);
    return { ok: true };
  },
});

export const saveDashboardSummary = internalMutation({
  args: {
    headline: v.string(),
    summary: v.string(),
    recommendedFocus: v.array(v.string()),
    model: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    await saveAdminInsight(ctx, {
      status: "ready",
      summaryHeadline: args.headline.trim(),
      summaryBody: args.summary.trim(),
      recommendedFocus: args.recommendedFocus.map((entry) => entry.trim()).filter(Boolean),
      generatedAt: nowIso(),
      model: args.model,
      requestId: args.requestId,
      error: undefined,
    });
    return { ok: true };
  },
});

export const saveDashboardSummaryFailure = internalMutation({
  args: {
    error: v.string(),
  },
  handler: async (ctx, { error }) => {
    await saveAdminInsight(ctx, {
      status: "failed",
      error: error.trim(),
    });
    return { ok: true };
  },
});

export const saveReportSeverityResult = internalMutation({
  args: {
    reportId: v.id("reports"),
    severityScore: v.number(),
    severityBand: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    rationale: v.string(),
    recommendedNextStep: v.string(),
    model: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) {
      return { saved: false };
    }

    await ctx.db.patch(args.reportId, {
      aiStatus: "ready",
      severityScore: args.severityScore,
      severityBand: args.severityBand,
      aiRationale: args.rationale.trim(),
      aiRecommendedAction: args.recommendedNextStep.trim(),
      aiScoredAt: nowIso(),
      aiModel: args.model,
      aiRequestId: args.requestId,
      aiError: undefined,
    });

    await scheduleDashboardSummaryRefresh(ctx, "report_scored");

    return { saved: true };
  },
});

export const saveReportSeverityFailure = internalMutation({
  args: {
    reportId: v.id("reports"),
    error: v.string(),
  },
  handler: async (ctx, { reportId, error }) => {
    const report = await ctx.db.get(reportId);
    if (!report) {
      return { saved: false };
    }

    await ctx.db.patch(reportId, {
      aiStatus: "failed",
      severityScore: undefined,
      severityBand: undefined,
      aiRationale: undefined,
      aiRecommendedAction: undefined,
      aiScoredAt: nowIso(),
      aiModel: undefined,
      aiRequestId: undefined,
      aiError: error.trim(),
    });

    await scheduleDashboardSummaryRefresh(ctx, "report_score_failed");

    return { saved: true };
  },
});

export const scoreReportSeverity = internalAction({
  args: {
    reportId: v.id("reports"),
  },
  handler: async (ctx, { reportId }) => {
    const payload = await ctx.runQuery(internal.admin.getReportSeverityPayload, {
      reportId,
    });

    if (!payload) {
      return { ok: false, reason: "report_not_found" };
    }

    try {
      const result = await scoreAdminReportSeverity(payload);
      await ctx.runMutation(internal.admin.saveReportSeverityResult, {
        reportId,
        severityScore: result.severityScore,
        severityBand: result.severityBand,
        rationale: result.rationale,
        recommendedNextStep: result.recommendedNextStep,
        model: result.model,
        requestId: result.requestId,
      });

      return { ok: true, requestId: result.requestId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Severity scoring failed.";
      await ctx.runMutation(internal.admin.saveReportSeverityFailure, {
        reportId,
        error: message,
      });
      return { ok: false, error: message };
    }
  },
});

export const refreshDashboardSummaryInternal = internalAction({
  args: {
    reason: v.string(),
  },
  handler: async (ctx) => {
    await ctx.runMutation(internal.admin.markDashboardSummaryPending, {});

    const snapshot = await ctx.runQuery(internal.admin.adminDashboardSummarySource, {});
    try {
      const summary = await generateAdminDashboardSummary(snapshot);
      await ctx.runMutation(internal.admin.saveDashboardSummary, {
        headline: summary.headline,
        summary: summary.summary,
        recommendedFocus: summary.recommendedFocus,
        model: summary.model,
        requestId: summary.requestId,
      });

      return { ok: true, requestId: summary.requestId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Summary generation failed.";
      await ctx.runMutation(internal.admin.saveDashboardSummaryFailure, {
        error: message,
      });
      return { ok: false, error: message };
    }
  },
});

export const refreshDashboardSummary = mutation({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { force }) => {
    const { userId } = await requireAdmin(ctx);
    const summary = await getAdminInsightDoc(ctx);
    const isFresh =
      summary?.status === "ready" &&
      !isAdminInsightStale(summary.generatedAt, getAdminAiConfig().summaryTtlMs);

    if (summary?.status === "pending") {
      return { scheduled: false, status: "pending" as const };
    }

    if (!force && isFresh) {
      return { scheduled: false, status: "ready" as const };
    }

    await markAdminInsightPending(ctx);

    if (force) {
      await ctx.db.insert("auditEvents", {
        action: "admin.summary_refresh_requested",
        actorId: userId,
        metadata: {},
        createdAt: nowIso(),
      });
    }

    await scheduleDashboardSummaryRefresh(ctx, force ? "manual_refresh" : "dashboard_auto_load");

    return { scheduled: true, status: "pending" as const };
  },
});

export const startReportReview = mutation({
  args: {
    reportId: v.id("reports"),
  },
  handler: async (ctx, { reportId }) => {
    const { userId } = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) {
      throw new Error("Report not found.");
    }

    const reviewStatus = normalizeReportReviewStatus(report.reviewStatus);
    if (reviewStatus !== "open") {
      throw new Error("Only open reports can be moved into review.");
    }

    await ctx.db.patch(reportId, {
      reviewStatus: "in_review",
      reviewedByUserId: userId,
      reviewedAt: nowIso(),
    });

    await ctx.db.insert("auditEvents", {
      action: "report.review_started",
      actorId: userId,
      metadata: {
        reportId,
      },
      createdAt: nowIso(),
    });

    await scheduleDashboardSummaryRefresh(ctx, "report_review_started");

    return { ok: true };
  },
});

export const resolveReport = mutation({
  args: {
    reportId: v.id("reports"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { reportId, note }) => {
    const { userId } = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) {
      throw new Error("Report not found.");
    }

    const reviewStatus = normalizeReportReviewStatus(report.reviewStatus);
    if (!isUnresolvedReviewStatus(reviewStatus)) {
      throw new Error("Only open or in-review reports can be resolved.");
    }

    const reviewNote = cleanOptionalText(note);
    await ctx.db.patch(reportId, {
      reviewStatus: "resolved",
      reviewNote: reviewNote ?? undefined,
      reviewedByUserId: userId,
      reviewedAt: nowIso(),
    });
    await incrementConfirmedReportCountForReport(ctx, report);

    await ctx.db.insert("auditEvents", {
      action: "report.resolved",
      actorId: userId,
      metadata: {
        reportId,
        note: reviewNote ?? null,
      },
      createdAt: nowIso(),
    });

    await scheduleDashboardSummaryRefresh(ctx, "report_resolved");

    return { ok: true };
  },
});

export const dismissReport = mutation({
  args: {
    reportId: v.id("reports"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { reportId, note }) => {
    const { userId } = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) {
      throw new Error("Report not found.");
    }

    const reviewStatus = normalizeReportReviewStatus(report.reviewStatus);
    if (!isUnresolvedReviewStatus(reviewStatus)) {
      throw new Error("Only open or in-review reports can be dismissed.");
    }

    const reviewNote = cleanOptionalText(note);
    await ctx.db.patch(reportId, {
      reviewStatus: "dismissed",
      reviewNote: reviewNote ?? undefined,
      reviewedByUserId: userId,
      reviewedAt: nowIso(),
    });

    await ctx.db.insert("auditEvents", {
      action: "report.dismissed",
      actorId: userId,
      metadata: {
        reportId,
        note: reviewNote ?? null,
      },
      createdAt: nowIso(),
    });

    await scheduleDashboardSummaryRefresh(ctx, "report_dismissed");

    return { ok: true };
  },
});

export const seedLocalQaPool = mutation({
  args: {
    liveDestinations: v.array(
      v.object({
        sealedDestinationRef: v.string(),
        routeDescriptorRef: v.string(),
      }),
    ),
  },
  handler: async (ctx, { liveDestinations }) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    if (liveDestinations.length < 2) {
      throw new Error("Seed local QA with at least 2 live matcher destinations.");
    }

    const activeGroup = await findActiveGroupForUser(ctx, userId);
    if (activeGroup) {
      throw new Error("Finish your active group before seeding a new QA matching pool.");
    }

    await ensureLocalQaUser(ctx, userId);
    await cancelOpenAvailabilitiesForUser(ctx, userId);

    const qaBots = await listLocalQaBotUsers(ctx);
    for (const bot of qaBots) {
      await cancelOpenAvailabilitiesForUser(ctx, bot._id);
    }

    const currentAvailabilityId = await createQaAvailability(ctx, userId, liveDestinations[0]);
    const bots = await Promise.all(
      liveDestinations.slice(1).map((_, index) => createQaBot(ctx, index + 1)),
    );
    const botAvailabilityIds = await Promise.all(
      bots.map((bot, index) => createQaAvailability(ctx, bot.userId, liveDestinations[index + 1])),
    );

    await ctx.db.insert("auditEvents", {
      action: "qa.pool.seeded",
      actorId: userId,
      metadata: {
        currentAvailabilityId,
        botAvailabilityIds,
        seededCount: liveDestinations.length,
      },
      createdAt: nowIso(),
    });

    return {
      ok: true,
      createdAvailabilities: 1 + botAvailabilityIds.length,
    };
  },
});

export const seedLocalQaReports = internalMutation({
  args: {
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, { overwrite }) => {
    ensureLocalQaEnabled();

    const shouldOverwrite = overwrite !== false;
    const [users, groups] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("groups").collect(),
    ]);

    const usersById = new Map(users.map((user) => [user._id as string, user]));
    const qaUsersById = new Map(
      users
        .filter((user) => isLocalQaUserEmail(user.email))
        .map((user) => [user._id as string, user]),
    );

    const targetGroups = groups
      .map((group) => ({
        group,
        memberUserIds: group.memberUserIds
          .filter((userId) => qaUsersById.has(userId))
          .slice(0, 4)
          .map((userId) => userId as Id<"users">),
      }))
      .filter(({ memberUserIds }) => memberUserIds.length >= 4)
      .sort((left, right) => right.group._creationTime - left.group._creationTime)
      .slice(0, SEEDED_LOCAL_QA_REPORT_TEMPLATES.length);

    if (targetGroups.length === 0) {
      throw new Error("No local QA groups with at least four riders were found.");
    }

    const targetGroupIds = new Set(targetGroups.map(({ group }) => group._id as string));
    const targetUserIds = new Set(
      targetGroups.flatMap(({ memberUserIds }) => memberUserIds.map((userId) => userId as string)),
    );

    const reviewer =
      users.find((user) => isAdminUserEmail(user.email)) ??
      usersById.get(targetGroups[0]?.memberUserIds[0] as string) ??
      null;
    if (!reviewer) {
      throw new Error("No reviewer account was available for seeded moderation activity.");
    }
    const reviewerUserId = reviewer._id as Id<"users">;

    const existingReports = (
      await Promise.all(
        targetGroups.map(({ group }) =>
          ctx.db
            .query("reports")
            .withIndex("groupId", (q) => q.eq("groupId", group._id))
            .collect(),
        ),
      )
    ).flat();

    if (shouldOverwrite && existingReports.length > 0) {
      const existingReportIds = new Set(existingReports.map((report) => report._id as string));
      for (const report of existingReports) {
        await ctx.db.delete(report._id);
      }

      const auditEvents = await ctx.db.query("auditEvents").collect();
      for (const event of auditEvents) {
        if (!event.action.startsWith("report.")) continue;

        const metadata =
          typeof event.metadata === "object" && event.metadata !== null
            ? (event.metadata as { reportId?: string; groupId?: string })
            : null;
        const metadataReportId =
          metadata && typeof metadata.reportId === "string" ? metadata.reportId : null;
        const metadataGroupId =
          metadata && typeof metadata.groupId === "string" ? metadata.groupId : null;

        if (
          (metadataReportId && existingReportIds.has(metadataReportId)) ||
          (metadataGroupId && targetGroupIds.has(metadataGroupId))
        ) {
          await ctx.db.delete(event._id);
        }
      }
    }

    const assignedUserNames = new Map<string, string>();
    for (const [groupIndex, targetGroup] of targetGroups.entries()) {
      const seedNames = SEEDED_LOCAL_QA_NAME_SETS[groupIndex % SEEDED_LOCAL_QA_NAME_SETS.length];
      targetGroup.memberUserIds.forEach((userId, memberIndex) => {
        if (!assignedUserNames.has(userId as string)) {
          assignedUserNames.set(userId as string, seedNames[memberIndex % seedNames.length]);
        }
      });
    }

    for (const [userId, name] of assignedUserNames) {
      await ctx.db.patch(userId as Id<"users">, { name });
    }

    if (!targetUserIds.has(reviewerUserId as string)) {
      await ctx.db.patch(reviewerUserId, { name: "QA Admin" });
    }

    const createdReportIds: Id<"reports">[] = [];
    let reportSeedIndex = 0;

    for (const [groupIndex, targetGroup] of targetGroups.entries()) {
      const templates = SEEDED_LOCAL_QA_REPORT_TEMPLATES[groupIndex] ?? [];
      const baseIso = targetGroup.group.departedAt ?? targetGroup.group.createdAt;
      const groupLabel = getGroupLabel(targetGroup.group);
      const pickupLabel = targetGroup.group.pickupLabel;

      for (const template of templates) {
        const reporterUserId = targetGroup.memberUserIds[template.reporterIndex];
        const reportedUserId =
          typeof template.reportedIndex === "number"
            ? targetGroup.memberUserIds[template.reportedIndex]
            : undefined;

        if (!reporterUserId) continue;
        if (reportedUserId && reporterUserId === reportedUserId) continue;

        const reporterName =
          assignedUserNames.get(reporterUserId as string) ??
          usersById.get(reporterUserId as string)?.name?.trim() ??
          usersById.get(reporterUserId as string)?.email?.trim() ??
          "Reporter";
        const reportedName =
          (reportedUserId &&
            (assignedUserNames.get(reportedUserId as string) ??
              usersById.get(reportedUserId as string)?.name?.trim() ??
              usersById.get(reportedUserId as string)?.email?.trim())) ||
          undefined;
        const replacements = {
          group: groupLabel,
          pickup: pickupLabel,
          reporter: reporterName,
          reported: reportedName,
        };
        const createdAt = offsetIso(baseIso, template.createdOffsetMinutes);
        const reviewedAt =
          typeof template.reviewedOffsetMinutes === "number"
            ? offsetIso(baseIso, template.reviewedOffsetMinutes)
            : undefined;
        const reviewStartedAt =
          typeof template.reviewStartedOffsetMinutes === "number"
            ? offsetIso(baseIso, template.reviewStartedOffsetMinutes)
            : reviewedAt;

        reportSeedIndex += 1;
        const requestId = `local-qa-seed-${Date.now().toString(36)}-${reportSeedIndex}`;
        const reportId = await ctx.db.insert("reports", {
          groupId: targetGroup.group._id,
          reporterUserId,
          ...(reportedUserId ? { reportedUserId } : {}),
          category: template.category,
          description: fillSeedTemplate(template.descriptionTemplate, replacements).trim(),
          createdAt,
          reviewStatus: template.reviewStatus,
          reviewNote: template.reviewNoteTemplate
            ? fillSeedTemplate(template.reviewNoteTemplate, replacements).trim()
            : undefined,
          reviewedByUserId: template.reviewStatus === "open" ? undefined : reviewerUserId,
          reviewedAt: template.reviewStatus === "open" ? undefined : reviewedAt,
          aiStatus: template.ai.status,
          severityScore: template.ai.status === "ready" ? template.ai.severityScore : undefined,
          severityBand:
            template.ai.status === "ready"
              ? inferSeverityBandFromScore(template.ai.severityScore)
              : undefined,
          aiRationale:
            template.ai.status === "ready"
              ? fillSeedTemplate(template.ai.rationaleTemplate, replacements).trim()
              : undefined,
          aiRecommendedAction:
            template.ai.status === "ready"
              ? fillSeedTemplate(template.ai.recommendedActionTemplate, replacements).trim()
              : undefined,
          aiScoredAt:
            template.ai.status === "pending"
              ? undefined
              : offsetIso(baseIso, template.ai.scoredOffsetMinutes),
          aiModel: template.ai.status === "pending" ? undefined : "local-qa-seed-v1",
          aiRequestId: template.ai.status === "pending" ? undefined : requestId,
          aiError:
            template.ai.status === "failed"
              ? fillSeedTemplate(template.ai.errorTemplate, replacements).trim()
              : undefined,
        });

        createdReportIds.push(reportId);

        await ctx.db.insert("auditEvents", {
          action: "report.created",
          actorId: reporterUserId,
          metadata: {
            reportId,
            groupId: targetGroup.group._id,
            category: template.category,
            reportedUserId: reportedUserId ?? null,
          },
          createdAt,
        });

        if (template.reviewStatus === "in_review" && reviewedAt) {
          await ctx.db.insert("auditEvents", {
            action: "report.review_started",
            actorId: reviewerUserId,
            metadata: {
              reportId,
            },
            createdAt: reviewedAt,
          });
        }

        if (
          (template.reviewStatus === "resolved" || template.reviewStatus === "dismissed") &&
          reviewedAt
        ) {
          if (reviewStartedAt) {
            await ctx.db.insert("auditEvents", {
              action: "report.review_started",
              actorId: reviewerUserId,
              metadata: {
                reportId,
              },
              createdAt: reviewStartedAt,
            });
          }

          await ctx.db.insert("auditEvents", {
            action: template.reviewStatus === "resolved" ? "report.resolved" : "report.dismissed",
            actorId: reviewerUserId,
            metadata: {
              reportId,
              note: template.reviewNoteTemplate
                ? fillSeedTemplate(template.reviewNoteTemplate, replacements).trim()
                : null,
            },
            createdAt: reviewedAt,
          });
        }
      }
    }

    const allReports = await ctx.db.query("reports").collect();
    for (const { group } of targetGroups) {
      await ctx.db.patch(group._id, {
        reportCount: allReports.filter((report) => report.groupId === group._id).length,
      });
    }

    for (const userId of targetUserIds) {
      await ctx.db.patch(userId as Id<"users">, {
        reportedCount: allReports.filter((report) => report.reportedUserId === userId).length,
      });
    }

    const snapshot = await buildAdminDashboardSnapshot(ctx);
    const summarySource = buildSummarySource(snapshot);
    const unresolvedCount = summarySource.unresolvedReportCounts.total;
    const criticalCount =
      typeof summarySource.unresolvedReportCounts.bySeverity.critical === "number"
        ? summarySource.unresolvedReportCounts.bySeverity.critical
        : 0;
    const aiPendingCount = summarySource.unresolvedReportCounts.aiPending;
    const aiFailedCount = summarySource.unresolvedReportCounts.aiFailed;
    const topCategories = Object.entries(summarySource.unresolvedReportCounts.byCategory)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([category]) => getReportCategoryLabel(category))
      .join(" and ");
    const groupLabels = targetGroups.map(({ group }) => getGroupLabel(group));

    await saveAdminInsight(ctx, {
      status: "ready",
      summaryHeadline: `${unresolvedCount} unresolved reports need follow-up`,
      summaryBody: `The moderation queue is concentrated in ${groupLabels.join(" and ")}. ${criticalCount} unresolved reports are already marked critical, with ${aiPendingCount} still waiting on AI scoring and ${aiFailedCount} that need manual fallback. ${topCategories ? `${topCategories} complaints make up the biggest buckets in the current queue.` : "The current queue spans multiple categories so the filters are exercised end to end."}`,
      recommendedFocus: [
        criticalCount > 0
          ? `Triage the ${criticalCount} critical safety complaints first.`
          : "Start with the oldest unresolved report in the queue.",
        "Confirm payment proof before closing the open non-payment complaints.",
        aiFailedCount > 0
          ? "Retry AI scoring for the timed-out report, but do not block manual review."
          : "Work through the remaining open queue after the safety items are assigned.",
      ],
      generatedAt: nowIso(),
      model: "local-qa-seed-v1",
      requestId: `local-qa-summary-${Date.now().toString(36)}`,
      error: undefined,
    });

    return {
      ok: true,
      groupsSeeded: targetGroups.map(({ group }) => ({
        groupId: group._id,
        groupLabel: getGroupLabel(group),
      })),
      reportsCreated: createdReportIds.length,
      targetedUsers: targetUserIds.size,
      unresolvedReports: unresolvedCount,
    };
  },
});

export const createLocalQaGroup = mutation({
  args: {
    scenario: v.union(
      v.literal("matched"),
      v.literal("meetup"),
      v.literal("in_trip"),
      v.literal("payment"),
      v.literal("rolling_match"),
    ),
  },
  handler: async (ctx, { scenario }) => {
    ensureLocalQaEnabled();
    await requireAdmin(ctx);
    void ctx;
    void scenario;
    throw new Error(
      "QA demo groups were removed. Seed live destinations and run matching instead.",
    );
  },
});

export const forceLocalQaBotAcknowledgements = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    const activeGroup = await findActiveGroupForUser(ctx, userId);
    if (!activeGroup) {
      throw new Error("There is no active QA group to update.");
    }
    if (activeGroup.status !== "matched_pending_ack") {
      throw new Error("The active QA group is not waiting for acknowledgements.");
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();
    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((user) => [user._id, user]));

    let updatedCount = 0;

    for (const member of members) {
      if (member.userId === userId) continue;

      const memberUser = userById.get(member.userId as Id<"users">);
      const isQaBot = memberUser?.email?.startsWith(LOCAL_QA_BOT_PREFIX) === true;
      if (!isQaBot) continue;

      const alreadyAccepted =
        member.acknowledgementStatus === "accepted" || member.accepted === true;
      if (alreadyAccepted) continue;

      await ctx.db.patch(member._id, {
        accepted: true,
        acknowledgementStatus: "accepted",
        acknowledgedAt: nowIso(),
      });
      updatedCount += 1;
    }

    await ctx.db.insert("auditEvents", {
      action: "qa.bots.acknowledged",
      actorId: userId,
      metadata: { groupId: activeGroup._id, updatedCount },
      createdAt: nowIso(),
    });

    return {
      ok: true,
      updatedCount,
      groupId: activeGroup._id,
    };
  },
});

export const deleteCurrentLocalQaGroup = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    const activeGroup = await findActiveGroupForUser(ctx, userId);
    if (!activeGroup) {
      throw new Error("There is no active QA group to delete.");
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();

    for (const member of members) {
      const availability = await ctx.db.get(member.availabilityId as Id<"availabilities">);
      if (availability && availability.status !== "cancelled") {
        await ctx.db.patch(availability._id, { status: "cancelled" });
      }
      await ctx.db.delete(member._id);
    }

    const envelopes = await ctx.db
      .query("envelopesByRecipient")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();
    for (const envelope of envelopes) {
      await ctx.db.delete(envelope._id);
    }

    const reports = await ctx.db
      .query("reports")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();
    for (const report of reports) {
      await ctx.db.delete(report._id);
    }

    const notificationEvents = await ctx.db.query("notificationEvents").collect();
    for (const event of notificationEvents) {
      if (event.groupId === activeGroup._id) {
        await ctx.db.delete(event._id);
      }
    }

    await ctx.db.delete(activeGroup._id);

    await ctx.db.insert("auditEvents", {
      action: "qa.group.deleted",
      actorId: userId,
      metadata: { groupId: activeGroup._id },
      createdAt: nowIso(),
    });

    return {
      ok: true,
      deletedGroupId: activeGroup._id,
    };
  },
});

export const forceLockGroups = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    const activeGroup = await findActiveGroupForUser(ctx, userId);
    if (!activeGroup) {
      throw new Error("No active group to lock.");
    }

    if (activeGroup.status !== "tentative") {
      throw new Error(`Group is "${activeGroup.status}", expected "tentative".`);
    }

    const lockMembers = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();
    const activeLockMembers = lockMembers.filter((m) => m.participationStatus === "active");
    const seatTotal =
      activeGroup.passengerSeatTotal != null
        ? activeGroup.passengerSeatTotal
        : sumPartySizes(activeLockMembers) || activeGroup.groupSize;
    const newStatus = seatTotal >= MAX_GROUP_SIZE ? "locked" : "semi_locked";
    await ctx.db.patch(activeGroup._id, { status: newStatus });

    await ctx.db.insert("auditEvents", {
      action: "qa.force_lock",
      actorId: userId,
      metadata: { groupId: activeGroup._id, newStatus },
      createdAt: nowIso(),
    });

    return { ok: true, groupId: activeGroup._id, newStatus };
  },
});

export const forceHardLockGroups = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await requireAuthenticatedUserId(ctx);
    const activeGroup = await findActiveGroupForUser(ctx, userId);
    if (!activeGroup) {
      throw new Error("No active group to hard-lock.");
    }

    if (activeGroup.status !== "semi_locked") {
      throw new Error(`Group is "${activeGroup.status}", expected "semi_locked".`);
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
      .collect();
    const activeMembers = members.filter((m) => m.participationStatus === "active");
    const memberUserIds = activeMembers.map((m) => m.userId);
    const bookerUserId = selectBookerUserId(memberUserIds);

    await ctx.db.patch(activeGroup._id, {
      status: "locked",
      bookerUserId: bookerUserId ?? activeGroup.bookerUserId,
    });

    await ctx.db.insert("auditEvents", {
      action: "qa.force_hard_lock",
      actorId: userId,
      metadata: { groupId: activeGroup._id, bookerUserId },
      createdAt: nowIso(),
    });

    return { ok: true, groupId: activeGroup._id, bookerUserId };
  },
});

export const localQaSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const enabled = process.env.ENABLE_LOCAL_QA === "true";
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    const preference = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();
    const availabilities = await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const activeGroup = await findActiveGroupForUser(ctx, userId);
    const members = activeGroup
      ? await ctx.db
          .query("groupMembers")
          .withIndex("groupId", (q) => q.eq("groupId", activeGroup._id))
          .collect()
      : [];

    return {
      enabled,
      user: {
        id: userId,
        name: user.name ?? null,
        email: user.email ?? null,
        emailVerified: user.emailVerified ?? false,
        onboardingComplete: user.onboardingComplete ?? false,
        isAnonymous: user.isAnonymous ?? false,
        hasPreferences: Boolean(preference),
      },
      availability: {
        total: availabilities.length,
        open: availabilities.filter((availability) => availability.status === "open").length,
      },
      activeGroup: activeGroup
        ? {
            id: activeGroup._id,
            status: activeGroup.status,
            name: activeGroup.groupName ?? "Hop Group",
            bookerUserId: activeGroup.bookerUserId ?? null,
            memberCount: members.length,
          }
        : null,
      qrTokens: members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        emoji: member.emoji ?? "🙂",
        qrToken: member.qrToken ?? null,
        acknowledgementStatus: member.acknowledgementStatus ?? null,
        isCurrentUser: member.userId === userId,
      })),
    };
  },
});

export const localQaConfig = query({
  args: {},
  handler: async () => ({
    enabled: process.env.ENABLE_LOCAL_QA === "true",
  }),
});

async function requireAdminOrNull(ctx: QueryCtx) {
  try {
    return await requireAdmin(ctx);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Not authenticated" || error.message === "Admin access required.")
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Internal admin mutation: delete a user and all related data.
 * Run from Convex Dashboard → Functions → admin.deleteUser.
 *
 * Deletes in order:
 * - authRefreshTokens (by sessionId)
 * - authVerificationCodes (by accountId)
 * - authVerifiers (by sessionId)
 * - authSessions
 * - authAccounts
 * - emailVerifications
 * - clientKeys
 * - preferences, availabilities, groupMembers, envelopesByRecipient (by userId)
 * - users
 */
export const deleteUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      return { deleted: false, reason: "User not found" };
    }

    const userIdStr = userId;

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();

    const sessionIds = sessions.map((session) => session._id);
    const accountIds = accounts.map((account) => account._id);

    for (const sessionId of sessionIds) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
    }

    for (const accountId of accountIds) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", accountId))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
    }

    const verifiers = await ctx.db.query("authVerifiers").collect();
    for (const verifier of verifiers) {
      if (verifier.sessionId && sessionIds.includes(verifier.sessionId)) {
        await ctx.db.delete(verifier._id);
      }
    }

    for (const session of sessions) await ctx.db.delete(session._id);
    for (const account of accounts) await ctx.db.delete(account._id);

    const verifications = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const clientKeys = await ctx.db
      .query("clientKeys")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const verification of verifications) await ctx.db.delete(verification._id);
    for (const clientKey of clientKeys) await ctx.db.delete(clientKey._id);

    const preferences = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const preference of preferences) await ctx.db.delete(preference._id);

    const availabilities = await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const availability of availabilities) await ctx.db.delete(availability._id);

    const allGroupMembers = await ctx.db.query("groupMembers").collect();
    for (const member of allGroupMembers) {
      if (member.userId === userIdStr) await ctx.db.delete(member._id);
    }

    const allEnvelopes = await ctx.db.query("envelopesByRecipient").collect();
    for (const envelope of allEnvelopes) {
      if (envelope.recipientUserId === userIdStr || envelope.senderUserId === userIdStr) {
        await ctx.db.delete(envelope._id);
      }
    }

    await ctx.db.delete(userId);

    return {
      deleted: true,
      email: user.email,
    };
  },
});

/**
 * One-time migration: cancel all open availabilities with legacy
 * routeDescriptorRef values and dissolve any tentative
 * groups that reference them.
 *
 * Run from Convex Dashboard → Functions → admin.migrateOldAvailabilities.
 */
export const migrateOldAvailabilities = internalMutation({
  args: {},
  handler: async (ctx) => {
    const availabilities = await ctx.db.query("availabilities").collect();
    let cancelledAvailabilities = 0;
    const affectedGroupIds = new Set<string>();

    for (const availability of availabilities) {
      if (availability.status !== "open") continue;

      const isLegacy = !availability.routeDescriptorRef.startsWith("route_");

      const isOldRouteFormat =
        availability.routeDescriptorRef.startsWith("route_") && "estimatedFareBand" in availability;

      if (isLegacy || isOldRouteFormat) {
        await ctx.db.patch(availability._id, { status: "cancelled" });
        cancelledAvailabilities += 1;
      }
    }

    const groups = await ctx.db.query("groups").collect();
    let dissolvedGroups = 0;

    for (const group of groups) {
      if (group.status !== "tentative") continue;

      let hasLegacyMember = false;
      for (const availabilityId of group.availabilityIds) {
        const availability = await ctx.db.get(availabilityId as Id<"availabilities">);
        if (availability && availability.status === "cancelled") {
          hasLegacyMember = true;
          break;
        }
      }

      if (hasLegacyMember) {
        await ctx.db.patch(group._id, { status: "dissolved" });
        dissolvedGroups += 1;
        affectedGroupIds.add(group._id);
      }
    }

    await ctx.db.insert("auditEvents", {
      action: "migration.old_availabilities_cleared",
      actorId: "system",
      metadata: {
        cancelledAvailabilities,
        dissolvedGroups,
        affectedGroupIds: [...affectedGroupIds],
      },
      createdAt: new Date().toISOString(),
    });

    return { cancelledAvailabilities, dissolvedGroups };
  },
});

export const confirmReport = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const { userId } = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("Report not found");

    const reviewStatus = normalizeReportReviewStatus(report.reviewStatus);
    if (reviewStatus === "resolved") return { ok: true as const };
    if (reviewStatus === "dismissed") {
      throw new Error("This report was dismissed.");
    }

    await ctx.db.patch(reportId, {
      reviewStatus: "resolved",
      reviewedByUserId: userId,
      reviewedAt: nowIso(),
    });
    await incrementConfirmedReportCountForReport(ctx, report);
    await ctx.db.insert("auditEvents", {
      action: "admin.report.confirmed",
      actorId: userId,
      metadata: { reportId },
      createdAt: nowIso(),
    });
    await scheduleDashboardSummaryRefresh(ctx, "report_resolved");

    return { ok: true as const };
  },
});
