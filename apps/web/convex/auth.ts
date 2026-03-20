import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import type { AuthProviderConfig } from "@convex-dev/auth/server";
import { MAX_GROUP_SIZE, MIN_GROUP_SIZE, getEmailDomain } from "@hop/shared";
import { resolveManagedVerificationFlags } from "../lib/auth-state";
import { ResendOTP } from "./ResendOTP";
import type { MutationCtx } from "./_generated/server";

const localQaEnabled = process.env.ENABLE_LOCAL_QA === "true";

const defaultPreferences = {
  selfDeclaredGender: "prefer_not_to_say" as const,
  sameGenderOnly: false,
  minGroupSize: MIN_GROUP_SIZE,
  maxGroupSize: MAX_GROUP_SIZE,
};

const providers: AuthProviderConfig[] = [ResendOTP];

if (localQaEnabled) {
  providers.unshift(
    Anonymous({
      profile: (params) => ({
        isAnonymous: true,
        name:
          typeof params.name === "string" && params.name.trim().length > 0
            ? params.name.trim()
            : "Local QA Rider",
        email:
          typeof params.email === "string" && params.email.trim().length > 0
            ? params.email.trim().toLowerCase()
            : `local-qa-${crypto.randomUUID().slice(0, 8)}@u.nus.edu`,
        emailVerified: true,
        onboardingComplete: true,
      }),
    }),
  );
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const profile = args.profile as {
        email?: string;
        name?: string;
        isAnonymous?: boolean;
        emailVerified?: boolean;
        onboardingComplete?: boolean;
      };
      const email =
        typeof profile.email === "string" ? profile.email.trim().toLowerCase() : undefined;
      const emailDomain = email ? getEmailDomain(email) : undefined;
      const name = typeof profile.name === "string" ? profile.name.trim() : undefined;
      const isAnonymous = typeof profile.isAnonymous === "boolean" ? profile.isAnonymous : false;
      let hasCompletedReplyVerification = false;
      const appCtx = ctx as MutationCtx;
      const existingUserId = args.existingUserId;

      if (existingUserId && !isAnonymous) {
        const [latestVerification] = await appCtx.db
          .query("emailVerifications")
          .withIndex("userId", (q) => q.eq("userId", existingUserId))
          .order("desc")
          .take(1);
        hasCompletedReplyVerification = typeof latestVerification?.verifiedAt === "number";
      }

      const { emailVerified, onboardingComplete } = resolveManagedVerificationFlags({
        isAnonymous,
        providerEmailVerified:
          typeof profile.emailVerified === "boolean" ? profile.emailVerified : undefined,
        providerOnboardingComplete:
          typeof profile.onboardingComplete === "boolean" ? profile.onboardingComplete : undefined,
        hasCompletedReplyVerification,
      });

      if (existingUserId) {
        await ctx.db.patch(existingUserId, {
          email,
          emailDomain,
          emailVerificationTime: Date.now(),
          ...(name ? { name } : {}),
          ...(typeof profile.isAnonymous === "boolean" ? { isAnonymous } : {}),
          emailVerified,
          ...(isAnonymous ? { onboardingComplete } : {}),
        });

        if (localQaEnabled && isAnonymous) {
          const existingPreference = await appCtx.db
            .query("preferences")
            .withIndex("userId", (q) => q.eq("userId", existingUserId))
            .first();

          if (!existingPreference) {
            await ctx.db.insert("preferences", {
              userId: existingUserId,
              ...defaultPreferences,
            });
          }
        }

        return existingUserId;
      }

      const userId = await ctx.db.insert("users", {
        email,
        emailDomain,
        emailVerificationTime: Date.now(),
        ...(name ? { name } : {}),
        ...(typeof profile.isAnonymous === "boolean" ? { isAnonymous } : {}),
        emailVerified,
        onboardingComplete,
        successfulTrips: 0,
        cancelledTrips: 0,
        reportedCount: 0,
      });

      if (localQaEnabled && isAnonymous) {
        await ctx.db.insert("preferences", {
          userId,
          ...defaultPreferences,
        });
      }

      return userId;
    },
  },
});
