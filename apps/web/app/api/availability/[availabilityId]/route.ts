import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ availabilityId: string }> },
) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { availabilityId } = await context.params;

  try {
    await fetchMutation(
      api.mutations.cancelAvailability,
      {
        availabilityId: availabilityId as Id<"availabilities">,
      },
      { token },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Availability not found." },
      { status: 404 },
    );
  }
}
