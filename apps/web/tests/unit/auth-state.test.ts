import { describe, expect, test } from "vitest";
import { resolveManagedVerificationFlags } from "../../lib/auth-state";

describe("resolveManagedVerificationFlags", () => {
  test("does not trust OTP provider verification for normal riders", () => {
    expect(
      resolveManagedVerificationFlags({
        isAnonymous: false,
        providerEmailVerified: true,
        providerOnboardingComplete: true,
        hasCompletedReplyVerification: false,
      }),
    ).toEqual({
      emailVerified: false,
      onboardingComplete: false,
    });
  });

  test("preserves local QA verification shortcuts for anonymous riders", () => {
    expect(
      resolveManagedVerificationFlags({
        isAnonymous: true,
        providerEmailVerified: true,
        providerOnboardingComplete: true,
        hasCompletedReplyVerification: false,
      }),
    ).toEqual({
      emailVerified: true,
      onboardingComplete: true,
    });
  });

  test("restores verified status once the passphrase reply has been completed", () => {
    expect(
      resolveManagedVerificationFlags({
        isAnonymous: false,
        providerEmailVerified: true,
        providerOnboardingComplete: false,
        hasCompletedReplyVerification: true,
      }),
    ).toEqual({
      emailVerified: true,
      onboardingComplete: false,
    });
  });
});
