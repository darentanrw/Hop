type ManagedVerificationFlagsArgs = {
  isAnonymous: boolean;
  providerEmailVerified?: boolean;
  providerOnboardingComplete?: boolean;
  hasCompletedReplyVerification: boolean;
};

export function resolveManagedVerificationFlags({
  isAnonymous,
  providerEmailVerified,
  providerOnboardingComplete,
  hasCompletedReplyVerification,
}: ManagedVerificationFlagsArgs) {
  if (isAnonymous) {
    return {
      emailVerified: providerEmailVerified === true,
      onboardingComplete: providerOnboardingComplete === true,
    };
  }

  return {
    // OTP verifies mailbox access, but Hop still requires the inbound passphrase reply
    // before treating the account as verified for onboarding access.
    emailVerified: hasCompletedReplyVerification,
    onboardingComplete: false,
  };
}
