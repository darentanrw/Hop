import { getAuthUserId } from "@convex-dev/auth/server";
import { calculateCredibilityScore, isCredibilitySuspended } from "@hop/shared";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isAdminUserEmail } from "./adminAccess";

export const CREDIBILITY_SUSPENSION_ERROR =
  "Your Hop account is suspended because your credibility score is too low. Contact support if you need help.";

export async function assertEffectiveUserNotCredibilitySuspended(
  ctx: MutationCtx,
  effectiveUserId: Id<"users">,
) {
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
    throw new Error(CREDIBILITY_SUSPENSION_ERROR);
  }
}
