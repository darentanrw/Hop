import { getAuthUserId } from "@convex-dev/auth/server";
import {
  ACK_WINDOW_MINUTES,
  MEETUP_GRACE_MINUTES,
  PAYMENT_WINDOW_HOURS,
  PICKUP_ORIGIN_ID,
  PICKUP_ORIGIN_LABEL,
} from "@hop/shared";
import { v } from "convex/values";
import { buildLockedGroupDestinations } from "../lib/group-destinations";
import {
  MEETING_LOCATION_LABEL,
  computeSplitAmounts,
  deriveMeetingTime,
  getEmojiForMember,
  getGroupTheme,
} from "../lib/group-lifecycle";
import { createStubMatcherSubmission } from "../lib/matcher-stub";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";

const LOCAL_QA_BOT_PREFIX = "local-qa-bot-";
const ACTIVE_GROUP_STATUSES = new Set([
  "matched_pending_ack",
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
  "depart_ready",
  "in_trip",
  "receipt_pending",
  "payment_pending",
  "reported",
]);

const defaultPreferences = {
  selfDeclaredGender: "prefer_not_to_say" as const,
  sameGenderOnly: false,
  minGroupSize: 2,
  maxGroupSize: 4,
};

type GroupDoc = Doc<"groups">;

type LocalQaScenario = "matched" | "meetup" | "in_trip" | "payment";

function ensureLocalQaEnabled() {
  if (process.env.ENABLE_LOCAL_QA !== "true") {
    throw new Error("Local QA controls are disabled.");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function addHours(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
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
  });

  return {
    userId,
    name: `QA Bot ${index}`,
  };
}

async function createQaAvailability(
  ctx: MutationCtx,
  userId: Id<"users">,
  seed: string,
  overrides?: Partial<Doc<"availabilities">>,
) {
  const { windowStart, windowEnd } = getQaWindow();
  const matcherPayload = createStubMatcherSubmission(seed);

  return await ctx.db.insert("availabilities", {
    userId,
    windowStart,
    windowEnd,
    ...defaultPreferences,
    sealedDestinationRef: matcherPayload.sealedDestinationRef,
    routeDescriptorRef: matcherPayload.routeDescriptorRef,
    estimatedFareBand: matcherPayload.estimatedFareBand,
    createdAt: nowIso(),
    status: "open",
    ...overrides,
  });
}

async function findActiveGroupForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const groups = await ctx.db.query("groups").collect();
  return (
    groups
      .filter(
        (group) => ACTIVE_GROUP_STATUSES.has(group.status) && group.memberUserIds.includes(userId),
      )
      .sort((left, right) => right._creationTime - left._creationTime)[0] ?? null
  );
}

async function getOrCreateCurrentAvailability(ctx: MutationCtx, userId: Id<"users">) {
  await cancelOpenAvailabilitiesForUser(ctx, userId);
  return await createQaAvailability(ctx, userId, `local-qa:${userId}:${Date.now()}`);
}

async function createLocalQaGroupDocuments(
  ctx: MutationCtx,
  userId: Id<"users">,
  scenario: LocalQaScenario,
) {
  const currentUser = await ensureLocalQaUser(ctx, userId);
  const existingGroup = await findActiveGroupForUser(ctx, userId);
  if (existingGroup) {
    throw new Error(
      "You already have an active group. Finish or clear it before creating another QA group.",
    );
  }

  const currentAvailabilityId = await getOrCreateCurrentAvailability(ctx, userId);
  const bots = await Promise.all([createQaBot(ctx, 1), createQaBot(ctx, 2)]);
  const botAvailabilityIds = await Promise.all(
    bots.map((bot, index) =>
      createQaAvailability(ctx, bot.userId, `local-qa-bot:${bot.userId}:${Date.now()}:${index}`),
    ),
  );

  const currentAvailability = await ctx.db.get(currentAvailabilityId);
  if (!currentAvailability) throw new Error("Could not create the QA availability.");

  const memberUserIds = [userId, ...bots.map((bot) => bot.userId as string)];
  const availabilityIds = [currentAvailabilityId as string, ...botAvailabilityIds.map(String)];
  const groupTheme = getGroupTheme(memberUserIds.join(":"));
  const meetingTime = deriveMeetingTime(currentAvailability.windowStart);
  const groupId = await ctx.db.insert("groups", {
    status: "matched_pending_ack",
    pickupOriginId: PICKUP_ORIGIN_ID,
    pickupLabel: PICKUP_ORIGIN_LABEL,
    windowStart: currentAvailability.windowStart,
    windowEnd: currentAvailability.windowEnd,
    groupSize: memberUserIds.length,
    estimatedFareBand: currentAvailability.estimatedFareBand,
    maxDetourMinutes: 6,
    averageScore: 0.94,
    minimumScore: 0.9,
    confirmationDeadline: addMinutes(nowIso(), ACK_WINDOW_MINUTES),
    createdAt: nowIso(),
    availabilityIds,
    memberUserIds,
    meetingTime,
    meetingLocationLabel: MEETING_LOCATION_LABEL,
    graceDeadline: addMinutes(meetingTime, MEETUP_GRACE_MINUTES),
    groupName: groupTheme.name,
    groupColor: groupTheme.color,
    bookerUserId: userId,
    suggestedDropoffOrder: memberUserIds,
    reportCount: 0,
  });

  const memberDocs = [
    {
      userId: userId as string,
      availabilityId: currentAvailabilityId as string,
      displayName: currentUser.name,
      destinationAddress: "Kent Ridge MRT",
    },
    ...bots.map((bot, index) => ({
      userId: bot.userId as string,
      availabilityId: botAvailabilityIds[index] as string,
      displayName: bot.name,
      destinationAddress: index === 0 ? "Clementi Ave 3" : "Buona Vista MRT",
    })),
  ];
  const lockedDestinations = buildLockedGroupDestinations(
    memberDocs.map((member) => ({
      availabilityId: member.availabilityId,
      userId: member.userId,
    })),
    new Map(
      memberDocs.map((member) => [
        member.availabilityId,
        {
          createdAt: nowIso(),
          sealedDestinationRef: `stub:destination:${encodeURIComponent(member.destinationAddress)}`,
        },
      ]),
    ),
  );
  const destinationByUserId = new Map(
    lockedDestinations.map((destination) => [destination.userId, destination]),
  );

  for (const [index, member] of memberDocs.entries()) {
    const lockedDestination = destinationByUserId.get(member.userId);
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: member.userId,
      availabilityId: member.availabilityId,
      displayName: member.displayName,
      emoji: getEmojiForMember(groupId, index),
      accepted: scenario === "matched" && member.userId === userId ? null : true,
      acknowledgementStatus:
        scenario === "matched" && member.userId === userId ? "pending" : "accepted",
      acknowledgedAt: scenario === "matched" && member.userId === userId ? null : nowIso(),
      participationStatus: "active",
      destinationAddress: lockedDestination?.destinationAddress,
      destinationSubmittedAt: lockedDestination?.destinationSubmittedAt,
      destinationLockedAt: lockedDestination?.destinationLockedAt,
      qrToken: `${groupId}:${member.userId}:${index}`,
      dropoffOrder: lockedDestination?.dropoffOrder,
      paymentStatus: "none",
    });
  }

  for (const availabilityId of [currentAvailabilityId, ...botAvailabilityIds]) {
    await ctx.db.patch(availabilityId, { status: "matched" });
  }

  if (scenario !== "matched") {
    await ctx.db.patch(groupId, {
      status:
        scenario === "meetup"
          ? "meetup_preparation"
          : scenario === "in_trip"
            ? "in_trip"
            : "payment_pending",
      suggestedDropoffOrder: lockedDestinations.map((destination) => destination.userId),
      memberUserIds,
      availabilityIds,
      groupSize: memberDocs.length,
      ...(scenario === "in_trip" || scenario === "payment" ? { departedAt: nowIso() } : {}),
    });
  }

  if (scenario === "in_trip" || scenario === "payment") {
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
    for (const member of members) {
      await ctx.db.patch(member._id, {
        checkedInAt: nowIso(),
        checkedInByUserId: userId,
      });
    }
  }

  if (scenario === "payment") {
    const totalCostCents = 2400;
    const split = computeSplitAmounts(totalCostCents, memberUserIds, userId);
    const submittedAt = nowIso();
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();

    await ctx.db.patch(groupId, {
      status: "payment_pending",
      finalCostCents: totalCostCents,
      receiptSubmittedAt: submittedAt,
      paymentDueAt: addHours(submittedAt, PAYMENT_WINDOW_HOURS),
      departedAt: nowIso(),
    });

    for (const member of members) {
      const amountDueCents = split.get(member.userId) ?? 0;
      await ctx.db.patch(member._id, {
        amountDueCents,
        paymentStatus: member.userId === userId ? "not_required" : "submitted",
        paymentSubmittedAt: member.userId === userId ? undefined : submittedAt,
      });
    }
  }

  await ctx.db.insert("auditEvents", {
    action: "qa.group.created",
    actorId: groupId,
    metadata: { scenario, userId },
    createdAt: nowIso(),
  });

  return groupId;
}

export const bootstrapLocalQaUser = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const user = await ensureLocalQaUser(ctx, userId);
    return { ok: true, user };
  },
});

export const seedLocalQaPool = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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

    const currentAvailabilityId = await createQaAvailability(
      ctx,
      userId,
      `local-qa-self:${userId}:${Date.now()}`,
    );
    const bots = await Promise.all([createQaBot(ctx, 1), createQaBot(ctx, 2)]);
    const botAvailabilityIds = await Promise.all(
      bots.map((bot, index) =>
        createQaAvailability(ctx, bot.userId, `local-qa-seed:${bot.userId}:${Date.now()}:${index}`),
      ),
    );

    await ctx.db.insert("auditEvents", {
      action: "qa.pool.seeded",
      actorId: userId,
      metadata: {
        currentAvailabilityId,
        botAvailabilityIds,
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
    ),
  },
  handler: async (ctx, { scenario }) => {
    ensureLocalQaEnabled();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const groupId = await createLocalQaGroupDocuments(ctx, userId, scenario);
    return { ok: true, groupId };
  },
});

export const forceLocalQaBotAcknowledgements = mutation({
  args: {},
  handler: async (ctx) => {
    ensureLocalQaEnabled();
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

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
