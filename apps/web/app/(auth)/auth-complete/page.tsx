"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";

export default function AuthCompletePage() {
  const router = useRouter();
  const user = useQuery(api.queries.currentUser);
  const status = useQuery(api.queries.getVerificationStatus);

  useEffect(() => {
    if (user === undefined || status === undefined) return;

    if (user === null || status === null) {
      router.replace("/login");
      return;
    }

    if (!status.emailVerified) {
      router.replace("/verify-email");
      return;
    }

    if (!status.onboardingComplete) {
      router.replace("/onboarding");
      return;
    }

    router.replace("/dashboard");
  }, [router, status, user]);

  return (
    <div className="auth-page">
      <div className="auth-body">
        <div className="card stack" style={{ textAlign: "center", padding: 32 }}>
          <h2>Signing you in</h2>
          <p className="text-muted">Preparing your Hop account...</p>
        </div>
      </div>
    </div>
  );
}
