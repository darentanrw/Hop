import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "../../../../lib/session";
import { destroySession } from "../../../../lib/store";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionId = cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.split("=")[1];

  if (sessionId) {
    destroySession(sessionId);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: new Date(0),
  });

  return response;
}
