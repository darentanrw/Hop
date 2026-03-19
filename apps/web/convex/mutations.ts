import { getAuthUserId } from "@convex-dev/auth/server";
import {
  ACK_WINDOW_MINUTES,
  HARD_LOCK_MINUTES_BEFORE,
  LOCK_HOURS_BEFORE,
  MAX_DETOUR_MINUTES,
  MAX_DISTINCT_LOCATIONS,
  MAX_GROUP_SIZE,
  MAX_SPREAD_KM,
  MEETUP_GRACE_MINUTES,
  MIN_GROUP_SIZE,
  MIN_TIME_OVERLAP_MINUTES,
  PICKUP_ORIGIN_ID,
  PICKUP_ORIGIN_LABEL,
  SMALL_GROUP_RELEASE_HOURS,
  arePreferencesCompatible,
  calculateCredibilityScore,
  overlapMinutes,
} from "@hop/shared";
import { v } from "convex/values";
import { buildLockedGroupDestinations } from "../lib/group-destinations";
import {
  MEETING_LOCATION_LABEL,
  deriveMeetingTime,
  generateQrPassphrase,
  getEmojiForMember,
  getGroupTheme,
  selectBookerUserId,
} from "../lib/group-lifecycle";
import {
  createStubCompatibility,
  createStubGeohashMap,
  createStubRevealEnvelopes,
} from "../lib/matcher-stub";
import type { CompatibilityEdge, MatchingCandidate, SelectedGroup } from "../lib/matching";
import { formGroups } from "../lib/matching";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalAction, internalMutation, mutation } from "./_generated/server";
import { resolveQaActingUserId } from "./localQa";

type RevealEnvelope = {
  recipientUserId: string;
  senderUserId: string;
  senderName: string;
  ciphertext: string;
};

type RevealContext = {
  groupStatus: "tentative" | "revealed" | "dissolved";
  isMember: boolean;
  allAccepted: boolean;
  members: Array<{
    userId: string;
    availabilityId: string;
    displayName: string;
    accepted: boolean | null;
    publicKey: null | string;
    sealedDestinationRef: null | string;
  }>;
  requesterEnvelopes: RevealEnvelope[];
};

function buildNotificationEmail(title: string, body: string) {
  return [
    '<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">',
    `<h2 style="margin:0 0 12px">${title}</h2>`,
    `<p style="margin:0 0 12px;line-height:1.5">${body}</p>`,
    '<p style="margin:0;color:#667085;font-size:12px">Hop keeps your ride group updated automatically.</p>',
    "</div>",
  ].join("");
}

async function scheduleLifecycleNotifications(
  ctx: MutationCtx,
  notifications: Array<{
    userId: Id<"users">;
    groupId?: Id<"groups">;
    kind: string;
    eventKey: string;
    title: string;
    body: string;
    emailSubject: string;
    emailHtml: string;
  }>,
) {
  if (notifications.length === 0) {
    return;
  }

  await ctx.scheduler.runAfter(0, internal.notifications.dispatchLifecycleNotifications, {
    notifications,
  });
}

// formGroups, evaluateGroup, and related helpers are in ../lib/matching.ts

async function fetchCompatibility(routeDescriptorRefs: string[]) {
  if ((process.env.MATCHER_MODE ?? "stub") !== "live") {
    return {
      edges: createStubCompatibility(routeDescriptorRefs),
      geohashByRef: createStubGeohashMap(routeDescriptorRefs),
    };
  }

  const matcherBaseUrl = process.env.MATCHER_BASE_URL ?? "http://localhost:4001";
  const response = await fetch(`${matcherBaseUrl}/matcher/compatibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routeDescriptorRefs }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to fetch matcher compatibility.");
  }

  const payload = (await response.json()) as {
    edges: CompatibilityEdge[];
    geohashByRef?: Record<string, string>;
  };
  return {
    edges: payload.edges,
    geohashByRef: new Map(Object.entries(payload.geohashByRef ?? {})),
  };
}

async function fetchRevealEnvelopes(
  members: Array<{
    userId: string;
    displayName: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  if ((process.env.MATCHER_MODE ?? "stub") !== "live") {
    return await createStubRevealEnvelopes(members);
  }

  const matcherBaseUrl = process.env.MATCHER_BASE_URL ?? "http://localhost:4001";
  const response = await fetch(`${matcherBaseUrl}/matcher/reveal-envelopes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to reveal addresses.");
  }

  const payload = (await response.json()) as { envelopes: RevealEnvelope[] };
  return payload.envelopes;
}

export const confirmAliasAndVerify = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const verifications = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const pending = verifications.find(
      (r) => !r.verifiedAt && r.expiresAt > Date.now() && r.pendingAliasFrom,
    );
    if (!pending) throw new Error("No pending alias confirmation");
    await ctx.runMutation(internal.inboundMutations.verifyEmailReply, {
      verificationId: pending._id,
      name: pending.pendingAliasName,
    });
    return { ok: true };
  },
});

export const rejectAlias = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const verifications = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const pending = verifications.find(
      (r) => !r.verifiedAt && r.expiresAt > Date.now() && r.pendingAliasFrom,
    );
    if (!pending) throw new Error("No pending alias confirmation");
    await ctx.db.patch(pending._id, {
      pendingAliasFrom: undefined,
      pendingAliasName: undefined,
    });
    return { ok: true };
  },
});

export const savePreferences = mutation({
  args: {
    selfDeclaredGender: v.union(
      v.literal("woman"),
      v.literal("man"),
      v.literal("nonbinary"),
      v.literal("prefer_not_to_say"),
    ),
    sameGenderOnly: v.boolean(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("preferences", {
        userId,
        ...args,
      });
    }
    return { userId };
  },
});

export const completeOnboarding = mutation({
  args: {
    name: v.optional(v.string()),
    selfDeclaredGender: v.union(
      v.literal("woman"),
      v.literal("man"),
      v.literal("nonbinary"),
      v.literal("prefer_not_to_say"),
    ),
    sameGenderOnly: v.boolean(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const { name: userName, ...prefArgs } = args;

    const existingPref = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .first();
    if (existingPref) {
      await ctx.db.patch(existingPref._id, prefArgs);
    } else {
      await ctx.db.insert("preferences", {
        userId,
        ...prefArgs,
      });
    }
    const existingName = user.name?.trim();
    const submittedName = userName?.trim();
    await ctx.db.patch(userId, {
      onboardingComplete: true,
      ...(!existingName && submittedName && { name: submittedName }),
    });
    return { userId };
  },
});

export const createAvailability = mutation({
  args: {
    windowStart: v.string(),
    windowEnd: v.string(),
    selfDeclaredGender: v.union(
      v.literal("woman"),
      v.literal("man"),
      v.literal("nonbinary"),
      v.literal("prefer_not_to_say"),
    ),
    sameGenderOnly: v.boolean(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
    sealedDestinationRef: v.string(),
    routeDescriptorRef: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existingMembers = await ctx.db
      .query("groupMembers")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();

    for (const member of existingMembers) {
      if ((member.amountDueCents ?? 0) <= 0 || member.paymentVerifiedAt) continue;
      const group = await ctx.db.get(member.groupId);
      if (
        !group ||
        group.status === "cancelled" ||
        group.status === "closed" ||
        group.status === "dissolved"
      ) {
        continue;
      }

      throw new Error("Clear your previous trip payment before scheduling another ride.");
    }

    const existing = await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect();

    const newStart = new Date(args.windowStart).getTime();
    const newEnd = new Date(args.windowEnd).getTime();

    for (const a of existing) {
      const start = new Date(a.windowStart).getTime();
      const end = new Date(a.windowEnd).getTime();
      const overlap = newStart < end && newEnd > start;
      if (overlap) {
        await ctx.db.patch(a._id, { status: "cancelled" });
      }
    }

    return await ctx.db.insert("availabilities", {
      userId,
      ...args,
      createdAt: new Date().toISOString(),
      status: "open",
    });
  },
});

export const cancelAvailability = mutation({
  args: { availabilityId: v.id("availabilities") },
  handler: async (ctx, { availabilityId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const availability = await ctx.db.get(availabilityId);
    if (!availability || availability.userId !== userId) {
      throw new Error("Availability not found.");
    }

    // Prevent deletion of already-matched availabilities
    // (these belong to active groups and should be managed via group cancellation instead)
    if (availability.status === "matched") {
      throw new Error("Cannot delete an availability that is part of an active group.");
    }

    await ctx.db.patch(availabilityId, { status: "cancelled" });
    return { ok: true };
  },
});

export const updateAcknowledgement = mutation({
  args: {
    groupId: v.id("groups"),
    accepted: v.boolean(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, accepted, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.status !== "matched_pending_ack" && group.status !== "tentative") {
      throw new Error("Group is not waiting for acknowledgement");
    }

    const userIdStr = userId;
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
    const member = members.find((m) => m.userId === userIdStr);
    if (!member) throw new Error("Not a member of this group");

    await ctx.db.patch(member._id, {
      accepted,
      acknowledgementStatus: accepted ? "accepted" : "declined",
      acknowledgedAt: new Date().toISOString(),
    });

    return { ok: true };
  },
});

export const cancelTripParticipation = mutation({
  args: {
    groupId: v.id("groups"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");

    // Can only cancel after match, before trip is closed
    const CANCELLABLE_STATUSES = new Set([
      "matched_pending_ack",
      "tentative",
      "meetup_preparation",
      "meetup_ready",
      "in_trip",
      "depart_ready",
      "payment_pending",
    ]);
    if (!CANCELLABLE_STATUSES.has(group.status)) {
      throw new Error("Cannot cancel trip in current status");
    }

    const userIdStr = userId;
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
    const member = members.find((m) => m.userId === userIdStr);
    if (!member) throw new Error("Not a member of this group");

    // Mark user as cancelled and increment their cancelledTrips
    await ctx.db.patch(member._id, {
      participationStatus: "cancelled_by_user",
    });

    // Cancel the availability to prevent reuse and enforce the consequence
    const availability = await ctx.db.get(member.availabilityId as Id<"availabilities">);
    if (availability?.status === "matched") {
      await ctx.db.patch(availability._id, { status: "cancelled" });
    }

    const user = await ctx.db.get(userId);
    if (user) {
      await ctx.db.patch(userId, {
        cancelledTrips: (user.cancelledTrips ?? 0) + 1,
      });
    }

    return { ok: true, message: "You have cancelled your participation in this trip" };
  },
});

export const registerClientKey = mutation({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("clientKeys")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("revokedAt"), undefined))
      .first();
    if (existing && existing.publicKey === publicKey) return existing._id;
    return await ctx.db.insert("clientKeys", {
      userId,
      publicKey,
      createdAt: Date.now(),
    });
  },
});

export const upsertPushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, { endpoint, p256dh, auth, userAgent }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        p256dh,
        auth,
        userAgent,
        updatedAt: now,
        disabledAt: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint,
      p256dh,
      auth,
      userAgent,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const disablePushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (!existing || existing.userId !== userId) {
      return { ok: true };
    }

    await ctx.db.patch(existing._id, {
      disabledAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const createTentativeGroup = internalMutation({
  args: {
    windowStart: v.string(),
    windowEnd: v.string(),
    groupSize: v.number(),
    maxDetourMinutes: v.number(),
    averageScore: v.number(),
    minimumScore: v.number(),
    availabilityIds: v.array(v.string()),
    memberUserIds: v.array(v.string()),
    members: v.array(
      v.object({
        userId: v.string(),
        availabilityId: v.string(),
        displayName: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const inProgressStatuses = new Set([
      "tentative",
      "semi_locked",
      "locked",
      "matched_pending_ack",
      "group_confirmed",
      "meetup_preparation",
      "meetup_checkin",
      "depart_ready",
      "in_trip",
      "receipt_pending",
      "payment_pending",
    ]);
    const activeGroups = await ctx.db.query("groups").collect();
    const conflictingGroup = activeGroups.find(
      (group) =>
        inProgressStatuses.has(group.status) &&
        group.memberUserIds.some((memberUserId) => args.memberUserIds.includes(memberUserId)),
    );
    if (conflictingGroup) {
      return null;
    }

    const availabilityById = new Map<
      string,
      {
        createdAt?: string;
        sealedDestinationRef: string;
      }
    >();

    for (const availabilityId of args.availabilityIds) {
      const availability = await ctx.db.get(availabilityId as Id<"availabilities">);
      if (!availability || availability.status !== "open") {
        return null;
      }

      availabilityById.set(availabilityId, {
        createdAt: availability.createdAt,
        sealedDestinationRef: availability.sealedDestinationRef,
      });
    }

    const lockedDestinations = buildLockedGroupDestinations(
      args.members.map((member) => ({
        availabilityId: member.availabilityId,
        userId: member.userId,
      })),
      availabilityById,
    );
    const destinationByUserId = new Map(
      lockedDestinations.map((destination) => [destination.userId, destination]),
    );

    const theme = getGroupTheme(args.memberUserIds.join(":"));
    const meetingTime = deriveMeetingTime(args.windowStart);

    // Fetch user credibility scores for booker selection
    const userDocs = await Promise.all(
      args.memberUserIds.map((userId) => ctx.db.get(userId as Id<"users">)),
    );
    const credibilityScores = new Map<string, number>();
    for (const [index, userId] of args.memberUserIds.entries()) {
      const user = userDocs[index];
      if (user) {
        const score = calculateCredibilityScore({
          successfulTrips: user.successfulTrips ?? 0,
          cancelledTrips: user.cancelledTrips ?? 0,
          reportedCount: user.reportedCount ?? 0,
        });
        credibilityScores.set(userId, score);
      }
    }

    const bookerUserId = selectBookerUserId(args.memberUserIds, credibilityScores);

    const groupId = await ctx.db.insert("groups", {
      status: "tentative",
      pickupOriginId: PICKUP_ORIGIN_ID,
      pickupLabel: PICKUP_ORIGIN_LABEL,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      groupSize: args.groupSize,
      maxDetourMinutes: args.maxDetourMinutes,
      averageScore: args.averageScore,
      minimumScore: args.minimumScore,
      confirmationDeadline: new Date(Date.now() + ACK_WINDOW_MINUTES * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      availabilityIds: args.availabilityIds,
      memberUserIds: args.memberUserIds,
      meetingTime,
      meetingLocationLabel: MEETING_LOCATION_LABEL,
      graceDeadline: new Date(
        new Date(meetingTime).getTime() + MEETUP_GRACE_MINUTES * 60_000,
      ).toISOString(),
      groupName: theme.name,
      groupColor: theme.color,
      bookerUserId: bookerUserId ?? undefined,
      suggestedDropoffOrder: lockedDestinations.map((destination) => destination.userId),
      reportCount: 0,
    });

    for (const availabilityId of args.availabilityIds) {
      await ctx.db.patch(availabilityId as Id<"availabilities">, { status: "matched" });
    }

    for (const [index, member] of args.members.entries()) {
      const lockedDestination = destinationByUserId.get(member.userId);
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: member.userId,
        availabilityId: member.availabilityId,
        displayName: member.displayName,
        emoji: getEmojiForMember(groupId, index),
        accepted: null,
        acknowledgementStatus: "pending",
        acknowledgedAt: null,
        participationStatus: "active",
        destinationAddress: lockedDestination?.destinationAddress,
        destinationSubmittedAt: lockedDestination?.destinationSubmittedAt,
        destinationLockedAt: lockedDestination?.destinationLockedAt,
        qrToken: generateQrPassphrase(`${groupId}:${member.userId}:${index}`),
        dropoffOrder: lockedDestination?.dropoffOrder,
        paymentStatus: "none",
      });
    }

    await ctx.db.insert("auditEvents", {
      action: "group.created",
      actorId: groupId,
      metadata: {
        groupSize: args.groupSize,
        averageScore: args.averageScore,
      },
      createdAt: new Date().toISOString(),
    });

    await scheduleLifecycleNotifications(
      ctx,
      args.members.map((member) => ({
        userId: member.userId as Id<"users">,
        groupId,
        kind: "match_found",
        eventKey: `${groupId}:match_found:${member.userId}`,
        title: `You are matched in ${theme.name}`,
        body: `Confirm your Hop ride within 30 minutes so ${theme.name} can lock in the meetup at ${MEETING_LOCATION_LABEL}.`,
        emailSubject: `Confirm your Hop ride in ${theme.name}`,
        emailHtml: buildNotificationEmail(
          `You are matched in ${theme.name}`,
          `Confirm your Hop ride within 30 minutes so ${theme.name} can lock in the meetup at ${MEETING_LOCATION_LABEL}.`,
        ),
      })),
    );

    return groupId;
  },
});

export const storeRevealedEnvelopes = internalMutation({
  args: {
    groupId: v.id("groups"),
    envelopes: v.array(
      v.object({
        recipientUserId: v.string(),
        senderUserId: v.string(),
        senderName: v.string(),
        ciphertext: v.string(),
      }),
    ),
  },
  handler: async (ctx, { groupId, envelopes }) => {
    const existing = await ctx.db
      .query("envelopesByRecipient")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();

    for (const envelope of existing) {
      await ctx.db.delete(envelope._id);
    }

    for (const envelope of envelopes) {
      await ctx.db.insert("envelopesByRecipient", {
        groupId,
        recipientUserId: envelope.recipientUserId,
        senderUserId: envelope.senderUserId,
        senderName: envelope.senderName,
        ciphertext: envelope.ciphertext,
      });
    }

    await ctx.db.patch(groupId, {
      status: "revealed",
      revealedAt: new Date().toISOString(),
    });

    await ctx.db.insert("auditEvents", {
      action: "group.revealed",
      actorId: groupId,
      metadata: { members: envelopes.length },
      createdAt: new Date().toISOString(),
    });

    return { ok: true };
  },
});

function computeGroupWindow(members: MatchingCandidate[]) {
  const latestStart = Math.max(...members.map((m) => new Date(m.windowStart).getTime()));
  const earliestEnd = Math.min(...members.map((m) => new Date(m.windowEnd).getTime()));
  return {
    windowStart: new Date(latestStart).toISOString(),
    windowEnd: new Date(Math.max(earliestEnd, latestStart)).toISOString(),
  };
}

async function createGroupsFromSelection(ctx: ActionCtx, selectedGroups: SelectedGroup[]) {
  let created = 0;
  for (const selected of selectedGroups) {
    const { windowStart, windowEnd } = computeGroupWindow(selected.members);
    const groupId = await ctx.runMutation(internal.mutations.createTentativeGroup, {
      windowStart,
      windowEnd,
      groupSize: selected.members.length,
      maxDetourMinutes: selected.maxDetourMinutes,
      averageScore: selected.averageScore,
      minimumScore: selected.minimumScore,
      availabilityIds: selected.members.map((member) => member.availabilityId),
      memberUserIds: selected.members.map((member) => member.userId),
      members: selected.members.map((member) => ({
        userId: member.userId,
        availabilityId: member.availabilityId,
        displayName: member.displayName,
      })),
    });
    if (groupId) created += 1;
  }
  return created;
}

export const runMatching = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const candidates = (await ctx.runQuery(
      internal.queries.getMatchingCandidates,
      {},
    )) as MatchingCandidate[];
    if (candidates.length < 2) {
      return { created: 0 };
    }

    const { edges, geohashByRef } = await fetchCompatibility(
      candidates.map((entry) => entry.routeDescriptorRef),
    );
    const selectedGroups = formGroups(candidates, edges, geohashByRef);
    const created = await createGroupsFromSelection(ctx, selectedGroups);
    return { created };
  },
});

export const runMatchingCron = internalAction({
  args: {},
  handler: async (ctx) => {
    const candidates = (await ctx.runQuery(
      internal.queries.getMatchingCandidates,
      {},
    )) as MatchingCandidate[];
    if (candidates.length < 2) {
      return { created: 0 };
    }

    const { edges, geohashByRef } = await fetchCompatibility(
      candidates.map((entry) => entry.routeDescriptorRef),
    );
    const selectedGroups = formGroups(candidates, edges, geohashByRef);
    const created = await createGroupsFromSelection(ctx, selectedGroups);
    return { created };
  },
});

export const runMatchingWithEdges = action({
  args: {
    edges: v.array(
      v.object({
        leftRef: v.string(),
        rightRef: v.string(),
        score: v.number(),
        detourMinutes: v.number(),
        spreadDistanceKm: v.number(),
        routeOverlap: v.number(),
        destinationProximity: v.number(),
      }),
    ),
  },
  handler: async (ctx, { edges }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const candidates = (await ctx.runQuery(
      internal.queries.getMatchingCandidates,
      {},
    )) as MatchingCandidate[];
    if (candidates.length < 2) {
      return { created: 0 };
    }

    const selectedGroups = formGroups(candidates, edges);
    const created = await createGroupsFromSelection(ctx, selectedGroups);
    return { created };
  },
});

export const revealGroupAddresses = action({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const requesterId = await getAuthUserId(ctx);
    if (!requesterId) throw new Error("Not authenticated");

    const revealContext = (await ctx.runQuery(internal.queries.getRevealContext, {
      groupId,
      requesterId,
    })) as null | RevealContext;
    if (!revealContext?.isMember) {
      throw new Error("Not a member of this group");
    }

    if (revealContext.groupStatus === "revealed") {
      return { envelopes: revealContext.requesterEnvelopes };
    }

    if (!revealContext.allAccepted) {
      throw new Error("All riders must acknowledge before reveal.");
    }

    const incompleteMember = revealContext.members.find(
      (member) => !member.publicKey || !member.sealedDestinationRef,
    );
    if (incompleteMember) {
      throw new Error("All group members must open Hop before addresses can be revealed.");
    }

    const envelopes = await fetchRevealEnvelopes(
      revealContext.members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        publicKey: member.publicKey as string,
        sealedDestinationRef: member.sealedDestinationRef as string,
      })),
    );

    await ctx.runMutation(internal.mutations.storeRevealedEnvelopes, {
      groupId,
      envelopes,
    });

    return {
      envelopes: envelopes.filter(
        (envelope) => envelope.recipientUserId === (requesterId as string),
      ),
    };
  },
});

export const lockGroups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const lockHorizon = now + LOCK_HOURS_BEFORE * 3_600_000;

    const groups = await ctx.db.query("groups").collect();
    const tentativeGroups = groups.filter(
      (g) => g.status === "tentative" && new Date(g.windowStart).getTime() <= lockHorizon,
    );

    let lockedCount = 0;
    let semiLockedCount = 0;

    for (const group of tentativeGroups) {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("groupId", (q) => q.eq("groupId", group._id))
        .collect();
      const activeMembers = members.filter((m) => m.participationStatus === "active");

      const activeCount = activeMembers.length;

      if (activeCount >= MAX_GROUP_SIZE) {
        const bookerUserId = selectBookerUserId(activeMembers.map((m) => m.userId));
        await ctx.db.patch(group._id, {
          status: "matched_pending_ack",
          groupSize: activeCount,
          confirmationDeadline: new Date(now + ACK_WINDOW_MINUTES * 60_000).toISOString(),
          bookerUserId: bookerUserId ?? group.bookerUserId,
        });
        lockedCount += 1;

        await scheduleLifecycleNotifications(
          ctx,
          activeMembers.map((member) => ({
            userId: member.userId as Id<"users">,
            groupId: group._id,
            kind: "group_locked",
            eventKey: `${group._id}:locked:${member.userId}`,
            title: `${group.groupName ?? "Your group"} is locked`,
            body: "Your ride group is full. Confirm within 30 minutes to lock in your spot.",
            emailSubject: `${group.groupName ?? "Your Hop group"} is locked — confirm now`,
            emailHtml: buildNotificationEmail(
              `${group.groupName ?? "Your group"} is locked`,
              "Your ride group is full. Confirm within 30 minutes to lock in your spot.",
            ),
          })),
        );
      } else {
        const spotsLeft = MAX_GROUP_SIZE - activeCount;
        await ctx.db.patch(group._id, { status: "semi_locked", groupSize: activeCount });
        semiLockedCount += 1;

        await scheduleLifecycleNotifications(
          ctx,
          activeMembers.map((member) => ({
            userId: member.userId as Id<"users">,
            groupId: group._id,
            kind: "group_semi_locked",
            eventKey: `${group._id}:semi_locked:${member.userId}`,
            title: `${group.groupName ?? "Your group"} is forming`,
            body: `${activeCount} riders matched. Open to ${spotsLeft} more until 30 min before departure.`,
            emailSubject: `${group.groupName ?? "Your Hop group"} is forming`,
            emailHtml: buildNotificationEmail(
              `${group.groupName ?? "Your group"} is forming`,
              `${activeCount} riders matched. Open to ${spotsLeft} more until 30 min before departure.`,
            ),
          })),
        );
      }
    }

    return { lockedCount, semiLockedCount };
  },
});

export const hardLockGroups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const hardLockHorizon = now + HARD_LOCK_MINUTES_BEFORE * 60_000;

    const groups = await ctx.db.query("groups").collect();
    const semiLockedGroups = groups.filter(
      (g) => g.status === "semi_locked" && new Date(g.windowStart).getTime() <= hardLockHorizon,
    );

    let hardLockedCount = 0;

    for (const group of semiLockedGroups) {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("groupId", (q) => q.eq("groupId", group._id))
        .collect();

      const activeMembers = members.filter((m) => m.participationStatus === "active");
      const memberUserIds = activeMembers.map((m) => m.userId);
      const bookerUserId = selectBookerUserId(memberUserIds);

      await ctx.db.patch(group._id, {
        status: "matched_pending_ack",
        confirmationDeadline: new Date(now + ACK_WINDOW_MINUTES * 60_000).toISOString(),
        bookerUserId: bookerUserId ?? group.bookerUserId,
      });
      hardLockedCount += 1;

      await scheduleLifecycleNotifications(
        ctx,
        activeMembers.map((member) => ({
          userId: member.userId as Id<"users">,
          groupId: group._id,
          kind: "group_hard_locked",
          eventKey: `${group._id}:hard_locked:${member.userId}`,
          title: `${group.groupName ?? "Your group"} is locked`,
          body: "All groups finalized. Confirm your ride — booker will book once everyone checks in.",
          emailSubject: `${group.groupName ?? "Your Hop group"} is locked — confirm now`,
          emailHtml: buildNotificationEmail(
            `${group.groupName ?? "Your group"} is locked`,
            "All groups finalized. Confirm your ride — booker will book once everyone checks in.",
          ),
        })),
      );
    }

    return { hardLockedCount };
  },
});

export const lateJoinGroup = action({
  args: {
    availabilityId: v.id("availabilities"),
  },
  handler: async (
    ctx,
    { availabilityId },
  ): Promise<{ joined: boolean; reason?: string; groupId?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const availability = (await ctx.runQuery(internal.queries.getAvailabilityById, {
      availabilityId,
    })) as {
      _id: Id<"availabilities">;
      userId: Id<"users">;
      windowStart: string;
      windowEnd: string;
      routeDescriptorRef: string;
      sealedDestinationRef: string;
      selfDeclaredGender: "woman" | "man" | "nonbinary" | "prefer_not_to_say";
      sameGenderOnly: boolean;
      status: string;
    } | null;

    if (!availability || availability.userId !== userId || availability.status !== "open") {
      throw new Error("No valid open availability found.");
    }

    const existingRefs = (await ctx.runQuery(
      internal.queries.getSemiLockedGroupRouteRefs,
      {},
    )) as string[];
    const allRefs = [...new Set([...existingRefs, availability.routeDescriptorRef])];
    const { edges, geohashByRef } = await fetchCompatibility(allRefs);

    const geohashRecord: Record<string, string> = {};
    if (geohashByRef) {
      for (const [key, value] of geohashByRef) geohashRecord[key] = value;
    }

    return (await ctx.runMutation(internal.mutations.attemptLateJoin, {
      userId,
      availabilityId,
      windowStart: availability.windowStart,
      windowEnd: availability.windowEnd,
      routeDescriptorRef: availability.routeDescriptorRef,
      sealedDestinationRef: availability.sealedDestinationRef,
      selfDeclaredGender: availability.selfDeclaredGender,
      sameGenderOnly: availability.sameGenderOnly,
      compatibilityEdges: edges.map((e) => ({
        leftRef: e.leftRef,
        rightRef: e.rightRef,
        detourMinutes: e.detourMinutes,
        spreadDistanceKm: e.spreadDistanceKm,
      })),
      geohashByRef: geohashRecord,
    })) as { joined: boolean; reason?: string; groupId?: string };
  },
});

export const attemptLateJoin = internalMutation({
  args: {
    userId: v.id("users"),
    availabilityId: v.id("availabilities"),
    windowStart: v.string(),
    windowEnd: v.string(),
    routeDescriptorRef: v.string(),
    sealedDestinationRef: v.string(),
    selfDeclaredGender: v.union(
      v.literal("woman"),
      v.literal("man"),
      v.literal("nonbinary"),
      v.literal("prefer_not_to_say"),
    ),
    sameGenderOnly: v.boolean(),
    compatibilityEdges: v.array(
      v.object({
        leftRef: v.string(),
        rightRef: v.string(),
        detourMinutes: v.number(),
        spreadDistanceKm: v.number(),
      }),
    ),
    geohashByRef: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db
      .query("groupMembers")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    const activeMemberships = existingMembership.filter((m) => m.participationStatus === "active");
    if (activeMemberships.length > 0) {
      const activeGroupStatuses = new Set([
        "tentative",
        "semi_locked",
        "locked",
        "matched_pending_ack",
        "group_confirmed",
        "meetup_preparation",
        "meetup_checkin",
        "depart_ready",
        "in_trip",
        "receipt_pending",
        "payment_pending",
      ]);
      for (const membership of activeMemberships) {
        const group = await ctx.db.get(membership.groupId);
        if (group && activeGroupStatuses.has(group.status)) {
          return { joined: false, reason: "Already in an active group." };
        }
      }
    }

    const edgeMap = new Map<string, { detourMinutes: number; spreadDistanceKm: number }>();
    for (const edge of args.compatibilityEdges) {
      const key = [edge.leftRef, edge.rightRef].sort().join("::");
      edgeMap.set(key, edge);
    }

    const joiner = { windowStart: args.windowStart, windowEnd: args.windowEnd };
    const groups = await ctx.db.query("groups").collect();
    const candidateGroups = groups.filter((g) => {
      if (g.status !== "semi_locked") return false;
      return overlapMinutes(joiner, g) > MIN_TIME_OVERLAP_MINUTES;
    });

    const joinerAvailability = await ctx.db.get(args.availabilityId);

    let targetGroup = null;
    let targetActiveMembers: Array<{
      _id: Id<"groupMembers">;
      userId: string;
      availabilityId: string;
      participationStatus?: string;
      displayName: string;
      [key: string]: unknown;
    }> = [];
    for (const group of candidateGroups) {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("groupId", (q) => q.eq("groupId", group._id))
        .collect();
      const activeMembers = members.filter((m) => m.participationStatus === "active");

      if (activeMembers.length >= MAX_GROUP_SIZE) continue;

      const activeAvailabilities = await Promise.all(
        activeMembers.map((m) => ctx.db.get(m.availabilityId as Id<"availabilities">)),
      );

      const newSize = activeMembers.length + 1;

      const sizeOk =
        activeAvailabilities.every((avail) => {
          if (!avail) return true;
          return (
            newSize >= (avail.minGroupSize ?? MIN_GROUP_SIZE) &&
            newSize <= (avail.maxGroupSize ?? MAX_GROUP_SIZE)
          );
        }) &&
        joinerAvailability != null &&
        newSize >= (joinerAvailability.minGroupSize ?? MIN_GROUP_SIZE) &&
        newSize <= (joinerAvailability.maxGroupSize ?? MAX_GROUP_SIZE);
      if (!sizeOk) continue;

      const genderOk = activeAvailabilities.every((avail) => {
        if (!avail) return true;
        return arePreferencesCompatible(
          { selfDeclaredGender: args.selfDeclaredGender, sameGenderOnly: args.sameGenderOnly },
          { selfDeclaredGender: avail.selfDeclaredGender, sameGenderOnly: avail.sameGenderOnly },
        );
      });
      if (!genderOk) continue;

      const routeOk = activeAvailabilities.every((avail) => {
        if (!avail) return true;
        const key = [args.routeDescriptorRef, avail.routeDescriptorRef].sort().join("::");
        const edge = edgeMap.get(key);
        if (!edge) return false;
        return edge.detourMinutes <= MAX_DETOUR_MINUTES && edge.spreadDistanceKm <= MAX_SPREAD_KM;
      });
      if (!routeOk) continue;

      const allRefs = [
        ...activeAvailabilities.map((a) => a?.routeDescriptorRef).filter(Boolean),
        args.routeDescriptorRef,
      ] as string[];
      const allClusters = allRefs.map((ref) => args.geohashByRef[ref]).filter(Boolean);
      if (allClusters.length === allRefs.length) {
        const distinctLocations = new Set(allClusters).size;
        if (distinctLocations > MAX_DISTINCT_LOCATIONS) continue;
      }

      targetGroup = group;
      targetActiveMembers = activeMembers;
      break;
    }

    if (!targetGroup) {
      return { joined: false, reason: "No compatible semi-locked groups found." };
    }

    const user = await ctx.db.get(args.userId);
    const displayName = user?.name?.trim() || "Hop member";

    const newMemberUserIds = [...targetActiveMembers.map((m) => m.userId), args.userId];
    const newAvailabilityIds = [
      ...targetActiveMembers.map((m) => m.availabilityId),
      args.availabilityId as string,
    ];

    const allRosterMembers = [
      ...targetActiveMembers.map((m) => ({
        availabilityId: m.availabilityId,
        userId: m.userId,
      })),
      { availabilityId: args.availabilityId as string, userId: args.userId as string },
    ];
    const availabilityById = new Map<
      string,
      { createdAt?: string; sealedDestinationRef: string }
    >();
    for (const member of allRosterMembers) {
      const avail = await ctx.db.get(member.availabilityId as Id<"availabilities">);
      if (avail) {
        availabilityById.set(member.availabilityId, {
          createdAt: avail.createdAt,
          sealedDestinationRef: avail.sealedDestinationRef,
        });
      }
    }

    const allLockedDestinations = buildLockedGroupDestinations(allRosterMembers, availabilityById);
    const newMemberDest = allLockedDestinations.find((d) => d.userId === (args.userId as string));
    if (!newMemberDest) {
      return { joined: false, reason: "Failed to compute destination for new member." };
    }

    const suggestedDropoffOrder = allLockedDestinations.map((d) => d.userId);

    await ctx.db.patch(targetGroup._id, {
      groupSize: newMemberUserIds.length,
      memberUserIds: newMemberUserIds,
      availabilityIds: newAvailabilityIds,
      suggestedDropoffOrder,
    });

    await ctx.db.patch(args.availabilityId, { status: "matched" });

    for (const dest of allLockedDestinations) {
      if (dest.userId === (args.userId as string)) continue;
      const activeMember = targetActiveMembers.find((m) => m.userId === dest.userId);
      if (activeMember) {
        await ctx.db.patch(activeMember._id, { dropoffOrder: dest.dropoffOrder });
      }
    }

    await ctx.db.insert("groupMembers", {
      groupId: targetGroup._id,
      userId: args.userId,
      availabilityId: args.availabilityId as string,
      displayName,
      emoji: getEmojiForMember(targetGroup._id, newMemberUserIds.length - 1),
      accepted: true,
      acknowledgementStatus: "accepted",
      acknowledgedAt: new Date().toISOString(),
      participationStatus: "active",
      destinationAddress: newMemberDest.destinationAddress,
      destinationSubmittedAt: newMemberDest.destinationSubmittedAt,
      destinationLockedAt: newMemberDest.destinationLockedAt,
      dropoffOrder: newMemberDest.dropoffOrder,
      qrToken: generateQrPassphrase(
        `${targetGroup._id}:${args.userId}:${newMemberUserIds.length - 1}`,
      ),
      paymentStatus: "none",
    });

    await scheduleLifecycleNotifications(
      ctx,
      targetActiveMembers
        .filter((m) => m.userId !== args.userId)
        .map((member) => ({
          userId: member.userId as Id<"users">,
          groupId: targetGroup._id,
          kind: "late_join",
          eventKey: `${targetGroup._id}:late_join:${args.userId}:${member.userId}`,
          title: "A new rider joined your group!",
          body: `${displayName} joined ${targetGroup.groupName ?? "your group"}.`,
          emailSubject: "A new rider joined your Hop group",
          emailHtml: buildNotificationEmail(
            "A new rider joined your group!",
            `${displayName} joined ${targetGroup.groupName ?? "your group"}.`,
          ),
        })),
    );

    return { joined: true, groupId: targetGroup._id };
  },
});

export const requestRedelegate = mutation({
  args: {
    groupId: v.id("groups"),
    volunteerAsBooker: v.boolean(),
  },
  handler: async (ctx, { groupId, volunteerAsBooker }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    const REDELEGATABLE_STATUSES = new Set([
      "semi_locked",
      "locked",
      "matched_pending_ack",
      "meetup_preparation",
    ]);
    if (!REDELEGATABLE_STATUSES.has(group.status)) {
      throw new Error("Group is not in a state that allows redelegation.");
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
    const activeMembers = members.filter((m) => m.participationStatus === "active");
    const member = activeMembers.find((m) => m.userId === userId);
    if (!member) throw new Error("Not an active member of this group");

    const allRedelegationVotes = await ctx.db
      .query("auditEvents")
      .withIndex("action", (q) => q.eq("action", "group.redelegate_vote"))
      .collect();
    const redelegationVotes = allRedelegationVotes.filter((e) => e.metadata?.groupId === groupId);
    const alreadyVoted = redelegationVotes.some((e) => e.metadata?.voterId === userId);
    if (alreadyVoted) throw new Error("You have already voted to redelegate.");

    await ctx.db.insert("auditEvents", {
      action: "group.redelegate_vote",
      actorId: userId,
      metadata: {
        groupId,
        voterId: userId,
        volunteerAsBooker,
      },
      createdAt: new Date().toISOString(),
    });

    const totalVotes = redelegationVotes.length + 1;
    const threshold = Math.ceil(activeMembers.length / 2);

    if (totalVotes >= threshold) {
      const volunteers = [
        ...redelegationVotes
          .filter((e) => e.metadata?.volunteerAsBooker)
          .map((e) => e.metadata?.voterId as string),
        ...(volunteerAsBooker ? [userId as string] : []),
      ];

      const newBooker =
        volunteers.length > 0
          ? selectBookerUserId(volunteers)
          : selectBookerUserId(activeMembers.map((m) => m.userId));

      if (newBooker) {
        await ctx.db.patch(groupId, { bookerUserId: newBooker });

        await scheduleLifecycleNotifications(
          ctx,
          activeMembers.map((m) => {
            const bookerMember = activeMembers.find((am) => am.userId === newBooker);
            return {
              userId: m.userId as Id<"users">,
              groupId,
              kind: "booker_changed",
              eventKey: `${groupId}:booker_changed:${newBooker}:${m.userId}`,
              title: "Booker changed",
              body: `Booker changed to ${bookerMember?.displayName ?? "a group member"}.`,
              emailSubject: "Hop group booker changed",
              emailHtml: buildNotificationEmail(
                "Booker changed",
                `Booker changed to ${bookerMember?.displayName ?? "a group member"}.`,
              ),
            };
          }),
        );
      }
    }

    return { ok: true, totalVotes, threshold };
  },
});
