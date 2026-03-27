import { getAuthUserId } from "@convex-dev/auth/server";
import {
  CREDIBILITY_SUSPENSION_THRESHOLD,
  MIN_GROUP_SIZE,
  calculateCredibilityScore,
  isCredibilitySuspended,
} from "@hop/shared";
import { selectBookerUserId } from "../lib/group-lifecycle";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isAdminUserEmail } from "./adminAccess";

/** Thrown when a user below the credibility threshold tries to create a new ride window. */
export const SCHEDULING_NOT_ALLOWED_ERROR = `Your account has been suspended as your credibility score has fallen below ${CREDIBILITY_SUSPENSION_THRESHOLD}. Contact help@hophome.app if you require assistance.`;

const PRE_RIDE_STATUSES = new Set(["tentative", "semi_locked", "locked", "matched_pending_ack"]);

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

/**
 * After a credibility-affecting action (e.g. admin confirming a report),
 * check whether the user is now suspended. If so, cancel their open
 * availabilities and evict them from any pre-ride groups.
 *
 * Returns the number of availabilities cancelled and groups affected.
 */
export async function enforceSuspensionSideEffects(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ cancelledAvailabilities: number; evictedFromGroups: number }> {
  const user = await ctx.db.get(userId);
  if (!user) return { cancelledAvailabilities: 0, evictedFromGroups: 0 };

  const score = calculateCredibilityScore({
    successfulTrips: user.successfulTrips ?? 0,
    cancelledTrips: user.cancelledTrips ?? 0,
    confirmedReportCount: user.confirmedReportCount ?? 0,
  });

  if (!isCredibilitySuspended(score)) {
    return { cancelledAvailabilities: 0, evictedFromGroups: 0 };
  }

  let cancelledAvailabilities = 0;
  const availabilities = await ctx.db
    .query("availabilities")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const availability of availabilities) {
    if (availability.status === "open") {
      await ctx.db.patch(availability._id, { status: "cancelled" });
      cancelledAvailabilities++;
    }
  }

  let evictedFromGroups = 0;
  const userIdStr = userId as string;
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();

  for (const membership of memberships) {
    if ((membership.participationStatus ?? "active") !== "active") continue;
    const group = await ctx.db.get(membership.groupId);
    if (!group || !PRE_RIDE_STATUSES.has(group.status)) continue;

    await ctx.db.patch(membership._id, { participationStatus: "removed_no_ack" });

    const matchedAvail = await ctx.db.get(membership.availabilityId as Id<"availabilities">);
    if (matchedAvail?.status === "matched") {
      await ctx.db.patch(matchedAvail._id, { status: "cancelled" });
    }

    const updatedMemberUserIds = group.memberUserIds.filter((id) => id !== userIdStr);
    const updatedAvailabilityIds = group.availabilityIds.filter(
      (id) => id !== (membership.availabilityId as unknown as string),
    );

    if (updatedMemberUserIds.length < MIN_GROUP_SIZE) {
      const otherMembers = await ctx.db
        .query("groupMembers")
        .withIndex("groupId", (q) => q.eq("groupId", group._id))
        .collect();
      for (const other of otherMembers) {
        if (other.userId === userIdStr) continue;
        if ((other.participationStatus ?? "active") !== "active") continue;
        await ctx.db.patch(other._id, { participationStatus: "removed_no_ack" });
        const otherAvail = await ctx.db.get(other.availabilityId as Id<"availabilities">);
        if (otherAvail?.status === "matched") {
          await ctx.db.patch(otherAvail._id, { status: "open" });
        }
      }
      await ctx.db.patch(group._id, {
        status: "cancelled",
        memberUserIds: updatedMemberUserIds,
        availabilityIds: updatedAvailabilityIds,
        groupSize: updatedMemberUserIds.length,
        bookerUserId: undefined,
      });
    } else {
      const newBooker =
        group.bookerUserId === userIdStr
          ? (selectBookerUserId(updatedMemberUserIds) ?? updatedMemberUserIds[0])
          : group.bookerUserId;

      await ctx.db.patch(group._id, {
        memberUserIds: updatedMemberUserIds,
        availabilityIds: updatedAvailabilityIds,
        groupSize: updatedMemberUserIds.length,
        bookerUserId: newBooker,
      });
    }

    evictedFromGroups++;
  }

  return { cancelledAvailabilities, evictedFromGroups };
}
