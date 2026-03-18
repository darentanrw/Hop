import cors from "cors";
import express from "express";
import { revealEnvelopes, scoreRouteDescriptors, submitDestination } from "./core";

const app = express();
const port = Number(process.env.MATCHER_PORT ?? 4001);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/matcher/submit-destination", (request, response) => {
  const address = String(request.body?.address ?? "").trim();

  if (!address) {
    response.status(400).json({ error: "Address is required." });
    return;
  }

  response.json(submitDestination(address));
});

app.post("/matcher/compatibility", (request, response) => {
  const routeDescriptorRefs = Array.isArray(request.body?.routeDescriptorRefs)
    ? request.body.routeDescriptorRefs.map(String)
    : [];

  response.json({
    edges: scoreRouteDescriptors(routeDescriptorRefs),
  });
});

app.post("/matcher/reveal-envelopes", (request, response) => {
  const members: Array<{
    riderId?: unknown;
    pseudonym?: unknown;
    sealedDestinationRef?: unknown;
    publicKey?: unknown;
  }> = Array.isArray(request.body?.members) ? request.body.members : [];

  response.json({
    envelopes: revealEnvelopes(
      members.map((member) => ({
        riderId: String(member.riderId),
        pseudonym: String(member.pseudonym),
        sealedDestinationRef: String(member.sealedDestinationRef),
        publicKey: String(member.publicKey),
      })),
    ),
  });
});

app.listen(port, () => {
  console.log(`Hop matcher service listening on http://localhost:${port}`);
});
