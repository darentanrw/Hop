import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { BottomNav } from "../../components/bottom-nav";
import { ClientKeyRegistrar } from "../../components/client-key-registrar";
import { LogoutButton } from "../../components/logout-button";
import { PwaCoachmark } from "../../components/pwa-coachmark";
import { api } from "../../convex/_generated/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const status = await fetchQuery(api.queries.getVerificationStatus, {}, { token });
  if (!status) redirect("/login");
  if (!status.emailVerified) redirect("/verify-email");
  if (!status.onboardingComplete) redirect("/onboarding");

  const riderProfile = await fetchQuery(api.queries.getRiderProfile, {}, { token });
  if (!riderProfile) redirect("/onboarding");

  return (
    <>
      <div className="page-container">
        <div className="top-bar">
          <div className="top-bar-brand">
            <div className="hop-logo">H</div>
            <div className="top-bar-info">
              <span className="pseudonym">{riderProfile.name?.trim() || "Hop member"}</span>
              <span className="campus">NUS</span>
            </div>
          </div>
          <LogoutButton />
        </div>
        <ClientKeyRegistrar />
        <PwaCoachmark />
        {children}
      </div>
      <BottomNav />
    </>
  );
}
