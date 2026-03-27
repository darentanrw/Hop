import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { AvailabilityForm } from "../../../components/availability-form";
import { api } from "../../../convex/_generated/api";

export default async function AvailabilityPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const [riderProfile, adminAccess] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.admin.adminAccess, {}, { token }),
  ]);
  if (!riderProfile) redirect("/onboarding");

  const schedulingBlocked = Boolean(riderProfile.credibilitySuspended && !adminAccess.isAdmin);

  return (
    <div className="stack-lg stagger">
      <div style={{ paddingTop: 4 }}>
        <h1>Schedule a ride</h1>
        <p style={{ marginTop: 6 }}>
          Set your preferred time window for heading home from NUS Utown.
        </p>
      </div>

      {schedulingBlocked ? (
        <div className="notice notice-info" style={{ marginTop: 8 }}>
          You can&apos;t schedule new rides as your account is suspended.
        </div>
      ) : (
        <AvailabilityForm profile={riderProfile} />
      )}
    </div>
  );
}
