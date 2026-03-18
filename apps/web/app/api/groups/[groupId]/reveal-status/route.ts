import { NextResponse } from "next/server";
import { revealStatusForRider } from "../../../../../lib/matching";
import { getCurrentSession } from "../../../../../lib/session";
import { getRiderProfileByUserId } from "../../../../../lib/store";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json(revealStatusForRider(riderProfile.riderId));
}
