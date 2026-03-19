import crypto from "node:crypto";
import type { AddressEnvelope, CompatibilityEdge } from "@hop/shared";
import {
  GEOHASH_PRECISION,
  MAX_DETOUR_MINUTES,
  MAX_SPREAD_KM,
  PICKUP_ORIGIN_LAT,
  PICKUP_ORIGIN_LNG,
} from "@hop/shared";
import ngeohash from "ngeohash";
import { geocodeAddress, getDrivingRoute, haversineKm } from "./onemap";

type DestinationRecord = {
  sealedDestinationRef: string;
  routeDescriptorRef: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  normalizedAddress: string;
  lat: number;
  lng: number;
  geohash6: string;
  geohash5: string;
};

type DescriptorRecord = {
  lat: number;
  lng: number;
  geohash6: string;
  geohash5: string;
};

type MatcherStore = {
  destinations: Map<string, DestinationRecord>;
  descriptors: Map<string, DescriptorRecord>;
};

const globalStore = globalThis as typeof globalThis & { __hopMatcherStore?: MatcherStore };

function getStore() {
  if (!globalStore.__hopMatcherStore) {
    globalStore.__hopMatcherStore = {
      destinations: new Map(),
      descriptors: new Map(),
    };
  }

  return globalStore.__hopMatcherStore;
}

function getSealingKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.MATCHER_SEALING_KEY ?? "dev-only-sealing-key-change-me")
    .digest();
}

function base64(input: Buffer) {
  return input.toString("base64");
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function sealAddress(address: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSealingKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: base64(ciphertext),
    iv: base64(iv),
    authTag: base64(authTag),
  };
}

function unsealAddress(record: DestinationRecord) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSealingKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

function areGeohashNeighbors(hashA: string, hashB: string): boolean {
  if (hashA === hashB) return true;
  const neighbors = ngeohash.neighbors(hashA);
  return Object.values(neighbors).includes(hashB);
}

export async function submitDestination(address: string) {
  const normalizedAddress = normalizeAddress(address);

  const geocoded = await geocodeAddress(address);
  if (!geocoded) {
    throw new Error("Could not geocode the address. Please check the address and try again.");
  }

  const { lat, lng } = geocoded;
  const geohash6 = ngeohash.encode(lat, lng, GEOHASH_PRECISION);
  const geohash5 = ngeohash.encode(lat, lng, 5);

  const sealedDestinationRef = `dest_${crypto.randomUUID()}`;
  const routeDescriptorRef = `route_${crypto.randomUUID()}`;
  const sealed = sealAddress(address);
  const store = getStore();

  store.destinations.set(sealedDestinationRef, {
    sealedDestinationRef,
    routeDescriptorRef,
    normalizedAddress,
    lat,
    lng,
    geohash6,
    geohash5,
    ...sealed,
  });
  store.descriptors.set(routeDescriptorRef, { lat, lng, geohash6, geohash5 });

  return {
    sealedDestinationRef,
    routeDescriptorRef,
  };
}

export async function scoreRouteDescriptors(
  routeDescriptorRefs: string[],
  timeOverlapByPair?: Map<string, number>,
): Promise<CompatibilityEdge[]> {
  const store = getStore();
  const edges: CompatibilityEdge[] = [];

  for (let index = 0; index < routeDescriptorRefs.length; index += 1) {
    for (
      let compareIndex = index + 1;
      compareIndex < routeDescriptorRefs.length;
      compareIndex += 1
    ) {
      const leftRef = routeDescriptorRefs[index];
      const rightRef = routeDescriptorRefs[compareIndex];
      const left = store.descriptors.get(leftRef);
      const right = store.descriptors.get(rightRef);

      if (!left || !right) {
        continue;
      }

      const geohash6Match = areGeohashNeighbors(left.geohash6, right.geohash6);
      const geohash5Match = !geohash6Match && areGeohashNeighbors(left.geohash5, right.geohash5);

      if (!geohash6Match && !geohash5Match) {
        continue;
      }

      const spreadDistanceKm = haversineKm(left.lat, left.lng, right.lat, right.lng);
      if (spreadDistanceKm > MAX_SPREAD_KM) {
        continue;
      }

      let detourMinutes: number;
      try {
        const [routeToLeft, routeToRight, routeLeftToRight] = await Promise.all([
          getDrivingRoute(PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG, left.lat, left.lng),
          getDrivingRoute(PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG, right.lat, right.lng),
          getDrivingRoute(left.lat, left.lng, right.lat, right.lng),
        ]);

        const longestSingleTrip = Math.max(routeToLeft.timeSeconds, routeToRight.timeSeconds);
        const sequentialTrip = Math.min(
          routeToLeft.timeSeconds + routeLeftToRight.timeSeconds,
          routeToRight.timeSeconds + routeLeftToRight.timeSeconds,
        );
        detourMinutes = Math.max(0, (sequentialTrip - longestSingleTrip) / 60);
      } catch {
        detourMinutes = spreadDistanceKm * 1.5;
      }

      if (detourMinutes > MAX_DETOUR_MINUTES) {
        continue;
      }

      const routeOverlap = Math.max(0, 1 - detourMinutes / MAX_DETOUR_MINUTES);
      const destinationProximity = Math.max(0, 1 - spreadDistanceKm / MAX_SPREAD_KM);

      const pairKeyStr = [leftRef, rightRef].sort().join("::");
      const timeOverlapNorm = timeOverlapByPair
        ? Math.min(1, (timeOverlapByPair.get(pairKeyStr) ?? 60) / 120)
        : 0.5;

      const score = Number(
        (0.55 * routeOverlap + 0.3 * destinationProximity + 0.15 * timeOverlapNorm).toFixed(2),
      );

      edges.push({
        leftRef,
        rightRef,
        routeOverlap: Number(routeOverlap.toFixed(2)),
        destinationProximity: Number(destinationProximity.toFixed(2)),
        score,
        detourMinutes: Number(detourMinutes.toFixed(1)),
        spreadDistanceKm: Number(spreadDistanceKm.toFixed(2)),
      });
    }
  }

  return edges;
}

export function countDistinctLocations(members: Array<{ geohash6: string }>): number {
  const seen = new Set<string>();
  for (const member of members) {
    let merged = false;
    for (const existing of seen) {
      if (member.geohash6 === existing || areGeohashNeighbors(member.geohash6, existing)) {
        merged = true;
        break;
      }
    }
    if (!merged) {
      seen.add(member.geohash6);
    }
  }
  return seen.size;
}

export function getDescriptor(routeDescriptorRef: string): DescriptorRecord | undefined {
  return getStore().descriptors.get(routeDescriptorRef);
}

function importRecipientKey(publicKey: string) {
  return crypto.createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
}

export function revealEnvelopes(
  members: Array<{
    userId: string;
    displayName: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  const store = getStore();
  const envelopes: AddressEnvelope[] = [];

  for (const recipient of members) {
    const recipientKey = importRecipientKey(recipient.publicKey);

    for (const sender of members) {
      const destinationRecord = store.destinations.get(sender.sealedDestinationRef);
      if (!destinationRecord) {
        continue;
      }

      const plaintextAddress = unsealAddress(destinationRecord);
      const payload = Buffer.from(
        JSON.stringify({
          userId: sender.userId,
          displayName: sender.displayName,
          address: plaintextAddress,
        }),
        "utf8",
      );
      const ciphertext = crypto.publicEncrypt(
        {
          key: recipientKey,
          oaepHash: "sha256",
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        },
        payload,
      );

      envelopes.push({
        recipientUserId: recipient.userId,
        senderUserId: sender.userId,
        senderName: sender.displayName,
        ciphertext: base64(ciphertext),
      });
    }
  }

  return envelopes;
}
