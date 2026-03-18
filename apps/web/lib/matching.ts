import {
  ACK_WINDOW_MINUTES,
  type AvailabilityEntry,
  type CompatibilityEdge,
  MAX_DETOUR_MINUTES,
  PICKUP_ORIGIN_ID,
  PICKUP_ORIGIN_LABEL,
  SMALL_GROUP_RELEASE_HOURS,
  type TentativeGroupMember,
} from "@hop/shared";
import { fetchCompatibility, fetchRevealEnvelopes } from "./matcher-client";
import {
  createGroup,
  dissolveGroup,
  findActiveGroupForRider,
  getActiveClientKeyForUser,
  getEnvelopesForRecipient,
  getGroup,
  getStore,
  listGroupMembers,
  listOpenAvailabilities,
  markAvailabilityMatched,
  nowIso,
  recordAudit,
  revealGroup,
  setGroupMembers,
  updateAcknowledgement,
} from "./store";

type CompatibilityMap = Map<string, CompatibilityEdge>;

function pairKey(left: string, right: string) {
  return [left, right].sort().join("::");
}

export function overlapMinutes(left: AvailabilityEntry, right: AvailabilityEntry) {
  const start = Math.max(
    new Date(left.windowStart).getTime(),
    new Date(right.windowStart).getTime(),
  );
  const end = Math.min(new Date(left.windowEnd).getTime(), new Date(right.windowEnd).getTime());
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function arePreferencesCompatible(left: AvailabilityEntry, right: AvailabilityEntry) {
  if (left.sameGenderOnly || right.sameGenderOnly) {
    return left.selfDeclaredGender === right.selfDeclaredGender;
  }

  return true;
}

function routeCompatible(
  left: AvailabilityEntry,
  right: AvailabilityEntry,
  compatibilityMap: CompatibilityMap,
) {
  const edge = compatibilityMap.get(pairKey(left.routeDescriptorRef, right.routeDescriptorRef));
  if (!edge) return null;
  if (edge.detourMinutes > MAX_DETOUR_MINUTES) return null;
  if (overlapMinutes(left, right) < 60) return null;
  if (!arePreferencesCompatible(left, right)) return null;
  return edge;
}

function groupAllowedForMembers(members: AvailabilityEntry[]) {
  const size = members.length;
  return members.every((member) => size >= member.minGroupSize && size <= member.maxGroupSize);
}

function evaluateGroup(
  members: AvailabilityEntry[],
  compatibilityMap: CompatibilityMap,
): null | {
  averageScore: number;
  minimumScore: number;
  maxDetourMinutes: number;
} {
  const pairScores: CompatibilityEdge[] = [];

  for (let index = 0; index < members.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < members.length; compareIndex += 1) {
      const edge = routeCompatible(members[index], members[compareIndex], compatibilityMap);
      if (!edge) return null;
      pairScores.push(edge);
    }
  }

  if (!groupAllowedForMembers(members)) {
    return null;
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

export async function runMatching() {
  const candidates = listOpenAvailabilities();
  if (candidates.length < 2) return;

  const edges = await fetchCompatibility(candidates.map((entry) => entry.routeDescriptorRef));
  const compatibilityMap = new Map<string, CompatibilityEdge>();
  for (const edge of edges) {
    compatibilityMap.set(pairKey(edge.leftRef, edge.rightRef), edge);
  }

  const unmatched = [...candidates];
  const selectedGroups: Array<{
    members: AvailabilityEntry[];
    averageScore: number;
    minimumScore: number;
    maxDetourMinutes: number;
  }> = [];

  const trySize = (size: number) => {
    let best: {
      members: AvailabilityEntry[];
      averageScore: number;
      minimumScore: number;
      maxDetourMinutes: number;
    } | null = null;

    for (const candidateMembers of combinations(unmatched, size)) {
      const hoursUntilStart =
        (new Date(candidateMembers[0].windowStart).getTime() - Date.now()) / 3_600_000;
      if (size < 4 && hoursUntilStart > SMALL_GROUP_RELEASE_HOURS) {
        continue;
      }

      const evaluation = evaluateGroup(candidateMembers, compatibilityMap);
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
      const index = unmatched.findIndex((entry) => entry.id === member.id);
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

  for (const selected of selectedGroups) {
    const fareBands = selected.members.map((member) => member.estimatedFareBand);
    const group = createGroup({
      status: "tentative",
      pickupOriginId: PICKUP_ORIGIN_ID,
      pickupLabel: PICKUP_ORIGIN_LABEL,
      windowStart: selected.members[0].windowStart,
      windowEnd: selected.members[0].windowEnd,
      groupSize: selected.members.length,
      estimatedFareBand: fareBands.sort()[0],
      maxDetourMinutes: selected.maxDetourMinutes,
      averageScore: selected.averageScore,
      minimumScore: selected.minimumScore,
      confirmationDeadline: new Date(Date.now() + ACK_WINDOW_MINUTES * 60_000).toISOString(),
      availabilityIds: selected.members.map((member) => member.id),
      memberRiderIds: selected.members.map((member) => member.riderId),
    });

    markAvailabilityMatched(group.availabilityIds);

    const store = getStore();
    const members: TentativeGroupMember[] = selected.members.map((member, index) => {
      const rider = store.riders.get(member.riderId);
      return {
        riderId: member.riderId,
        availabilityId: member.id,
        pseudonymLabel: rider?.pseudonymCode ?? `Rider ${index + 1}`,
        accepted: null,
        acknowledgedAt: null,
      };
    });

    setGroupMembers(group.id, members);
    recordAudit("group.created", group.id, {
      groupSize: group.groupSize,
      averageScore: group.averageScore,
    });
  }
}

export async function acknowledgeGroup(groupId: string, riderId: string, accepted: boolean) {
  const group = getGroup(groupId);
  if (!group) return null;

  if (new Date(group.confirmationDeadline).getTime() < Date.now()) {
    dissolveGroup(groupId);
    recordAudit("group.timeout", groupId, { groupId });
    return null;
  }

  const updated = updateAcknowledgement(groupId, riderId, accepted);
  if (!updated) return null;

  if (!accepted) {
    dissolveGroup(groupId);
    recordAudit("group.declined", groupId, { riderId });
    await runMatching();
    return null;
  }

  const members = listGroupMembers(groupId);
  const revealReady = members.length > 0 && members.every((member) => member.accepted === true);
  recordAudit("group.acknowledged", groupId, { riderId, revealReady });

  return findActiveGroupForRider(riderId);
}

export async function revealAddresses(groupId: string) {
  const store = getStore();
  const group = getGroup(groupId);
  if (!group) {
    throw new Error("Group not found.");
  }

  const members = listGroupMembers(groupId);
  if (!members.length || !members.every((member) => member.accepted === true)) {
    throw new Error("All riders must acknowledge before reveal.");
  }

  if (group.status === "revealed") {
    return group;
  }

  const revealMembers = members.map((member) => {
    const availability = store.availabilities.get(member.availabilityId);
    const rider = store.riders.get(member.riderId);
    if (!availability || !rider) {
      throw new Error("Reveal data is incomplete.");
    }

    const clientKey = getActiveClientKeyForUser(rider.userId);
    if (!clientKey) {
      throw new Error("Missing active client key for rider.");
    }

    return {
      riderId: member.riderId,
      pseudonym: member.pseudonymLabel,
      sealedDestinationRef: availability.sealedDestinationRef,
      publicKey: clientKey.publicKey,
    };
  });

  const envelopes = await fetchRevealEnvelopes(revealMembers);
  const byRecipient: Record<string, typeof envelopes> = {};
  for (const envelope of envelopes) {
    if (!byRecipient[envelope.recipientRiderId]) {
      byRecipient[envelope.recipientRiderId] = [];
    }
    byRecipient[envelope.recipientRiderId].push(envelope);
  }

  revealGroup(groupId, byRecipient);
  recordAudit("group.revealed", groupId, { members: revealMembers.length });
  return getGroup(groupId);
}

export function revealStatusForRider(riderId: string) {
  const current = findActiveGroupForRider(riderId);
  if (!current) return null;

  return {
    status: current.group.status,
    revealReady: current.revealReady,
    confirmationDeadline: current.group.confirmationDeadline,
  };
}

export function envelopesForRider(groupId: string, riderId: string) {
  return getEnvelopesForRecipient(groupId, riderId);
}
