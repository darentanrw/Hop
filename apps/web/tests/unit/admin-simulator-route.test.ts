import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import type { SimulatorRunResponse } from "@hop/shared";
import { fetchQuery } from "convex/nextjs";
import { POST } from "../../app/api/admin/simulator/route";

const mockToken = vi.mocked(convexAuthNextjsToken);
const mockFetchQuery = vi.mocked(fetchQuery);
const mockFetch = vi.fn();

function isoOffset(offsetHours: number) {
  return new Date(Date.now() + offsetHours * 3_600_000).toISOString();
}

function buildRider(args: {
  id: string;
  label: string;
  arrivalIndex: number;
  address?: string;
  routeDescriptorRef: string;
  sealedDestinationRef: string;
  state: "new" | "open" | "matched";
  matchedGroupId?: string | null;
  lastProcessedCycleNumber?: number | null;
}) {
  return {
    id: args.id,
    label: args.label,
    arrivalIndex: args.arrivalIndex,
    address: args.address ?? `${args.label} address`,
    verifiedTitle: args.label,
    postal: "120000",
    windowStart: isoOffset(6),
    windowEnd: isoOffset(8),
    selfDeclaredGender: "prefer_not_to_say" as const,
    sameGenderOnly: false,
    sealedDestinationRef: args.sealedDestinationRef,
    routeDescriptorRef: args.routeDescriptorRef,
    state: args.state,
    lastProcessedCycleNumber: args.lastProcessedCycleNumber ?? null,
    matchedGroupId: args.matchedGroupId ?? null,
    maskedLocationLabel: null,
    coordinate: null,
    clusterKey: null,
    color: args.matchedGroupId ? "#3b82f6" : null,
    dropoffOrder: null,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("MATCHER_BASE_URL", "http://matcher.test");
  vi.stubEnv("MATCHER_ADMIN_PREVIEW_SECRET", "preview-secret");
  mockToken.mockReset();
  mockFetchQuery.mockReset();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin simulator route", () => {
  test("rejects unauthenticated requests", async () => {
    mockToken.mockResolvedValueOnce("");

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: { riders: [] } }),
      }),
    );

    expect(response.status).toBe(401);
  });

  test("rejects non-admin requests", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: false,
      email: "user@u.nus.edu",
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: { riders: [] } }),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("rejects invalid payloads before calling the matcher", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: { riders: [{ label: "A" }] } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("preserves an existing group and lets a later rider join it", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://matcher.test/matcher/compatibility") {
        return new Response(
          JSON.stringify({
            edges: [
              {
                leftRef: "route_a",
                rightRef: "route_b",
                score: 0.81,
                routeOverlap: 0.8,
                destinationProximity: 0.79,
                detourMinutes: 4.1,
                spreadDistanceKm: 1.2,
              },
              {
                leftRef: "route_a",
                rightRef: "route_c",
                score: 0.92,
                routeOverlap: 0.9,
                destinationProximity: 0.91,
                detourMinutes: 3.2,
                spreadDistanceKm: 0.6,
              },
              {
                leftRef: "route_b",
                rightRef: "route_c",
                score: 0.9,
                routeOverlap: 0.88,
                destinationProximity: 0.87,
                detourMinutes: 3.8,
                spreadDistanceKm: 0.8,
              },
            ],
            geohashByRef: {
              route_a: "w21z73",
              route_b: "w21z73",
              route_c: "w21z73",
            },
          }),
        );
      }

      if (url === "http://matcher.test/matcher/admin/preview") {
        const body = JSON.parse(String(init?.body));
        expect(body.groups[0]?.members).toHaveLength(3);

        return new Response(
          JSON.stringify({
            riders: [
              {
                riderId: "rider_a",
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                alias: "Rider 1",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3151, lng: 103.7649 },
              },
              {
                riderId: "rider_b",
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                alias: "Rider 2",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3155, lng: 103.7655 },
              },
              {
                riderId: "rider_c",
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                alias: "Rider 3",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3161, lng: 103.7661 },
              },
            ],
            groups: [
              {
                groupId: "sim_group_1",
                totalDistanceMeters: 8600,
                totalTimeSeconds: 820,
                legs: [],
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected fetch to ${url}`);
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: {
            sessionSeed: 7,
            nextArrivalIndex: 3,
            nextCycleNumber: 2,
            riders: [
              buildRider({
                id: "rider_a",
                label: "Rider 1",
                arrivalIndex: 0,
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 1,
              }),
              buildRider({
                id: "rider_b",
                label: "Rider 2",
                arrivalIndex: 1,
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 1,
              }),
              buildRider({
                id: "rider_c",
                label: "Rider 3",
                arrivalIndex: 2,
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                state: "new",
              }),
            ],
            groups: [
              {
                groupId: "sim_group_1",
                memberRiderIds: ["rider_a", "rider_b"],
                name: "Sky Loop",
                color: "#3b82f6",
                averageScore: 0.81,
                minimumScore: 0.81,
                maxDetourMinutes: 4.1,
                totalDistanceMeters: 8300,
                totalTimeSeconds: 780,
                legs: [],
              },
            ],
            openRiderIds: [],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SimulatorRunResponse;

    expect(payload.cycleAssignments).toEqual([{ cycleNumber: 2, riderIds: ["rider_c"] }]);
    expect(payload.session.groups).toHaveLength(1);
    expect(payload.session.groups[0]?.memberRiderIds).toContain("rider_c");
    expect(payload.session.openRiderIds).toEqual([]);
    expect(payload.session.riders.find((rider) => rider.id === "rider_c")).toMatchObject({
      state: "matched",
      matchedGroupId: "sim_group_1",
      lastProcessedCycleNumber: 2,
    });
    expect(payload.session.nextCycleNumber).toBe(3);
  });

  test("keeps unmatched riders open across later runs", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "http://matcher.test/matcher/compatibility") {
        return new Response(
          JSON.stringify({
            edges: [],
            geohashByRef: {
              route_a: "w21z73",
              route_b: "w21z73",
              route_c: "w21z80",
            },
          }),
        );
      }

      if (url === "http://matcher.test/matcher/admin/preview") {
        return new Response(
          JSON.stringify({
            riders: [
              {
                riderId: "rider_a",
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                alias: "Rider 1",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3151, lng: 103.7649 },
              },
              {
                riderId: "rider_b",
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                alias: "Rider 2",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3155, lng: 103.7655 },
              },
              {
                riderId: "rider_c",
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                alias: "Rider 3",
                maskedLocationLabel: "Postal sector 18",
                coordinate: { lat: 1.3521, lng: 103.9498 },
              },
            ],
            groups: [
              {
                groupId: "sim_group_1",
                totalDistanceMeters: 8300,
                totalTimeSeconds: 780,
                legs: [],
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected fetch to ${url}`);
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: {
            sessionSeed: 11,
            nextArrivalIndex: 3,
            nextCycleNumber: 5,
            riders: [
              buildRider({
                id: "rider_a",
                label: "Rider 1",
                arrivalIndex: 0,
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 4,
              }),
              buildRider({
                id: "rider_b",
                label: "Rider 2",
                arrivalIndex: 1,
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 4,
              }),
              buildRider({
                id: "rider_c",
                label: "Rider 3",
                arrivalIndex: 2,
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                state: "open",
                lastProcessedCycleNumber: 4,
              }),
            ],
            groups: [
              {
                groupId: "sim_group_1",
                memberRiderIds: ["rider_a", "rider_b"],
                name: "Sky Loop",
                color: "#3b82f6",
                averageScore: 0.81,
                minimumScore: 0.81,
                maxDetourMinutes: 4.1,
                totalDistanceMeters: 8300,
                totalTimeSeconds: 780,
                legs: [],
              },
            ],
            openRiderIds: ["rider_c"],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SimulatorRunResponse;

    expect(payload.cycleAssignments).toEqual([{ cycleNumber: 5, riderIds: [] }]);
    expect(payload.session.openRiderIds).toEqual(["rider_c"]);
    expect(payload.session.riders.find((rider) => rider.id === "rider_c")).toMatchObject({
      state: "open",
      matchedGroupId: null,
      lastProcessedCycleNumber: 5,
    });
    expect(payload.session.nextCycleNumber).toBe(6);
  });

  test("does not late-join a fourth rider into an existing three-rider group", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://matcher.test/matcher/compatibility") {
        return new Response(
          JSON.stringify({
            edges: [
              {
                leftRef: "route_a",
                rightRef: "route_b",
                score: 0.9,
                routeOverlap: 0.89,
                destinationProximity: 0.88,
                detourMinutes: 3.6,
                spreadDistanceKm: 0.7,
              },
              {
                leftRef: "route_a",
                rightRef: "route_c",
                score: 0.9,
                routeOverlap: 0.89,
                destinationProximity: 0.88,
                detourMinutes: 3.4,
                spreadDistanceKm: 0.7,
              },
              {
                leftRef: "route_b",
                rightRef: "route_c",
                score: 0.9,
                routeOverlap: 0.89,
                destinationProximity: 0.88,
                detourMinutes: 3.8,
                spreadDistanceKm: 0.8,
              },
              {
                leftRef: "route_a",
                rightRef: "route_d",
                score: 0.91,
                routeOverlap: 0.9,
                destinationProximity: 0.89,
                detourMinutes: 3.2,
                spreadDistanceKm: 0.6,
              },
              {
                leftRef: "route_b",
                rightRef: "route_d",
                score: 0.91,
                routeOverlap: 0.9,
                destinationProximity: 0.89,
                detourMinutes: 3.2,
                spreadDistanceKm: 0.6,
              },
              {
                leftRef: "route_c",
                rightRef: "route_d",
                score: 0.91,
                routeOverlap: 0.9,
                destinationProximity: 0.89,
                detourMinutes: 3.2,
                spreadDistanceKm: 0.6,
              },
            ],
            geohashByRef: {
              route_a: "w21z73",
              route_b: "w21z73",
              route_c: "w21z74",
              route_d: "w21z74",
            },
          }),
        );
      }

      if (url === "http://matcher.test/matcher/admin/preview") {
        const body = JSON.parse(String(init?.body));
        expect(body.groups[0]?.members).toHaveLength(3);

        return new Response(
          JSON.stringify({
            riders: [
              {
                riderId: "rider_a",
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                alias: "Rider 1",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3151, lng: 103.7649 },
              },
              {
                riderId: "rider_b",
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                alias: "Rider 2",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3155, lng: 103.7655 },
              },
              {
                riderId: "rider_c",
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                alias: "Rider 3",
                maskedLocationLabel: "Postal sector 13",
                coordinate: { lat: 1.3161, lng: 103.7661 },
              },
              {
                riderId: "rider_d",
                routeDescriptorRef: "route_d",
                sealedDestinationRef: "dest_d",
                alias: "Rider 4",
                maskedLocationLabel: "Postal sector 13",
                coordinate: { lat: 1.3164, lng: 103.7666 },
              },
            ],
            groups: [
              {
                groupId: "sim_group_1",
                totalDistanceMeters: 8600,
                totalTimeSeconds: 820,
                legs: [],
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected fetch to ${url}`);
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: {
            sessionSeed: 7,
            nextArrivalIndex: 4,
            nextCycleNumber: 3,
            riders: [
              buildRider({
                id: "rider_a",
                label: "Rider 1",
                arrivalIndex: 0,
                routeDescriptorRef: "route_a",
                sealedDestinationRef: "dest_a",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 2,
              }),
              buildRider({
                id: "rider_b",
                label: "Rider 2",
                arrivalIndex: 1,
                routeDescriptorRef: "route_b",
                sealedDestinationRef: "dest_b",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 2,
              }),
              buildRider({
                id: "rider_c",
                label: "Rider 3",
                arrivalIndex: 2,
                routeDescriptorRef: "route_c",
                sealedDestinationRef: "dest_c",
                state: "matched",
                matchedGroupId: "sim_group_1",
                lastProcessedCycleNumber: 2,
              }),
              buildRider({
                id: "rider_d",
                label: "Rider 4",
                arrivalIndex: 3,
                routeDescriptorRef: "route_d",
                sealedDestinationRef: "dest_d",
                state: "new",
              }),
            ],
            groups: [
              {
                groupId: "sim_group_1",
                memberRiderIds: ["rider_a", "rider_b", "rider_c"],
                name: "Sky Loop",
                color: "#3b82f6",
                averageScore: 0.9,
                minimumScore: 0.9,
                maxDetourMinutes: 3.8,
                totalDistanceMeters: 8600,
                totalTimeSeconds: 820,
                legs: [],
              },
            ],
            openRiderIds: [],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SimulatorRunResponse;

    expect(payload.session.groups).toHaveLength(1);
    expect(payload.session.groups[0]?.memberRiderIds).toEqual(["rider_a", "rider_b", "rider_c"]);
    expect(payload.session.openRiderIds).toEqual(["rider_d"]);
    expect(payload.session.riders.find((rider) => rider.id === "rider_d")).toMatchObject({
      state: "open",
      matchedGroupId: null,
      lastProcessedCycleNumber: 3,
    });
  });

  test("refreshes matcher refs when backend memory is lost", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "http://matcher.test/matcher/compatibility") {
        const body = JSON.parse(String(init?.body));
        if (body.routeDescriptorRefs.includes("route_old_a")) {
          return new Response(
            JSON.stringify({
              error: "Missing matcher route descriptor: route_old_a.",
            }),
            { status: 500 },
          );
        }

        return new Response(
          JSON.stringify({
            edges: [
              {
                leftRef: "route_new_a",
                rightRef: "route_new_b",
                score: 0.88,
                routeOverlap: 0.86,
                destinationProximity: 0.84,
                detourMinutes: 4.2,
                spreadDistanceKm: 0.7,
              },
            ],
            geohashByRef: {
              route_new_a: "w21z73",
              route_new_b: "w21z73",
            },
          }),
        );
      }

      if (url === "http://matcher.test/matcher/submit-destination") {
        const body = JSON.parse(String(init?.body));
        if (body.address.includes("Rider 1")) {
          return new Response(
            JSON.stringify({
              sealedDestinationRef: "dest_new_a",
              routeDescriptorRef: "route_new_a",
            }),
          );
        }

        return new Response(
          JSON.stringify({
            sealedDestinationRef: "dest_new_b",
            routeDescriptorRef: "route_new_b",
          }),
        );
      }

      if (url === "http://matcher.test/matcher/admin/preview") {
        return new Response(
          JSON.stringify({
            riders: [
              {
                riderId: "rider_a",
                routeDescriptorRef: "route_new_a",
                sealedDestinationRef: "dest_new_a",
                alias: "Rider 1",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3151, lng: 103.7649 },
              },
              {
                riderId: "rider_b",
                routeDescriptorRef: "route_new_b",
                sealedDestinationRef: "dest_new_b",
                alias: "Rider 2",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3155, lng: 103.7655 },
              },
            ],
            groups: [
              {
                groupId: "sim_group_1",
                totalDistanceMeters: 8300,
                totalTimeSeconds: 780,
                legs: [],
              },
            ],
          }),
        );
      }

      throw new Error(`Unexpected fetch to ${url}`);
    });

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: {
            sessionSeed: 3,
            nextArrivalIndex: 2,
            nextCycleNumber: 1,
            riders: [
              buildRider({
                id: "rider_a",
                label: "Rider 1",
                arrivalIndex: 0,
                address: "Rider 1 address",
                routeDescriptorRef: "route_old_a",
                sealedDestinationRef: "dest_old_a",
                state: "new",
              }),
              buildRider({
                id: "rider_b",
                label: "Rider 2",
                arrivalIndex: 1,
                address: "Rider 2 address",
                routeDescriptorRef: "route_old_b",
                sealedDestinationRef: "dest_old_b",
                state: "new",
              }),
            ],
            groups: [],
            openRiderIds: [],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SimulatorRunResponse;

    expect(payload.session.riders.map((rider) => rider.routeDescriptorRef)).toEqual([
      "route_new_a",
      "route_new_b",
    ]);
    expect(payload.session.riders.map((rider) => rider.sealedDestinationRef)).toEqual([
      "dest_new_a",
      "dest_new_b",
    ]);
    expect(payload.session.groups).toHaveLength(1);
  });
});
