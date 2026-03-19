import type { AddressEnvelope, CompatibilityEdge, FareBand } from "@hop/shared";

const fareBands: FareBand[] = ["S$10-15", "S$16-20", "S$21-25", "S$26+"];

const destinations = [
  {
    address: "Blk 123 Clementi Ave 3, Singapore 120123",
    cluster: 0,
    fareBand: "S$10-15" as FareBand,
  },
  {
    address: "Blk 45 Holland Drive, Singapore 270045",
    cluster: 1,
    fareBand: "S$16-20" as FareBand,
  },
  {
    address: "Blk 88 Jurong East Street 13, Singapore 600088",
    cluster: 2,
    fareBand: "S$21-25" as FareBand,
  },
  {
    address: "Blk 101 Toa Payoh Lorong 1, Singapore 310101",
    cluster: 3,
    fareBand: "S$26+" as FareBand,
  },
  {
    address: "Blk 7 Bukit Timah Road, Singapore 259688",
    cluster: 1,
    fareBand: "S$16-20" as FareBand,
  },
  {
    address: "Blk 56 Commonwealth Drive, Singapore 140056",
    cluster: 0,
    fareBand: "S$10-15" as FareBand,
  },
];

function hashString(input: string) {
  let hash = 0;
  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function getDestinationForSeed(seed: string) {
  return destinations[hashString(seed) % destinations.length];
}

function getCluster(ref: string) {
  const segments = ref.split(":");
  return Number.parseInt(segments[2] ?? "0", 10) || 0;
}

function encodeAddress(address: string) {
  return encodeURIComponent(address);
}

function decodeAddress(encoded: string) {
  return decodeURIComponent(encoded);
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

async function encryptPayload(publicKeyBase64: string, payload: Record<string, string>) {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKeyBase64),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  return bytesToBase64(new Uint8Array(ciphertext));
}

export function createStubMatcherSubmission(seed: string, userDestination?: string) {
  const destination = getDestinationForSeed(seed);
  const seedHash = hashString(seed);
  const addressToEncode = userDestination?.trim() || destination.address;

  return {
    sealedDestinationRef: `stub:destination:${encodeAddress(addressToEncode)}`,
    routeDescriptorRef: `stub:route:${destination.cluster}:${seedHash % 1000}`,
    estimatedFareBand: destination.fareBand,
  };
}

export function createStubCompatibility(routeDescriptorRefs: string[]): CompatibilityEdge[] {
  const edges: CompatibilityEdge[] = [];

  for (let index = 0; index < routeDescriptorRefs.length; index += 1) {
    for (
      let compareIndex = index + 1;
      compareIndex < routeDescriptorRefs.length;
      compareIndex += 1
    ) {
      const leftRef = routeDescriptorRefs[index];
      const rightRef = routeDescriptorRefs[compareIndex];
      const distance = Math.abs(getCluster(leftRef) - getCluster(rightRef));
      const destinationProximity = distance === 0 ? 0.93 : distance === 1 ? 0.82 : 0.72;
      const routeOverlap = Math.max(0.62, destinationProximity - 0.05);
      const score = Number((0.55 * routeOverlap + 0.45 * destinationProximity).toFixed(2));
      const detourMinutes = distance === 0 ? 4 : distance === 1 ? 8 : 11;

      edges.push({
        leftRef,
        rightRef,
        score,
        detourMinutes,
        routeOverlap: Number(routeOverlap.toFixed(2)),
        destinationProximity: Number(destinationProximity.toFixed(2)),
        fareBand: fareBands[(getCluster(leftRef) + getCluster(rightRef)) % fareBands.length],
      });
    }
  }

  return edges;
}

export function decodeStubDestinationRef(sealedDestinationRef: string) {
  const encoded = sealedDestinationRef.split(":").slice(2).join(":");
  return decodeAddress(encoded);
}

export async function createStubRevealEnvelopes(
  members: Array<{
    userId: string;
    displayName: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  const envelopes: AddressEnvelope[] = [];

  for (const recipient of members) {
    for (const sender of members) {
      const ciphertext = await encryptPayload(recipient.publicKey, {
        userId: sender.userId,
        displayName: sender.displayName,
        address: decodeStubDestinationRef(sender.sealedDestinationRef),
      });

      envelopes.push({
        recipientUserId: recipient.userId,
        senderUserId: sender.userId,
        senderName: sender.displayName,
        ciphertext,
      });
    }
  }

  return envelopes;
}
