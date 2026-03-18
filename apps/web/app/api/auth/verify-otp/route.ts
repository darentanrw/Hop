import { type NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "../../../../lib/auth";
import { SESSION_COOKIE_NAME } from "../../../../lib/session";
import { getRiderProfileByUserId } from "../../../../lib/store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session, user } = verifyOtp(
      String(body.requestId ?? ""),
      String(body.code ?? ""),
      String(body.clientPublicKey ?? ""),
    );
    const riderProfile = getRiderProfileByUserId(user.id);
    const response = NextResponse.json({ session: { id: session.id }, riderProfile });

    response.cookies.set(SESSION_COOKIE_NAME, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date(session.expiresAt),
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to verify OTP." },
      { status: 400 },
    );
  }
}
