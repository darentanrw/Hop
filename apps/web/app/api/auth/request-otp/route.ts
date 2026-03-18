import { type NextRequest, NextResponse } from "next/server";
import { requestOtp } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const otpRequest = requestOtp(String(body.email ?? ""));
    return NextResponse.json(otpRequest);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to request OTP." },
      { status: 400 },
    );
  }
}
