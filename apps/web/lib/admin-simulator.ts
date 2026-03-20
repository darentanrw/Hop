import type {
  SelfDeclaredGender,
  SimulatorCompatibilityEdge,
  SimulatorGroupResult,
  SimulatorInputRider,
  SimulatorRequest,
  SimulatorRiderResult,
  SimulatorStats,
} from "@hop/shared";

const allowedGenders = new Set<SelfDeclaredGender>([
  "woman",
  "man",
  "nonbinary",
  "prefer_not_to_say",
]);

function isoOffset(base: Date, offsetMinutes: number) {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

export function buildDefaultSimulatorRequest(now = new Date()): SimulatorRequest {
  const sharedStart = new Date(now.getTime() + 6 * 3_600_000);
  const sharedEnd = new Date(sharedStart.getTime() + 2 * 3_600_000);

  return {
    riders: [
      {
        label: "Booker candidate",
        address: "321 Clementi Avenue 3, Singapore 129905",
        windowStart: isoOffset(sharedStart, 0),
        windowEnd: isoOffset(sharedEnd, 0),
        selfDeclaredGender: "prefer_not_to_say",
        sameGenderOnly: false,
      },
      {
        label: "West cluster",
        address: "The Clementi Mall, Singapore 129588",
        windowStart: isoOffset(sharedStart, 15),
        windowEnd: isoOffset(sharedEnd, 15),
        selfDeclaredGender: "prefer_not_to_say",
        sameGenderOnly: false,
      },
      {
        label: "Near Holland",
        address: "Holland Village MRT Station, Singapore 278995",
        windowStart: isoOffset(sharedStart, 20),
        windowEnd: isoOffset(sharedEnd, 30),
        selfDeclaredGender: "prefer_not_to_say",
        sameGenderOnly: false,
      },
      {
        label: "Far east outlier",
        address: "Jewel Changi Airport, Singapore 819666",
        windowStart: isoOffset(sharedStart, 0),
        windowEnd: isoOffset(sharedEnd, 0),
        selfDeclaredGender: "prefer_not_to_say",
        sameGenderOnly: false,
      },
    ],
  };
}

export const DEFAULT_SIMULATOR_REQUEST: SimulatorRequest = buildDefaultSimulatorRequest();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDatetime(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function isSimulatorRider(value: unknown): value is SimulatorInputRider {
  if (!isRecord(value)) return false;
  return (
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    typeof value.address === "string" &&
    value.address.trim().length > 0 &&
    typeof value.windowStart === "string" &&
    isIsoDatetime(value.windowStart) &&
    typeof value.windowEnd === "string" &&
    isIsoDatetime(value.windowEnd) &&
    allowedGenders.has(value.selfDeclaredGender as SelfDeclaredGender) &&
    typeof value.sameGenderOnly === "boolean"
  );
}

export function validateSimulatorRequest(
  value: unknown,
): { ok: true; data: SimulatorRequest } | { ok: false; error: string } {
  if (!isRecord(value) || !Array.isArray(value.riders)) {
    return { ok: false, error: "Provide a JSON object with a riders array." };
  }

  if (value.riders.length < 2) {
    return { ok: false, error: "Provide at least 2 riders to simulate matching." };
  }

  if (value.riders.length > 50) {
    return { ok: false, error: "Keep the simulator to 50 riders or fewer per run." };
  }

  if (!value.riders.every(isSimulatorRider)) {
    return {
      ok: false,
      error:
        "Each rider needs label, address, ISO windowStart/windowEnd, selfDeclaredGender, and sameGenderOnly.",
    };
  }

  const invalidWindow = value.riders.find(
    (rider) => new Date(rider.windowEnd).getTime() <= new Date(rider.windowStart).getTime(),
  );
  if (invalidWindow) {
    return { ok: false, error: "Each rider windowEnd must be later than windowStart." };
  }

  return {
    ok: true,
    data: {
      riders: value.riders.map((rider) => ({
        label: rider.label.trim(),
        address: rider.address.trim(),
        windowStart: rider.windowStart,
        windowEnd: rider.windowEnd,
        selfDeclaredGender: rider.selfDeclaredGender,
        sameGenderOnly: rider.sameGenderOnly,
      })),
    },
  };
}

export function buildSimulatorAlias(index: number) {
  return `Rider ${index + 1}`;
}

export function buildSimulatorStats(
  riders: SimulatorRiderResult[],
  groups: SimulatorGroupResult[],
  compatibilityEdges: SimulatorCompatibilityEdge[],
): SimulatorStats {
  const totalRouteDistanceMeters = groups.reduce(
    (sum, group) => sum + group.totalDistanceMeters,
    0,
  );
  const totalRouteTimeSeconds = groups.reduce((sum, group) => sum + group.totalTimeSeconds, 0);
  const totalGroupDetourMinutes = groups.reduce((sum, group) => sum + group.maxDetourMinutes, 0);
  const pairScoreTotal = compatibilityEdges.reduce((sum, edge) => sum + edge.score, 0);

  return {
    totalRiders: riders.length,
    groupsFormed: groups.length,
    matchedRiders: riders.filter((rider) => rider.groupId !== null).length,
    unmatchedRiders: riders.filter((rider) => rider.groupId === null).length,
    compatiblePairCount: compatibilityEdges.length,
    averagePairScore: compatibilityEdges.length
      ? Number((pairScoreTotal / compatibilityEdges.length).toFixed(2))
      : 0,
    minimumPairScore: compatibilityEdges.length
      ? Math.min(...compatibilityEdges.map((edge) => edge.score))
      : 0,
    totalRouteDistanceMeters,
    totalRouteTimeSeconds,
    totalGroupDetourMinutes: Number(totalGroupDetourMinutes.toFixed(1)),
  };
}

export function toSimulatorJson(value: SimulatorRequest = DEFAULT_SIMULATOR_REQUEST) {
  return JSON.stringify(value, null, 2);
}
