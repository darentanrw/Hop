import { describe, expect, test } from "vitest";
import type { CompatibilityEdge, MatchingCandidate } from "../../lib/matching";
import { evaluateGroup, formGroups, pairKey } from "../../lib/matching";

/**
 * Locations used (real Singapore coordinates):
 *
 * Clementi cluster  (~1.315, 103.765)  — riders A and C
 * Holland cluster   (~1.312, 103.796)  — nearby to Clementi, rider joining later
 * Changi cluster    (~1.364, 103.992)  — far from Clementi, rider B
 */

const SOON = new Date(Date.now() + 2 * 3_600_000).toISOString();
const SOON_END = new Date(Date.now() + 4 * 3_600_000).toISOString();

function makeCandidate(
  overrides: Partial<MatchingCandidate> & { userId: string },
): MatchingCandidate {
  return {
    availabilityId: `avail_${overrides.userId}`,
    windowStart: SOON,
    windowEnd: SOON_END,
    selfDeclaredGender: "prefer_not_to_say",
    sameGenderOnly: false,
    routeDescriptorRef: `route_${overrides.userId}`,
    sealedDestinationRef: `dest_${overrides.userId}`,
    displayName: overrides.userId,
    ...overrides,
  };
}

function makeEdge(
  leftRef: string,
  rightRef: string,
  overrides?: Partial<CompatibilityEdge>,
): CompatibilityEdge {
  return {
    leftRef,
    rightRef,
    score: 0.85,
    detourMinutes: 5,
    spreadDistanceKm: 1.2,
    routeOverlap: 10,
    destinationProximity: 0.3,
    ...overrides,
  };
}

describe("group formation — location-based scenarios", () => {
  test("two riders with far-apart locations produce no group (no compatibility edge)", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi",
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_changi",
    });

    // No edges means the matcher determined locations are too far
    // (geohash mismatch or spread > MAX_SPREAD_KM)
    const edges: CompatibilityEdge[] = [];
    const groups = formGroups([riderA, riderB], edges);

    expect(groups).toHaveLength(0);
  });

  test("two riders with far-apart locations produce no group (edge exceeds MAX_SPREAD_KM)", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi",
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_changi",
    });

    // Even if an edge exists, spread > 8 km means it should be rejected
    const edges = [
      makeEdge("route_clementi", "route_changi", {
        spreadDistanceKm: 25,
        detourMinutes: 20,
        score: 0.3,
      }),
    ];
    const groups = formGroups([riderA, riderB], edges);

    expect(groups).toHaveLength(0);
  });

  test("two riders with far-apart locations produce no group (detour exceeds MAX_DETOUR_MINUTES)", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi",
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_changi",
    });

    const edges = [
      makeEdge("route_clementi", "route_changi", {
        spreadDistanceKm: 6,
        detourMinutes: 15,
        score: 0.4,
      }),
    ];
    const groups = formGroups([riderA, riderB], edges);

    expect(groups).toHaveLength(0);
  });

  test("two riders with close locations form a group", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi_1",
    });
    const riderC = makeCandidate({
      userId: "charlie",
      routeDescriptorRef: "route_clementi_2",
    });

    const edges = [
      makeEdge("route_clementi_1", "route_clementi_2", {
        spreadDistanceKm: 0.5,
        detourMinutes: 3,
        score: 0.92,
      }),
    ];
    const groups = formGroups([riderA, riderC], edges);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].averageScore).toBeGreaterThan(0.5);
    expect(groups[0].maxDetourMinutes).toBeLessThanOrEqual(12);

    const memberIds = groups[0].members.map((m) => m.userId).sort();
    expect(memberIds).toEqual(["alice", "charlie"]);
  });

  test("third rider with close location joins the group (forms a 3-person group)", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi_1",
    });
    const riderC = makeCandidate({
      userId: "charlie",
      routeDescriptorRef: "route_clementi_2",
    });
    const riderD = makeCandidate({
      userId: "diana",
      routeDescriptorRef: "route_holland",
    });

    // All three locations are close to each other
    const edges = [
      makeEdge("route_clementi_1", "route_clementi_2", {
        spreadDistanceKm: 0.5,
        detourMinutes: 3,
        score: 0.92,
      }),
      makeEdge("route_clementi_1", "route_holland", {
        spreadDistanceKm: 3.2,
        detourMinutes: 6,
        score: 0.78,
      }),
      makeEdge("route_clementi_2", "route_holland", {
        spreadDistanceKm: 3.0,
        detourMinutes: 5,
        score: 0.8,
      }),
    ];
    const groups = formGroups([riderA, riderC, riderD], edges);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);

    const memberIds = groups[0].members.map((m) => m.userId).sort();
    expect(memberIds).toEqual(["alice", "charlie", "diana"]);
  });

  test("close rider is grouped while far rider is left unmatched", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi_1",
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_changi",
    });
    const riderC = makeCandidate({
      userId: "charlie",
      routeDescriptorRef: "route_clementi_2",
    });

    // Only the Clementi pair has a compatible edge, Changi is too far from both
    const edges = [
      makeEdge("route_clementi_1", "route_clementi_2", {
        spreadDistanceKm: 0.5,
        detourMinutes: 3,
        score: 0.92,
      }),
    ];
    const groups = formGroups([riderA, riderB, riderC], edges);

    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);

    const memberIds = groups[0].members.map((m) => m.userId).sort();
    expect(memberIds).toEqual(["alice", "charlie"]);
  });

  test("algorithm prefers a larger group when a third close rider is available", () => {
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_clementi_1",
    });
    const riderC = makeCandidate({
      userId: "charlie",
      routeDescriptorRef: "route_clementi_2",
    });
    const riderD = makeCandidate({
      userId: "diana",
      routeDescriptorRef: "route_holland",
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_changi",
    });

    // Clementi pair + Holland are all close; Changi is far from everyone
    const edges = [
      makeEdge("route_clementi_1", "route_clementi_2", {
        spreadDistanceKm: 0.5,
        detourMinutes: 3,
        score: 0.92,
      }),
      makeEdge("route_clementi_1", "route_holland", {
        spreadDistanceKm: 3.2,
        detourMinutes: 6,
        score: 0.78,
      }),
      makeEdge("route_clementi_2", "route_holland", {
        spreadDistanceKm: 3.0,
        detourMinutes: 5,
        score: 0.8,
      }),
    ];

    const groups = formGroups([riderA, riderB, riderC, riderD], edges);

    // Should form a group-of-3 (Clementi+Holland), Bob left out
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);

    const memberIds = groups[0].members.map((m) => m.userId).sort();
    expect(memberIds).toEqual(["alice", "charlie", "diana"]);
  });
});

describe("formGroups — small group release gate uses shared window", () => {
  test("pair with offset windows uses consensus start (latest windowStart) for release gate", () => {
    const now = Date.now();
    // Rider A: 3h–5h from now, Rider B: 4h–5.5h from now
    // Overlap is 4h–5h (60 min), consensus start = 4h away
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_a",
      windowStart: new Date(now + 3 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 5 * 3_600_000).toISOString(),
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_b",
      windowStart: new Date(now + 4 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 5.5 * 3_600_000).toISOString(),
    });

    const edges = [makeEdge("route_a", "route_b")];

    // Consensus start is 4h away (< SMALL_GROUP_RELEASE_HOURS=36), so this forms.
    const groups = formGroups([riderA, riderB], edges);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  test("pair is blocked when consensus start exceeds SMALL_GROUP_RELEASE_HOURS", () => {
    const now = Date.now();
    // Rider A: 34h from now, Rider B: 37h from now
    // Shared window starts at 37h → exceeds SMALL_GROUP_RELEASE_HOURS (36)
    const riderA = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_a",
      windowStart: new Date(now + 34 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 38 * 3_600_000).toISOString(),
    });
    const riderB = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_b",
      windowStart: new Date(now + 37 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 40 * 3_600_000).toISOString(),
    });

    const edges = [makeEdge("route_a", "route_b")];
    const groups = formGroups([riderA, riderB], edges);

    // Without the fix, rider A's 4h start would pass the gate.
    // With the fix, the consensus 6h start correctly blocks the group.
    expect(groups).toHaveLength(0);
  });
});

describe("evaluateGroup — constraint validation", () => {
  test("returns null when no compatibility edge exists between a pair", () => {
    const members = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_a" }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_b" }),
    ];
    const compatibilityMap = new Map<string, CompatibilityEdge>();

    expect(evaluateGroup(members, compatibilityMap)).toBeNull();
  });

  test("returns null when spread exceeds MAX_SPREAD_KM (8 km)", () => {
    const members = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_a" }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_b" }),
    ];
    const edge = makeEdge("route_a", "route_b", { spreadDistanceKm: 9 });
    const compatibilityMap = new Map([[pairKey("route_a", "route_b"), edge]]);

    expect(evaluateGroup(members, compatibilityMap)).toBeNull();
  });

  test("returns null when detour exceeds MAX_DETOUR_MINUTES (12 min)", () => {
    const members = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_a" }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_b" }),
    ];
    const edge = makeEdge("route_a", "route_b", { detourMinutes: 15 });
    const compatibilityMap = new Map([[pairKey("route_a", "route_b"), edge]]);

    expect(evaluateGroup(members, compatibilityMap)).toBeNull();
  });

  test("returns null when time windows don't overlap at all", () => {
    const now = Date.now();
    const members = [
      makeCandidate({
        userId: "alice",
        routeDescriptorRef: "route_a",
        windowStart: new Date(now).toISOString(),
        windowEnd: new Date(now + 3_600_000).toISOString(),
      }),
      makeCandidate({
        userId: "bob",
        routeDescriptorRef: "route_b",
        windowStart: new Date(now + 3_600_000).toISOString(),
        windowEnd: new Date(now + 7_200_000).toISOString(),
      }),
    ];
    const edge = makeEdge("route_a", "route_b");
    const compatibilityMap = new Map([[pairKey("route_a", "route_b"), edge]]);

    expect(evaluateGroup(members, compatibilityMap)).toBeNull();
  });

  test("returns null when gender preferences are incompatible", () => {
    const members = [
      makeCandidate({
        userId: "alice",
        routeDescriptorRef: "route_a",
        sameGenderOnly: true,
        selfDeclaredGender: "woman",
      }),
      makeCandidate({
        userId: "bob",
        routeDescriptorRef: "route_b",
        selfDeclaredGender: "man",
      }),
    ];
    const edge = makeEdge("route_a", "route_b");
    const compatibilityMap = new Map([[pairKey("route_a", "route_b"), edge]]);

    expect(evaluateGroup(members, compatibilityMap)).toBeNull();
  });

  test("returns scores when all constraints pass", () => {
    const members = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_a" }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_b" }),
    ];
    const edge = makeEdge("route_a", "route_b", {
      score: 0.88,
      detourMinutes: 5,
      spreadDistanceKm: 1.5,
    });
    const compatibilityMap = new Map([[pairKey("route_a", "route_b"), edge]]);

    const result = evaluateGroup(members, compatibilityMap);

    expect(result).not.toBeNull();
    expect(result?.averageScore).toBe(0.88);
    expect(result?.maxDetourMinutes).toBe(5);
  });
});

describe("party size — passenger seats (max 4 per car)", () => {
  test("forms one group from party 3 + party 1 (4 seats)", () => {
    const a = makeCandidate({ userId: "alice", routeDescriptorRef: "route_x", partySize: 3 });
    const b = makeCandidate({ userId: "bob", routeDescriptorRef: "route_y", partySize: 1 });
    const edges = [makeEdge("route_x", "route_y")];
    const groups = formGroups([a, b], edges);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  test("forms one group from party 2 + party 2 (4 seats)", () => {
    const a = makeCandidate({ userId: "a", routeDescriptorRef: "r1", partySize: 2 });
    const b = makeCandidate({ userId: "b", routeDescriptorRef: "r2", partySize: 2 });
    const groups = formGroups([a, b], [makeEdge("r1", "r2")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  test("does not combine 3-seat and 2-seat bookings in one group (5 seats)", () => {
    const a = makeCandidate({ userId: "alice", routeDescriptorRef: "route_x", partySize: 3 });
    const b = makeCandidate({ userId: "bob", routeDescriptorRef: "route_y", partySize: 2 });
    const edges = [makeEdge("route_x", "route_y")];
    const groups = formGroups([a, b], edges);
    for (const g of groups) {
      const ids = new Set(g.members.map((m) => m.userId));
      expect(ids.has("alice") && ids.has("bob")).toBe(false);
    }
  });

  test("party 3 + party 1 with shared route ref matches without matcher edges", () => {
    const a = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_shared",
      partySize: 3,
    });
    const b = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_shared",
      partySize: 1,
    });
    const groups = formGroups([a, b], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });
});

describe("matching — full-car gate and same-destination fallbacks", () => {
  test("evaluateGroup uses a synthetic perfect edge when two members share routeDescriptorRef and the map is empty", () => {
    const members = [
      makeCandidate({
        userId: "alice",
        routeDescriptorRef: "route_same",
        partySize: 3,
      }),
      makeCandidate({
        userId: "bob",
        routeDescriptorRef: "route_same",
        partySize: 1,
      }),
    ];
    const result = evaluateGroup(members, new Map());
    expect(result).not.toBeNull();
    expect(result?.averageScore).toBe(1);
    expect(result?.minimumScore).toBe(1);
    expect(result?.maxDetourMinutes).toBe(0);
  });

  test("evaluateGroup still rejects shared routeDescriptorRef when the map edge exceeds detour limit", () => {
    const members = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_same" }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_same" }),
    ];
    const bad = makeEdge("route_same", "route_same", { detourMinutes: 20, spreadDistanceKm: 0 });
    const map = new Map([[pairKey("route_same", "route_same"), bad]]);
    expect(evaluateGroup(members, map)).toBeNull();
  });

  test("party 3 + party 1 with different refs bypasses the 36h small-group gate", () => {
    const now = Date.now();
    const window = {
      windowStart: new Date(now + 40 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 42 * 3_600_000).toISOString(),
    };
    const a = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_x",
      partySize: 3,
      ...window,
    });
    const b = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_y",
      partySize: 1,
      ...window,
    });
    const groups = formGroups([a, b], [makeEdge("route_x", "route_y")]);
    expect(groups).toHaveLength(1);
    expect(sumSeats(groups[0]?.members ?? [])).toBe(4);
  });

  test("default party size 1+1 stays blocked when shared window starts beyond SMALL_GROUP_RELEASE_HOURS", () => {
    const now = Date.now();
    const window = {
      windowStart: new Date(now + 40 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 42 * 3_600_000).toISOString(),
    };
    const a = makeCandidate({ userId: "alice", routeDescriptorRef: "route_a", ...window });
    const b = makeCandidate({ userId: "bob", routeDescriptorRef: "route_b", ...window });
    const groups = formGroups([a, b], [makeEdge("route_a", "route_b")]);
    expect(groups).toHaveLength(0);
  });

  test("party 3 + party 1 same destination forms with no edges and a far-future window", () => {
    const now = Date.now();
    const window = {
      windowStart: new Date(now + 40 * 3_600_000).toISOString(),
      windowEnd: new Date(now + 42 * 3_600_000).toISOString(),
    };
    const a = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_z",
      partySize: 3,
      ...window,
    });
    const b = makeCandidate({
      userId: "bob",
      routeDescriptorRef: "route_z",
      partySize: 1,
      ...window,
    });
    const groups = formGroups([a, b], []);
    expect(groups).toHaveLength(1);
  });
});

function sumSeats(members: MatchingCandidate[]) {
  return members.reduce((s, m) => s + (m.partySize ?? 1), 0);
}

describe("single-account group prevention", () => {
  test("solo candidate with partySize 2 does not form a group", () => {
    const solo = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_a",
      partySize: 2,
    });
    const groups = formGroups([solo], []);
    expect(groups).toHaveLength(0);
  });

  test("solo candidate with partySize 3 does not form a group", () => {
    const solo = makeCandidate({
      userId: "alice",
      routeDescriptorRef: "route_a",
      partySize: 3,
    });
    const groups = formGroups([solo], []);
    expect(groups).toHaveLength(0);
  });

  test("every formed group has at least 2 distinct accounts", () => {
    const candidates = [
      makeCandidate({ userId: "alice", routeDescriptorRef: "route_a", partySize: 3 }),
      makeCandidate({ userId: "bob", routeDescriptorRef: "route_a", partySize: 1 }),
      makeCandidate({ userId: "charlie", routeDescriptorRef: "route_c", partySize: 2 }),
    ];
    const edges = [makeEdge("route_a", "route_a"), makeEdge("route_a", "route_c")];
    const groups = formGroups(candidates, edges);
    for (const g of groups) {
      expect(g.members.length).toBeGreaterThanOrEqual(2);
      const uniqueUsers = new Set(g.members.map((m) => m.userId));
      expect(uniqueUsers.size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("formGroups — subset bounds", () => {
  test("no group exceeds MAX_GROUP_SIZE accounts", () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      makeCandidate({
        userId: `user_${i}`,
        routeDescriptorRef: "route_shared",
        partySize: 1,
      }),
    );
    const groups = formGroups(candidates, []);
    for (const g of groups) {
      expect(g.members.length).toBeLessThanOrEqual(4);
    }
  });

  test("three accounts with partySize 1 form a group of 3 (not two separate groups)", () => {
    const candidates = [
      makeCandidate({ userId: "a", routeDescriptorRef: "r_shared", partySize: 1 }),
      makeCandidate({ userId: "b", routeDescriptorRef: "r_shared", partySize: 1 }),
      makeCandidate({ userId: "c", routeDescriptorRef: "r_shared", partySize: 1 }),
    ];
    const groups = formGroups(candidates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  test("four accounts with partySize 1 form one group of 4", () => {
    const candidates = [
      makeCandidate({ userId: "a", routeDescriptorRef: "r_shared", partySize: 1 }),
      makeCandidate({ userId: "b", routeDescriptorRef: "r_shared", partySize: 1 }),
      makeCandidate({ userId: "c", routeDescriptorRef: "r_shared", partySize: 1 }),
      makeCandidate({ userId: "d", routeDescriptorRef: "r_shared", partySize: 1 }),
    ];
    const groups = formGroups(candidates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(4);
    expect(sumSeats(groups[0].members)).toBe(4);
  });

  test("five accounts with partySize 1 form one group of 4 and leave 1 unmatched", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({
        userId: `u${i}`,
        routeDescriptorRef: "r_shared",
        partySize: 1,
      }),
    );
    const groups = formGroups(candidates, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(4);
  });
});
