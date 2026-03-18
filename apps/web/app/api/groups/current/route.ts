import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";

export async function GET() {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await fetchAction(api.mutations.runMatching, {}, { token });
  const group = await fetchQuery(api.queries.getActiveGroup, {}, { token });
  return NextResponse.json(group ?? { group: null });
}
