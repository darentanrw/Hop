import { describe, expect, test } from "vitest";
import { resolveDestinationLabel } from "../../lib/destination-storage";

describe("destination label storage", () => {
  test("uses the cached address for live matcher destinations", () => {
    expect(
      resolveDestinationLabel("sealed:abc123", {
        "sealed:abc123": "Blk 123 Clementi Ave 3, Singapore 120123",
      }),
    ).toBe("Blk 123 Clementi Ave 3, Singapore 120123");
  });

  test("falls back when a live matcher destination has no cached address", () => {
    expect(resolveDestinationLabel("sealed:missing")).toBe("Your destination");
  });
});
