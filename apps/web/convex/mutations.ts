import { getAuthUserId } from "@convex-dev/auth/server";
import {
  ACK_WINDOW_MINUTES,
  MAX_DETOUR_MINUTES,
  MEETUP_GRACE_MINUTES,
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
import { createStubCompatibility, createStubRevealEnvelopes } from "../lib/matcher-stub";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalMutation, mutation } from "./_generated/server";
import { resolveQaActingUserId } from "./localQa";

type MatchingCandidate = {
  availabilityId: Id<"availabilities">;
  userId: Id<"users">;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: "woman" | "man" | "nonbinary" | "prefer_not_to_say";
  sameGenderOnly: boolean;
  minGroupSize: number;
  maxGroupSize: number;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  estimatedFareBand: "S$10-15" | "S$16-20" | "S$21-25" | "S$26+";
  displayName: string;
};

type CompatibilityEdge = {
  leftRef: string;
  rightRef: string;
  score: number;
  detourMinutes: number;
};

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

function pairKey(left: string, right: string) {
  return [left, right].sort().join("::");
}

function groupAllowedForMembers(members: MatchingCandidate[]) {
  const size = members.length;
  return members.every((member) => size >= member.minGroupSize && size <= member.maxGroupSize);
}

function evaluateGroup(
  members: MatchingCandidate[],
  compatibilityMap: Map<string, CompatibilityEdge>,
) {
  const pairScores: CompatibilityEdge[] = [];

  for (let index = 0; index < members.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < members.length; compareIndex += 1) {
      const left = members[index];
      const right = members[compareIndex];
      const edge = compatibilityMap.get(pairKey(left.routeDescriptorRef, right.routeDescriptorRef));
      if (!edge) return null;
      if (edge.detourMinutes > MAX_DETOUR_MINUTES) return null;
      if (overlapMinutes(left, right) < 60) return null;
      if (!arePreferencesCompatible(left, right)) return null;
      pairScores.push(edge);
    }
  }

  if (!groupAllowedForMembers(members)) {
    return null;
  }

  const averageScore =
    pairScores.reduce((total, score) => total + score.score, 0) / Math.max(pairScores.length, 1);
  const minimumScore = Math.min(...pairScores.map((score) => score.score), 1);
  const maxDetourMinutes = Math.max(...pairScores.map((score) => score.detourMinutes), 0);

  return {
    averageScore: Number(averageScore.toFixed(2)),
    minimumScore: Number(minimumScore.toFixed(2)),
    maxDetourMinutes,
  };
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  if (size === 1) return items.map((item) => [item]);

  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = items.slice(index + 1);
    for (const tail of combinations(rest, size - 1)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}

async function fetchCompatibility(routeDescriptorRefs: string[]) {
  if ((process.env.MATCHER_MODE ?? "stub") !== "live") {
    return createStubCompatibility(routeDescriptorRefs);
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

  const payload = (await response.json()) as { edges: CompatibilityEdge[] };
  return payload.edges;
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
    estimatedFareBand: v.union(
      v.literal("S$10-15"),
      v.literal("S$16-20"),
      v.literal("S$21-25"),
      v.literal("S$26+"),
    ),
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
    estimatedFareBand: v.union(
      v.literal("S$10-15"),
      v.literal("S$16-20"),
      v.literal("S$21-25"),
      v.literal("S$26+"),
    ),
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
    const activeGroups = await ctx.db.query("groups").collect();
    const conflictingGroup = activeGroups.find(
      (group) =>
        group.status !== "dissolved" &&
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
      status: "matched_pending_ack",
      pickupOriginId: PICKUP_ORIGIN_ID,
      pickupLabel: PICKUP_ORIGIN_LABEL,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      groupSize: args.groupSize,
      estimatedFareBand: args.estimatedFareBand,
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

    const edges = await fetchCompatibility(candidates.map((entry) => entry.routeDescriptorRef));
    const compatibilityMap = new Map<string, CompatibilityEdge>();
    for (const edge of edges) {
      compatibilityMap.set(pairKey(edge.leftRef, edge.rightRef), edge);
    }

    const unmatched = [...candidates];
    const selectedGroups: Array<{
      members: MatchingCandidate[];
      averageScore: number;
      minimumScore: number;
      maxDetourMinutes: number;
    }> = [];

    const trySize = (size: number) => {
      let best: {
        members: MatchingCandidate[];
        averageScore: number;
        minimumScore: number;
        maxDetourMinutes: number;
      } | null = null;

      for (const candidateMembers of combinations(unmatched, size)) {
        const hoursUntilStart =
          (new Date(candidateMembers[0].windowStart).getTime() - Date.now()) / 3_600_000;
        if (size < 4 && hoursUntilStart > SMALL_GROUP_RELEASE_HOURS) {
          continue;
        }

        const evaluation = evaluateGroup(candidateMembers, compatibilityMap);
        if (!evaluation) continue;

        const current = { members: candidateMembers, ...evaluation };
        if (
          !best ||
          current.averageScore > best.averageScore ||
          (current.averageScore === best.averageScore &&
            current.minimumScore > best.minimumScore) ||
          (current.averageScore === best.averageScore &&
            current.minimumScore === best.minimumScore &&
            current.maxDetourMinutes < best.maxDetourMinutes)
        ) {
          best = current;
        }
      }

      if (!best) return false;

      selectedGroups.push(best);
      for (const member of best.members) {
        const index = unmatched.findIndex(
          (entry) => entry.availabilityId === member.availabilityId,
        );
        if (index >= 0) unmatched.splice(index, 1);
      }
      return true;
    };

    while (unmatched.length >= 2) {
      if (trySize(4)) continue;
      if (trySize(3)) continue;
      if (trySize(2)) continue;
      break;
    }

    let created = 0;
    for (const selected of selectedGroups) {
      const fareBands = selected.members.map((member) => member.estimatedFareBand);
      const groupId = await ctx.runMutation(internal.mutations.createTentativeGroup, {
        windowStart: selected.members[0].windowStart,
        windowEnd: selected.members[0].windowEnd,
        groupSize: selected.members.length,
        estimatedFareBand: fareBands.sort()[0],
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
