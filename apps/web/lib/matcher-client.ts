import type { AddressEnvelope, CompatibilityEdge } from "@hop/shared";
import { getMatcherBaseUrl } from "./matcher-base-url";

export async function fetchCompatibility(routeDescriptorRefs: string[]) {
  const response = await fetch(`${getMatcherBaseUrl()}/matcher/compatibility`, {
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
    userId: string;
    displayName: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  const response = await fetch(`${getMatcherBaseUrl()}/matcher/reveal-envelopes`, {
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
