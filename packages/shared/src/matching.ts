import {
  type CompatibilityEdge,
  MAX_DETOUR_MINUTES,
  MAX_GROUP_ACCOUNTS,
  MAX_GROUP_SIZE,
  MAX_SPREAD_KM,
  MIN_GROUP_SIZE,
  MIN_TIME_OVERLAP_MINUTES,
  SMALL_GROUP_RELEASE_HOURS,
  type SelfDeclaredGender,
  arePreferencesCompatible,
  isGroupWithinCapacity,
  overlapMinutes,
  sumPartySizes,
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
  /** Passengers on this booking; defaults to 1. */
  partySize?: number;
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
  _geohashByRef?: Map<string, string>,
) {
  if (!isGroupWithinCapacity(members)) return null;

  const pairScores: CompatibilityEdge[] = [];

  for (let index = 0; index < members.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < members.length; compareIndex += 1) {
      const left = members[index];
      const right = members[compareIndex];
      const key = pairKey(left.routeDescriptorRef, right.routeDescriptorRef);
      let edge = compatibilityMap.get(key);
      if (!edge && left.routeDescriptorRef === right.routeDescriptorRef) {
        const ref = left.routeDescriptorRef;
        edge = {
          leftRef: ref,
          rightRef: ref,
          score: 1,
          routeOverlap: 1,
          destinationProximity: 1,
          detourMinutes: 0,
          spreadDistanceKm: 0,
        };
      }
      if (!edge) return null;
      if (edge.detourMinutes > MAX_DETOUR_MINUTES) return null;
      if (edge.spreadDistanceKm > MAX_SPREAD_KM) return null;
      if (overlapMinutes(left, right) <= MIN_TIME_OVERLAP_MINUTES) return null;
      if (!arePreferencesCompatible(left, right)) return null;
      pairScores.push(edge);
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

function forEachSubset<T>(
  items: T[],
  minSize: number,
  maxSize: number,
  visit: (subset: T[]) => void,
) {
  const n = items.length;
  const subset: T[] = [];
  function dfs(i: number) {
    if (subset.length === maxSize) {
      visit([...subset]);
      return;
    }
    if (i === n) {
      if (subset.length >= minSize) {
        visit([...subset]);
      }
      return;
    }
    dfs(i + 1);
    subset.push(items[i] as T);
    dfs(i + 1);
    subset.pop();
  }
  dfs(0);
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

  while (unmatched.length >= 2) {
    let best: SelectedGroup | null = null;

    for (let targetSeats = MAX_GROUP_SIZE; targetSeats >= MIN_GROUP_SIZE; targetSeats--) {
      forEachSubset(unmatched, 2, MAX_GROUP_ACCOUNTS, (candidateMembers) => {
        const seats = sumPartySizes(candidateMembers);
        if (seats !== targetSeats) {
          return;
        }

        const sharedWindowStart = Math.max(
          ...candidateMembers.map((member) => new Date(member.windowStart).getTime()),
        );
        const hoursUntilStart = (sharedWindowStart - Date.now()) / 3_600_000;
        if (seats < MAX_GROUP_SIZE && hoursUntilStart > SMALL_GROUP_RELEASE_HOURS) {
          return;
        }

        const evaluation = evaluateGroup(candidateMembers, compatibilityMap, geohashByRef);
        if (!evaluation) {
          return;
        }

        const current = { members: candidateMembers, ...evaluation };
        if (
          !best ||
          current.averageScore > best.averageScore ||
          (current.averageScore === best.averageScore &&
            current.minimumScore > best.minimumScore) ||
          (current.averageScore === best.averageScore &&
            current.minimumScore === best.minimumScore &&
            current.maxDetourMinutes < best.maxDetourMinutes)
        ) {
          best = current;
        }
      });

      if (best) {
        break;
      }
    }

    if (best === null) {
      break;
    }

    const chosen: SelectedGroup = best;
    selectedGroups.push(chosen);
    for (const member of chosen.members) {
      const index = unmatched.findIndex((entry) => entry.availabilityId === member.availabilityId);
      if (index >= 0) {
        unmatched.splice(index, 1);
      }
    }
  }

  return selectedGroups;
}
