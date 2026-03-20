import { describe, expect, test } from "vitest";
import { buildLockedGroupDestinations } from "../../lib/group-destinations";

describe("group destination locking", () => {
  test("orders opaque matcher refs deterministically when the group is formed", () => {
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
            sealedDestinationRef: "dest_b",
          },
        ],
        [
          "availability-b",
          {
            createdAt: "2026-03-19T11:00:00.000Z",
            sealedDestinationRef: "dest_a",
          },
        ],
      ]),
    );

    expect(destinations).toMatchObject([
      {
        availabilityId: "availability-b",
        destinationAddress: undefined,
        destinationLockedAt: "2026-03-19T11:00:00.000Z",
        dropoffOrder: 1,
        userId: "user-b",
      },
      {
        availabilityId: "availability-a",
        destinationAddress: undefined,
        destinationLockedAt: "2026-03-19T10:00:00.000Z",
        dropoffOrder: 2,
        userId: "user-a",
      },
    ]);
  });

  test("uses the opaque sealed ref as a stable ordering key", () => {
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
