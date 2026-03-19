import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { AvailabilityList } from "../../../components/availability-list";
import { DashboardStatusCard } from "../../../components/dashboard-status-card";
import { PreferencesForm } from "../../../components/preferences-form";
import { api } from "../../../convex/_generated/api";

export default async function DashboardPage() {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  await fetchAction(api.mutations.runMatching, {}, { token });
  await fetchMutation(api.trips.advanceCurrentGroupLifecycle, {}, { token });

  const [riderProfile, availabilities, group, eligibility] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.queries.listAvailabilities, {}, { token }),
    fetchQuery(api.trips.getActiveTrip, {}, { token }),
    fetchQuery(api.trips.getRideEligibility, {}, { token }),
  ]);

  if (!riderProfile) return null;

  return (
    <div className="stack-lg stagger">
      {eligibility?.hasActiveGroup ? (
        <div className="notice notice-error">
          You already have an active ride. Finish it before scheduling another.
        </div>
      ) : eligibility?.unpaidCount ? (
        <div className="notice notice-error">
          You have an outstanding payment from a previous ride. Settle up before scheduling another.
        </div>
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
