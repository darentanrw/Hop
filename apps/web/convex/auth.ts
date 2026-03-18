import { convexAuth } from "@convex-dev/auth/server";
import { getEmailDomain } from "@hop/shared";
import { ResendOTP } from "./ResendOTP";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [ResendOTP],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const email =
        typeof args.profile.email === "string"
          ? args.profile.email.trim().toLowerCase()
          : undefined;
      const emailDomain = email ? getEmailDomain(email) : undefined;

      if (args.existingUserId) {
        await ctx.db.patch(args.existingUserId, {
          email,
          emailDomain,
          emailVerificationTime: Date.now(),
        });
        return args.existingUserId;
      }

      return await ctx.db.insert("users", {
        email,
        emailDomain,
        emailVerified: false,
        onboardingComplete: false,
        emailVerificationTime: Date.now(),
      });
    },
  },
});
