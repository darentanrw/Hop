import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";

export async function GET() {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const group = await fetchQuery(api.queries.getActiveGroup, {}, { token });
  if (!group) {
    return NextResponse.json(null);
  }
  return NextResponse.json({
    status: group.group.status,
    revealReady: group.revealReady,
    confirmationDeadline: group.group.confirmationDeadline,
  });
}
