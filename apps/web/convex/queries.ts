import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery, query } from "./_generated/server";
import { requireAdmin } from "./adminAccess";

async function getRiderProfileInternal(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const preference = await ctx.db
    .query("preferences")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .first();
  if (!preference) return null;
  return {
    userId: userId,
    name: user.name,
    email: user.email,
    selfDeclaredGender: preference.selfDeclaredGender,
    sameGenderOnly: preference.sameGenderOnly,
    successfulTrips: user.successfulTrips ?? 0,
    cancelledTrips: user.cancelledTrips ?? 0,
    reportedCount: user.reportedCount ?? 0,
  };
}

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const getVerificationStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const pendingVerifications = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const pendingVerification = pendingVerifications
      .filter((record) => !record.verifiedAt && record.expiresAt > Date.now())
      .sort((left, right) => right._creationTime - left._creationTime)[0];
    const pendingAlias =
      pendingVerification?.pendingAliasFrom && pendingVerification.expiresAt > Date.now()
        ? {
            from: pendingVerification.pendingAliasFrom,
            name: pendingVerification.pendingAliasName,
            signupEmail: pendingVerification.email,
          }
        : null;
    return {
      emailVerified: user.emailVerified ?? false,
      onboardingComplete: user.onboardingComplete ?? false,
      pendingAlias,
    };
  },
});

export const getRiderProfile = query({
  args: {},
  handler: async (ctx) => getRiderProfileInternal(ctx),
});

export const listAvailabilities = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getRiderProfileInternal(ctx);
    if (!profile) return [];
    return await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", profile.userId))
      .collect();
  },
});

export const getActiveGroup = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getRiderProfileInternal(ctx);
    if (!profile) return null;
    const groups = await ctx.db.query("groups").collect();
    const userIdStr = profile.userId;
    const group = groups.find(
      (g) => g.status !== "dissolved" && g.memberUserIds.includes(userIdStr),
    );
    if (!group) return null;
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", group._id))
      .collect();
    const revealReady = members.length > 0 && members.every((m) => m.accepted === true);
    return {
      group: {
        ...group,
        id: group._id,
      },
      members: members.map((m) => ({
        userId: m.userId,
        availabilityId: m.availabilityId,
        displayName: m.displayName,
        accepted: m.accepted,
        acknowledgedAt: m.acknowledgedAt,
      })),
      revealReady,
    };
  },
});

export const getPendingVerificationByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    const verifications = await ctx.db
      .query("emailVerifications")
      .withIndex("email", (q) => q.eq("email", normalized))
      .collect();
    const verification = verifications
      .filter((record) => !record.verifiedAt && record.expiresAt > Date.now())
      .sort((left, right) => right._creationTime - left._creationTime)[0];
    if (!verification) return null;
    return {
      id: verification._id,
      passphrase: verification.passphrase,
    };
  },
});

export const adminSnapshot = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    const availabilities = await ctx.db.query("availabilities").collect();
    const groups = await ctx.db.query("groups").collect();
    const auditEvents = await ctx.db.query("auditEvents").order("desc").take(20);
    return {
      users: users.length,
      openAvailabilities: availabilities.filter((a) => a.status === "open").length,
      tentativeGroups: groups.filter((g) => g.status === "tentative").length,
      revealedGroups: groups.filter((g) => g.status === "revealed").length,
      auditEvents: auditEvents.reverse(),
    };
  },
});

export const getMatchingCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const availabilities = await ctx.db.query("availabilities").collect();
    const openAvailabilities = availabilities.filter(
      (availability) =>
        availability.status === "open" && new Date(availability.windowEnd).getTime() > now,
    );
    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((user) => [user._id, user]));

    return openAvailabilities.map((availability) => ({
      availabilityId: availability._id,
      userId: availability.userId,
      windowStart: availability.windowStart,
      windowEnd: availability.windowEnd,
      selfDeclaredGender: availability.selfDeclaredGender,
      sameGenderOnly: availability.sameGenderOnly,
      routeDescriptorRef: availability.routeDescriptorRef,
      sealedDestinationRef: availability.sealedDestinationRef,
      displayName: userById.get(availability.userId)?.name?.trim() || "Hop member",
      partySize: availability.partySize ?? 1,
    }));
  },
});

export const getRevealContext = internalQuery({
  args: {
    groupId: v.id("groups"),
    requesterId: v.id("users"),
  },
  handler: async (ctx, { groupId, requesterId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) return null;

    const requesterIdStr = requesterId as string;
    const isMember = group.memberUserIds.includes(requesterIdStr);
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
    const requesterEnvelopes = await ctx.db
      .query("envelopesByRecipient")
      .withIndex("groupId_recipient", (q) =>
        q.eq("groupId", groupId).eq("recipientUserId", requesterIdStr),
      )
      .collect();

    const membersWithKeys = await Promise.all(
      members.map(async (member) => {
        const availability = await ctx.db.get(member.availabilityId as Id<"availabilities">);
        const clientKey = await ctx.db
          .query("clientKeys")
          .withIndex("userId", (q) => q.eq("userId", member.userId as Id<"users">))
          .filter((q) => q.eq(q.field("revokedAt"), undefined))
          .first();

        return {
          userId: member.userId,
          availabilityId: member.availabilityId,
          displayName: member.displayName,
          accepted: member.accepted,
          publicKey: clientKey?.publicKey ?? null,
          sealedDestinationRef: availability?.sealedDestinationRef ?? null,
        };
      }),
    );

    return {
      groupStatus: group.status,
      isMember,
      allAccepted: members.length > 0 && members.every((member) => member.accepted === true),
      members: membersWithKeys,
      requesterEnvelopes: requesterEnvelopes.map((envelope) => ({
        recipientUserId: envelope.recipientUserId,
        senderUserId: envelope.senderUserId,
        senderName: envelope.senderName,
        ciphertext: envelope.ciphertext,
      })),
    };
  },
});

export const getAvailabilityById = internalQuery({
  args: { availabilityId: v.id("availabilities") },
  handler: async (ctx, { availabilityId }) => {
    return await ctx.db.get(availabilityId);
  },
});

export const getSemiLockedGroupRouteRefs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    const joinableGroups = groups.filter(
      (g) => g.status === "semi_locked" || g.status === "tentative",
    );
    const allAvailIds = joinableGroups.flatMap((g) => g.availabilityIds);
    const refs: string[] = [];
    for (const id of allAvailIds) {
      const avail = await ctx.db.get(id as Id<"availabilities">);
      if (avail?.routeDescriptorRef) refs.push(avail.routeDescriptorRef);
    }
    return [...new Set(refs)];
  },
});
