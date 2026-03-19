import crypto from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./onemap", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    geocodeAddress: vi.fn(),
    getDrivingRoute: vi.fn(),
  };
});

import { createMatcherApp } from "./app";
import { type LogEntry, createLogger } from "./logger";
import { geocodeAddress, getDrivingRoute } from "./onemap";

const mockGeocode = vi.mocked(geocodeAddress);
const mockRoute = vi.mocked(getDrivingRoute);
const originalFetch = globalThis.fetch;

function generatePublicKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return publicKey.toString("base64");
}

async function startTestServer(logEntries: LogEntry[]) {
  const logger = createLogger({
    level: "debug",
    sink: (entry) => {
      logEntries.push(entry);
    },
  });
  const { app } = createMatcherApp({ logger });
  const server = app.listen(0);

  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve test server address.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server) {
  server.close();
  await once(server, "close");
}

describe("matcher app logging", () => {
  const servers = new Set<Server>();

  beforeEach(() => {
    mockGeocode.mockReset();
    mockRoute.mockReset();
  });

  afterEach(async () => {
    await Promise.all([...servers].map((server) => stopServer(server)));
    servers.clear();
    globalThis.fetch = originalFetch;
  });

  test("logs submit-destination lifecycle without leaking the plaintext address", async () => {
    const logEntries: LogEntry[] = [];
    const { server, baseUrl } = await startTestServer(logEntries);
    servers.add(server);
    const address = "123 Clementi Ave 3 Singapore 120123";
    mockGeocode.mockResolvedValueOnce({
      lat: 1.3151,
      lng: 103.7649,
      postalCode: "120123",
      buildingName: "BLK 123",
    });

    const response = await fetch(`${baseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-submit-1",
      },
      body: JSON.stringify({ address }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-submit-1");

    const requestReceived = logEntries.find((entry) => entry.event === "request.received");
    const submissionLogged = logEntries.find(
      (entry) => entry.event === "matcher.destination_submitted",
    );
    const requestCompleted = logEntries.find((entry) => entry.event === "request.completed");

    expect(requestReceived).toMatchObject({
      route: "/matcher/submit-destination",
    });
    expect(submissionLogged).toMatchObject({
      requestId: "req-submit-1",
      routeDescriptorRef: expect.stringMatching(/^route_/),
      sealedDestinationRef: expect.stringMatching(/^dest_/),
    });
    expect(requestCompleted).toMatchObject({
      requestId: "req-submit-1",
      statusCode: 200,
    });
    expect(JSON.stringify(logEntries)).not.toContain(address);
  });

  test("logs validation failures for missing addresses", async () => {
    const logEntries: LogEntry[] = [];
    const { server, baseUrl } = await startTestServer(logEntries);
    servers.add(server);

    const response = await fetch(`${baseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "   " }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Address is required." });

    expect(logEntries.find((entry) => entry.event === "request.validation_failed")).toMatchObject({
      level: "warn",
      operation: "matcher.submit-destination",
      error: "Address is required.",
    });
    expect(logEntries.find((entry) => entry.event === "request.completed")).toMatchObject({
      statusCode: 400,
    });
  });

  test("returns a real error when upstream address search fails", async () => {
    const logEntries: LogEntry[] = [];
    const { server, baseUrl } = await startTestServer(logEntries);
    servers.add(server);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.onemap.gov.sg/api/common/elastic/search")) {
        return new Response(null, { status: 503 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const response = await fetch(`${baseUrl}/matcher/search?q=clementi`);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Address search is unavailable right now. Try again.",
    });

    expect(logEntries.find((entry) => entry.event === "matcher.search_failed")).toMatchObject({
      level: "warn",
      queryLength: 8,
      upstreamStatus: 503,
    });
  });

  test("logs reveal-envelopes failures with request context", async () => {
    const logEntries: LogEntry[] = [];
    const { server, baseUrl } = await startTestServer(logEntries);
    servers.add(server);
    mockGeocode.mockResolvedValueOnce({
      lat: 1.3155,
      lng: 103.7655,
      postalCode: "120124",
      buildingName: "BLK 456",
    });

    const submissionResponse = await fetch(`${baseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "456 Clementi Ave 4 Singapore 120124" }),
    });
    const submission = (await submissionResponse.json()) as { sealedDestinationRef: string };

    const response = await fetch(`${baseUrl}/matcher/reveal-envelopes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-reveal-1",
      },
      body: JSON.stringify({
        members: [
          {
            userId: "user_a",
            displayName: "Alice",
            sealedDestinationRef: submission.sealedDestinationRef,
            publicKey: generatePublicKey(),
          },
          {
            userId: "user_b",
            displayName: "Bob",
            sealedDestinationRef: submission.sealedDestinationRef,
            publicKey: "not-a-valid-key",
          },
        ],
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("asymmetric key"),
    });

    expect(
      logEntries.find((entry) => entry.event === "matcher.envelopes_reveal_failed"),
    ).toMatchObject({
      requestId: "req-reveal-1",
      operation: "matcher.reveal-envelopes",
      memberCount: 2,
      error: {
        message: expect.any(String),
        name: expect.any(String),
      },
    });
    expect(
      logEntries.find(
        (entry) => entry.event === "request.completed" && entry.requestId === "req-reveal-1",
      ),
    ).toMatchObject({
      requestId: "req-reveal-1",
      statusCode: 500,
    });
  });

  test("logs compatibility score summaries instead of raw request metadata", async () => {
    const logEntries: LogEntry[] = [];
    const { server, baseUrl } = await startTestServer(logEntries);
    servers.add(server);

    mockGeocode
      .mockResolvedValueOnce({
        lat: 1.3151,
        lng: 103.7649,
        postalCode: "120123",
        buildingName: "BLK 123",
      })
      .mockResolvedValueOnce({
        lat: 1.3155,
        lng: 103.7655,
        postalCode: "120124",
        buildingName: "BLK 456",
      });

    const leftSubmission = await fetch(`${baseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Clementi Ave 3 Singapore 120123" }),
    });
    const rightSubmission = await fetch(`${baseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "456 Clementi Ave 4 Singapore 120124" }),
    });

    const left = (await leftSubmission.json()) as { routeDescriptorRef: string };
    const right = (await rightSubmission.json()) as { routeDescriptorRef: string };

    mockRoute
      .mockResolvedValueOnce({ distanceMeters: 8000, timeSeconds: 720 })
      .mockResolvedValueOnce({ distanceMeters: 8200, timeSeconds: 740 })
      .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 60 })
      .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 65 });

    const response = await fetch(`${baseUrl}/matcher/compatibility`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-compat-1",
      },
      body: JSON.stringify({
        routeDescriptorRefs: [left.routeDescriptorRef, right.routeDescriptorRef],
      }),
    });

    expect(response.status).toBe(200);

    expect(
      logEntries.find((entry) => entry.event === "matcher.compatibility_scored"),
    ).toMatchObject({
      requestId: "req-compat-1",
      operation: "matcher.compatibility",
      routeDescriptorRefCount: 2,
      edgeCount: 1,
      clusterCount: 1,
      averageScore: expect.any(Number),
      minimumScore: expect.any(Number),
      maximumScore: expect.any(Number),
      topMatch: {
        leftRef: left.routeDescriptorRef,
        rightRef: right.routeDescriptorRef,
        score: expect.any(Number),
        detourMinutes: expect.any(Number),
        spreadDistanceKm: expect.any(Number),
      },
    });
  });
});
