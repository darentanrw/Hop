import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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

    // 1. Auth: sessions and accounts for this user
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();

    const sessionIds = sessions.map((s) => s._id);
    const accountIds = accounts.map((a) => a._id);

    // 2. Delete authRefreshTokens (by sessionId)
    for (const sessionId of sessionIds) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();
      for (const t of tokens) await ctx.db.delete(t._id);
    }

    // 3. Delete authVerificationCodes (by accountId)
    for (const accountId of accountIds) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", accountId))
        .collect();
      for (const c of codes) await ctx.db.delete(c._id);
    }

    // 4. Delete authVerifiers (by sessionId)
    const verifiers = await ctx.db.query("authVerifiers").collect();
    for (const ver of verifiers) {
      if (ver.sessionId && sessionIds.includes(ver.sessionId)) {
        await ctx.db.delete(ver._id);
      }
    }

    // 5. Delete authSessions and authAccounts
    for (const s of sessions) await ctx.db.delete(s._id);
    for (const a of accounts) await ctx.db.delete(a._id);

    // 6. Delete emailVerifications and clientKeys
    const verifications = await ctx.db
      .query("emailVerifications")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    const clientKeys = await ctx.db
      .query("clientKeys")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const ev of verifications) await ctx.db.delete(ev._id);
    for (const ck of clientKeys) await ctx.db.delete(ck._id);

    // 7. preferences
    const prefs = await ctx.db
      .query("preferences")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const p of prefs) await ctx.db.delete(p._id);

    // 8. availabilities
    const avails = await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const a of avails) await ctx.db.delete(a._id);

    // 9. groupMembers
    const allGroupMembers = await ctx.db.query("groupMembers").collect();
    for (const m of allGroupMembers) {
      if (m.userId === userIdStr) await ctx.db.delete(m._id);
    }

    // 10. envelopesByRecipient
    const allEnvelopes = await ctx.db.query("envelopesByRecipient").collect();
    for (const e of allEnvelopes) {
      if (e.recipientUserId === userIdStr || e.senderUserId === userIdStr) {
        await ctx.db.delete(e._id);
      }
    }

    // 11. Delete user
    await ctx.db.delete(userId);

    return {
      deleted: true,
      email: user.email,
    };
  },
});
