import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export async function GET(_request: Request, context: { params: Promise<{ groupId: string }> }) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { groupId } = await context.params;

  try {
    const result = await fetchAction(
      api.mutations.revealGroupAddresses,
      {
        groupId: groupId as Id<"groups">,
      },
      { token },
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reveal addresses." },
      { status: 400 },
    );
  }
}
