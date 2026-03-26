import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import { getMatcherBaseUrl } from "../../../../lib/matcher-base-url";

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [riderProfile, adminAccess] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.admin.adminAccess, {}, { token }),
  ]);
  if (riderProfile?.credibilitySuspended && !adminAccess.isAdmin) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
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
