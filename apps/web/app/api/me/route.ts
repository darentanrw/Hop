import { clampGroupSize } from "@hop/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "../../../lib/session";
import { getRiderProfileByUserId, updatePreferences } from "../../../lib/store";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ riderProfile: getRiderProfileByUserId(session.userId) });
}

export async function PATCH(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const profile = getRiderProfileByUserId(session.userId);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const body = await request.json();
  const nextProfile = updatePreferences(profile.riderId, {
    selfDeclaredGender: body.selfDeclaredGender ?? profile.selfDeclaredGender,
    sameGenderOnly: Boolean(body.sameGenderOnly),
    minGroupSize: clampGroupSize(Number(body.minGroupSize), profile.minGroupSize),
    maxGroupSize: clampGroupSize(Number(body.maxGroupSize), profile.maxGroupSize),
  });

  return NextResponse.json({ riderProfile: nextProfile });
}
