import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { GroupClient } from "../../../components/group-client";
import { api } from "../../../convex/_generated/api";

export default async function GroupPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  await fetchAction(api.mutations.runMatching, {}, { token });
  const current = await fetchQuery(api.queries.getActiveGroup, {}, { token });

  return (
    <div className="stack-lg stagger">
      <div style={{ paddingTop: 4 }}>
        <h1>Your group</h1>
        <p style={{ marginTop: 6 }}>Addresses revealed only after everyone confirms.</p>
      </div>
      <GroupClient initialGroup={current} />
    </div>
  );
}
