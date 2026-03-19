import { MAX_GROUP_SIZE, MIN_GROUP_SIZE } from "@hop/shared";
import { v } from "convex/values";
import { findNewestVerificationMatchByBody } from "../lib/inbound-email";
import { internalMutation, internalQuery } from "./_generated/server";

export const getPendingVerificationByBody = internalQuery({
  args: { bodyText: v.string() },
  handler: async (ctx, { bodyText }) => {
    const all = await ctx.db.query("emailVerifications").collect();
    const active = all.filter((record) => !record.verifiedAt && record.expiresAt > Date.now());
    const match = findNewestVerificationMatchByBody(active, bodyText);
    return match ? { id: match._id, email: match.email, userId: match.userId } : null;
  },
});

export const storePendingAlias = internalMutation({
  args: {
    verificationId: v.id("emailVerifications"),
    aliasFrom: v.string(),
    aliasName: v.optional(v.string()),
  },
  handler: async (ctx, { verificationId, aliasFrom, aliasName }) => {
    const verification = await ctx.db.get(verificationId);
    if (!verification || verification.verifiedAt) return;
    if (verification.expiresAt < Date.now()) return;
    await ctx.db.patch(verificationId, {
      pendingAliasFrom: aliasFrom.trim().toLowerCase(),
      ...(aliasName && { pendingAliasName: aliasName }),
    });
  },
});

export const verifyEmailReply = internalMutation({
  args: {
    verificationId: v.id("emailVerifications"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { verificationId, name }) => {
    const verification = await ctx.db.get(verificationId);
    if (!verification || verification.verifiedAt) return;
    if (verification.expiresAt < Date.now()) return;

    console.log(
      `[verifyEmailReply] Verifying ${verification.email}${name ? `, name: ${name}` : ""}`,
    );
    await ctx.db.patch(verificationId, {
      verifiedAt: Date.now(),
      pendingAliasFrom: undefined,
      pendingAliasName: undefined,
    });
    await ctx.db.patch(verification.userId, {
      emailVerified: true,
      ...(name ? { name } : {}),
    });

    const existingPref = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", verification.userId))
      .first();
    if (!existingPref) {
      await ctx.db.insert("preferences", {
        userId: verification.userId,
        selfDeclaredGender: "prefer_not_to_say",
        sameGenderOnly: false,
        minGroupSize: MIN_GROUP_SIZE,
        maxGroupSize: MAX_GROUP_SIZE,
      });
    }
  },
});
