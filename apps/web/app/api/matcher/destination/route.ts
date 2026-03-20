import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";
import { getMatcherBaseUrl } from "../../../../lib/matcher-base-url";

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { address?: unknown } | null;
  const address = String(payload?.address ?? "").trim();

  if (!address) {
    return NextResponse.json({ error: "Address is required." }, { status: 400 });
  }

  try {
    const matcherBaseUrl = getMatcherBaseUrl();
    const response = await fetch(`${matcherBaseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error ?? "Could not save destination." },
        { status: response.status || 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Matcher service is unavailable. Start the matcher and try again.",
      },
      {
        status:
          error instanceof Error && error.message.includes("Matcher base URL is not configured")
            ? 500
            : 502,
      },
    );
  }
}
