import { describe, expect, test } from "vitest";
import {
  createStubMatcherSubmissionForAddress,
  decodeStubDestinationRef,
} from "../../lib/matcher-stub";

describe("matcher stub submissions", () => {
  test("preserves the rider-entered address in stub mode", () => {
    const address = "Blk 123 Clementi Ave 3, Singapore 120123";
    const payload = createStubMatcherSubmissionForAddress(address);

    expect(decodeStubDestinationRef(payload.sealedDestinationRef)).toBe(address);
    expect(payload.routeDescriptorRef).toMatch(/^stub:route:/);
  });
});
