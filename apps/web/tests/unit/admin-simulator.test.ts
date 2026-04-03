import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildCycleAssignments,
  clearStoredAdminSimulatorState,
  createEmptySimulatorSession,
  loadStoredAdminSimulatorState,
  normalizeSimulatorSession,
  persistStoredAdminSimulatorState,
} from "../../lib/admin-simulator";

function buildSessionWithRiders(states: Array<"new" | "open" | "matched">) {
  return {
    sessionSeed: 17,
    nextArrivalIndex: states.length,
    nextCycleNumber: 4,
    riders: states.map((state, index) => ({
      id: `rider_${index + 1}`,
      label: `Rider ${index + 1}`,
      arrivalIndex: index,
      address: `Address ${index + 1}`,
      verifiedTitle: `Place ${index + 1}`,
      postal: "120000",
      windowStart: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      windowEnd: new Date(Date.now() + 8 * 3_600_000).toISOString(),
      selfDeclaredGender: "prefer_not_to_say" as const,
      sameGenderOnly: false,
      sealedDestinationRef: `dest_${index + 1}`,
      routeDescriptorRef: `route_${index + 1}`,
      state,
      lastProcessedCycleNumber: state === "new" ? null : 3,
      matchedGroupId: state === "matched" ? "sim_group_1" : null,
      maskedLocationLabel: null,
      coordinate: null,
      clusterKey: null,
      color: null,
      dropoffOrder: null,
    })),
    groups:
      states.filter((state) => state === "matched").length >= 2
        ? [
            {
              groupId: "sim_group_1",
              memberRiderIds: ["rider_1", "rider_2"],
              name: "Sky Loop",
              color: "#3b82f6",
              averageScore: 0.8,
              minimumScore: 0.8,
              maxDetourMinutes: 4,
              totalDistanceMeters: 0,
              totalTimeSeconds: 0,
              legs: [],
            },
          ]
        : [],
    openRiderIds: states
      .map((state, index) => (state === "open" ? `rider_${index + 1}` : null))
      .filter((value): value is string => Boolean(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin simulator helpers", () => {
  test("buildCycleAssignments deterministically batches new riders", () => {
    const session = buildSessionWithRiders(["open", "new", "new", "new", "new"]);

    expect(buildCycleAssignments(session)).toEqual([
      { cycleNumber: 4, riderIds: ["rider_2"] },
      { cycleNumber: 5, riderIds: ["rider_3", "rider_4"] },
      { cycleNumber: 6, riderIds: ["rider_5"] },
    ]);
    expect(buildCycleAssignments(session)).toEqual(buildCycleAssignments(session));
  });

  test("buildCycleAssignments emits a recheck cycle when only open riders remain", () => {
    const session = buildSessionWithRiders(["open", "open"]);

    expect(buildCycleAssignments(session)).toEqual([{ cycleNumber: 4, riderIds: [] }]);
  });

  test("persists and restores the simulator session from localStorage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });

    const session = buildSessionWithRiders(["new", "open"]);
    persistStoredAdminSimulatorState({
      version: 1,
      session,
      lastRun: null,
    });

    expect(loadStoredAdminSimulatorState()?.session.riders).toHaveLength(2);

    clearStoredAdminSimulatorState();
    expect(loadStoredAdminSimulatorState()).toBeNull();
  });

  test("createEmptySimulatorSession initializes counters", () => {
    const session = createEmptySimulatorSession(42);

    expect(session).toMatchObject({
      sessionSeed: 42,
      nextArrivalIndex: 0,
      nextCycleNumber: 1,
      riders: [],
      groups: [],
      openRiderIds: [],
    });
  });

  test("normalizeSimulatorSession keeps each rider in at most one group", () => {
    const session = {
      ...buildSessionWithRiders(["matched", "matched", "matched"]),
      groups: [
        {
          groupId: "sim_group_1",
          memberRiderIds: ["rider_1", "rider_2"],
          name: "Sky Loop",
          color: "#3b82f6",
          averageScore: 0.8,
          minimumScore: 0.8,
          maxDetourMinutes: 4,
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          legs: [],
        },
        {
          groupId: "sim_group_2",
          memberRiderIds: ["rider_2", "rider_3"],
          name: "Lime Twist",
          color: "#84cc16",
          averageScore: 0.75,
          minimumScore: 0.75,
          maxDetourMinutes: 5,
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          legs: [],
        },
      ],
      openRiderIds: ["rider_3"],
    };

    expect(normalizeSimulatorSession(session)).toMatchObject({
      groups: [
        {
          groupId: "sim_group_1",
          memberRiderIds: ["rider_1", "rider_2"],
        },
      ],
      openRiderIds: ["rider_3"],
    });
  });

  test("normalizeSimulatorSession rewrites duplicate group ids to unique values", () => {
    const session = {
      ...buildSessionWithRiders(["matched", "matched", "open", "open"]),
      groups: [
        {
          groupId: "sim_group_5",
          memberRiderIds: ["rider_1", "rider_2"],
          name: "Sky Loop",
          color: "#3b82f6",
          averageScore: 0.8,
          minimumScore: 0.8,
          maxDetourMinutes: 4,
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          legs: [],
        },
        {
          groupId: "sim_group_5",
          memberRiderIds: ["rider_3", "rider_4"],
          name: "Lime Twist",
          color: "#84cc16",
          averageScore: 0.75,
          minimumScore: 0.75,
          maxDetourMinutes: 5,
          totalDistanceMeters: 0,
          totalTimeSeconds: 0,
          legs: [],
        },
      ],
      openRiderIds: [],
    };

    expect(normalizeSimulatorSession(session).groups.map((group) => group.groupId)).toEqual([
      "sim_group_5",
      "sim_group_6",
    ]);
  });
});
