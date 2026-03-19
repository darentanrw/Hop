import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./onemap", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    geocodeAddress: vi.fn(),
    getDrivingRoute: vi.fn(),
  };
});

import {
  countDistinctLocations,
  revealEnvelopes,
  scoreRouteDescriptors,
  submitDestination,
} from "./core";
import { geocodeAddress, getDrivingRoute } from "./onemap";

const mockGeocode = vi.mocked(geocodeAddress);
const mockRoute = vi.mocked(getDrivingRoute);

function generatePublicKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return publicKey.toString("base64");
}

function mockClementiGeocode() {
  mockGeocode.mockResolvedValueOnce({
    lat: 1.3151,
    lng: 103.7649,
    postalCode: "120123",
    buildingName: "BLK 123",
  });
}

function mockClementi2Geocode() {
  mockGeocode.mockResolvedValueOnce({
    lat: 1.3155,
    lng: 103.7655,
    postalCode: "120124",
    buildingName: "BLK 456",
  });
}

function mockChangiGeocode() {
  mockGeocode.mockResolvedValueOnce({
    lat: 1.3644,
    lng: 103.9915,
    postalCode: "819663",
    buildingName: "CHANGI AIRPORT",
  });
}

function mockNearbyRoutes() {
  mockRoute
    .mockResolvedValueOnce({ distanceMeters: 8000, timeSeconds: 720 }) // NUS → Clementi1
    .mockResolvedValueOnce({ distanceMeters: 8200, timeSeconds: 740 }) // NUS → Clementi2
    .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 60 }) // Clementi1 → Clementi2
    .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 65 }); // Clementi2 → Clementi1
}

beforeEach(() => {
  mockRoute.mockReset();
  mockGeocode.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matcher core", () => {
  test("submitDestination never returns plaintext address", async () => {
    const address = "123 Clementi Ave 3 Singapore 120123";
    mockClementiGeocode();

    const result = await submitDestination(address);

    expect(result.sealedDestinationRef).toMatch(/^dest_/);
    expect(JSON.stringify(result)).not.toContain(address);
  });

  test("submitDestination throws when geocoding fails", async () => {
    mockGeocode.mockResolvedValueOnce(null);
    await expect(submitDestination("nonexistent place")).rejects.toThrow("Could not geocode");
  });

  test("compatibility scoring returns pairwise edges for nearby addresses", async () => {
    mockClementiGeocode();
    const left = await submitDestination("123 Clementi Ave 3 Singapore 120123");
    mockClementi2Geocode();
    const right = await submitDestination("456 Clementi Ave 4 Singapore 120124");

    mockNearbyRoutes();
    const edges = await scoreRouteDescriptors([left.routeDescriptorRef, right.routeDescriptorRef]);

    expect(edges).toHaveLength(1);
    expect(edges[0].score).toBeGreaterThan(0.5);
    expect(edges[0].destinationProximity).toBeGreaterThan(0.8);
    expect(edges[0].spreadDistanceKm).toBeLessThan(2);
  });

  test("far-apart addresses are filtered by geohash", async () => {
    mockClementiGeocode();
    const left = await submitDestination("Clementi");
    mockChangiGeocode();
    const right = await submitDestination("Changi Airport");

    const edges = await scoreRouteDescriptors([left.routeDescriptorRef, right.routeDescriptorRef]);

    expect(edges).toHaveLength(0);
  });

  test("compatibility scoring fails loudly when a route descriptor is missing", async () => {
    mockClementiGeocode();
    const left = await submitDestination("123 Clementi Ave 3 Singapore 120123");

    await expect(scoreRouteDescriptors([left.routeDescriptorRef, "route_missing"])).rejects.toThrow(
      "Missing matcher route descriptor",
    );
  });

  test("compatibility scoring fails loudly when live routing fails", async () => {
    mockClementiGeocode();
    const left = await submitDestination("123 Clementi Ave 3 Singapore 120123");
    mockClementi2Geocode();
    const right = await submitDestination("456 Clementi Ave 4 Singapore 120124");

    mockRoute.mockRejectedValueOnce(new Error("OneMap route API unavailable"));

    await expect(
      scoreRouteDescriptors([left.routeDescriptorRef, right.routeDescriptorRef]),
    ).rejects.toThrow("Could not calculate live route compatibility");
  });

  test("reveal envelopes are created per recipient", async () => {
    mockClementiGeocode();
    const left = await submitDestination("123 Clementi Ave 3 Singapore 120123");
    mockClementi2Geocode();
    const right = await submitDestination("456 Clementi Ave 4 Singapore 120124");

    const envelopes = revealEnvelopes([
      {
        userId: "user_a",
        displayName: "Alice",
        sealedDestinationRef: left.sealedDestinationRef,
        publicKey: generatePublicKey(),
      },
      {
        userId: "user_b",
        displayName: "Bob",
        sealedDestinationRef: right.sealedDestinationRef,
        publicKey: generatePublicKey(),
      },
    ]);

    expect(envelopes).toHaveLength(4);
    expect(envelopes.every((envelope) => envelope.ciphertext.length > 20)).toBe(true);
  });

  test("reveal envelopes fail loudly when a destination record is missing", () => {
    expect(() =>
      revealEnvelopes([
        {
          userId: "user_a",
          displayName: "Alice",
          sealedDestinationRef: "dest_missing",
          publicKey: generatePublicKey(),
        },
      ]),
    ).toThrow("Missing matcher destination record");
  });

  test("countDistinctLocations groups same geohash6 cells", () => {
    expect(
      countDistinctLocations([
        { geohash6: "w21z73" },
        { geohash6: "w21z73" },
        { geohash6: "w21z74" },
      ]),
    ).toBeLessThanOrEqual(3);
  });

  test("countDistinctLocations returns 1 for all same geohash", () => {
    expect(
      countDistinctLocations([
        { geohash6: "w21z73" },
        { geohash6: "w21z73" },
        { geohash6: "w21z73" },
      ]),
    ).toBe(1);
  });
});
