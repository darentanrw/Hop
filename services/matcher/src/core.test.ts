import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import { revealEnvelopes, scoreRouteDescriptors, submitDestination } from "./core";

function generatePublicKey() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return publicKey.toString("base64");
}

describe("matcher core", () => {
  test("submitDestination never returns plaintext address", () => {
    const address = "123 Clementi Ave 3 Singapore 120123";
    const result = submitDestination(address);

    expect(result.sealedDestinationRef).toMatch(/^dest_/);
    expect(JSON.stringify(result)).not.toContain(address);
  });

  test("compatibility scoring returns pairwise edges", () => {
    const left = submitDestination("123 Clementi Ave 3 Singapore 120123");
    const right = submitDestination("456 Clementi Ave 4 Singapore 120124");
    const edges = scoreRouteDescriptors([left.routeDescriptorRef, right.routeDescriptorRef]);

    expect(edges).toHaveLength(1);
    expect(edges[0].score).toBeGreaterThan(0.5);
  });

  test("reveal envelopes are created per recipient", () => {
    const left = submitDestination("123 Clementi Ave 3 Singapore 120123");
    const right = submitDestination("456 Clementi Ave 4 Singapore 120124");

    const envelopes = revealEnvelopes([
      {
        riderId: "rider_a",
        pseudonym: "Rider A",
        sealedDestinationRef: left.sealedDestinationRef,
        publicKey: generatePublicKey(),
      },
      {
        riderId: "rider_b",
        pseudonym: "Rider B",
        sealedDestinationRef: right.sealedDestinationRef,
        publicKey: generatePublicKey(),
      },
    ]);

    expect(envelopes).toHaveLength(4);
    expect(envelopes.every((envelope) => envelope.ciphertext.length > 20)).toBe(true);
  });
});
