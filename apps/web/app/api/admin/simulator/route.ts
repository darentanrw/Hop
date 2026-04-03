import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import type {
  CompatibilityEdge,
  MatcherSimulatorPreviewResponse,
  MatchingCandidate,
  SimulatorCompatibilityEdge,
  SimulatorRunResponse,
  SimulatorSession,
  SimulatorSessionGroup,
  SimulatorSessionRider,
} from "@hop/shared";
import {
  MAX_GROUP_ACCOUNTS,
  evaluateGroup,
  formGroups,
  pairKey,
  sortOpaqueDestinationEntries,
} from "@hop/shared";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import {
  buildCycleAssignments,
  buildSimulatorStats,
  getNextSimulatorGroupNumber,
  normalizeSimulatorSession,
  validateSimulatorRunRequest,
} from "../../../../lib/admin-simulator";
import { getUnusedGroupTheme } from "../../../../lib/group-lifecycle";
import { getMatcherBaseUrl } from "../../../../lib/matcher-base-url";

type DestinationSubmission = {
  sealedDestinationRef: string;
  routeDescriptorRef: string;
};

type CompatibilityResponse = {
  edges: CompatibilityEdge[];
  geohashByRef: Record<string, string>;
};

type SimulationExecutionResult = {
  session: SimulatorSession;
  compatibilityEdges: SimulatorCompatibilityEdge[];
  cycleAssignments: Array<{ cycleNumber: number; riderIds: string[] }>;
};

function buildCandidate(rider: SimulatorSessionRider): MatchingCandidate {
  return {
    availabilityId: rider.id,
    userId: rider.id,
    windowStart: rider.windowStart,
    windowEnd: rider.windowEnd,
    selfDeclaredGender: rider.selfDeclaredGender,
    sameGenderOnly: rider.sameGenderOnly,
    routeDescriptorRef: rider.routeDescriptorRef,
    sealedDestinationRef: rider.sealedDestinationRef,
    displayName: rider.label,
  };
}

function compareGroupScores(
  left: Pick<SimulatorSessionGroup, "averageScore" | "minimumScore" | "maxDetourMinutes">,
  right: Pick<SimulatorSessionGroup, "averageScore" | "minimumScore" | "maxDetourMinutes">,
) {
  if (left.averageScore !== right.averageScore) {
    return left.averageScore - right.averageScore;
  }
  if (left.minimumScore !== right.minimumScore) {
    return left.minimumScore - right.minimumScore;
  }
  return right.maxDetourMinutes - left.maxDetourMinutes;
}

function shouldRefreshMatcherRefs(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Missing matcher route descriptor") ||
    message.includes("Missing matcher destination record")
  );
}

async function postMatcherJson<TResponse>(
  url: string,
  body: unknown,
  headers: HeadersInit = {},
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | TResponse
    | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error ?? "Matcher request failed.");
  }

  return payload as TResponse;
}

async function fetchCompatibility(
  matcherBaseUrl: string,
  riders: SimulatorSessionRider[],
): Promise<CompatibilityResponse> {
  if (riders.length < 2) {
    return { edges: [], geohashByRef: {} };
  }

  return await postMatcherJson<CompatibilityResponse>(`${matcherBaseUrl}/matcher/compatibility`, {
    routeDescriptorRefs: riders.map((rider) => rider.routeDescriptorRef),
  });
}

async function refreshSessionDestinations(
  session: SimulatorSession,
  matcherBaseUrl: string,
): Promise<SimulatorSession> {
  const refreshedRiders = await Promise.all(
    session.riders.map(async (rider) => {
      let submission: DestinationSubmission;
      try {
        submission = await postMatcherJson<DestinationSubmission>(
          `${matcherBaseUrl}/matcher/submit-destination`,
          { address: rider.address },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Matcher destination submission failed.";
        if (message === "Could not geocode the address. Please check the address and try again.") {
          throw new Error(
            `Could not geocode "${rider.label}". Try a more specific Singapore landmark or add a postal code.`,
          );
        }
        throw error;
      }

      return {
        ...rider,
        sealedDestinationRef: submission.sealedDestinationRef,
        routeDescriptorRef: submission.routeDescriptorRef,
        maskedLocationLabel: null,
        coordinate: null,
        clusterKey: null,
        color: rider.state === "matched" ? rider.color : null,
        dropoffOrder: rider.state === "matched" ? rider.dropoffOrder : null,
      } satisfies SimulatorSessionRider;
    }),
  );

  return normalizeSimulatorSession({
    ...session,
    riders: refreshedRiders,
  });
}

function applyPreviewData(
  session: SimulatorSession,
  preview: MatcherSimulatorPreviewResponse,
  geohashByRef: Record<string, string>,
): SimulatorSession {
  const previewRiderById = new Map(preview.riders.map((rider) => [rider.riderId, rider]));
  const previewGroupById = new Map(preview.groups.map((group) => [group.groupId, group]));
  const groupMembership = new Map<
    string,
    { groupId: string; color: string; dropoffOrder: number }
  >();

  for (const group of session.groups) {
    group.memberRiderIds.forEach((riderId, index) => {
      groupMembership.set(riderId, {
        groupId: group.groupId,
        color: group.color,
        dropoffOrder: index + 1,
      });
    });
  }

  const riders = session.riders.map((rider) => {
    const previewRider = previewRiderById.get(rider.id);
    const membership = groupMembership.get(rider.id);

    return {
      ...rider,
      maskedLocationLabel: previewRider?.maskedLocationLabel ?? rider.maskedLocationLabel,
      coordinate: previewRider?.coordinate ?? rider.coordinate,
      clusterKey: geohashByRef[rider.routeDescriptorRef] ?? rider.clusterKey,
      matchedGroupId: membership?.groupId ?? null,
      color: membership?.color ?? null,
      dropoffOrder: membership?.dropoffOrder ?? null,
      state: membership ? "matched" : rider.state === "matched" ? "open" : rider.state,
    } satisfies SimulatorSessionRider;
  });

  const groups = session.groups.map((group) => {
    const previewGroup = previewGroupById.get(group.groupId);
    return {
      ...group,
      totalDistanceMeters: previewGroup?.totalDistanceMeters ?? group.totalDistanceMeters,
      totalTimeSeconds: previewGroup?.totalTimeSeconds ?? group.totalTimeSeconds,
      legs: previewGroup?.legs ?? group.legs,
    } satisfies SimulatorSessionGroup;
  });

  return normalizeSimulatorSession({
    ...session,
    riders,
    groups,
  });
}

async function buildPreviewSession(
  session: SimulatorSession,
  matcherBaseUrl: string,
  previewSecret: string,
  geohashByRef: Record<string, string>,
) {
  if (session.riders.length === 0) {
    return session;
  }

  const preview = await postMatcherJson<MatcherSimulatorPreviewResponse>(
    `${matcherBaseUrl}/matcher/admin/preview`,
    {
      riders: session.riders.map((rider) => ({
        riderId: rider.id,
        routeDescriptorRef: rider.routeDescriptorRef,
        sealedDestinationRef: rider.sealedDestinationRef,
        alias: rider.label,
      })),
      groups: session.groups.map((group) => ({
        groupId: group.groupId,
        members: sortOpaqueDestinationEntries(
          group.memberRiderIds.map((riderId) => {
            const rider = session.riders.find((entry) => entry.id === riderId);
            if (!rider) {
              throw new Error(`Missing rider ${riderId} for preview group ${group.groupId}.`);
            }
            return {
              riderId: rider.id,
              alias: rider.label,
              routeDescriptorRef: rider.routeDescriptorRef,
              sealedDestinationRef: rider.sealedDestinationRef,
              stableId: rider.id,
            };
          }),
        ).map(({ stableId: _stableId, ...member }) => member),
      })),
    },
    {
      "x-hop-admin-preview-secret": previewSecret,
    },
  );

  return applyPreviewData(session, preview, geohashByRef);
}

async function executeSimulation(
  session: SimulatorSession,
  matcherBaseUrl: string,
  previewSecret: string,
): Promise<SimulationExecutionResult> {
  const workingSession = normalizeSimulatorSession(session);
  const riderById = new Map(workingSession.riders.map((rider) => [rider.id, rider]));
  const cycleAssignments = buildCycleAssignments(workingSession);
  const compatibilityEdgeMap = new Map<string, SimulatorCompatibilityEdge>();
  const geohashByRef: Record<string, string> = {};
  let nextGroupNumber = getNextSimulatorGroupNumber(workingSession.groups);
  const usedGroupColors = new Set(
    workingSession.groups.map((group) => group.color).filter((color) => color.trim().length > 0),
  );

  for (const cycle of cycleAssignments) {
    const currentOpenIds = new Set(workingSession.openRiderIds);
    for (const riderId of cycle.riderIds) {
      currentOpenIds.add(riderId);
    }

    const currentOpenRiders = [...currentOpenIds]
      .map((riderId) => riderById.get(riderId))
      .filter((rider): rider is SimulatorSessionRider => Boolean(rider))
      .sort((left, right) => left.arrivalIndex - right.arrivalIndex);

    const relevantRiders = [
      ...workingSession.groups.flatMap((group) =>
        group.memberRiderIds
          .map((riderId) => riderById.get(riderId))
          .filter((rider): rider is SimulatorSessionRider => Boolean(rider)),
      ),
      ...currentOpenRiders,
    ];
    const uniqueRelevantRiders = [
      ...new Map(relevantRiders.map((rider) => [rider.id, rider])).values(),
    ];
    const compatibility = await fetchCompatibility(matcherBaseUrl, uniqueRelevantRiders);
    const compatibilityMap = new Map(
      compatibility.edges.map((edge) => [pairKey(edge.leftRef, edge.rightRef), edge]),
    );
    const cycleGeohashMap = new Map(Object.entries(compatibility.geohashByRef));

    for (const [ref, geohash] of Object.entries(compatibility.geohashByRef)) {
      geohashByRef[ref] = geohash;
    }

    for (const edge of compatibility.edges) {
      const left = uniqueRelevantRiders.find((rider) => rider.routeDescriptorRef === edge.leftRef);
      const right = uniqueRelevantRiders.find(
        (rider) => rider.routeDescriptorRef === edge.rightRef,
      );
      if (!left || !right) continue;
      compatibilityEdgeMap.set(pairKey(left.id, right.id), {
        ...edge,
        leftRiderId: left.id,
        rightRiderId: right.id,
        leftAlias: left.label,
        rightAlias: right.label,
        cycleNumber: cycle.cycleNumber,
      });
    }

    const remainingOpenIds = new Set(currentOpenRiders.map((rider) => rider.id));

    for (const rider of currentOpenRiders) {
      if (!remainingOpenIds.has(rider.id)) continue;

      let bestGroupIndex = -1;
      let bestScore: Pick<
        SimulatorSessionGroup,
        "averageScore" | "minimumScore" | "maxDetourMinutes"
      > | null = null;

      for (const [groupIndex, group] of workingSession.groups.entries()) {
        const members = group.memberRiderIds
          .map((memberId) => riderById.get(memberId))
          .filter((member): member is SimulatorSessionRider => Boolean(member));
        if (members.length !== group.memberRiderIds.length) continue;
        if (members.length + 1 > MAX_GROUP_ACCOUNTS) continue;

        const evaluation = evaluateGroup(
          [...members.map(buildCandidate), buildCandidate(rider)],
          compatibilityMap,
          cycleGeohashMap,
        );
        if (!evaluation) continue;

        if (!bestScore || compareGroupScores(evaluation, bestScore) > 0) {
          bestGroupIndex = groupIndex;
          bestScore = evaluation;
        }
      }

      if (bestGroupIndex < 0 || !bestScore) {
        continue;
      }

      const group = workingSession.groups[bestGroupIndex];
      group.memberRiderIds = sortOpaqueDestinationEntries(
        [...group.memberRiderIds, rider.id].map((memberId) => {
          const member = riderById.get(memberId);
          if (!member) {
            throw new Error(`Missing rider ${memberId} for simulated group ${group.groupId}.`);
          }
          return {
            sealedDestinationRef: member.sealedDestinationRef,
            stableId: member.id,
          };
        }),
      ).map((member) => member.stableId);
      group.averageScore = bestScore.averageScore;
      group.minimumScore = bestScore.minimumScore;
      group.maxDetourMinutes = bestScore.maxDetourMinutes;

      rider.state = "matched";
      rider.matchedGroupId = group.groupId;
      rider.lastProcessedCycleNumber = cycle.cycleNumber;
      remainingOpenIds.delete(rider.id);
    }

    const remainingOpenRiders = [...remainingOpenIds]
      .map((riderId) => riderById.get(riderId))
      .filter((rider): rider is SimulatorSessionRider => Boolean(rider))
      .sort((left, right) => left.arrivalIndex - right.arrivalIndex);
    const selectedGroups = formGroups(
      remainingOpenRiders.map(buildCandidate),
      compatibility.edges,
      cycleGeohashMap,
    );

    for (const selectedGroup of selectedGroups) {
      const groupId = `sim_group_${nextGroupNumber}`;
      nextGroupNumber += 1;
      const theme = getUnusedGroupTheme(
        `${workingSession.sessionSeed}:${groupId}`,
        usedGroupColors,
      );

      const memberRiderIds = sortOpaqueDestinationEntries(
        selectedGroup.members.map((member) => {
          const rider = riderById.get(member.userId);
          if (!rider) {
            throw new Error(`Missing rider ${member.userId} for selected simulator group.`);
          }
          return {
            sealedDestinationRef: rider.sealedDestinationRef,
            stableId: rider.id,
          };
        }),
      ).map((member) => member.stableId);

      workingSession.groups.push({
        groupId,
        memberRiderIds,
        name: theme.name,
        color: theme.color,
        averageScore: selectedGroup.averageScore,
        minimumScore: selectedGroup.minimumScore,
        maxDetourMinutes: selectedGroup.maxDetourMinutes,
        totalDistanceMeters: 0,
        totalTimeSeconds: 0,
        legs: [],
      });

      for (const riderId of memberRiderIds) {
        const rider = riderById.get(riderId);
        if (!rider) continue;
        rider.state = "matched";
        rider.matchedGroupId = groupId;
        rider.lastProcessedCycleNumber = cycle.cycleNumber;
        remainingOpenIds.delete(riderId);
      }
    }

    for (const rider of currentOpenRiders) {
      if (rider.state === "matched") continue;
      rider.state = "open";
      rider.matchedGroupId = null;
      rider.color = null;
      rider.dropoffOrder = null;
      rider.lastProcessedCycleNumber = cycle.cycleNumber;
    }

    workingSession.openRiderIds = [...remainingOpenIds].sort((leftId, rightId) => {
      const left = riderById.get(leftId);
      const right = riderById.get(rightId);
      return (left?.arrivalIndex ?? 0) - (right?.arrivalIndex ?? 0);
    });
  }

  const lastCycleAssignment = cycleAssignments.at(-1);
  workingSession.nextCycleNumber = lastCycleAssignment
    ? lastCycleAssignment.cycleNumber + 1
    : workingSession.nextCycleNumber;

  const previewSession = await buildPreviewSession(
    normalizeSimulatorSession(workingSession),
    matcherBaseUrl,
    previewSecret,
    geohashByRef,
  );

  return {
    session: previewSession,
    compatibilityEdges: [...compatibilityEdgeMap.values()].sort(
      (left, right) =>
        left.cycleNumber - right.cycleNumber ||
        left.leftAlias.localeCompare(right.leftAlias) ||
        left.rightAlias.localeCompare(right.rightAlias),
    ),
    cycleAssignments,
  };
}

export async function POST(request: Request) {
  const token = await convexAuthNextjsToken();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const access = await fetchQuery(api.admin.adminAccess, {}, { token });
  if (!access.isAdmin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const validation = validateSimulatorRunRequest(payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const previewSecret = process.env.MATCHER_ADMIN_PREVIEW_SECRET?.trim();
  if (!previewSecret) {
    return NextResponse.json(
      { error: "MATCHER_ADMIN_PREVIEW_SECRET is not configured." },
      { status: 500 },
    );
  }

  try {
    const matcherBaseUrl = getMatcherBaseUrl();
    let executed: SimulationExecutionResult;

    try {
      executed = await executeSimulation(validation.data.session, matcherBaseUrl, previewSecret);
    } catch (error) {
      if (!shouldRefreshMatcherRefs(error)) {
        throw error;
      }
      const refreshedSession = await refreshSessionDestinations(
        validation.data.session,
        matcherBaseUrl,
      );
      executed = await executeSimulation(refreshedSession, matcherBaseUrl, previewSecret);
    }

    const result: SimulatorRunResponse = {
      session: executed.session,
      cycleAssignments: executed.cycleAssignments,
      compatibilityEdges: executed.compatibilityEdges,
      stats: buildSimulatorStats(executed.session, executed.compatibilityEdges),
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not geocode "')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Admin simulation failed. Check matcher connectivity and try again.",
      },
      { status: 502 },
    );
  }
}
