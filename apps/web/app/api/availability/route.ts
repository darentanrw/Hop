import { type NextRequest, NextResponse } from "next/server";
import { runMatching } from "../../../lib/matching";
import { getCurrentSession } from "../../../lib/session";
import {
  createAvailability,
  getRiderProfileByUserId,
  listAvailabilitiesForRider,
} from "../../../lib/store";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json({ entries: listAvailabilitiesForRider(riderProfile.riderId) });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const body = await request.json();
  const availability = createAvailability({
    riderId: riderProfile.riderId,
    windowStart: String(body.windowStart),
    windowEnd: String(body.windowEnd),
    selfDeclaredGender: body.selfDeclaredGender ?? riderProfile.selfDeclaredGender,
    sameGenderOnly: Boolean(body.sameGenderOnly),
    minGroupSize: Number(body.minGroupSize ?? riderProfile.minGroupSize),
    maxGroupSize: Number(body.maxGroupSize ?? riderProfile.maxGroupSize),
    sealedDestinationRef: String(body.sealedDestinationRef),
    routeDescriptorRef: String(body.routeDescriptorRef),
    estimatedFareBand: body.estimatedFareBand,
  });

  await runMatching();

  return NextResponse.json({ availabilityId: availability.id });
}
