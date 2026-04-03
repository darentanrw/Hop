import type {
  Coordinate,
  SelfDeclaredGender,
  SimulatorCompatibilityEdge,
  SimulatorCycleAssignment,
  SimulatorInputRider,
  SimulatorRunRequest,
  SimulatorRunResponse,
  SimulatorSession,
  SimulatorSessionGroup,
  SimulatorSessionRider,
  SimulatorStats,
} from "@hop/shared";

const allowedGenders = new Set<SelfDeclaredGender>([
  "woman",
  "man",
  "nonbinary",
  "prefer_not_to_say",
]);

const ADMIN_SIMULATOR_STORAGE_KEY = "hop-admin-simulator-session";
const ADMIN_SIMULATOR_STORAGE_VERSION = 1;

export type StoredAdminSimulatorState = {
  version: number;
  session: SimulatorSession;
  lastRun: SimulatorRunResponse | null;
};

function isoOffset(base: Date, offsetMinutes: number) {
  return new Date(base.getTime() + offsetMinutes * 60_000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDatetime(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    isRecord(value) &&
    typeof value.lat === "number" &&
    Number.isFinite(value.lat) &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lng)
  );
}

function isSimulatorInputRider(value: unknown): value is SimulatorInputRider {
  if (!isRecord(value)) return false;
  return (
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    typeof value.address === "string" &&
    value.address.trim().length > 0 &&
    (value.verifiedTitle == null || typeof value.verifiedTitle === "string") &&
    (value.postal == null || typeof value.postal === "string") &&
    typeof value.windowStart === "string" &&
    isIsoDatetime(value.windowStart) &&
    typeof value.windowEnd === "string" &&
    isIsoDatetime(value.windowEnd) &&
    allowedGenders.has(value.selfDeclaredGender as SelfDeclaredGender) &&
    typeof value.sameGenderOnly === "boolean"
  );
}

function isSimulatorSessionRider(value: unknown): value is SimulatorSessionRider {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.label === "string" &&
    value.label.trim().length > 0 &&
    typeof value.arrivalIndex === "number" &&
    Number.isInteger(value.arrivalIndex) &&
    value.arrivalIndex >= 0 &&
    typeof value.address === "string" &&
    value.address.trim().length > 0 &&
    (value.verifiedTitle == null || typeof value.verifiedTitle === "string") &&
    (value.postal == null || typeof value.postal === "string") &&
    typeof value.windowStart === "string" &&
    isIsoDatetime(value.windowStart) &&
    typeof value.windowEnd === "string" &&
    isIsoDatetime(value.windowEnd) &&
    allowedGenders.has(value.selfDeclaredGender as SelfDeclaredGender) &&
    typeof value.sameGenderOnly === "boolean" &&
    typeof value.sealedDestinationRef === "string" &&
    value.sealedDestinationRef.trim().length > 0 &&
    typeof value.routeDescriptorRef === "string" &&
    value.routeDescriptorRef.trim().length > 0 &&
    (value.state === "new" || value.state === "open" || value.state === "matched") &&
    (value.lastProcessedCycleNumber == null ||
      (typeof value.lastProcessedCycleNumber === "number" &&
        Number.isInteger(value.lastProcessedCycleNumber) &&
        value.lastProcessedCycleNumber >= 1)) &&
    (value.matchedGroupId == null || typeof value.matchedGroupId === "string") &&
    (value.maskedLocationLabel == null || typeof value.maskedLocationLabel === "string") &&
    (value.coordinate == null || isCoordinate(value.coordinate)) &&
    (value.clusterKey == null || typeof value.clusterKey === "string") &&
    (value.color == null || typeof value.color === "string") &&
    (value.dropoffOrder == null ||
      (typeof value.dropoffOrder === "number" &&
        Number.isInteger(value.dropoffOrder) &&
        value.dropoffOrder >= 1))
  );
}

function isSimulatorSessionGroup(value: unknown): value is SimulatorSessionGroup {
  if (!isRecord(value)) return false;
  return (
    typeof value.groupId === "string" &&
    value.groupId.trim().length > 0 &&
    Array.isArray(value.memberRiderIds) &&
    value.memberRiderIds.every((memberId) => typeof memberId === "string" && memberId.trim()) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.color === "string" &&
    value.color.trim().length > 0 &&
    typeof value.averageScore === "number" &&
    Number.isFinite(value.averageScore) &&
    typeof value.minimumScore === "number" &&
    Number.isFinite(value.minimumScore) &&
    typeof value.maxDetourMinutes === "number" &&
    Number.isFinite(value.maxDetourMinutes) &&
    typeof value.totalDistanceMeters === "number" &&
    Number.isFinite(value.totalDistanceMeters) &&
    typeof value.totalTimeSeconds === "number" &&
    Number.isFinite(value.totalTimeSeconds) &&
    Array.isArray(value.legs)
  );
}

function hashString(input: string) {
  let hash = 0;
  for (const character of input) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash >>> 0;
}

function normalizeRider(rider: SimulatorSessionRider): SimulatorSessionRider {
  return {
    ...rider,
    label: rider.label.trim(),
    address: rider.address.trim(),
    verifiedTitle: rider.verifiedTitle?.trim() || null,
    postal: rider.postal?.trim() || null,
    sealedDestinationRef: rider.sealedDestinationRef.trim(),
    routeDescriptorRef: rider.routeDescriptorRef.trim(),
    maskedLocationLabel: rider.maskedLocationLabel?.trim() || null,
    clusterKey: rider.clusterKey?.trim() || null,
    color: rider.color?.trim() || null,
  };
}

function normalizeGroup(group: SimulatorSessionGroup): SimulatorSessionGroup {
  return {
    ...group,
    memberRiderIds: [...new Set(group.memberRiderIds)],
    groupId: group.groupId.trim(),
    name: group.name.trim(),
    color: group.color.trim(),
  };
}

function extractSimulatorGroupNumber(groupId: string) {
  const match = /^sim_group_(\d+)$/.exec(groupId.trim());
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

export function getNextSimulatorGroupNumber(groups: SimulatorSessionGroup[]) {
  const maxGroupNumber = groups.reduce((max, group) => {
    const parsed = extractSimulatorGroupNumber(group.groupId);
    return parsed == null || Number.isNaN(parsed) ? max : Math.max(max, parsed);
  }, 0);
  return maxGroupNumber + 1;
}

export function buildSimulatorAlias(index: number) {
  return `Rider ${index + 1}`;
}

export function createEmptySimulatorSession(seed = Date.now()): SimulatorSession {
  return {
    sessionSeed: Math.abs(Math.floor(seed)) || 1,
    nextArrivalIndex: 0,
    nextCycleNumber: 1,
    riders: [],
    groups: [],
    openRiderIds: [],
  };
}

export function buildDefaultSimulatorRiders(now = new Date()): SimulatorInputRider[] {
  const sharedStart = new Date(now.getTime() + 6 * 3_600_000);
  const sharedEnd = new Date(sharedStart.getTime() + 2 * 3_600_000);

  return [
    {
      label: "Booker candidate",
      address: "321 Clementi Avenue 3, Singapore 129905",
      verifiedTitle: "321 Clementi Avenue 3",
      postal: "129905",
      windowStart: isoOffset(sharedStart, 0),
      windowEnd: isoOffset(sharedEnd, 0),
      selfDeclaredGender: "prefer_not_to_say",
      sameGenderOnly: false,
    },
    {
      label: "West cluster",
      address: "The Clementi Mall, Singapore 129588",
      verifiedTitle: "The Clementi Mall",
      postal: "129588",
      windowStart: isoOffset(sharedStart, 15),
      windowEnd: isoOffset(sharedEnd, 15),
      selfDeclaredGender: "prefer_not_to_say",
      sameGenderOnly: false,
    },
    {
      label: "Near Holland",
      address: "Holland Village MRT Station, Singapore 278995",
      verifiedTitle: "Holland Village MRT Station",
      postal: "278995",
      windowStart: isoOffset(sharedStart, 20),
      windowEnd: isoOffset(sharedEnd, 30),
      selfDeclaredGender: "prefer_not_to_say",
      sameGenderOnly: false,
    },
    {
      label: "Far east outlier",
      address: "Jewel Changi Airport, Singapore 819666",
      verifiedTitle: "Jewel Changi Airport",
      postal: "819666",
      windowStart: isoOffset(sharedStart, 0),
      windowEnd: isoOffset(sharedEnd, 0),
      selfDeclaredGender: "prefer_not_to_say",
      sameGenderOnly: false,
    },
  ];
}

export function normalizeSimulatorSession(session: SimulatorSession): SimulatorSession {
  const riders = session.riders
    .map(normalizeRider)
    .sort((left, right) => left.arrivalIndex - right.arrivalIndex);
  const riderIdSet = new Set(riders.map((rider) => rider.id));
  const claimedRiderIds = new Set<string>();
  const claimedGroupIds = new Set<string>();
  let nextGroupNumber = getNextSimulatorGroupNumber(session.groups.map(normalizeGroup));
  const groups: SimulatorSessionGroup[] = [];
  for (const rawGroup of session.groups.map(normalizeGroup)) {
    const groupId =
      rawGroup.groupId.length === 0 || claimedGroupIds.has(rawGroup.groupId)
        ? `sim_group_${nextGroupNumber++}`
        : rawGroup.groupId;
    claimedGroupIds.add(groupId);
    const memberRiderIds = rawGroup.memberRiderIds.filter((riderId, index, riderIds) => {
      if (!riderIdSet.has(riderId)) return false;
      if (riderIds.indexOf(riderId) !== index) return false;
      if (claimedRiderIds.has(riderId)) return false;
      claimedRiderIds.add(riderId);
      return true;
    });
    if (memberRiderIds.length < 2) continue;
    groups.push({
      ...rawGroup,
      groupId,
      memberRiderIds,
    });
  }
  const matchedRiderIds = new Set(groups.flatMap((group) => group.memberRiderIds));
  const matchedGroupByRiderId = new Map(
    groups.flatMap((group) =>
      group.memberRiderIds.map((riderId) => [riderId, group.groupId] as const),
    ),
  );

  const normalizedRiders = riders.map((rider) => {
    const matchedGroupId = matchedGroupByRiderId.get(rider.id) ?? null;
    const state = matchedGroupId ? "matched" : rider.state === "matched" ? "open" : rider.state;

    return {
      ...rider,
      state,
      matchedGroupId,
      color: matchedGroupId
        ? (groups.find((group) => group.groupId === matchedGroupId)?.color ?? rider.color)
        : null,
      dropoffOrder: matchedGroupId ? rider.dropoffOrder : null,
    } satisfies SimulatorSessionRider;
  });

  const openRiderIds = normalizedRiders
    .filter((rider) => !matchedRiderIds.has(rider.id) && rider.state !== "matched")
    .map((rider) => rider.id);
  const maxArrivalIndex = normalizedRiders.reduce(
    (max, rider) => Math.max(max, rider.arrivalIndex),
    -1,
  );

  return {
    sessionSeed: Math.abs(Math.floor(session.sessionSeed)) || 1,
    nextArrivalIndex: Math.max(session.nextArrivalIndex, maxArrivalIndex + 1, 0),
    nextCycleNumber: Math.max(session.nextCycleNumber, 1),
    riders: normalizedRiders,
    groups,
    openRiderIds,
  };
}

export function validateSimulatorRunRequest(
  value: unknown,
): { ok: true; data: SimulatorRunRequest } | { ok: false; error: string } {
  if (!isRecord(value) || !isRecord(value.session)) {
    return { ok: false, error: "Provide a JSON object with a session." };
  }

  const sessionValue = value.session as Record<string, unknown>;
  if (
    typeof sessionValue.sessionSeed !== "number" ||
    !Number.isFinite(sessionValue.sessionSeed) ||
    typeof sessionValue.nextArrivalIndex !== "number" ||
    !Number.isInteger(sessionValue.nextArrivalIndex) ||
    typeof sessionValue.nextCycleNumber !== "number" ||
    !Number.isInteger(sessionValue.nextCycleNumber) ||
    !Array.isArray(sessionValue.riders) ||
    !Array.isArray(sessionValue.groups) ||
    !Array.isArray(sessionValue.openRiderIds)
  ) {
    return { ok: false, error: "Session is missing required simulator fields." };
  }

  if (sessionValue.riders.length > 50) {
    return { ok: false, error: "Keep the simulator to 50 riders or fewer per run." };
  }

  if (!sessionValue.riders.every(isSimulatorSessionRider)) {
    return { ok: false, error: "Session riders are invalid." };
  }

  if (!sessionValue.groups.every(isSimulatorSessionGroup)) {
    return { ok: false, error: "Session groups are invalid." };
  }

  if (
    !sessionValue.openRiderIds.every(
      (riderId) => typeof riderId === "string" && riderId.trim().length > 0,
    )
  ) {
    return { ok: false, error: "Session open rider ids are invalid." };
  }

  const invalidWindow = sessionValue.riders.find(
    (rider) =>
      new Date(rider.windowEnd as string).getTime() <=
      new Date(rider.windowStart as string).getTime(),
  );
  if (invalidWindow) {
    return { ok: false, error: "Each rider windowEnd must be later than windowStart." };
  }

  return {
    ok: true,
    data: {
      session: normalizeSimulatorSession(sessionValue as unknown as SimulatorSession),
    },
  };
}

export function buildCycleAssignments(session: SimulatorSession): SimulatorCycleAssignment[] {
  const normalized = normalizeSimulatorSession(session);
  const newRiders = normalized.riders
    .filter((rider) => rider.state === "new")
    .sort((left, right) => left.arrivalIndex - right.arrivalIndex);

  if (newRiders.length === 0) {
    return normalized.openRiderIds.length > 0
      ? [{ cycleNumber: normalized.nextCycleNumber, riderIds: [] }]
      : [];
  }

  const assignments: SimulatorCycleAssignment[] = [];
  let offset = 0;
  let cycleNumber = normalized.nextCycleNumber;

  while (offset < newRiders.length) {
    const remaining = newRiders.length - offset;
    const batchSize = Math.min(getCycleBatchSize(normalized.sessionSeed, cycleNumber), remaining);
    assignments.push({
      cycleNumber,
      riderIds: newRiders.slice(offset, offset + batchSize).map((rider) => rider.id),
    });
    offset += batchSize;
    cycleNumber += 1;
  }

  return assignments;
}

export function getCycleBatchSize(sessionSeed: number, cycleNumber: number) {
  return (hashString(`${sessionSeed}:${cycleNumber}`) % 4) + 1;
}

export function buildSimulatorStats(
  session: SimulatorSession,
  compatibilityEdges: SimulatorCompatibilityEdge[],
): SimulatorStats {
  const totalRouteDistanceMeters = session.groups.reduce(
    (sum, group) => sum + group.totalDistanceMeters,
    0,
  );
  const totalRouteTimeSeconds = session.groups.reduce(
    (sum, group) => sum + group.totalTimeSeconds,
    0,
  );
  const totalGroupDetourMinutes = session.groups.reduce(
    (sum, group) => sum + group.maxDetourMinutes,
    0,
  );
  const pairScoreTotal = compatibilityEdges.reduce((sum, edge) => sum + edge.score, 0);
  const matchedRiders = session.riders.filter((rider) => rider.state === "matched").length;

  return {
    totalRiders: session.riders.length,
    groupsFormed: session.groups.length,
    matchedRiders,
    unmatchedRiders: session.openRiderIds.length,
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

export function loadStoredAdminSimulatorState(): StoredAdminSimulatorState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(ADMIN_SIMULATOR_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredAdminSimulatorState | null;
    if (!parsed || parsed.version !== ADMIN_SIMULATOR_STORAGE_VERSION || !parsed.session) {
      return null;
    }

    const validation = validateSimulatorRunRequest({ session: parsed.session });
    if (!validation.ok) return null;

    return {
      version: ADMIN_SIMULATOR_STORAGE_VERSION,
      session: validation.data.session,
      lastRun: parsed.lastRun ?? null,
    };
  } catch {
    return null;
  }
}

export function persistStoredAdminSimulatorState(state: StoredAdminSimulatorState) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      ADMIN_SIMULATOR_STORAGE_KEY,
      JSON.stringify({
        version: ADMIN_SIMULATOR_STORAGE_VERSION,
        session: normalizeSimulatorSession(state.session),
        lastRun: state.lastRun,
      } satisfies StoredAdminSimulatorState),
    );
  } catch {}
}

export function clearStoredAdminSimulatorState() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(ADMIN_SIMULATOR_STORAGE_KEY);
  } catch {}
}
