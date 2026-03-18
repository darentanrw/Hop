import { AvailabilityForm } from "../../../components/availability-form";
import { requireUser } from "../../../lib/require-user";

export default async function AvailabilityPage() {
  const { riderProfile } = await requireUser();

  return (
    <div className="stack-lg stagger">
      <div style={{ paddingTop: 4 }}>
        <h1>Schedule a ride</h1>
        <p style={{ marginTop: 6 }}>
          Set your preferred time window for heading home from NUS Utown.
        </p>
      </div>

      <AvailabilityForm
        profile={riderProfile}
        matcherBaseUrl={process.env.NEXT_PUBLIC_MATCHER_BASE_URL ?? "http://localhost:4001"}
      />
    </div>
  );
}
