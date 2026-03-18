import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { GroupClient } from "../../../components/group-client";
import { api } from "../../../convex/_generated/api";

export default async function GroupPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  await fetchAction(api.mutations.runMatching, {}, { token });
  await fetchMutation(api.trips.advanceCurrentGroupLifecycle, {}, { token });
  const current = await fetchQuery(api.trips.getActiveTrip, {}, { token });

  return (
    <div className="stack-lg stagger">
      <div style={{ paddingTop: 4 }}>
        <h1>Your ride group</h1>
        <p style={{ marginTop: 6 }}>Confirm, meet up, check in, ride, and settle up here.</p>
      </div>
      <GroupClient initialGroup={current} />
    </div>
  );
}
