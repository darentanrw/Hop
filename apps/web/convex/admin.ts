import { getAuthUserId } from "@convex-dev/auth/server";
import { MAX_GROUP_SIZE, MIN_GROUP_SIZE, sumPartySizes } from "@hop/shared";
import { v } from "convex/values";
import { selectBookerUserId } from "../lib/group-lifecycle";
import { isMembershipInActiveRide } from "../lib/ride-eligibility";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./adminAccess";

const LOCAL_QA_BOT_PREFIX = "local-qa-bot-";

const defaultPreferences = {
  selfDeclaredGender: "prefer_not_to_say" as const,
  sameGenderOnly: false,
  minGroupSize: MIN_GROUP_SIZE,
  maxGroupSize: MAX_GROUP_SIZE,
};

type GroupDoc = Doc<"groups">;

function ensureLocalQaEnabled() {
  if (process.env.ENABLE_LOCAL_QA !== "true") {
    throw new Error("Local QA controls are disabled.");
  }
}

function nowIso() {
  return new Date().toISOString();
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
    if (report.reviewStatus === "confirmed") return { ok: true as const };
    if (report.reviewStatus === "dismissed") {
      throw new Error("This report was dismissed.");
    }
    await ctx.db.patch(reportId, { reviewStatus: "confirmed" });
    if (report.reportedUserId) {
      const reportedUserId = report.reportedUserId as Id<"users">;
      const reportedUser = await ctx.db.get(reportedUserId);
      if (reportedUser) {
        await ctx.db.patch(reportedUserId, {
          confirmedReportCount: (reportedUser.confirmedReportCount ?? 0) + 1,
        });
      }
    }
    await ctx.db.insert("auditEvents", {
      action: "admin.report.confirmed",
      actorId: userId,
      metadata: { reportId },
      createdAt: nowIso(),
    });
    return { ok: true as const };
  },
});

export const dismissReport = mutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const { userId } = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) throw new Error("Report not found");
    if (report.reviewStatus === "confirmed") {
      throw new Error("Cannot dismiss a report that was already confirmed.");
    }
    if (report.reviewStatus === "dismissed") return { ok: true as const };
    await ctx.db.patch(reportId, { reviewStatus: "dismissed" });
    await ctx.db.insert("auditEvents", {
      action: "admin.report.dismissed",
      actorId: userId,
      metadata: { reportId },
      createdAt: nowIso(),
    });
    return { ok: true as const };
  },
});
