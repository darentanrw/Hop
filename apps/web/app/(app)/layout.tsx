import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { BottomNav } from "../../components/bottom-nav";
import { ClientKeyRegistrar } from "../../components/client-key-registrar";
import { LocalQaPanel } from "../../components/local-qa-panel";
import { PwaCoachmark } from "../../components/pwa-coachmark";
import { TopBarContent } from "../../components/top-bar-content";
import { api } from "../../convex/_generated/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const status = await fetchQuery(api.queries.getVerificationStatus, {}, { token });
  if (!status) redirect("/login");
  if (!status.emailVerified) redirect("/verify-email");
  if (!status.onboardingComplete) redirect("/onboarding");

  const [riderProfile, adminAccess] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.admin.adminAccess, {}, { token }),
  ]);
  if (!riderProfile) redirect("/onboarding");

  return (
    <>
      <div className="page-container">
        <TopBarContent />
        <ClientKeyRegistrar />
        <PwaCoachmark />
        {adminAccess.isAdmin ? <LocalQaPanel /> : null}
        {children}
      </div>
      <BottomNav />
    </>
  );
}
