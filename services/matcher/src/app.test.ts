import crypto from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { MatcherSimulatorPreviewResponse } from "@hop/shared";
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
import { clearMatcherStore } from "./core";
import { type LogEntry, createLogger } from "./logger";
import { geocodeAddress, getDrivingRoute } from "./onemap";

const mockGeocode = vi.mocked(geocodeAddress);
const mockRoute = vi.mocked(getDrivingRoute);
const originalFetch = globalThis.fetch;

type DestinationSubmission = {
  sealedDestinationRef: string;
  routeDescriptorRef: string;
};

class MockSocket extends Duplex {
  remoteAddress = "127.0.0.1";

  override _read() {}

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    callback();
  }

  override setTimeout() {
    return this;
  }

  override setNoDelay() {
    return this;
  }

  override setKeepAlive() {
    return this;
  }
}

function generatePublicKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return publicKey.toString("base64");
}

async function sendAppRequest(
  app: ReturnType<typeof createMatcherApp>["app"],
  path: string,
  init: RequestInit = {},
) {
  const socket = new MockSocket();
  const request = new IncomingMessage(socket);
  request.method = init.method ?? "GET";
  request.url = path;
  request.httpVersion = "1.1";
  request.httpVersionMajor = 1;
  request.httpVersionMinor = 1;

  const headers = new Headers(init.headers ?? {});
  const bodyText =
    typeof init.body === "string" ? init.body : init.body == null ? null : String(init.body);

  if (bodyText != null && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(bodyText)));
  }

  request.headers = Object.fromEntries(headers.entries());

  const response = new ServerResponse(request);
  const bodyChunks: Buffer[] = [];

  response.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
    if (chunk != null) {
      bodyChunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : undefined),
      );
    }

    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }

    return true;
  }) as typeof response.write;

  response.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
    if (chunk != null) {
      bodyChunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : undefined),
      );
    }

    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }

    response.finished = true;
    response.emit("finish");
    return response;
  }) as typeof response.end;

  await new Promise<void>((resolve, reject) => {
    response.once("finish", () => resolve());
    app.handle(request, response, (error: unknown) => {
      if (error) {
        reject(error);
      }
    });
    if (bodyText != null) {
      request.push(bodyText);
    }
    request.push(null);
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.getHeaders())) {
    responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  return new Response(Buffer.concat(bodyChunks), {
    status: response.statusCode,
    headers: responseHeaders,
  });
}

function createTestClient(logEntries: LogEntry[]) {
  const logger = createLogger({
    level: "debug",
    sink: (entry) => {
      logEntries.push(entry);
    },
  });
  const { app } = createMatcherApp({ logger });

  return {
    request: (path: string, init?: RequestInit) => sendAppRequest(app, path, init),
  };
}

describe("matcher app logging", () => {
  beforeEach(() => {
    mockGeocode.mockReset();
    mockRoute.mockReset();
    clearMatcherStore();
    vi.stubEnv("MATCHER_ADMIN_PREVIEW_SECRET", "test-preview-secret");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  test("logs submit-destination lifecycle without leaking the plaintext address", async () => {
    const logEntries: LogEntry[] = [];
    const { request } = createTestClient(logEntries);
    const address = "123 Clementi Ave 3 Singapore 120123";
    mockGeocode.mockResolvedValueOnce({
      lat: 1.3151,
      lng: 103.7649,
      postalCode: "120123",
      buildingName: "BLK 123",
    });

    const response = await request("/matcher/submit-destination", {
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
    const { request } = createTestClient(logEntries);

    const response = await request("/matcher/submit-destination", {
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
    const { request } = createTestClient(logEntries);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.onemap.gov.sg/api/common/elastic/search")) {
        return new Response(null, { status: 503 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const response = await request("/matcher/search?q=clementi");

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

  test("filters out search suggestions without valid postal codes", async () => {
    const logEntries: LogEntry[] = [];
    const { request } = createTestClient(logEntries);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://www.onemap.gov.sg/api/common/elastic/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                SEARCHVAL: "KENT RIDGE MRT STATION EXIT A",
                LATITUDE: "1.29431784777384",
                LONGITUDE: "103.784465461468",
                POSTAL: "NIL",
                BUILDING: "KENT RIDGE MRT STATION EXIT A",
                ADDRESS: "KENT RIDGE MRT STATION EXIT A",
              },
              {
                SEARCHVAL: "KENT RIDGE MRT STATION (CC24)",
                LATITUDE: "1.29353349887123",
                LONGITUDE: "103.784572738173",
                POSTAL: "118177",
                BUILDING: "KENT RIDGE MRT STATION (CC24)",
                ADDRESS:
                  "301 SOUTH BUONA VISTA ROAD KENT RIDGE MRT STATION (CC24) SINGAPORE 118177",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const response = await request("/matcher/search?q=kent ridge mrt");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          title: "KENT RIDGE MRT STATION (CC24)",
          address: "301 SOUTH BUONA VISTA ROAD KENT RIDGE MRT STATION (CC24) SINGAPORE 118177",
          postal: "118177",
          lat: "1.29353349887123",
          lng: "103.784572738173",
        },
      ],
    });
  });

  test("logs reveal-envelopes failures with request context", async () => {
    const logEntries: LogEntry[] = [];
    const { request } = createTestClient(logEntries);
    mockGeocode.mockResolvedValueOnce({
      lat: 1.3155,
      lng: 103.7655,
      postalCode: "120124",
      buildingName: "BLK 456",
    });

    const submissionResponse = await request("/matcher/submit-destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "456 Clementi Ave 4 Singapore 120124" }),
    });
    const submission = (await submissionResponse.json()) as { sealedDestinationRef: string };

    const response = await request("/matcher/reveal-envelopes", {
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
    const { request } = createTestClient(logEntries);

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

    const leftSubmission = await request("/matcher/submit-destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Clementi Ave 3 Singapore 120123" }),
    });
    const rightSubmission = await request("/matcher/submit-destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "456 Clementi Ave 4 Singapore 120124" }),
    });

    const left = (await leftSubmission.json()) as { routeDescriptorRef: string };
    const right = (await rightSubmission.json()) as { routeDescriptorRef: string };

    mockRoute
      .mockResolvedValueOnce({ distanceMeters: 8000, timeSeconds: 720, polyline: [] })
      .mockResolvedValueOnce({ distanceMeters: 8200, timeSeconds: 740, polyline: [] })
      .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 60, polyline: [] })
      .mockResolvedValueOnce({ distanceMeters: 300, timeSeconds: 65, polyline: [] });

    const response = await request("/matcher/compatibility", {
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

  test("admin preview requires the shared secret and returns masked route previews", async () => {
    const logEntries: LogEntry[] = [];
    const { request } = createTestClient(logEntries);

    mockGeocode.mockResolvedValueOnce({
      lat: 1.3151,
      lng: 103.7649,
      postalCode: "120123",
      buildingName: "BLK 123",
    });

    const submissionResponse = await request("/matcher/submit-destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Clementi Ave 3 Singapore 120123" }),
    });
    const submission = (await submissionResponse.json()) as DestinationSubmission;

    const forbidden = await request("/matcher/admin/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ riders: [], groups: [] }),
    });
    expect(forbidden.status).toBe(403);

    mockRoute.mockResolvedValueOnce({
      distanceMeters: 8000,
      timeSeconds: 720,
      polyline: [
        [1.3049, 103.7734],
        [1.3151, 103.7649],
      ],
    });

    const response = await request("/matcher/admin/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hop-admin-preview-secret": "test-preview-secret",
      },
      body: JSON.stringify({
        riders: [
          {
            riderId: "sim_rider_1",
            routeDescriptorRef: submission.routeDescriptorRef,
            sealedDestinationRef: submission.sealedDestinationRef,
            alias: "Rider 1",
          },
        ],
        groups: [
          {
            groupId: "sim_group_1",
            members: [
              {
                riderId: "sim_rider_1",
                routeDescriptorRef: submission.routeDescriptorRef,
                sealedDestinationRef: submission.sealedDestinationRef,
                alias: "Rider 1",
              },
            ],
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const preview = (await response.json()) as MatcherSimulatorPreviewResponse;
    expect(preview.riders[0].maskedLocationLabel).toBe("Postal sector 12");
    expect(JSON.stringify(preview)).not.toContain("Clementi Ave");
    expect(preview.groups[0].legs[0].polyline).toEqual([
      [1.3049, 103.7734],
      [1.3151, 103.7649],
    ]);
    expect(
      logEntries.find((entry) => entry.event === "matcher.admin_preview_generated"),
    ).toMatchObject({
      riderCount: 1,
      groupCount: 1,
    });
  });
});
