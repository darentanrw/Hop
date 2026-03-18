import { type NextRequest, NextResponse } from "next/server";
import { acknowledgeGroup } from "../../../../../lib/matching";
import { getCurrentSession } from "../../../../../lib/session";
import { getRiderProfileByUserId } from "../../../../../lib/store";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const { groupId } = await context.params;
  const body = await request.json();
  const updated = await acknowledgeGroup(groupId, riderProfile.riderId, Boolean(body.accepted));

  return NextResponse.json(updated ?? { ok: true });
}
