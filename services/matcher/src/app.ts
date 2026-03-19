import crypto from "node:crypto";
import type { CompatibilityEdge, MatcherSimulatorPreviewRequest } from "@hop/shared";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  buildSimulatorPreview,
  computeLocationClusters,
  revealEnvelopes,
  scoreRouteDescriptors,
  submitDestination,
} from "./core";
import {
  type MatcherLogger,
  createLogger,
  getRequestLogContext,
  summarizeRequestBody,
} from "./logger";

type CreateMatcherAppOptions = {
  logger?: MatcherLogger;
};

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";

function createRequestId() {
  return crypto.randomUUID();
}

function getDurationMs(startedAt: bigint) {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

function hasValidPreviewSecret(request: Request) {
  const expected = process.env.MATCHER_ADMIN_PREVIEW_SECRET?.trim();
  const provided = request.get("x-hop-admin-preview-secret")?.trim() ?? "";

  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function summarizeCompatibilityScores(edges: CompatibilityEdge[]) {
  if (edges.length === 0) {
    return {
      averageScore: 0,
      minimumScore: 0,
      maximumScore: 0,
      topMatch: null,
    };
  }

  const sortedByScore = [...edges].sort(
    (left, right) => right.score - left.score || left.detourMinutes - right.detourMinutes,
  );
  const totalScore = edges.reduce((sum, edge) => sum + edge.score, 0);

  return {
    averageScore: Number((totalScore / edges.length).toFixed(2)),
    minimumScore: sortedByScore.at(-1)?.score ?? 0,
    maximumScore: sortedByScore[0]?.score ?? 0,
    topMatch: sortedByScore[0]
      ? {
          leftRef: sortedByScore[0].leftRef,
          rightRef: sortedByScore[0].rightRef,
          score: sortedByScore[0].score,
          detourMinutes: sortedByScore[0].detourMinutes,
          spreadDistanceKm: sortedByScore[0].spreadDistanceKm,
        }
      : null,
  };
}

function normalizeRevealErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Reveal failed.";
  }

  const message = error.message.toLowerCase();
  const looksLikeInvalidKey =
    message.includes("asymmetric key") ||
    message.includes("not-a-valid-key") ||
    message.includes("asn1") ||
    message.includes("spki") ||
    message.includes("public key") ||
    message.includes("header too long");

  if (looksLikeInvalidKey) {
    return "Invalid asymmetric key provided.";
  }

  return error.message;
}

function respondWithBadRequest(
  request: Request,
  response: Response,
  logger: MatcherLogger,
  message: string,
  context: Record<string, unknown> = {},
) {
  logger.warn("request.validation_failed", {
    ...getRequestLogContext(request),
    ...context,
    error: message,
  });
  response.status(400).json({ error: message });
}

export function createMatcherApp(options: CreateMatcherAppOptions = {}) {
  const logger = options.logger ?? createLogger();
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());

  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = request.get("x-request-id")?.trim() || createRequestId();
    let finished = false;

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    response.on("finish", () => {
      finished = true;
      logger.debug("request.completed", {
        ...getRequestLogContext(request),
        statusCode: response.statusCode,
        durationMs: getDurationMs(startedAt),
      });
    });

    response.on("close", () => {
      if (finished) return;

      logger.warn("request.aborted", {
        ...getRequestLogContext(request),
        statusCode: response.statusCode,
        durationMs: getDurationMs(startedAt),
      });
    });

    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.use((request, _response, next) => {
    logger.info("request.received", {
      route: request.path,
    });
    next();
  });

  app.get("/health", (request, response) => {
    logger.debug("health.check", {
      ...getRequestLogContext(request),
    });
    response.json({ ok: true });
  });

  app.get("/matcher/search", async (request, response) => {
    const query = String(request.query.q ?? "").trim();

    if (query.length < 2) {
      response.json({ results: [] });
      return;
    }

    try {
      const url = `${ONEMAP_SEARCH_URL}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
      const upstream = await fetch(url);
      if (!upstream.ok) {
        logger.warn("matcher.search_failed", {
          ...getRequestLogContext(request),
          queryLength: query.length,
          upstreamStatus: upstream.status,
        });
        response.status(502).json({ error: "Address search is unavailable right now. Try again." });
        return;
      }

      const data = (await upstream.json()) as {
        results?: Array<{
          SEARCHVAL: string;
          LATITUDE: string;
          LONGITUDE: string;
          POSTAL: string;
          BUILDING: string;
          ADDRESS: string;
        }>;
      };
      const results = (data.results ?? []).slice(0, 8).map((result) => ({
        title: result.BUILDING && result.BUILDING !== "NIL" ? result.BUILDING : result.SEARCHVAL,
        address: result.ADDRESS,
        postal: result.POSTAL,
        lat: result.LATITUDE,
        lng: result.LONGITUDE,
      }));

      logger.info("matcher.search_completed", {
        ...getRequestLogContext(request),
        queryLength: query.length,
        resultCount: results.length,
      });

      response.json({ results });
    } catch (error) {
      logger.error("matcher.search_failed", {
        ...getRequestLogContext(request),
        queryLength: query.length,
        error,
      });
      response.status(502).json({ error: "Address search is unavailable right now. Try again." });
    }
  });

  app.post("/matcher/submit-destination", async (request, response) => {
    const address = typeof request.body?.address === "string" ? request.body.address.trim() : "";

    if (!address) {
      respondWithBadRequest(request, response, logger, "Address is required.");
      return;
    }

    try {
      const submission = await submitDestination(address);

      logger.info("matcher.destination_submitted", {
        ...getRequestLogContext(request),
        sealedDestinationRef: submission.sealedDestinationRef,
        routeDescriptorRef: submission.routeDescriptorRef,
      });

      response.json(submission);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not process destination.";
      respondWithBadRequest(request, response, logger, message);
    }
  });

  app.post("/matcher/compatibility", async (request, response) => {
    const routeDescriptorRefs = Array.isArray(request.body?.routeDescriptorRefs)
      ? request.body.routeDescriptorRefs.map(String)
      : [];

    try {
      const edges = await scoreRouteDescriptors(routeDescriptorRefs);
      const geohashByRef = computeLocationClusters(routeDescriptorRefs);
      const scoreSummary = summarizeCompatibilityScores(edges);

      logger.info("matcher.compatibility_scored", {
        ...getRequestLogContext(request),
        routeDescriptorRefCount: routeDescriptorRefs.length,
        edgeCount: edges.length,
        clusterCount: new Set(Object.values(geohashByRef)).size,
        ...scoreSummary,
      });

      response.json({ edges, geohashByRef });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compatibility scoring failed.";
      logger.error("matcher.compatibility_failed", {
        ...getRequestLogContext(request),
        routeDescriptorRefCount: routeDescriptorRefs.length,
        error,
      });
      response.status(500).json({ error: message });
    }
  });

  app.post("/matcher/reveal-envelopes", (request, response) => {
    const members: Array<{
      userId?: unknown;
      displayName?: unknown;
      sealedDestinationRef?: unknown;
      publicKey?: unknown;
    }> = Array.isArray(request.body?.members) ? request.body.members : [];

    try {
      const envelopes = revealEnvelopes(
        members.map((member) => ({
          userId: String(member.userId),
          displayName: String(member.displayName ?? ""),
          sealedDestinationRef: String(member.sealedDestinationRef),
          publicKey: String(member.publicKey),
        })),
      );

      logger.info("matcher.envelopes_revealed", {
        ...getRequestLogContext(request),
        memberCount: members.length,
        envelopeCount: envelopes.length,
      });

      response.json({ envelopes });
    } catch (error) {
      const message = normalizeRevealErrorMessage(error);
      logger.error("matcher.envelopes_reveal_failed", {
        ...getRequestLogContext(request),
        memberCount: members.length,
        error,
      });
      response.status(500).json({ error: message });
    }
  });

  app.post("/matcher/admin/preview", async (request, response) => {
    if (!hasValidPreviewSecret(request)) {
      response.status(403).json({ error: "Forbidden." });
      return;
    }

    const riders = Array.isArray(request.body?.riders)
      ? (request.body.riders as Array<Record<string, unknown>>)
      : [];
    const groups = Array.isArray(request.body?.groups)
      ? (request.body.groups as Array<Record<string, unknown>>)
      : [];

    try {
      const preview = await buildSimulatorPreview({
        riders: riders.map((rider) => ({
          riderId: String(rider?.riderId ?? ""),
          routeDescriptorRef: String(rider?.routeDescriptorRef ?? ""),
          sealedDestinationRef: String(rider?.sealedDestinationRef ?? ""),
          alias: String(rider?.alias ?? ""),
        })),
        groups: groups.map((group) => ({
          groupId: String(group?.groupId ?? ""),
          members: Array.isArray(group?.members)
            ? (group.members as Array<Record<string, unknown>>).map((member) => ({
                riderId: String(member?.riderId ?? ""),
                routeDescriptorRef: String(member?.routeDescriptorRef ?? ""),
                sealedDestinationRef: String(member?.sealedDestinationRef ?? ""),
                alias: String(member?.alias ?? ""),
              }))
            : [],
        })),
      } satisfies MatcherSimulatorPreviewRequest);

      logger.info("matcher.admin_preview_generated", {
        ...getRequestLogContext(request),
        riderCount: preview.riders.length,
        groupCount: preview.groups.length,
      });

      response.json(preview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview generation failed.";
      logger.error("matcher.admin_preview_failed", {
        ...getRequestLogContext(request),
        riderCount: riders.length,
        groupCount: groups.length,
        error,
      });
      response.status(500).json({ error: message });
    }
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    logger.error("request.failed", {
      ...getRequestLogContext(request),
      statusCode: response.statusCode >= 400 ? response.statusCode : 500,
      error,
    });

    if (response.headersSent) {
      return;
    }

    response.status(500).json({ error: "Internal server error." });
  });

  return { app, logger };
}
