import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { AppShellEnhancements } from "../../components/app-shell-enhancements";
import { BottomNav } from "../../components/bottom-nav";
import { ConvexAppProvider } from "../../components/convex-app-provider";
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
    <ConvexAppProvider>
      <>
        <div className="page-container">
          <TopBarContent />
          <AppShellEnhancements />
          {children}
        </div>
        <BottomNav />
      </>
    </ConvexAppProvider>
  );
}
