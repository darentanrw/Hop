import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const selfDeclaredGender = v.union(
  v.literal("woman"),
  v.literal("man"),
  v.literal("nonbinary"),
  v.literal("prefer_not_to_say"),
);

const groupStatus = v.union(v.literal("tentative"), v.literal("revealed"), v.literal("dissolved"));
const lifecycleGroupStatus = v.union(
  v.literal("tentative"),
  v.literal("semi_locked"),
  v.literal("locked"),
  v.literal("revealed"),
  v.literal("dissolved"),
  v.literal("matched_pending_ack"),
  v.literal("group_confirmed"),
  v.literal("meetup_preparation"),
  v.literal("meetup_checkin"),
  v.literal("depart_ready"),
  v.literal("in_trip"),
  v.literal("receipt_pending"),
  v.literal("payment_pending"),
  v.literal("closed"),
  v.literal("reported"),
  v.literal("cancelled"),
);

const availabilityStatus = v.union(v.literal("open"), v.literal("matched"), v.literal("cancelled"));
const memberParticipationStatus = v.union(
  v.literal("active"),
  v.literal("removed_no_ack"),
  v.literal("removed_no_show"),
  v.literal("cancelled_by_user"),
);
const memberAcknowledgementStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("timed_out"),
);
const memberPaymentStatus = v.union(
  v.literal("none"),
  v.literal("owed"),
  v.literal("submitted"),
  v.literal("verified"),
  v.literal("not_required"),
);
const reportCategory = v.union(
  v.literal("no_show"),
  v.literal("non_payment"),
  v.literal("unsafe_behavior"),
  v.literal("harassment"),
  v.literal("misconduct"),
  v.literal("other"),
);
const notificationChannel = v.union(v.literal("push"), v.literal("email"));
const notificationStatus = v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed"));

const schema = defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    emailDomain: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    onboardingComplete: v.optional(v.boolean()),
    successfulTrips: v.optional(v.number()),
    cancelledTrips: v.optional(v.number()),
    reportedCount: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  preferences: defineTable({
    userId: v.id("users"),
    selfDeclaredGender,
    sameGenderOnly: v.boolean(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
  }).index("userId", ["userId"]),
  emailVerifications: defineTable({
    userId: v.id("users"),
    passphrase: v.string(),
    email: v.string(),
    expiresAt: v.number(),
    verifiedAt: v.optional(v.number()),
    pendingAliasFrom: v.optional(v.string()),
    pendingAliasName: v.optional(v.string()),
  })
    .index("userId", ["userId"])
    .index("email", ["email"]),
  clientKeys: defineTable({
    userId: v.id("users"),
    publicKey: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("userId", ["userId"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    disabledAt: v.optional(v.number()),
  })
    .index("userId", ["userId"])
    .index("endpoint", ["endpoint"]),
  availabilities: defineTable({
    userId: v.id("users"),
    windowStart: v.string(),
    windowEnd: v.string(),
    selfDeclaredGender,
    sameGenderOnly: v.boolean(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
    sealedDestinationRef: v.string(),
    routeDescriptorRef: v.string(),
    estimatedFareBand: v.optional(v.string()),
    createdAt: v.string(),
    status: availabilityStatus,
  }).index("userId", ["userId"]),
  groups: defineTable({
    status: lifecycleGroupStatus,
    pickupOriginId: v.string(),
    pickupLabel: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    groupSize: v.number(),
    estimatedFareBand: v.optional(v.string()),
    maxDetourMinutes: v.number(),
    averageScore: v.number(),
    minimumScore: v.number(),
    confirmationDeadline: v.string(),
    createdAt: v.string(),
    revealedAt: v.optional(v.string()),
    availabilityIds: v.array(v.string()),
    memberUserIds: v.array(v.string()),
    meetingTime: v.optional(v.string()),
    meetingLocationLabel: v.optional(v.string()),
    graceDeadline: v.optional(v.string()),
    groupName: v.optional(v.string()),
    groupColor: v.optional(v.string()),
    bookerUserId: v.optional(v.string()),
    suggestedDropoffOrder: v.optional(v.array(v.string())),
    departedAt: v.optional(v.string()),
    finalCostCents: v.optional(v.number()),
    receiptStorageId: v.optional(v.id("_storage")),
    receiptSubmittedAt: v.optional(v.string()),
    paymentDueAt: v.optional(v.string()),
    closedAt: v.optional(v.string()),
    generalAreaLabels: v.optional(v.array(v.string())),
    reportCount: v.optional(v.number()),
  }),
  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.string(),
    availabilityId: v.string(),
    displayName: v.string(),
    emoji: v.optional(v.string()),
    accepted: v.union(v.boolean(), v.null()),
    acknowledgementStatus: v.optional(memberAcknowledgementStatus),
    acknowledgedAt: v.union(v.string(), v.null()),
    participationStatus: v.optional(memberParticipationStatus),
    checkedInAt: v.optional(v.string()),
    checkedInByUserId: v.optional(v.string()),
    destinationAddress: v.optional(v.string()),
    destinationSubmittedAt: v.optional(v.string()),
    destinationLockedAt: v.optional(v.string()),
    qrToken: v.optional(v.string()),
    dropoffOrder: v.optional(v.number()),
    amountDueCents: v.optional(v.number()),
    paymentStatus: v.optional(memberPaymentStatus),
    paymentProofStorageId: v.optional(v.id("_storage")),
    paymentSubmittedAt: v.optional(v.string()),
    paymentVerifiedAt: v.optional(v.string()),
    paymentVerifiedByUserId: v.optional(v.string()),
  })
    .index("groupId", ["groupId"])
    .index("userId", ["userId"])
    .index("groupId_userId", ["groupId", "userId"]),
  envelopesByRecipient: defineTable({
    groupId: v.id("groups"),
    recipientUserId: v.string(),
    senderUserId: v.string(),
    senderName: v.string(),
    ciphertext: v.string(),
  })
    .index("groupId", ["groupId"])
    .index("groupId_recipient", ["groupId", "recipientUserId"]),
  auditEvents: defineTable({
    action: v.string(),
    actorId: v.string(),
    metadata: v.any(),
    createdAt: v.string(),
  }),
  reports: defineTable({
    groupId: v.id("groups"),
    reporterUserId: v.string(),
    reportedUserId: v.optional(v.string()),
    category: reportCategory,
    description: v.string(),
    createdAt: v.string(),
  }).index("groupId", ["groupId"]),
  notificationEvents: defineTable({
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
    eventKey: v.string(),
    kind: v.string(),
    channel: notificationChannel,
    status: notificationStatus,
    detail: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("eventKey", ["eventKey"])
    .index("userId", ["userId"]),
});

export default schema;
