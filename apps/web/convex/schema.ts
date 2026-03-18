import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const fareBand = v.union(
  v.literal("S$10-15"),
  v.literal("S$16-20"),
  v.literal("S$21-25"),
  v.literal("S$26+"),
);

const selfDeclaredGender = v.union(
  v.literal("woman"),
  v.literal("man"),
  v.literal("nonbinary"),
  v.literal("prefer_not_to_say"),
);

const groupStatus = v.union(v.literal("tentative"), v.literal("revealed"), v.literal("dissolved"));

const availabilityStatus = v.union(v.literal("open"), v.literal("matched"), v.literal("cancelled"));

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
    estimatedFareBand: fareBand,
    createdAt: v.string(),
    status: availabilityStatus,
  }).index("userId", ["userId"]),
  groups: defineTable({
    status: groupStatus,
    pickupOriginId: v.string(),
    pickupLabel: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    groupSize: v.number(),
    estimatedFareBand: fareBand,
    maxDetourMinutes: v.number(),
    averageScore: v.number(),
    minimumScore: v.number(),
    confirmationDeadline: v.string(),
    createdAt: v.string(),
    revealedAt: v.optional(v.string()),
    availabilityIds: v.array(v.string()),
    memberUserIds: v.array(v.string()),
  }),
  groupMembers: defineTable({
    groupId: v.id("groups"),
    userId: v.string(),
    availabilityId: v.string(),
    displayName: v.string(),
    accepted: v.union(v.boolean(), v.null()),
    acknowledgedAt: v.union(v.string(), v.null()),
  }).index("groupId", ["groupId"]),
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
});

export default schema;
