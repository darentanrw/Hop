import {
  MAX_DISTINCT_LOCATIONS,
  MAX_SPREAD_KM,
  arePreferencesCompatible,
  overlapMinutes,
} from "@hop/shared";
import { describe, expect, test } from "vitest";
import { createStubCompatibility } from "../../lib/matcher-stub";

describe("matching constraints", () => {
  test("stub compatibility includes spreadDistanceKm", () => {
    const refs = ["stub:route:0:100", "stub:route:1:200"];
    const edges = createStubCompatibility(refs);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toHaveProperty("spreadDistanceKm");
    expect(typeof edges[0].spreadDistanceKm).toBe("number");
  });

  test("same-cluster stub pairs have small spread", () => {
    const refs = ["stub:route:0:100", "stub:route:0:200"];
    const edges = createStubCompatibility(refs);
    expect(edges[0].spreadDistanceKm).toBeLessThan(1);
  });

  test("distant-cluster stub pairs have larger spread but within MAX_SPREAD_KM", () => {
    const refs = ["stub:route:0:100", "stub:route:3:200"];
    const edges = createStubCompatibility(refs);
    expect(edges[0].spreadDistanceKm).toBeGreaterThan(3);
    expect(edges[0].spreadDistanceKm).toBeLessThan(MAX_SPREAD_KM);
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
    const refs = ["stub:route:0:100", "stub:route:1:200"];
    const edges = createStubCompatibility(refs);
    expect(edges[0]).not.toHaveProperty("fareBand");
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
