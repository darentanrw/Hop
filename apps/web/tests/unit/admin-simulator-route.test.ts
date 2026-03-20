import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: vi.fn(),
}));

import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { POST } from "../../app/api/admin/simulator/route";

const mockToken = vi.mocked(convexAuthNextjsToken);
const mockFetchQuery = vi.mocked(fetchQuery);
const mockFetch = vi.fn();

function isoOffset(offsetHours: number) {
  return new Date(Date.now() + offsetHours * 3_600_000).toISOString();
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
        body: JSON.stringify({ riders: [] }),
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
        body: JSON.stringify({ riders: [] }),
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
        body: JSON.stringify({ riders: [{ label: "A" }] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns a masked simulation preview for valid admin input", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://matcher.test/matcher/submit-destination") {
        const body = JSON.parse(String(init?.body));
        if (body.address.includes("120123")) {
          return new Response(
            JSON.stringify({
              sealedDestinationRef: "dest_1",
              routeDescriptorRef: "route_1",
            }),
          );
        }

        return new Response(
          JSON.stringify({
            sealedDestinationRef: "dest_2",
            routeDescriptorRef: "route_2",
          }),
        );
      }

      if (url === "http://matcher.test/matcher/compatibility") {
        return new Response(
          JSON.stringify({
            edges: [
              {
                leftRef: "route_1",
                rightRef: "route_2",
                score: 0.88,
                routeOverlap: 0.9,
                destinationProximity: 0.86,
                detourMinutes: 4.2,
                spreadDistanceKm: 0.8,
              },
            ],
            geohashByRef: {
              route_1: "w21z73",
              route_2: "w21z73",
            },
          }),
        );
      }

      if (url === "http://matcher.test/matcher/admin/preview") {
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/json",
          "x-hop-admin-preview-secret": "preview-secret",
        });

        return new Response(
          JSON.stringify({
            riders: [
              {
                riderId: "sim_rider_1",
                routeDescriptorRef: "route_1",
                sealedDestinationRef: "dest_1",
                alias: "Rider 1",
                maskedLocationLabel: "Postal sector 12",
                coordinate: { lat: 1.3151, lng: 103.7649 },
              },
              {
                riderId: "sim_rider_2",
                routeDescriptorRef: "route_2",
                sealedDestinationRef: "dest_2",
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
                legs: [
                  {
                    fromLabel: "NUS Utown",
                    toLabel: "Rider 1",
                    from: { lat: 1.3049, lng: 103.7734 },
                    to: { lat: 1.3151, lng: 103.7649 },
                    polyline: [
                      [1.3049, 103.7734],
                      [1.3151, 103.7649],
                    ],
                    distanceMeters: 8000,
                    timeSeconds: 720,
                  },
                  {
                    fromLabel: "Rider 1",
                    toLabel: "Rider 2",
                    from: { lat: 1.3151, lng: 103.7649 },
                    to: { lat: 1.3155, lng: 103.7655 },
                    polyline: [
                      [1.3151, 103.7649],
                      [1.3155, 103.7655],
                    ],
                    distanceMeters: 300,
                    timeSeconds: 60,
                  },
                ],
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
          riders: [
            {
              label: "Alice",
              address: "Blk 123 Clementi Ave 3, Singapore 120123",
              windowStart: isoOffset(6),
              windowEnd: isoOffset(8),
              selfDeclaredGender: "prefer_not_to_say",
              sameGenderOnly: false,
            },
            {
              label: "Bob",
              address: "Blk 456 Clementi Ave 4, Singapore 120124",
              windowStart: isoOffset(6.25),
              windowEnd: isoOffset(8.25),
              selfDeclaredGender: "prefer_not_to_say",
              sameGenderOnly: false,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      riders: Array<{ alias: string; maskedLocationLabel: string; color: string | null }>;
      groups: Array<{ color: string; name: string }>;
      stats: { matchedRiders: number; groupsFormed: number };
    };

    expect(payload.stats).toMatchObject({
      matchedRiders: 2,
      groupsFormed: 1,
    });
    expect(payload.groups[0].color).toMatch(/^#/);
    expect(payload.groups[0].name.length).toBeGreaterThan(0);
    expect(payload.riders.map((rider) => rider.alias)).toEqual(["Rider 1", "Rider 2"]);
    expect(payload.riders.every((rider) => rider.maskedLocationLabel === "Postal sector 12")).toBe(
      true,
    );
    expect(JSON.stringify(payload)).not.toContain("Clementi Ave");
  });

  test("returns rider-scoped guidance when one rider cannot be geocoded", async () => {
    mockToken.mockResolvedValueOnce("token");
    mockFetchQuery.mockResolvedValueOnce({
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@u.nus.edu",
    });

    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Could not geocode the address. Please check the address and try again.",
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sealedDestinationRef: "dest_ok",
            routeDescriptorRef: "route_ok",
          }),
          { status: 200 },
        ),
      );

    const response = await POST(
      new Request("http://localhost/api/admin/simulator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          riders: [
            {
              label: "First rider",
              address: "bad address",
              windowStart: isoOffset(6),
              windowEnd: isoOffset(8),
              selfDeclaredGender: "prefer_not_to_say",
              sameGenderOnly: false,
            },
            {
              label: "Second rider",
              address: "123 Clementi Ave 3 Singapore 120123",
              windowStart: isoOffset(6.25),
              windowEnd: isoOffset(8.25),
              selfDeclaredGender: "prefer_not_to_say",
              sameGenderOnly: false,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        'Could not geocode "First rider". Try a more specific Singapore landmark or add a postal code.',
    });
  });
});
