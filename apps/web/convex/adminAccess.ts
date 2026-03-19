import { getAuthUserId } from "@convex-dev/auth/server";
import { isEmailAllowlisted, normalizeAdminEmails } from "../lib/admin-access";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AdminReadableCtx = QueryCtx | MutationCtx;

export function getAdminAllowlist() {
  return normalizeAdminEmails(process.env.ADMIN_EMAILS);
}

export function isAdminUserEmail(email: string | undefined | null) {
  return isEmailAllowlisted(email, getAdminAllowlist());
}

export async function getAdminActor(ctx: AdminReadableCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return {
      userId: null,
      user: null,
      isAdmin: false,
    };
  }

  const user = (await ctx.db.get(userId)) as Doc<"users"> | null;
  return {
    userId,
    user,
    isAdmin: isAdminUserEmail(user?.email),
  };
}

export async function requireAdmin(ctx: AdminReadableCtx) {
  const actor = await getAdminActor(ctx);
  if (!actor.userId) {
    throw new Error("Not authenticated");
  }
  if (!actor.isAdmin) {
    throw new Error("Admin access required.");
  }
  return actor;
}
