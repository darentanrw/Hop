import { describe, expect, test } from "vitest";
import { resolveGroupDestinationLabel } from "../../lib/group-destination-label";

describe("group destination label", () => {
  test("prefers the locked destination address when available", () => {
    expect(
      resolveGroupDestinationLabel({
        destinationAddress: "123 Clementi Rd",
        sealedDestinationRef: "sealed:utown",
      }),
    ).toBe("123 Clementi Rd");
  });

  test("falls back to the cached label for sealed destinations", () => {
    expect(
      resolveGroupDestinationLabel(
        {
          destinationAddress: null,
          sealedDestinationRef: "sealed:utown",
        },
        { "sealed:utown": "PGP Residences" },
      ),
    ).toBe("PGP Residences");
  });

  test("uses a neutral fallback when no destination label is available", () => {
    expect(
      resolveGroupDestinationLabel({
        destinationAddress: null,
        sealedDestinationRef: null,
      }),
    ).toBe("Your destination");
  });
});
