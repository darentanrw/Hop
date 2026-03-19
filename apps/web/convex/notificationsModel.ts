import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getNotificationRecipient = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();

    return {
      userId,
      email: user.email ?? null,
      name: user.name ?? null,
      subscriptions: subscriptions
        .filter((subscription) => !subscription.disabledAt)
        .map((subscription) => ({
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        })),
    };
  },
});

export const hasNotificationEvent = internalQuery({
  args: {
    eventKey: v.string(),
  },
  handler: async (ctx, { eventKey }) => {
    const existing = await ctx.db
      .query("notificationEvents")
      .withIndex("eventKey", (q) => q.eq("eventKey", eventKey))
      .first();
    return Boolean(existing);
  },
});

export const recordNotificationEvent = internalMutation({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
    eventKey: v.string(),
    kind: v.string(),
    channel: v.union(v.literal("push"), v.literal("email")),
    status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationEvents")
      .withIndex("eventKey", (q) => q.eq("eventKey", args.eventKey))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("notificationEvents", {
      ...args,
      createdAt: new Date().toISOString(),
    });
  },
});

export const disablePushSubscriptionByEndpoint = internalMutation({
  args: {
    endpoint: v.string(),
  },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("endpoint", (q) => q.eq("endpoint", endpoint))
      .first();

    if (!existing) {
      return { ok: true };
    }

    await ctx.db.patch(existing._id, {
      disabledAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
