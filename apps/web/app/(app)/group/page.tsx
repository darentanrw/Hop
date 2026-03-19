import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { GroupClient } from "../../../components/group-client";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default async function GroupPage({
  searchParams,
}: {
  searchParams: Promise<{ qaUserId?: string }>;
}) {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");
  const { qaUserId } = await searchParams;
  const actingUserId = qaUserId as Id<"users"> | undefined;

  await fetchAction(api.mutations.runMatching, {}, { token });
  await fetchMutation(api.trips.advanceCurrentGroupLifecycle, { actingUserId }, { token });
  const current = await fetchQuery(api.trips.getActiveTrip, { actingUserId }, { token });

  return <GroupClient initialGroup={current} qaActingUserId={actingUserId} />;
}
