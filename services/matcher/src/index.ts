import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  computeLocationClusters,
  revealEnvelopes,
  scoreRouteDescriptors,
  submitDestination,
} from "./core";
import { geocodeAddress } from "./onemap";

const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";

const app = express();
const port = Number(process.env.MATCHER_PORT ?? 4001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
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
      response.json({ results: [] });
      return;
    }

    const data = (await upstream.json()) as {
      found: number;
      results: Array<{
        SEARCHVAL: string;
        LATITUDE: string;
        LONGITUDE: string;
        POSTAL: string;
        BUILDING: string;
        ADDRESS: string;
      }>;
    };

    response.json({
      results: (data.results ?? []).slice(0, 8).map((r) => ({
        title: r.BUILDING && r.BUILDING !== "NIL" ? r.BUILDING : r.SEARCHVAL,
        address: r.ADDRESS,
        postal: r.POSTAL,
        lat: r.LATITUDE,
        lng: r.LONGITUDE,
      })),
    });
  } catch {
    response.json({ results: [] });
  }
});

app.post("/matcher/submit-destination", async (request, response) => {
  const address = String(request.body?.address ?? "").trim();

  if (!address) {
    response.status(400).json({ error: "Address is required." });
    return;
  }

  try {
    const result = await submitDestination(address);
    response.json(result);
  } catch (err) {
    response.status(400).json({
      error: err instanceof Error ? err.message : "Could not process destination.",
    });
  }
});

app.post("/matcher/compatibility", async (request, response) => {
  const routeDescriptorRefs = Array.isArray(request.body?.routeDescriptorRefs)
    ? request.body.routeDescriptorRefs.map(String)
    : [];

  try {
    const edges = await scoreRouteDescriptors(routeDescriptorRefs);
    const geohashByRef = computeLocationClusters(routeDescriptorRefs);
    response.json({ edges, geohashByRef });
  } catch (err) {
    response.status(500).json({
      error: err instanceof Error ? err.message : "Compatibility scoring failed.",
    });
  }
});

app.post("/matcher/reveal-envelopes", (request, response) => {
  const members: Array<{
    userId?: unknown;
    displayName?: unknown;
    sealedDestinationRef?: unknown;
    publicKey?: unknown;
  }> = Array.isArray(request.body?.members) ? request.body.members : [];

  response.json({
    envelopes: revealEnvelopes(
      members.map((member) => ({
        userId: String(member.userId),
        displayName: String(member.displayName ?? ""),
        sealedDestinationRef: String(member.sealedDestinationRef),
        publicKey: String(member.publicKey),
      })),
    ),
  });
});

app.listen(port, () => {
  console.log(`Hop matcher service listening on http://localhost:${port}`);
});
