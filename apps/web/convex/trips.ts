import { getAuthUserId } from "@convex-dev/auth/server";
import { PAYMENT_WINDOW_HOURS, calculateCredibilityScore } from "@hop/shared";
import { v } from "convex/values";
import { computeSplitAmounts, selectBookerUserId } from "../lib/group-lifecycle";
import { buildNotificationEmail } from "../lib/notification-email";
import { checkRideEligibility, isMembershipInActiveRide } from "../lib/ride-eligibility";
import { BOOKER_ABSENT_BUFFER_MS, REDELEGATE_STATUSES, buildActions } from "../lib/trip-actions";
import { canViewGroupReceipt, canViewPaymentProof } from "../lib/trip-receipts";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { CHAT_ELIGIBLE_STATUSES } from "./chat";
import { resolveQaActingUserId } from "./localQa";

type GroupDoc = Doc<"groups">;
type GroupMemberDoc = Doc<"groupMembers">;

function nowIso() {
  return new Date().toISOString();
}

function addHours(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(cents / 100);
}

async function scheduleLifecycleNotifications(
  ctx: MutationCtx,
  notifications: Array<{
    userId: Id<"users">;
    groupId?: Id<"groups">;
    kind: string;
    eventKey: string;
    title: string;
    body: string;
    emailSubject: string;
    emailHtml: string;
  }>,
) {
  if (notifications.length === 0) {
    return;
  }

  await ctx.scheduler.runAfter(0, internal.notifications.dispatchLifecycleNotifications, {
    notifications,
  });
}

async function listGroupMembers(ctx: QueryCtx | MutationCtx, groupId: Id<"groups">) {
  return await ctx.db
    .query("groupMembers")
    .withIndex("groupId", (q) => q.eq("groupId", groupId))
    .collect();
}

function getActiveMembers(members: GroupMemberDoc[]) {
  return members.filter((member) => (member.participationStatus ?? "active") === "active");
}

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
      .filter(({ membership, group }) => isMembershipInActiveRide(membership, group))
      .map(({ group }) => group)
      .filter((group): group is GroupDoc => Boolean(group))
      .sort((left, right) => right._creationTime - left._creationTime)[0] ?? null
  );
}

async function reopenAvailability(ctx: MutationCtx, availabilityId: string) {
  const availability = await ctx.db.get(availabilityId as Id<"availabilities">);
  if (availability?.status === "matched") {
    await ctx.db.patch(availability._id, { status: "open" });
  }
}

export async function syncLifecycleForGroup(ctx: MutationCtx, group: GroupDoc) {
  const members = await listGroupMembers(ctx, group._id);
  const activeMembers = getActiveMembers(members);
  const now = Date.now();

  if (group.status === "matched_pending_ack") {
    const acceptedMembers = activeMembers.filter(
      (member) =>
        member.acknowledgementStatus === "accepted" ||
        (member.accepted === true && !member.acknowledgementStatus),
    );
    const pendingMembers = activeMembers.filter(
      (member) =>
        member.acknowledgementStatus === "pending" ||
        (member.accepted === null && !member.acknowledgementStatus),
    );
    const shouldResolve =
      pendingMembers.length === 0 ||
      new Date(group.confirmationDeadline).getTime() <= now ||
      activeMembers.some(
        (member) => member.acknowledgementStatus === "declined" || member.accepted === false,
      );

    if (shouldResolve) {
      if (acceptedMembers.length >= 2) {
        const acceptedIds = new Set(acceptedMembers.map((member) => member._id));
        const acceptedUserIds = acceptedMembers.map((member) => member.userId);
        const acceptedAvailabilityIds = acceptedMembers.map((member) => member.availabilityId);
        const removedMembers = members.filter((member) => !acceptedIds.has(member._id));
        const orderedAcceptedMembers = [...acceptedMembers].sort(
          (left, right) =>
            (left.dropoffOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.dropoffOrder ?? Number.MAX_SAFE_INTEGER) ||
            left.userId.localeCompare(right.userId),
        );

        for (const member of removedMembers) {
          await ctx.db.patch(member._id, {
            participationStatus: "removed_no_ack",
            acknowledgementStatus:
              member.acknowledgementStatus === "declined" || member.accepted === false
                ? "declined"
                : "timed_out",
          });
          await reopenAvailability(ctx, member.availabilityId);
        }

        for (const [index, member] of orderedAcceptedMembers.entries()) {
          await ctx.db.patch(member._id, {
            dropoffOrder: index + 1,
          });
        }

        // Select the highest-credibility booker among accepted riders.
        const userDocs = await Promise.all(
          acceptedUserIds.map((userId) => ctx.db.get(userId as Id<"users">)),
        );
        const credibilityScores = new Map<string, number>();
        for (const [index, acceptedUserId] of acceptedUserIds.entries()) {
          const user = userDocs[index];
          if (user) {
            const score = calculateCredibilityScore({
              successfulTrips: user.successfulTrips ?? 0,
              cancelledTrips: user.cancelledTrips ?? 0,
              reportedCount: user.reportedCount ?? 0,
            });
            credibilityScores.set(acceptedUserId, score);
          }
        }
        const nextBookerUserId =
          selectBookerUserId(acceptedUserIds, credibilityScores) ?? acceptedUserIds[0];

        await ctx.db.patch(group._id, {
          status: "meetup_preparation",
          memberUserIds: acceptedUserIds,
          availabilityIds: acceptedAvailabilityIds,
          groupSize: acceptedMembers.length,
          bookerUserId: nextBookerUserId,
          suggestedDropoffOrder: orderedAcceptedMembers.map((member) => member.userId),
        });

        await scheduleLifecycleNotifications(ctx, [
          ...acceptedMembers.map((member) => ({
            userId: member.userId as Id<"users">,
            groupId: group._id,
            kind: "group_confirmed",
            eventKey: `${group._id}:group_confirmed:${member.userId}`,
            title: `${group.groupName ?? "Hop Group"} is confirmed`,
            body: `Your booking destination is already locked. Get ready to meet at ${group.meetingLocationLabel ?? group.pickupLabel}.`,
            emailSubject: `${group.groupName ?? "Hop Group"} is confirmed`,
            emailHtml: buildNotificationEmail(
              `${group.groupName ?? "Hop Group"} is confirmed`,
              `Your booking destination is already locked. Get ready to meet at ${group.meetingLocationLabel ?? group.pickupLabel}.`,
            ),
          })),
          ...removedMembers.map((member) => ({
            userId: member.userId as Id<"users">,
            groupId: group._id,
            kind: "match_closed",
            eventKey: `${group._id}:match_closed:${member.userId}`,
            title: `${group.groupName ?? "Hop Group"} moved on without you`,
            body: "This ride continued with the riders who acknowledged in time. You can look for another Hop ride.",
            emailSubject: `${group.groupName ?? "Hop Group"} moved on without you`,
            emailHtml: buildNotificationEmail(
              `${group.groupName ?? "Hop Group"} moved on without you`,
              "This ride continued with the riders who acknowledged in time. You can look for another Hop ride.",
            ),
          })),
        ]);
      } else {
        await ctx.db.patch(group._id, { status: "cancelled" });
        for (const member of members) {
          await reopenAvailability(ctx, member.availabilityId);
        }

        // Increment cancelledTrips only for members who didn't acknowledge (not their fault others didn't)
        // Declined members explicitly chose not to ride
        const declinedOrTimedOut = activeMembers.filter(
          (member) =>
            member.acknowledgementStatus === "declined" ||
            member.accepted === false ||
            member.acknowledgementStatus === "pending",
        );
        for (const member of declinedOrTimedOut) {
          const user = await ctx.db.get(member.userId as Id<"users">);
          if (user) {
            await ctx.db.patch(member.userId as Id<"users">, {
              cancelledTrips: (user.cancelledTrips ?? 0) + 1,
            });
          }
        }

        await scheduleLifecycleNotifications(
          ctx,
          activeMembers.map((member) => ({
            userId: member.userId as Id<"users">,
            groupId: group._id,
            kind: "match_cancelled",
            eventKey: `${group._id}:match_cancelled:${member.userId}`,
            title: `${group.groupName ?? "Hop Group"} could not be confirmed`,
            body: "Not enough riders acknowledged in time. You can head back into the queue for another ride.",
            emailSubject: `${group.groupName ?? "Hop Group"} could not be confirmed`,
            emailHtml: buildNotificationEmail(
              `${group.groupName ?? "Hop Group"} could not be confirmed`,
              "Not enough riders acknowledged in time. You can head back into the queue for another ride.",
            ),
          })),
        );
      }
    }
  }

  if (group.status === "group_confirmed") {
    const allDestinationsReady =
      activeMembers.length > 0 &&
      activeMembers.every((member) => Boolean(member.destinationLockedAt));
    if (allDestinationsReady) {
      await ctx.db.patch(group._id, { status: "meetup_preparation" });
    }
  }

  if (group.status === "meetup_checkin") {
    const everyoneCheckedIn =
      activeMembers.length > 0 && activeMembers.every((member) => Boolean(member.checkedInAt));
    const graceExpired = group.graceDeadline
      ? new Date(group.graceDeadline).getTime() <= now
      : false;

    if (everyoneCheckedIn || graceExpired) {
      await ctx.db.patch(group._id, { status: "depart_ready" });
    }
  }

  if (group.status === "payment_pending") {
    // Credit for verified payments is done in verifyPayment (single writer) for durable idempotency.
    // Here we only close the group when all payment members have paid.
    const paymentMembers = activeMembers.filter((member) => (member.amountDueCents ?? 0) > 0);
    const allPaid = paymentMembers.every((member) => member.paymentStatus === "verified");
    if (allPaid) {
      const latestGroup = await ctx.db.get(group._id);
      await ctx.db.patch(group._id, {
        status: "closed",
        closedAt: latestGroup?.closedAt ?? group.closedAt ?? nowIso(),
      });
    }
  }

  return await ctx.db.get(group._id);
}

async function buildTripPayload(
  ctx: QueryCtx | MutationCtx,
  group: GroupDoc,
  currentUserId: string,
) {
  const members = await listGroupMembers(ctx, group._id);
  const reports = await ctx.db
    .query("reports")
    .withIndex("groupId", (q) => q.eq("groupId", group._id))
    .collect();

  const currentUserMember = members.find((member) => member.userId === currentUserId) ?? null;
  const isCurrentGroupMember = Boolean(currentUserMember);
  const activeMembers = getActiveMembers(members);
  const checkedInMembers = activeMembers.filter((member) => Boolean(member.checkedInAt));
  const outstandingPayments = activeMembers.filter((member) => (member.amountDueCents ?? 0) > 0);
  const everyoneCheckedIn =
    activeMembers.length > 0 && activeMembers.every((member) => Boolean(member.checkedInAt));
  const graceExpired = group.graceDeadline
    ? new Date(group.graceDeadline).getTime() <= Date.now()
    : false;
  const meetingTime = group.meetingTime ?? group.windowStart;
  const bookerAbsentWindowPassed =
    new Date(meetingTime).getTime() + BOOKER_ABSENT_BUFFER_MS <= Date.now();

  const sortedByDropoff = [...activeMembers].sort(
    (left, right) =>
      (left.dropoffOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.dropoffOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const receiptImageUrl =
    group.receiptStorageId && canViewGroupReceipt({ isCurrentGroupMember })
      ? await ctx.storage.getUrl(group.receiptStorageId)
      : null;
  const membersWithPaymentProof = await Promise.all(
    members.map(async (member) => ({
      member,
      paymentProofImageUrl:
        member.paymentProofStorageId &&
        canViewPaymentProof({
          viewerUserId: currentUserId,
          bookerUserId: group.bookerUserId ?? null,
          memberUserId: member.userId,
        })
          ? await ctx.storage.getUrl(member.paymentProofStorageId)
          : null,
    })),
  );
  const currentUserMemberWithPaymentProof =
    membersWithPaymentProof.find(({ member }) => member.userId === currentUserId) ?? null;

  return {
    group: {
      id: group._id,
      status: group.status,
      pickupLabel: group.pickupLabel,
      windowStart: group.windowStart,
      windowEnd: group.windowEnd,
      groupSize: group.groupSize,
      maxDetourMinutes: group.maxDetourMinutes,
      confirmationDeadline: group.confirmationDeadline,
      meetingTime: group.meetingTime ?? group.windowStart,
      meetingLocationLabel: group.meetingLocationLabel ?? group.pickupLabel,
      graceDeadline: group.graceDeadline ?? addMinutes(group.windowStart, 5),
      groupName: group.groupName ?? "Hop Group",
      groupColor: group.groupColor ?? "#44d4c8",
      bookerUserId: group.bookerUserId ?? activeMembers[0]?.userId ?? null,
      suggestedDropoffOrder: group.suggestedDropoffOrder ?? [],
      finalCostCents: group.finalCostCents ?? null,
      receiptImageUrl,
      receiptSubmittedAt: group.receiptSubmittedAt ?? null,
      paymentDueAt: group.paymentDueAt ?? null,
      reportCount: reports.length,
      bookerCheckedIn: activeMembers.some(
        (member) => member.userId === group.bookerUserId && Boolean(member.checkedInAt),
      ),
    },
    currentUserId,
    currentUserMember: currentUserMemberWithPaymentProof
      ? {
          userId: currentUserMemberWithPaymentProof.member.userId,
          displayName: currentUserMemberWithPaymentProof.member.displayName,
          emoji: currentUserMemberWithPaymentProof.member.emoji ?? "🙂",
          destinationLockedAt: currentUserMemberWithPaymentProof.member.destinationLockedAt ?? null,
          qrToken: currentUserMemberWithPaymentProof.member.qrToken ?? null,
          amountDueCents: currentUserMemberWithPaymentProof.member.amountDueCents ?? 0,
          paymentStatus: currentUserMemberWithPaymentProof.member.paymentStatus ?? "none",
          paymentProofImageUrl: currentUserMemberWithPaymentProof.paymentProofImageUrl,
        }
      : null,
    members: membersWithPaymentProof.map(({ member, paymentProofImageUrl }) => ({
      userId: member.userId,
      displayName: member.displayName,
      emoji: member.emoji ?? "🙂",
      acknowledgementStatus:
        member.acknowledgementStatus ??
        (member.accepted === true
          ? "accepted"
          : member.accepted === false
            ? "declined"
            : "pending"),
      participationStatus: member.participationStatus ?? "active",
      checkedInAt: member.checkedInAt ?? null,
      checkedInByUserId: member.checkedInByUserId ?? null,
      destinationLockedAt: member.destinationLockedAt ?? null,
      dropoffOrder: member.dropoffOrder ?? null,
      amountDueCents: member.amountDueCents ?? 0,
      paymentStatus: member.paymentStatus ?? "none",
      paymentProofImageUrl,
      paymentSubmittedAt: member.paymentSubmittedAt ?? null,
      paymentVerifiedAt: member.paymentVerifiedAt ?? null,
      isBooker: member.userId === group.bookerUserId,
    })),
    stats: {
      activeMemberCount: activeMembers.length,
      checkedInCount: checkedInMembers.length,
      destinationCount: activeMembers.filter((member) => Boolean(member.destinationLockedAt))
        .length,
      outstandingPaymentCount: outstandingPayments.filter(
        (member) => member.paymentStatus !== "verified",
      ).length,
    },
    dropoffPreview: sortedByDropoff
      .filter((member) => member.dropoffOrder !== undefined)
      .map((member) => ({
        userId: member.userId,
        emoji: member.emoji ?? "🙂",
        order: member.dropoffOrder ?? null,
      })),
    actions: {
      ...buildActions(group, currentUserId, currentUserMember, {
        everyoneCheckedIn,
        graceExpired,
        bookerAbsentWindowPassed,
      }),
      canChat:
        CHAT_ELIGIBLE_STATUSES.has(group.status) &&
        (currentUserMember?.participationStatus ?? "active") === "active",
    },
  };
}

export const getRideEligibility = query({
  args: { actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) return null;

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

    const result = checkRideEligibility(pairs);

    const openAvailability = await ctx.db
      .query("availabilities")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();

    return {
      ...result,
      hasOpenWindow: Boolean(openAvailability),
      blocked: result.blocked || Boolean(openAvailability),
    };
  },
});

export const advanceCurrentGroupLifecycle = mutation({
  args: { actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await findActiveGroupForUser(ctx, userId);
    if (!group) return { ok: true };

    await syncLifecycleForGroup(ctx, group);
    return { ok: true };
  },
});

export const getActiveTrip = query({
  args: { actingUserId: v.optional(v.id("users")) },
  handler: async (ctx, { actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) return null;

    const group = await findActiveGroupForUser(ctx, userId);
    if (!group) return null;

    return await buildTripPayload(ctx, group, userId);
  },
});

export const submitGroupDestination = mutation({
  args: {
    groupId: v.id("groups"),
    address: v.string(),
  },
  handler: async (ctx, { groupId, address }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.status === "cancelled" || group.status === "closed" || group.status === "dissolved") {
      throw new Error("This group is no longer active.");
    }

    const member = await ctx.db
      .query("groupMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
      .first();
    if (!member || (member.participationStatus ?? "active") !== "active") {
      throw new Error("You are no longer part of this group.");
    }

    void address;
    throw new Error(
      "Your destination was locked with this booking window. Leave the group and create a new booking window if you need to change it.",
    );
  },
});

export const startMeetupCheckIn = mutation({
  args: {
    groupId: v.id("groups"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId) throw new Error("Only the booker can start check-in.");
    if (group.status !== "group_confirmed" && group.status !== "meetup_preparation") {
      throw new Error("Check-in cannot start yet.");
    }

    const members = await listGroupMembers(ctx, groupId);
    const activeMembers = getActiveMembers(members);
    if (!activeMembers.every((member) => Boolean(member.destinationLockedAt))) {
      throw new Error(
        "Every rider must have a confirmed booking destination before meetup check-in.",
      );
    }

    const bookerMember = activeMembers.find((member) => member.userId === userId);
    if (bookerMember && !bookerMember.checkedInAt) {
      await ctx.db.patch(bookerMember._id, {
        checkedInAt: nowIso(),
        checkedInByUserId: userId,
      });
    }

    await ctx.db.patch(groupId, { status: "meetup_checkin" });
    return { ok: true };
  },
});

export const scanGroupQrToken = mutation({
  args: {
    groupId: v.id("groups"),
    qrToken: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, qrToken, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId)
      throw new Error("Only the booker can verify rider attendance.");
    if (group.status !== "meetup_checkin" && group.status !== "depart_ready") {
      throw new Error("Check-in is not active for this group.");
    }

    const members = await listGroupMembers(ctx, groupId);
    const member = members.find(
      (entry) => entry.qrToken === qrToken && (entry.participationStatus ?? "active") === "active",
    );
    if (!member) throw new Error("That QR token does not belong to an active rider in this group.");

    await ctx.db.patch(member._id, {
      checkedInAt: member.checkedInAt ?? nowIso(),
      checkedInByUserId: userId,
    });

    await syncLifecycleForGroup(ctx, group);
    return { ok: true };
  },
});

export const departGroup = mutation({
  args: {
    groupId: v.id("groups"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId) throw new Error("Only the booker can depart the group.");

    const members = await listGroupMembers(ctx, groupId);
    const activeMembers = getActiveMembers(members);
    const graceExpired = group.graceDeadline
      ? new Date(group.graceDeadline).getTime() <= Date.now()
      : false;
    const everyoneCheckedIn =
      activeMembers.length > 0 && activeMembers.every((member) => Boolean(member.checkedInAt));

    if (!everyoneCheckedIn && !graceExpired) {
      throw new Error("Wait for everyone to check in or for the 5-minute grace window to end.");
    }

    const presentMembers = activeMembers.filter((member) => Boolean(member.checkedInAt));
    if (presentMembers.length < 2) {
      throw new Error("At least two riders need to be present to depart.");
    }

    const absentMembers = activeMembers.filter((member) => !member.checkedInAt);

    for (const member of absentMembers) {
      await ctx.db.patch(member._id, {
        participationStatus: "removed_no_show",
      });

      // No-show harms credibility: increment cancelledTrips
      const user = await ctx.db.get(member.userId as Id<"users">);
      if (user) {
        await ctx.db.patch(member.userId as Id<"users">, {
          cancelledTrips: (user.cancelledTrips ?? 0) + 1,
        });
      }
    }

    await ctx.db.patch(groupId, {
      status: "in_trip",
      departedAt: nowIso(),
      memberUserIds: presentMembers.map((member) => member.userId),
      availabilityIds: presentMembers.map((member) => member.availabilityId),
      groupSize: presentMembers.length,
      suggestedDropoffOrder: presentMembers
        .sort((left, right) => (left.dropoffOrder ?? 999) - (right.dropoffOrder ?? 999))
        .map((member) => member.userId),
    });

    await scheduleLifecycleNotifications(
      ctx,
      absentMembers.map((member) => ({
        userId: member.userId as Id<"users">,
        groupId,
        kind: "removed_no_show",
        eventKey: `${groupId}:removed_no_show:${member.userId}`,
        title: `You were removed from ${group.groupName ?? "Hop Group"}`,
        body: "The group departed after the meetup grace period because your attendance was not verified.",
        emailSubject: `You were removed from ${group.groupName ?? "Hop Group"}`,
        emailHtml: buildNotificationEmail(
          `You were removed from ${group.groupName ?? "Hop Group"}`,
          "The group departed after the meetup grace period because your attendance was not verified.",
        ),
      })),
    );

    return { ok: true };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const submitReceipt = mutation({
  args: {
    groupId: v.id("groups"),
    totalCostCents: v.number(),
    storageId: v.id("_storage"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, totalCostCents, storageId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId)
      throw new Error("Only the booker can upload the taxi receipt.");

    const members = await listGroupMembers(ctx, groupId);
    const activeMembers = getActiveMembers(members);
    const split = computeSplitAmounts(
      totalCostCents,
      activeMembers.map((member) => member.userId),
      userId,
    );
    const submittedAt = nowIso();

    await ctx.db.patch(groupId, {
      status: "payment_pending",
      finalCostCents: totalCostCents,
      receiptStorageId: storageId,
      receiptSubmittedAt: submittedAt,
      paymentDueAt: addHours(submittedAt, PAYMENT_WINDOW_HOURS),
    });

    for (const member of activeMembers) {
      const amountDueCents = split.get(member.userId) ?? 0;
      await ctx.db.patch(member._id, {
        amountDueCents,
        paymentStatus: member.userId === userId ? "not_required" : "owed",
      });
    }

    await scheduleLifecycleNotifications(
      ctx,
      activeMembers
        .filter((member) => member.userId !== userId)
        .map((member) => {
          const amountDueCents = split.get(member.userId) ?? 0;
          return {
            userId: member.userId as Id<"users">,
            groupId,
            kind: "payment_requested",
            eventKey: `${groupId}:payment_requested:${member.userId}:${storageId}`,
            title: `Payment proof is now due for ${group.groupName ?? "Hop Group"}`,
            body: `Upload proof of your ${formatCurrency(amountDueCents)} payment within 24 hours.`,
            emailSubject: `Payment proof is now due for ${group.groupName ?? "Hop Group"}`,
            emailHtml: buildNotificationEmail(
              `Payment proof is now due for ${group.groupName ?? "Hop Group"}`,
              `Upload proof of your ${formatCurrency(amountDueCents)} payment within 24 hours.`,
            ),
          };
        }),
    );

    return { ok: true };
  },
});

export const submitPaymentProof = mutation({
  args: {
    groupId: v.id("groups"),
    storageId: v.id("_storage"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, storageId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const member = await ctx.db
      .query("groupMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", groupId).eq("userId", userId))
      .first();
    if (!member || (member.amountDueCents ?? 0) <= 0) {
      throw new Error("There is no payment due for this rider.");
    }

    await ctx.db.patch(member._id, {
      paymentProofStorageId: storageId,
      paymentSubmittedAt: nowIso(),
      paymentStatus: "submitted",
    });

    return { ok: true };
  },
});

export const verifyPayment = mutation({
  args: {
    groupId: v.id("groups"),
    memberUserId: v.id("users"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, memberUserId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId) throw new Error("Only the booker can verify payments.");

    const member = await ctx.db
      .query("groupMembers")
      .withIndex("groupId_userId", (q) => q.eq("groupId", groupId).eq("userId", memberUserId))
      .first();
    if (!member || member.paymentStatus !== "submitted") {
      throw new Error("That rider has not submitted a payment proof yet.");
    }

    await ctx.db.patch(member._id, {
      paymentStatus: "verified",
      paymentVerifiedAt: nowIso(),
      paymentVerifiedByUserId: userId,
    });

    // Credit successfulTrips once per verified member (single writer = durable idempotency).
    const latestGroup = await ctx.db.get(groupId);
    const rewarded = (latestGroup?.rewardedUserIds ?? []) as string[];
    if (!rewarded.includes(memberUserId)) {
      const rewardUser = await ctx.db.get(memberUserId);
      if (rewardUser) {
        await ctx.db.patch(memberUserId, {
          successfulTrips: (rewardUser.successfulTrips ?? 0) + 1,
        });
      }
      await ctx.db.patch(groupId, {
        rewardedUserIds: [...rewarded, memberUserId],
      });
    }

    await syncLifecycleForGroup(ctx, (await ctx.db.get(groupId)) ?? group);
    return { ok: true };
  },
});

export const redelegateBooker = mutation({
  args: {
    groupId: v.id("groups"),
    newBookerUserId: v.id("users"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, newBookerUserId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId !== userId) throw new Error("Only the current booker can redelegate.");
    if (!REDELEGATE_STATUSES.has(group.status)) {
      throw new Error("Cannot redelegate booker in the current group status.");
    }

    const members = await listGroupMembers(ctx, groupId);
    const activeMembers = getActiveMembers(members);
    const target = activeMembers.find((member) => member.userId === (newBookerUserId as string));
    if (!target) throw new Error("Target user is not an active member of this group.");
    if (target.userId === (userId as string)) {
      throw new Error("Cannot redelegate to yourself.");
    }

    await ctx.db.patch(groupId, { bookerUserId: newBookerUserId });
    return { ok: true };
  },
});

export const reportBookerAbsent = mutation({
  args: {
    groupId: v.id("groups"),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, { groupId, actingUserId }) => {
    const userId = await resolveQaActingUserId(ctx, actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.bookerUserId === userId) {
      throw new Error("The booker cannot report themselves absent.");
    }
    if (group.status !== "meetup_checkin") {
      throw new Error("Cannot report booker absent in the current group status.");
    }

    const meetingTime = group.meetingTime ?? group.windowStart;
    const bufferElapsed = new Date(meetingTime).getTime() + BOOKER_ABSENT_BUFFER_MS <= Date.now();
    if (!bufferElapsed) {
      throw new Error("The 5-minute grace window after meeting time has not passed yet.");
    }

    const members = await listGroupMembers(ctx, groupId);
    const activeMembers = getActiveMembers(members);

    const callerMember = activeMembers.find((member) => member.userId === (userId as string));
    if (!callerMember) throw new Error("You are not an active member of this group.");

    const bookerMember = activeMembers.find(
      (member) => member.userId === (group.bookerUserId as string),
    );
    if (bookerMember?.checkedInAt) throw new Error("The booker has already checked in.");

    const checkedInNonBooker = activeMembers.filter(
      (member) => member.userId !== (group.bookerUserId as string) && Boolean(member.checkedInAt),
    );
    const candidates =
      checkedInNonBooker.length > 0
        ? checkedInNonBooker
        : activeMembers.filter((member) => member.userId !== (group.bookerUserId as string));

    if (candidates.length === 0) throw new Error("No eligible members to become booker.");

    const candidateUserIds = candidates.map((member) => member.userId);
    const credibilityScores = new Map<string, number>();
    for (const member of candidates) {
      const user = await ctx.db.get(member.userId as Id<"users">);
      if (user) {
        credibilityScores.set(
          member.userId,
          calculateCredibilityScore({
            successfulTrips: user.successfulTrips ?? 0,
            cancelledTrips: user.cancelledTrips ?? 0,
            reportedCount: user.reportedCount ?? 0,
          }),
        );
      }
    }

    const newBookerUserId = selectBookerUserId(candidateUserIds, credibilityScores);
    if (!newBookerUserId) throw new Error("No eligible members to become booker.");

    await ctx.db.patch(groupId, {
      bookerUserId: newBookerUserId as Id<"users">,
      bookerRedelegatedAt: nowIso(),
    });

    return { ok: true };
  },
});

export const createReport = mutation({
  args: {
    groupId: v.id("groups"),
    reportedUserId: v.optional(v.id("users")),
    category: v.union(
      v.literal("no_show"),
      v.literal("non_payment"),
      v.literal("unsafe_behavior"),
      v.literal("harassment"),
      v.literal("misconduct"),
      v.literal("other"),
    ),
    description: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await resolveQaActingUserId(ctx, args.actingUserId);
    if (!userId) throw new Error("Not authenticated");

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");

    await ctx.db.insert("reports", {
      groupId: args.groupId,
      reporterUserId: userId,
      reportedUserId: args.reportedUserId,
      category: args.category,
      description: args.description.trim(),
      createdAt: nowIso(),
    });

    await ctx.db.patch(args.groupId, {
      status: group.status === "closed" ? "reported" : "reported",
      reportCount: (group.reportCount ?? 0) + 1,
    });

    // Increment reportedCount for the reported user
    if (args.reportedUserId) {
      const reportedUser = await ctx.db.get(args.reportedUserId);
      if (reportedUser) {
        await ctx.db.patch(args.reportedUserId, {
          reportedCount: (reportedUser.reportedCount ?? 0) + 1,
        });
      }
    }

    return { ok: true };
  },
});
