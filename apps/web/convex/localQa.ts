import { getAuthUserId } from "@convex-dev/auth/server";
import { isMembershipInActiveRide } from "../lib/ride-eligibility";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type GroupDoc = Doc<"groups">;

async function findActiveGroupForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  const pairs = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      group: await ctx.db.get(membership.groupId),
    })),
  );

  return (
    pairs
      .filter(
        ({ membership, group }) =>
          group !== null &&
          (group.status === "reported" || isMembershipInActiveRide(membership, group)),
      )
      .map(({ group }) => group)
      .filter((group): group is GroupDoc => Boolean(group))
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
