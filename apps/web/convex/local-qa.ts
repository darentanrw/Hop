import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

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

export async function resolveQaActingUserId(
  ctx: QueryCtx | MutationCtx,
  actingUserId?: Id<"users">,
) {
  const authUserId = await getAuthUserId(ctx);
  if (!authUserId) return null;

  if (!actingUserId || actingUserId === authUserId) {
    return authUserId;
  }

  if (process.env.ENABLE_LOCAL_QA !== "true") {
    return authUserId;
  }

  const activeGroup = await findActiveGroupForUser(ctx, authUserId);
  if (!activeGroup || !activeGroup.memberUserIds.includes(actingUserId)) {
    return authUserId;
  }

  return actingUserId;
}
