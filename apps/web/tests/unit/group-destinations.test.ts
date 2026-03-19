import { describe, expect, test } from "vitest";
import { buildLockedGroupDestinations } from "../../lib/group-destinations";

describe("group destination locking", () => {
  test("orders stub destinations deterministically when the group is formed", () => {
    const destinations = buildLockedGroupDestinations(
      [
        { availabilityId: "availability-b", userId: "user-b" },
        { availabilityId: "availability-a", userId: "user-a" },
      ],
      new Map([
        [
          "availability-a",
          {
            createdAt: "2026-03-19T10:00:00.000Z",
            sealedDestinationRef: `stub:destination:${encodeURIComponent("Blk 45 Holland Drive, Singapore 270045")}`,
          },
        ],
        [
          "availability-b",
          {
            createdAt: "2026-03-19T11:00:00.000Z",
            sealedDestinationRef: `stub:destination:${encodeURIComponent("Blk 123 Clementi Ave 3, Singapore 120123")}`,
          },
        ],
      ]),
    );

    expect(destinations).toMatchObject([
      {
        availabilityId: "availability-b",
        destinationAddress: "Blk 123 Clementi Ave 3, Singapore 120123",
        destinationLockedAt: "2026-03-19T11:00:00.000Z",
        dropoffOrder: 1,
        userId: "user-b",
      },
      {
        availabilityId: "availability-a",
        destinationAddress: "Blk 45 Holland Drive, Singapore 270045",
        destinationLockedAt: "2026-03-19T10:00:00.000Z",
        dropoffOrder: 2,
        userId: "user-a",
      },
    ]);
  });

  test("falls back to the sealed ref when the destination cannot be decoded locally", () => {
    const destinations = buildLockedGroupDestinations(
      [{ availabilityId: "availability-a", userId: "user-a" }],
      new Map([
        [
          "availability-a",
          {
            createdAt: "2026-03-19T10:00:00.000Z",
            sealedDestinationRef: "secure:opaque-ref",
          },
        ],
      ]),
    );

    expect(destinations).toMatchObject([
      {
        availabilityId: "availability-a",
        destinationAddress: undefined,
        destinationLockedAt: "2026-03-19T10:00:00.000Z",
        dropoffOrder: 1,
        userId: "user-a",
      },
    ]);
  });
});
