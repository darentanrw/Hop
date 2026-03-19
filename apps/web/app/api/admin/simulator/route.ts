import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import type {
  CompatibilityEdge,
  MatcherSimulatorPreviewResponse,
  MatchingCandidate,
  SimulatorCompatibilityEdge,
  SimulatorResponse,
} from "@hop/shared";
import { formGroups, pairKey, sortOpaqueDestinationEntries } from "@hop/shared";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import {
  buildSimulatorAlias,
  buildSimulatorStats,
  validateSimulatorRequest,
} from "../../../../lib/admin-simulator";
import { getGroupTheme } from "../../../../lib/group-lifecycle";

type DestinationSubmission = {
  sealedDestinationRef: string;
  routeDescriptorRef: string;
};

type CompatibilityResponse = {
  edges: CompatibilityEdge[];
  geohashByRef: Record<string, string>;
};

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
  const validation = validateSimulatorRequest(payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const matcherBaseUrl = process.env.MATCHER_BASE_URL ?? "http://localhost:4001";
  const previewSecret = process.env.MATCHER_ADMIN_PREVIEW_SECRET?.trim();
  if (!previewSecret) {
    return NextResponse.json(
      { error: "MATCHER_ADMIN_PREVIEW_SECRET is not configured." },
      { status: 500 },
    );
  }

  try {
    const SUBMIT_CONCURRENCY = 4;
    const riderDrafts: Array<
      DestinationSubmission & {
        riderId: string;
        alias: string;
        input: (typeof validation.data.riders)[number];
      }
    > = [];

    for (let i = 0; i < validation.data.riders.length; i += SUBMIT_CONCURRENCY) {
      const batch = validation.data.riders.slice(i, i + SUBMIT_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (rider, batchIndex) => {
          const index = i + batchIndex;
          let submission: DestinationSubmission;
          try {
            submission = await postMatcherJson<DestinationSubmission>(
              `${matcherBaseUrl}/matcher/submit-destination`,
              { address: rider.address },
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Matcher destination submission failed.";
            if (
              message === "Could not geocode the address. Please check the address and try again."
            ) {
              throw new Error(
                `Could not geocode "${rider.label}". Try a more specific Singapore landmark or add a postal code.`,
              );
            }
            throw error;
          }

          return {
            riderId: `sim_rider_${index + 1}`,
            alias: buildSimulatorAlias(index),
            input: rider,
            ...submission,
          };
        }),
      );
      riderDrafts.push(...results);
    }

    const compatibility = await postMatcherJson<CompatibilityResponse>(
      `${matcherBaseUrl}/matcher/compatibility`,
      {
        routeDescriptorRefs: riderDrafts.map((rider) => rider.routeDescriptorRef),
      },
    );

    const candidates: MatchingCandidate[] = riderDrafts.map((rider) => ({
      availabilityId: rider.riderId,
      userId: rider.riderId,
      windowStart: rider.input.windowStart,
      windowEnd: rider.input.windowEnd,
      selfDeclaredGender: rider.input.selfDeclaredGender,
      sameGenderOnly: rider.input.sameGenderOnly,
      routeDescriptorRef: rider.routeDescriptorRef,
      sealedDestinationRef: rider.sealedDestinationRef,
      displayName: rider.alias,
    }));

    const geohashByRef = new Map(Object.entries(compatibility.geohashByRef));
    const selectedGroups = formGroups(candidates, compatibility.edges, geohashByRef);
    const riderById = new Map(riderDrafts.map((rider) => [rider.riderId, rider]));
    const usedThemeIndices = new Set<number>();
    const groupMetadata = selectedGroups.map((group, index) => {
      const groupId = `sim_group_${index + 1}`;
      const theme = getGroupTheme(
        group.members.map((member) => member.userId).join(":"),
        usedThemeIndices,
      );
      const orderedMembers = sortOpaqueDestinationEntries(
        group.members.map((member) => {
          const draft = riderById.get(member.userId);
          if (!draft) {
            throw new Error(`Missing rider draft for ${member.userId}.`);
          }
          return {
            riderId: draft.riderId,
            alias: draft.alias,
            routeDescriptorRef: draft.routeDescriptorRef,
            sealedDestinationRef: draft.sealedDestinationRef,
            stableId: draft.riderId,
          };
        }),
      );

      return {
        groupId,
        name: theme.name,
        color: theme.color,
        averageScore: group.averageScore,
        minimumScore: group.minimumScore,
        maxDetourMinutes: group.maxDetourMinutes,
        orderedMembers: orderedMembers.map(({ stableId: _stableId, ...member }) => member),
      };
    });

    const preview = await postMatcherJson<MatcherSimulatorPreviewResponse>(
      `${matcherBaseUrl}/matcher/admin/preview`,
      {
        riders: riderDrafts.map((rider) => ({
          riderId: rider.riderId,
          routeDescriptorRef: rider.routeDescriptorRef,
          sealedDestinationRef: rider.sealedDestinationRef,
          alias: rider.alias,
        })),
        groups: groupMetadata.map((group) => ({
          groupId: group.groupId,
          members: group.orderedMembers,
        })),
      },
      {
        "x-hop-admin-preview-secret": previewSecret,
      },
    );

    const previewRiderById = new Map(preview.riders.map((rider) => [rider.riderId, rider]));
    const previewGroupById = new Map(preview.groups.map((group) => [group.groupId, group]));
    const groupMembership = new Map<
      string,
      { groupId: string; color: string; dropoffOrder: number }
    >();

    for (const group of groupMetadata) {
      group.orderedMembers.forEach((member, index) => {
        groupMembership.set(member.riderId, {
          groupId: group.groupId,
          color: group.color,
          dropoffOrder: index + 1,
        });
      });
    }

    const riders = riderDrafts.map((rider) => {
      const previewRider = previewRiderById.get(rider.riderId);
      if (!previewRider) {
        throw new Error(`Missing rider preview for ${rider.riderId}.`);
      }
      const membership = groupMembership.get(rider.riderId);

      return {
        riderId: rider.riderId,
        alias: rider.alias,
        maskedLocationLabel: previewRider.maskedLocationLabel,
        coordinate: previewRider.coordinate,
        routeDescriptorRef: rider.routeDescriptorRef,
        sealedDestinationRef: rider.sealedDestinationRef,
        clusterKey: compatibility.geohashByRef[rider.routeDescriptorRef] ?? null,
        groupId: membership?.groupId ?? null,
        color: membership?.color ?? null,
        dropoffOrder: membership?.dropoffOrder ?? null,
      };
    });

    const ridersById = new Map(riders.map((rider) => [rider.riderId, rider]));
    const groups = groupMetadata.map((group) => {
      const previewGroup = previewGroupById.get(group.groupId);
      if (!previewGroup) {
        throw new Error(`Missing group preview for ${group.groupId}.`);
      }

      return {
        groupId: group.groupId,
        name: group.name,
        color: group.color,
        members: group.orderedMembers.map((member) => {
          const rider = ridersById.get(member.riderId);
          if (!rider) {
            throw new Error(`Missing rider result for ${member.riderId}.`);
          }
          return rider;
        }),
        averageScore: group.averageScore,
        minimumScore: group.minimumScore,
        maxDetourMinutes: group.maxDetourMinutes,
        totalDistanceMeters: previewGroup.totalDistanceMeters,
        totalTimeSeconds: previewGroup.totalTimeSeconds,
        legs: previewGroup.legs,
      };
    });

    const routeToRider = new Map(riderDrafts.map((rider) => [rider.routeDescriptorRef, rider]));
    const compatibilityEdges: SimulatorCompatibilityEdge[] = compatibility.edges.map((edge) => {
      const left = routeToRider.get(edge.leftRef);
      const right = routeToRider.get(edge.rightRef);
      if (!left || !right) {
        throw new Error(`Missing rider metadata for edge ${pairKey(edge.leftRef, edge.rightRef)}.`);
      }
      return {
        ...edge,
        leftRiderId: left.riderId,
        rightRiderId: right.riderId,
        leftAlias: left.alias,
        rightAlias: right.alias,
      };
    });

    const result: SimulatorResponse = {
      riders,
      groups,
      unmatchedRiderIds: riders
        .filter((rider) => rider.groupId === null)
        .map((rider) => rider.riderId),
      compatibilityEdges,
      stats: buildSimulatorStats(riders, groups, compatibilityEdges),
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Could not geocode "')) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 },
      );
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
