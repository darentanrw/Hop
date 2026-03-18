import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";

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
    selfDeclaredGender: preference.selfDeclaredGender,
    sameGenderOnly: preference.sameGenderOnly,
    minGroupSize: preference.minGroupSize,
    maxGroupSize: preference.maxGroupSize,
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
    const pendingVerification = pendingVerifications.find(
      (r) => !r.verifiedAt && r.expiresAt > Date.now(),
    );
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
    const verification = verifications.find((rec) => !rec.verifiedAt && rec.expiresAt > Date.now());
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
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
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
