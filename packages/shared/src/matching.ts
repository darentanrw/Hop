import {
  type CompatibilityEdge,
  MAX_DETOUR_MINUTES,
  MAX_DISTINCT_LOCATIONS,
  MAX_SPREAD_KM,
  MIN_TIME_OVERLAP_MINUTES,
  SMALL_GROUP_RELEASE_HOURS,
  type SelfDeclaredGender,
  arePreferencesCompatible,
  overlapMinutes,
} from "./domain";

export type MatchingCandidate = {
  availabilityId: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  selfDeclaredGender: SelfDeclaredGender;
  sameGenderOnly: boolean;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  displayName: string;
};

export type SelectedGroup = {
  members: MatchingCandidate[];
  averageScore: number;
  minimumScore: number;
  maxDetourMinutes: number;
};

export type OpaqueDestinationSortable = {
  sealedDestinationRef: string;
  stableId: string;
  secondaryStableId?: string;
};

export function pairKey(left: string, right: string) {
  return [left, right].sort().join("::");
}

export function sortOpaqueDestinationEntries<T extends OpaqueDestinationSortable>(entries: T[]) {
  return [...entries].sort(
    (left, right) =>
      left.sealedDestinationRef
        .toLowerCase()
        .localeCompare(right.sealedDestinationRef.toLowerCase()) ||
      left.stableId.localeCompare(right.stableId) ||
      (left.secondaryStableId ?? "").localeCompare(right.secondaryStableId ?? ""),
  );
}

export function evaluateGroup(
  members: MatchingCandidate[],
  compatibilityMap: Map<string, CompatibilityEdge>,
  geohashByRef?: Map<string, string>,
) {
  const pairScores: CompatibilityEdge[] = [];

  for (let index = 0; index < members.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < members.length; compareIndex += 1) {
      const left = members[index];
      const right = members[compareIndex];
      const edge = compatibilityMap.get(pairKey(left.routeDescriptorRef, right.routeDescriptorRef));
      if (!edge) return null;
      if (edge.detourMinutes > MAX_DETOUR_MINUTES) return null;
      if (edge.spreadDistanceKm > MAX_SPREAD_KM) return null;
      if (overlapMinutes(left, right) <= MIN_TIME_OVERLAP_MINUTES) return null;
      if (!arePreferencesCompatible(left, right)) return null;
      pairScores.push(edge);
    }
  }

  if (geohashByRef) {
    const geohashes = members
      .map((member) => geohashByRef.get(member.routeDescriptorRef))
      .filter((value): value is string => Boolean(value));
    if (geohashes.length === members.length) {
      const distinctCount = new Set(geohashes).size;
      if (distinctCount > MAX_DISTINCT_LOCATIONS) return null;
    }
  }

  const averageScore =
    pairScores.reduce((total, score) => total + score.score, 0) / Math.max(pairScores.length, 1);
  const minimumScore = Math.min(...pairScores.map((score) => score.score), 1);
  const maxDetourMinutes = Math.max(...pairScores.map((score) => score.detourMinutes), 0);

  return {
    averageScore: Number(averageScore.toFixed(2)),
    minimumScore: Number(minimumScore.toFixed(2)),
    maxDetourMinutes,
  };
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  if (size === 1) return items.map((item) => [item]);

  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = items.slice(index + 1);
    for (const tail of combinations(rest, size - 1)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}

export function formGroups(
  candidates: MatchingCandidate[],
  edges: CompatibilityEdge[],
  geohashByRef?: Map<string, string>,
): SelectedGroup[] {
  const compatibilityMap = new Map<string, CompatibilityEdge>();
  for (const edge of edges) {
    compatibilityMap.set(pairKey(edge.leftRef, edge.rightRef), edge);
  }

  const unmatched = [...candidates];
  const selectedGroups: SelectedGroup[] = [];

  const trySize = (size: number) => {
    let best: SelectedGroup | null = null;

    for (const candidateMembers of combinations(unmatched, size)) {
      const sharedWindowStart = Math.max(
        ...candidateMembers.map((member) => new Date(member.windowStart).getTime()),
      );
      const hoursUntilStart = (sharedWindowStart - Date.now()) / 3_600_000;
      if (size < 4 && hoursUntilStart > SMALL_GROUP_RELEASE_HOURS) {
        continue;
      }

      const evaluation = evaluateGroup(candidateMembers, compatibilityMap, geohashByRef);
      if (!evaluation) continue;

      const current = { members: candidateMembers, ...evaluation };
      if (
        !best ||
        current.averageScore > best.averageScore ||
        (current.averageScore === best.averageScore && current.minimumScore > best.minimumScore) ||
        (current.averageScore === best.averageScore &&
          current.minimumScore === best.minimumScore &&
          current.maxDetourMinutes < best.maxDetourMinutes)
      ) {
        best = current;
      }
    }

    if (!best) return false;

    selectedGroups.push(best);
    for (const member of best.members) {
      const index = unmatched.findIndex((entry) => entry.availabilityId === member.availabilityId);
      if (index >= 0) unmatched.splice(index, 1);
    }
    return true;
  };

  while (unmatched.length >= 2) {
    if (trySize(4)) continue;
    if (trySize(3)) continue;
    if (trySize(2)) continue;
    break;
  }

  return selectedGroups;
}
