import type { AddressEnvelope, CompatibilityEdge } from "@hop/shared";

const MATCHER_BASE_URL = process.env.MATCHER_BASE_URL ?? "http://localhost:4001";

export async function fetchCompatibility(routeDescriptorRefs: string[]) {
  const response = await fetch(`${MATCHER_BASE_URL}/matcher/compatibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routeDescriptorRefs }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to fetch matcher compatibility.");
  }

  const payload = (await response.json()) as { edges: CompatibilityEdge[] };
  return payload.edges;
}

export async function fetchRevealEnvelopes(
  members: Array<{
    riderId: string;
    pseudonym: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  const response = await fetch(`${MATCHER_BASE_URL}/matcher/reveal-envelopes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to reveal addresses.");
  }

  const payload = (await response.json()) as { envelopes: AddressEnvelope[] };
  return payload.envelopes;
}
