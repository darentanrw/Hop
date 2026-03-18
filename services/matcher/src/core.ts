import crypto from "node:crypto";
import type { AddressEnvelope, CompatibilityEdge, FareBand } from "@hop/shared";

type DestinationRecord = {
  sealedDestinationRef: string;
  routeDescriptorRef: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  normalizedAddress: string;
  features: {
    postalPrefix: string;
    tokenSet: string[];
    routeHash: string;
  };
  estimatedFareBand: FareBand;
};

type MatcherStore = {
  destinations: Map<string, DestinationRecord>;
  descriptors: Map<string, DestinationRecord["features"]>;
};

const globalStore = globalThis as typeof globalThis & { __hopMatcherStore?: MatcherStore };

function getStore() {
  if (!globalStore.__hopMatcherStore) {
    globalStore.__hopMatcherStore = {
      destinations: new Map(),
      descriptors: new Map(),
    };
  }

  return globalStore.__hopMatcherStore;
}

function getSealingKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.MATCHER_SEALING_KEY ?? "dev-only-sealing-key-change-me")
    .digest();
}

function base64(input: Buffer) {
  return input.toString("base64");
}

function normalizeAddress(address: string) {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenizeAddress(normalizedAddress: string) {
  return normalizedAddress
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 12);
}

function postalPrefix(normalizedAddress: string) {
  const sixDigit = normalizedAddress.match(/\b(\d{6})\b/);
  if (sixDigit) return sixDigit[1].slice(0, 3);
  return crypto.createHash("sha256").update(normalizedAddress).digest("hex").slice(0, 3);
}

function computeFareBand(normalizedAddress: string): FareBand {
  const hashValue = Number.parseInt(
    crypto.createHash("sha256").update(normalizedAddress).digest("hex").slice(0, 4),
    16,
  );
  const bucket = hashValue % 4;
  return ["S$10-15", "S$16-20", "S$21-25", "S$26+"][bucket] as FareBand;
}

function sealAddress(address: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSealingKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: base64(ciphertext),
    iv: base64(iv),
    authTag: base64(authTag),
  };
}

function unsealAddress(record: DestinationRecord) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSealingKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

function jaccardSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union === 0 ? 0 : intersection / union;
}

export function submitDestination(address: string) {
  const normalizedAddress = normalizeAddress(address);
  const tokenSet = tokenizeAddress(normalizedAddress);
  const features = {
    postalPrefix: postalPrefix(normalizedAddress),
    tokenSet,
    routeHash: crypto.createHash("sha256").update(normalizedAddress).digest("hex").slice(0, 10),
  };
  const sealedDestinationRef = `dest_${crypto.randomUUID()}`;
  const routeDescriptorRef = `route_${crypto.randomUUID()}`;
  const estimatedFareBand = computeFareBand(normalizedAddress);
  const sealed = sealAddress(address);
  const store = getStore();

  store.destinations.set(sealedDestinationRef, {
    sealedDestinationRef,
    routeDescriptorRef,
    normalizedAddress,
    features,
    estimatedFareBand,
    ...sealed,
  });
  store.descriptors.set(routeDescriptorRef, features);

  return {
    sealedDestinationRef,
    routeDescriptorRef,
    estimatedFareBand,
  };
}

export function scoreRouteDescriptors(routeDescriptorRefs: string[]): CompatibilityEdge[] {
  const store = getStore();
  const edges: CompatibilityEdge[] = [];

  for (let index = 0; index < routeDescriptorRefs.length; index += 1) {
    for (
      let compareIndex = index + 1;
      compareIndex < routeDescriptorRefs.length;
      compareIndex += 1
    ) {
      const leftRef = routeDescriptorRefs[index];
      const rightRef = routeDescriptorRefs[compareIndex];
      const left = store.descriptors.get(leftRef);
      const right = store.descriptors.get(rightRef);

      if (!left || !right) {
        continue;
      }

      const destinationProximity =
        left.postalPrefix === right.postalPrefix
          ? 0.92
          : left.postalPrefix.slice(0, 2) === right.postalPrefix.slice(0, 2)
            ? 0.75
            : 0.4;
      const routeOverlap = Math.max(
        destinationProximity - 0.08,
        jaccardSimilarity(left.tokenSet, right.tokenSet),
      );
      const score = Number((0.55 * routeOverlap + 0.45 * destinationProximity).toFixed(2));
      const detourMinutes = Math.max(2, Math.round((1 - score) * 18));
      const fareBand = routeOverlap > 0.82 && destinationProximity > 0.82 ? "S$10-15" : "S$16-20";

      edges.push({
        leftRef,
        rightRef,
        routeOverlap: Number(routeOverlap.toFixed(2)),
        destinationProximity: Number(destinationProximity.toFixed(2)),
        score,
        detourMinutes,
        fareBand,
      });
    }
  }

  return edges;
}

function importRecipientKey(publicKey: string) {
  return crypto.createPublicKey({
    key: Buffer.from(publicKey, "base64"),
    format: "der",
    type: "spki",
  });
}

export function revealEnvelopes(
  members: Array<{
    riderId: string;
    pseudonym: string;
    sealedDestinationRef: string;
    publicKey: string;
  }>,
) {
  const store = getStore();
  const envelopes: AddressEnvelope[] = [];

  for (const recipient of members) {
    const recipientKey = importRecipientKey(recipient.publicKey);

    for (const sender of members) {
      const destinationRecord = store.destinations.get(sender.sealedDestinationRef);
      if (!destinationRecord) {
        continue;
      }

      const plaintextAddress = unsealAddress(destinationRecord);
      const payload = Buffer.from(
        JSON.stringify({
          riderId: sender.riderId,
          pseudonym: sender.pseudonym,
          address: plaintextAddress,
        }),
        "utf8",
      );
      const ciphertext = crypto.publicEncrypt(
        {
          key: recipientKey,
          oaepHash: "sha256",
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        },
        payload,
      );

      envelopes.push({
        recipientRiderId: recipient.riderId,
        senderRiderId: sender.riderId,
        senderPseudonym: sender.pseudonym,
        ciphertext: base64(ciphertext),
      });
    }
  }

  return envelopes;
}
