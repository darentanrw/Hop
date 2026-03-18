import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { type NextRequest, NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { groupId } = await context.params;
  const body = await request.json();

  try {
    await fetchMutation(
      api.mutations.updateAcknowledgement,
      {
        groupId: groupId as Id<"groups">,
        accepted: Boolean(body.accepted),
      },
      { token },
    );
    const updated = await fetchQuery(api.queries.getActiveGroup, {}, { token });
    return NextResponse.json(updated ?? { ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update acknowledgement." },
      { status: 400 },
    );
  }
}
