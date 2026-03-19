import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { resolveQaActingUserId } from "./localQa";

export const CHAT_ELIGIBLE_STATUSES = new Set([
  "group_confirmed",
  "meetup_preparation",
  "meetup_checkin",
  "depart_ready",
  "in_trip",
  "receipt_pending",
  "payment_pending",
]);

const MAX_MESSAGE_LENGTH = 500;

export const listMessages = query({
  args: {
    groupId: v.id("groups"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) return [];

    const group = await ctx.db.get(groupId);
    if (!group || !CHAT_ELIGIBLE_STATUSES.has(group.status)) return [];

    const member = await ctx.db
      .query("groupMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
      .first();
    if (!member || (member.participationStatus ?? "active") !== "active") return [];

    return await ctx.db
      .query("groupMessages")
      .withIndex("groupId_createdAt", (q) => q.eq("groupId", groupId))
      .collect();
  },
});

export const sendMessage = mutation({
  args: {
    groupId: v.id("groups"),
    body: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, body, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Message cannot be empty.");
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (!CHAT_ELIGIBLE_STATUSES.has(group.status)) {
      throw new Error("Chat is not available for this group right now.");
    }

    const member = await ctx.db
      .query("groupMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
      .first();
    if (!member || (member.participationStatus ?? "active") !== "active") {
      throw new Error("You are not an active member of this group.");
    }

    await ctx.db.insert("groupMessages", {
      groupId,
      senderUserId: userId,
      senderDisplayName: member.displayName,
      senderEmoji: member.emoji ?? "🙂",
      body: trimmed,
      createdAt: new Date().toISOString(),
    });

    return { ok: true };
  },
});
