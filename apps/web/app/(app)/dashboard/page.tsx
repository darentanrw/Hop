import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { AvailabilityList } from "../../../components/availability-list";
import { DashboardBackgroundSync } from "../../../components/dashboard-background-sync";
import { DashboardStatusCard } from "../../../components/dashboard-status-card";
import { PreferencesForm } from "../../../components/preferences-form";
import { api } from "../../../convex/_generated/api";
import { getDashboardNotice } from "../../../lib/dashboard-notice";

export default async function DashboardPage() {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  const [riderProfile, availabilities, group, eligibility] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.queries.listAvailabilities, {}, { token }),
    fetchQuery(api.trips.getActiveTrip, {}, { token }),
    fetchQuery(api.trips.getRideEligibility, {}, { token }),
  ]);
  const dashboardNotice = getDashboardNotice({
    hasActiveTrip: Boolean(group),
    eligibility,
  });

  if (!riderProfile) return null;

  return (
    <div className="stack-lg stagger">
      <DashboardBackgroundSync />

      {dashboardNotice ? (
        <div className="notice notice-error">{dashboardNotice}</div>
      ) : (
        <DashboardStatusCard initialGroup={group} initialAvailabilities={availabilities ?? []} />
      )}

      <div>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Your windows</h2>
          {!eligibility?.blocked && (
            <Link href="/availability" style={{ fontSize: 13, fontWeight: 600 }}>
              + Add
            </Link>
          )}
        </div>
        <AvailabilityList availabilities={availabilities ?? []} />
      </div>

      <PreferencesForm profile={riderProfile} />
    </div>
  );
}
