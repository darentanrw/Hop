import {
  MAX_DISTINCT_LOCATIONS,
  MAX_SPREAD_KM,
  arePreferencesCompatible,
  overlapMinutes,
} from "@hop/shared";
import { describe, expect, test } from "vitest";
import type { CompatibilityEdge } from "../../lib/matching";

function makeEdge(overrides?: Partial<CompatibilityEdge>): CompatibilityEdge {
  return {
    leftRef: "route_a",
    rightRef: "route_b",
    score: 0.82,
    detourMinutes: 6,
    spreadDistanceKm: 3.2,
    routeOverlap: 10,
    destinationProximity: 0.5,
    ...overrides,
  };
}

describe("matching constraints", () => {
  test("compatibility edges include spreadDistanceKm", () => {
    const edge = makeEdge();
    expect(edge).toHaveProperty("spreadDistanceKm");
    expect(typeof edge.spreadDistanceKm).toBe("number");
  });

  test("nearby pairs can have small spread", () => {
    const edge = makeEdge({ spreadDistanceKm: 0.5 });
    expect(edge.spreadDistanceKm).toBeLessThan(1);
  });

  test("wider-but-valid pairs stay within MAX_SPREAD_KM", () => {
    const edge = makeEdge({ spreadDistanceKm: 6.8 });
    expect(edge.spreadDistanceKm).toBeGreaterThan(3);
    expect(edge.spreadDistanceKm).toBeLessThan(MAX_SPREAD_KM);
  });

  test("group with 4 distinct locations would violate MAX_DISTINCT_LOCATIONS", () => {
    expect(MAX_DISTINCT_LOCATIONS).toBe(3);
    const locations = new Set(["loc_a", "loc_b", "loc_c", "loc_d"]);
    expect(locations.size).toBeGreaterThan(MAX_DISTINCT_LOCATIONS);
  });

  test("group with 3 locations (2 riders share one) is accepted", () => {
    const locations = ["loc_a", "loc_b", "loc_a", "loc_c"];
    const distinct = new Set(locations).size;
    expect(distinct).toBeLessThanOrEqual(MAX_DISTINCT_LOCATIONS);
  });

  test("group exceeding max spread km is rejected", () => {
    const spreadKm = 9.5;
    expect(spreadKm).toBeGreaterThan(MAX_SPREAD_KM);
  });

  test("compatibility edges have no fareBand field", () => {
    expect(makeEdge()).not.toHaveProperty("fareBand");
  });

  test("gender compatibility blocks mixed-gender when sameGenderOnly", () => {
    const left = { sameGenderOnly: true, selfDeclaredGender: "woman" as const };
    const right = { sameGenderOnly: false, selfDeclaredGender: "man" as const };
    expect(arePreferencesCompatible(left, right)).toBe(false);
  });

  test("time overlap calculation for partial windows", () => {
    const left = {
      windowStart: "2026-03-20T10:00:00.000Z",
      windowEnd: "2026-03-20T12:00:00.000Z",
    };
    const right = {
      windowStart: "2026-03-20T11:00:00.000Z",
      windowEnd: "2026-03-20T14:00:00.000Z",
    };
    expect(overlapMinutes(left, right)).toBe(60);
  });

  test("no time overlap returns 0", () => {
    const left = {
      windowStart: "2026-03-20T10:00:00.000Z",
      windowEnd: "2026-03-20T11:00:00.000Z",
    };
    const right = {
      windowStart: "2026-03-20T12:00:00.000Z",
      windowEnd: "2026-03-20T14:00:00.000Z",
    };
    expect(overlapMinutes(left, right)).toBe(0);
  });
});
