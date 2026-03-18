import { NextResponse } from "next/server";
import { getCurrentSession } from "../../../../lib/session";
import { cancelAvailability, getRiderProfileByUserId } from "../../../../lib/store";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ availabilityId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const { availabilityId } = await context.params;
  const cancelled = cancelAvailability(availabilityId, riderProfile.riderId);

  if (!cancelled) {
    return NextResponse.json({ error: "Availability not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
