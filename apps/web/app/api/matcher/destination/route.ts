import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";
import { createStubMatcherSubmissionForAddress } from "../../../../lib/matcher-stub";

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

  if ((process.env.MATCHER_MODE ?? "stub") !== "live") {
    return NextResponse.json(createStubMatcherSubmissionForAddress(address));
  }

  const matcherBaseUrl = process.env.MATCHER_BASE_URL ?? "http://localhost:4001";
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
}
