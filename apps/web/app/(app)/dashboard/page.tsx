import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { DashboardBackgroundSync } from "../../../components/dashboard-background-sync";
import { DashboardRidesTabs } from "../../../components/dashboard-rides-tabs";
import { DashboardStatusCard } from "../../../components/dashboard-status-card";
import { PreferencesForm } from "../../../components/preferences-form";
import { api } from "../../../convex/_generated/api";
import { getDashboardNotice } from "../../../lib/dashboard-notice";

export default async function DashboardPage() {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  const [riderProfile, availabilities, group, eligibility, adminAccess, pastRides] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.queries.listAvailabilities, {}, { token }),
    fetchQuery(api.trips.getActiveTrip, {}, { token }),
    fetchQuery(api.trips.getRideEligibility, {}, { token }),
    fetchQuery(api.admin.adminAccess, {}, { token }),
    fetchQuery(api.trips.listPastRides, {}, { token }),
  ]);
  const dashboardNotice = getDashboardNotice({
    hasActiveTrip: Boolean(group),
    eligibility,
  });

  if (!riderProfile) return null;

  const schedulingBlocked = Boolean(riderProfile.credibilitySuspended && !adminAccess.isAdmin);

  return (
    <div className="stack-lg stagger">
      <DashboardBackgroundSync />

      {dashboardNotice ? (
        <div className="notice notice-error">{dashboardNotice}</div>
      ) : (
        <DashboardStatusCard
          initialGroup={group}
          initialAvailabilities={availabilities ?? []}
          schedulingBlocked={schedulingBlocked}
        />
      )}

      <div>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Your windows</h2>
          {!eligibility?.blocked && !schedulingBlocked && (
            <Link href="/availability" style={{ fontSize: 13, fontWeight: 600 }}>
              + Add
            </Link>
          )}
        </div>
        <AvailabilityList availabilities={availabilities ?? []} />
      </div>
      <DashboardRidesTabs
        initialAvailabilities={availabilities ?? []}
        initialPastRides={pastRides ?? []}
        showAddLink={!eligibility?.blocked}
      />

      <PreferencesForm profile={riderProfile} />
    </div>
  );
}
