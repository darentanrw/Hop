import { NextResponse } from "next/server";
import { envelopesForRider, revealAddresses } from "../../../../../lib/matching";
import { getCurrentSession } from "../../../../../lib/session";
import { getRiderProfileByUserId } from "../../../../../lib/store";

export async function GET(_request: Request, context: { params: Promise<{ groupId: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const riderProfile = getRiderProfileByUserId(session.userId);
  if (!riderProfile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const { groupId } = await context.params;

  try {
    await revealAddresses(groupId);
    return NextResponse.json({
      envelopes: envelopesForRider(groupId, riderProfile.riderId),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reveal addresses." },
      { status: 400 },
    );
  }
}
