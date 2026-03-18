import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { BottomNav } from "../../components/bottom-nav";
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
      <div className="page-container">{children}</div>
      <BottomNav />
    </>
  );
}
