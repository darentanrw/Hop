import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearCachedToken,
  clearRouteCaches,
  geocodeAddress,
  getAuthToken,
  getDrivingRoute,
  haversineKm,
} from "./onemap";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  clearCachedToken();
  clearRouteCaches();
  vi.stubEnv("ONEMAP_EMAIL", "test@example.com");
  vi.stubEnv("ONEMAP_PASSWORD", "testpassword");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("OneMap client", () => {
  test("geocodeAddress parses lat/lng from response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        found: 1,
        results: [
          {
            LATITUDE: "1.3521",
            LONGITUDE: "103.8198",
            POSTAL: "120123",
            BUILDING: "BLK 123",
          },
        ],
      }),
    });

    const result = await geocodeAddress("Blk 123 Clementi");
    expect(result).not.toBeNull();
    expect(result?.lat).toBeCloseTo(1.3521, 3);
    expect(result?.lng).toBeCloseTo(103.8198, 3);
    expect(result?.postalCode).toBe("120123");
    expect(result?.buildingName).toBe("BLK 123");
  });

  test("geocodeAddress returns null when no results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ found: 0, results: [] }),
    });

    const result = await geocodeAddress("nonexistent place");
    expect(result).toBeNull();
  });

  test("geocodeAddress retries with cleaned candidates and postal fallback", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ found: 0, results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          found: 1,
          results: [
            {
              LATITUDE: "1.3151",
              LONGITUDE: "103.7649",
              POSTAL: "120123",
              BUILDING: "BLK 123",
            },
          ],
        }),
      });

    const result = await geocodeAddress("Blk 123 Clementi Ave 3, Singapore 120123");
    expect(result).not.toBeNull();
    expect(result?.postalCode).toBe("120123");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("getAuthToken fetches and caches token", async () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "test-token-123",
        expiry_timestamp: futureDate,
      }),
    });

    const token1 = await getAuthToken();
    expect(token1).toBe("test-token-123");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const token2 = await getAuthToken();
    expect(token2).toBe("test-token-123");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("getDrivingRoute returns distance and time", async () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token",
          expiry_timestamp: futureDate,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          route_summary: {
            total_distance: 12500,
            total_time: 900,
          },
          route_geometry: [
            [103.7734, 1.3049],
            [103.8198, 1.3521],
          ],
        }),
      });

    const route = await getDrivingRoute(1.3049, 103.7734, 1.3521, 103.8198);
    expect(route.distanceMeters).toBe(12500);
    expect(route.timeSeconds).toBe(900);
    expect(route.polyline).toEqual([
      [1.3049, 103.7734],
      [1.3521, 103.8198],
    ]);
  });

  test("haversineKm computes distance between two known points", () => {
    const nusLat = 1.3049;
    const nusLng = 103.7734;
    const clementiLat = 1.3151;
    const clementiLng = 103.7649;

    const distance = haversineKm(nusLat, nusLng, clementiLat, clementiLng);
    expect(distance).toBeGreaterThan(0.5);
    expect(distance).toBeLessThan(3);
  });

  test("haversineKm returns 0 for same point", () => {
    expect(haversineKm(1.3, 103.8, 1.3, 103.8)).toBe(0);
  });
});
