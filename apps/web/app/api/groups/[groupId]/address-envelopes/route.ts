import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";

export async function GET(_request: Request, context: { params: Promise<{ groupId: string }> }) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { groupId } = await context.params;
  const group = await fetchQuery(api.queries.getActiveGroup, {}, { token });
  if (!group || group.group.id !== groupId) {
    return NextResponse.json({ envelopes: [] });
  }
  // TODO: Implement address reveal via matcher - requires client keys and matcher integration
  return NextResponse.json({ envelopes: [] });
}
