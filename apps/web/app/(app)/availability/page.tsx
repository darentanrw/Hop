import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { AvailabilityForm } from "../../../components/availability-form";
import { api } from "../../../convex/_generated/api";

export default async function AvailabilityPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const riderProfile = await fetchQuery(api.queries.getRiderProfile, {}, { token });
  if (!riderProfile) redirect("/onboarding");

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
