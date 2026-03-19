import { arePreferencesCompatible, isAllowedUniversityEmail, overlapMinutes } from "@hop/shared";
import type { AvailabilityEntry } from "@hop/shared";
import { describe, expect, test } from "vitest";

function availability(overrides: Partial<AvailabilityEntry> = {}): AvailabilityEntry {
  return {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    windowStart: new Date("2026-03-20T10:00:00.000Z").toISOString(),
    windowEnd: new Date("2026-03-20T14:00:00.000Z").toISOString(),
    selfDeclaredGender: "woman",
    sameGenderOnly: false,
    sealedDestinationRef: "dest_1",
    routeDescriptorRef: "route_1",
    createdAt: new Date().toISOString(),
    status: "open",
    ...overrides,
  };
}

describe("validation", () => {
  test("allows NUS domains only", () => {
    expect(isAllowedUniversityEmail("student@u.nus.edu")).toBe(true);
    expect(isAllowedUniversityEmail("student@gmail.com")).toBe(false);
  });

  test("computes overlap in minutes", () => {
    const left = availability();
    const right = availability({
      windowStart: new Date("2026-03-20T12:00:00.000Z").toISOString(),
      windowEnd: new Date("2026-03-20T15:00:00.000Z").toISOString(),
    });

    expect(overlapMinutes(left, right)).toBe(120);
  });

  test("respects same-gender preference", () => {
    const left = availability({ sameGenderOnly: true, selfDeclaredGender: "woman" });
    const right = availability({ selfDeclaredGender: "man" });
    const compatible = arePreferencesCompatible(left, right);

    expect(compatible).toBe(false);
  });
});
