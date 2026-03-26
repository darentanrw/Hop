import { getAuthUserId } from "@convex-dev/auth/server";
import { calculateCredibilityScore, isCredibilitySuspended } from "@hop/shared";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isAdminUserEmail } from "./adminAccess";

/** Thrown when a user below the credibility threshold tries to create a new ride window. */
export const SCHEDULING_NOT_ALLOWED_ERROR =
  "Your account has been suspended as your credibility score has fallen below 30. Contact help@hophome.app if you require assistance.";

export async function assertUserCanScheduleNewRide(ctx: MutationCtx, effectiveUserId: Id<"users">) {
  const authUserId = await getAuthUserId(ctx);
  const authUser = authUserId ? await ctx.db.get(authUserId) : null;
  if (isAdminUserEmail(authUser?.email)) return;

  const subject = await ctx.db.get(effectiveUserId);
  if (!subject) throw new Error("Not authenticated");

  const score = calculateCredibilityScore({
    successfulTrips: subject.successfulTrips ?? 0,
    cancelledTrips: subject.cancelledTrips ?? 0,
    confirmedReportCount: subject.confirmedReportCount ?? 0,
  });
  if (isCredibilitySuspended(score)) {
    throw new Error(SCHEDULING_NOT_ALLOWED_ERROR);
  }
}
