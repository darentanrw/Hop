import crypto from "node:crypto";
import type {
  AddressEnvelope,
  CompatibilityEdge,
  MatcherSimulatorPreviewGroup,
  MatcherSimulatorPreviewRequest,
  MatcherSimulatorPreviewResponse,
} from "@hop/shared";
import {
  GEOHASH_PRECISION,
  MAX_DETOUR_MINUTES,
  MAX_SPREAD_KM,
  PICKUP_ORIGIN_LABEL,
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
  maskedLocationLabel: string;
  postalCode: string;
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

const globalStore = globalThis as typeof globalThis & {
  __hopMatcherStore?: MatcherStore;
};

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

function buildMaskedLocationLabel(postalCode: string, geohash5: string) {
  const postalSector = postalCode.trim().slice(0, 2);
  if (postalSector) {
    return `Postal sector ${postalSector}`;
  }
  return `Area ${geohash5.toUpperCase()}`;
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
    maskedLocationLabel: buildMaskedLocationLabel(geocoded.postalCode, geohash5),
    postalCode: geocoded.postalCode,
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

export function clearMatcherStore() {
  const store = getStore();
  store.destinations.clear();
  store.descriptors.clear();
}

const SCORING_CONCURRENCY = 8;

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

export async function scoreRouteDescriptors(
  routeDescriptorRefs: string[],
  timeOverlapByPair?: Map<string, number>,
): Promise<CompatibilityEdge[]> {
  const store = getStore();

  type EligiblePair = {
    leftRef: string;
    rightRef: string;
    left: DescriptorRecord;
    right: DescriptorRecord;
    spreadDistanceKm: number;
  };

  const eligiblePairs: EligiblePair[] = [];

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
        const missingRefs = [left ? null : leftRef, right ? null : rightRef].filter(Boolean);
        throw new Error(
          `Missing matcher route descriptor${missingRefs.length === 1 ? "" : "s"}: ${missingRefs.join(", ")}.`,
        );
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

      eligiblePairs.push({
        leftRef,
        rightRef,
        left,
        right,
        spreadDistanceKm,
      });
    }
  }

  /** Below this haversine distance (km), treat as one stop — skip live routing (avoids API flakes). */
  const COLOCATED_KM = 0.05;

  const tasks = eligiblePairs.map((pair) => async (): Promise<CompatibilityEdge | null> => {
    const { leftRef, rightRef, left, right, spreadDistanceKm } = pair;

    let detourMinutes: number;
    if (spreadDistanceKm < COLOCATED_KM) {
      detourMinutes = 0;
    } else {
      try {
        const [routeToLeft, routeToRight, routeLeftToRight, routeRightToLeft] = await Promise.all([
          getDrivingRoute(PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG, left.lat, left.lng),
          getDrivingRoute(PICKUP_ORIGIN_LAT, PICKUP_ORIGIN_LNG, right.lat, right.lng),
          getDrivingRoute(left.lat, left.lng, right.lat, right.lng),
          getDrivingRoute(right.lat, right.lng, left.lat, left.lng),
        ]);

        const longestSingleTrip = Math.max(routeToLeft.timeSeconds, routeToRight.timeSeconds);
        const sequentialTrip = Math.min(
          routeToLeft.timeSeconds + routeLeftToRight.timeSeconds,
          routeToRight.timeSeconds + routeRightToLeft.timeSeconds,
        );
        detourMinutes = Math.max(0, (sequentialTrip - longestSingleTrip) / 60);
      } catch {
        return null;
      }
    }

    if (detourMinutes > MAX_DETOUR_MINUTES) {
      return null;
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

    return {
      leftRef,
      rightRef,
      routeOverlap: Number(routeOverlap.toFixed(2)),
      destinationProximity: Number(destinationProximity.toFixed(2)),
      score,
      detourMinutes: Number(detourMinutes.toFixed(1)),
      spreadDistanceKm: Number(spreadDistanceKm.toFixed(2)),
    };
  });

  const results = await runWithConcurrency(tasks, SCORING_CONCURRENCY);
  return results.filter((edge): edge is CompatibilityEdge => edge !== null);
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

export function computeLocationClusters(routeDescriptorRefs: string[]): Record<string, string> {
  const store = getStore();
  const clusterByRef: Record<string, string> = {};
  const canonicalGeohashes: string[] = [];

  for (const ref of routeDescriptorRefs) {
    const descriptor = store.descriptors.get(ref);
    if (!descriptor) continue;

    let merged = false;
    for (const existing of canonicalGeohashes) {
      if (areGeohashNeighbors(descriptor.geohash6, existing)) {
        clusterByRef[ref] = existing;
        merged = true;
        break;
      }
    }
    if (!merged) {
      canonicalGeohashes.push(descriptor.geohash6);
      clusterByRef[ref] = descriptor.geohash6;
    }
  }

  return clusterByRef;
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
        throw new Error(`Missing matcher destination record for ${sender.sealedDestinationRef}.`);
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

function getDestinationRecord(sealedDestinationRef: string) {
  const record = getStore().destinations.get(sealedDestinationRef);
  if (!record) {
    throw new Error(`Missing matcher destination record for ${sealedDestinationRef}.`);
  }
  return record;
}

function getPreviewPolyline(
  polyline: Array<[number, number]>,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Array<[number, number]> {
  if (polyline.length > 0) return polyline;
  return [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ];
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

type PreviewRider = {
  riderId: string;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  alias: string;
  maskedLocationLabel: string;
  coordinate: { lat: number; lng: number };
};

async function computeRouteForOrder(
  riders: PreviewRider[],
): Promise<{ totalTime: number; totalDistance: number }> {
  let from = { lat: PICKUP_ORIGIN_LAT, lng: PICKUP_ORIGIN_LNG };
  let totalTime = 0;
  let totalDistance = 0;

  for (const rider of riders) {
    const route = await getDrivingRoute(
      from.lat,
      from.lng,
      rider.coordinate.lat,
      rider.coordinate.lng,
    );
    totalTime += route.timeSeconds;
    totalDistance += route.distanceMeters;
    from = rider.coordinate;
  }

  return { totalTime, totalDistance };
}

async function findOptimalOrder(members: PreviewRider[]): Promise<PreviewRider[]> {
  if (members.length <= 1) return members;

  const perms = permutations(members);
  let bestOrder = members;
  let bestTime = Number.POSITIVE_INFINITY;

  for (const perm of perms) {
    const { totalTime } = await computeRouteForOrder(perm);
    if (totalTime < bestTime) {
      bestTime = totalTime;
      bestOrder = perm;
    }
  }

  return bestOrder;
}

export async function buildSimulatorPreview(
  request: MatcherSimulatorPreviewRequest,
): Promise<MatcherSimulatorPreviewResponse> {
  const riderPreviews = request.riders.map((rider) => {
    const destination = getDestinationRecord(rider.sealedDestinationRef);
    return {
      riderId: rider.riderId,
      routeDescriptorRef: rider.routeDescriptorRef,
      sealedDestinationRef: rider.sealedDestinationRef,
      alias: rider.alias,
      maskedLocationLabel: destination.maskedLocationLabel,
      coordinate: {
        lat: destination.lat,
        lng: destination.lng,
      },
    };
  });

  const riderById = new Map(riderPreviews.map((rider) => [rider.riderId, rider]));
  const groups = [];

  for (const group of request.groups) {
    const memberRiders = group.members
      .map((m) => riderById.get(m.riderId))
      .filter((r): r is PreviewRider => r !== undefined);

    if (memberRiders.length !== group.members.length) {
      const missing = group.members.find((m) => !riderById.has(m.riderId));
      throw new Error(`Missing matcher preview rider for ${missing?.riderId}.`);
    }

    const optimizedOrder = await findOptimalOrder(memberRiders);

    let from = {
      lat: PICKUP_ORIGIN_LAT,
      lng: PICKUP_ORIGIN_LNG,
      label: PICKUP_ORIGIN_LABEL,
    };
    const legs: MatcherSimulatorPreviewGroup["legs"] = [];
    let totalDistanceMeters = 0;
    let totalTimeSeconds = 0;

    for (const rider of optimizedOrder) {
      const route = await getDrivingRoute(
        from.lat,
        from.lng,
        rider.coordinate.lat,
        rider.coordinate.lng,
      );
      totalDistanceMeters += route.distanceMeters;
      totalTimeSeconds += route.timeSeconds;
      legs.push({
        fromLabel: from.label,
        toLabel: rider.alias,
        from: { lat: from.lat, lng: from.lng },
        to: rider.coordinate,
        polyline: getPreviewPolyline(route.polyline, from, rider.coordinate),
        distanceMeters: route.distanceMeters,
        timeSeconds: route.timeSeconds,
      });
      from = {
        lat: rider.coordinate.lat,
        lng: rider.coordinate.lng,
        label: rider.alias,
      };
    }

    groups.push({
      groupId: group.groupId,
      legs,
      totalDistanceMeters,
      totalTimeSeconds,
    });
  }

  return {
    riders: riderPreviews,
    groups,
  };
}
