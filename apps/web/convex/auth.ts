import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import type { AuthProviderConfig } from "@convex-dev/auth/server";
import { getEmailDomain } from "@hop/shared";
import { ResendOTP } from "./ResendOTP";

const localQaEnabled = process.env.ENABLE_LOCAL_QA === "true";

const defaultPreferences = {
  selfDeclaredGender: "prefer_not_to_say" as const,
  sameGenderOnly: false,
  minGroupSize: 2,
  maxGroupSize: 4,
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
      const emailVerified =
        typeof profile.emailVerified === "boolean" ? profile.emailVerified : false;
      const onboardingComplete =
        typeof profile.onboardingComplete === "boolean" ? profile.onboardingComplete : false;

      if (args.existingUserId) {
        await ctx.db.patch(args.existingUserId, {
          email,
          emailDomain,
          emailVerificationTime: Date.now(),
          ...(name ? { name } : {}),
          ...(typeof profile.isAnonymous === "boolean" ? { isAnonymous } : {}),
          ...(typeof profile.emailVerified === "boolean" ? { emailVerified } : {}),
          ...(typeof profile.onboardingComplete === "boolean" ? { onboardingComplete } : {}),
        });

        if (localQaEnabled && isAnonymous) {
          const existingPreference = (await ctx.db.query("preferences").collect()).find(
            (preference) => preference.userId === args.existingUserId,
          );

          if (!existingPreference) {
            await ctx.db.insert("preferences", {
              userId: args.existingUserId,
              ...defaultPreferences,
            });
          }
        }

        return args.existingUserId;
      }

      const userId = await ctx.db.insert("users", {
        email,
        emailDomain,
        emailVerificationTime: Date.now(),
        ...(name ? { name } : {}),
        ...(typeof profile.isAnonymous === "boolean" ? { isAnonymous } : {}),
        emailVerified,
        onboardingComplete,
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
