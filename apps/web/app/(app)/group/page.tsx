import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { GroupClient } from "../../../components/group-client";
import { api } from "../../../convex/_generated/api";

export default async function GroupPage({
  searchParams,
}: {
  searchParams: Promise<{ qaUserId?: string }>;
}) {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");
  const { qaUserId } = await searchParams;

  await fetchAction(api.mutations.runMatching, {}, { token });
  await fetchMutation(api.trips.advanceCurrentGroupLifecycle, {}, { token });
  const current = await fetchQuery(api.trips.getActiveTrip, {}, { token });

  return <GroupClient initialGroup={current} qaActingUserId={qaUserId} />;
}
