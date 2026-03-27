import { describe, expect, test } from "vitest";
import {
  clampRange,
  formatRangeSummary,
  formatStoredMeetingTimeWithDate,
  formatStoredWindow,
  formatStoredWindowWithDate,
  slotFromPointerPosition,
  slotsToIsoRange,
  updateRangeForHandle,
} from "../../lib/time-range";

describe("time range utilities", () => {
  test("clamps to a one-hour minimum duration", () => {
    expect(clampRange(10, 11)).toEqual({ startSlot: 10, endSlot: 12 });
  });

  test("prevents the start handle from crossing the end handle", () => {
    expect(updateRangeForHandle("start", 18, { startSlot: 12, endSlot: 14 })).toEqual({
      startSlot: 18,
      endSlot: 20,
    });
  });

  test("converts date and slots into ISO timestamps", () => {
    const range = slotsToIsoRange("2026-03-20", 36, 40);

    expect(range.windowStart).toBe("2026-03-20T10:00:00.000Z");
    expect(range.windowEnd).toBe("2026-03-20T12:00:00.000Z");
  });

  test("maps pointer positions into snapped slots", () => {
    expect(slotFromPointerPosition(50, 0, 100)).toBe(24);
    expect(slotFromPointerPosition(0, 0, 100)).toBe(0);
    expect(slotFromPointerPosition(100, 0, 100)).toBe(48);
  });

  test("formats a readable summary", () => {
    expect(formatRangeSummary("2026-03-20", 36, 40)).toContain("Mar");
  });

  test("formats stored windows in Singapore time", () => {
    const formatted = formatStoredWindow("2026-03-20T10:00:00.000Z", "2026-03-20T12:00:00.000Z");

    expect(formatted).toContain("Fri");
    expect(formatted).toContain("6:00");
    expect(formatted).toContain("8:00");
  });

  test("formats stored windows with a full date for notifications", () => {
    const formatted = formatStoredWindowWithDate(
      "2026-03-20T10:00:00.000Z",
      "2026-03-20T12:00:00.000Z",
    );

    expect(formatted).toContain("Fri");
    expect(formatted).toContain("Mar");
    expect(formatted).toContain("20");
    expect(formatted).toContain("6:00");
    expect(formatted).toContain("8:00");
  });

  test("formats stored meeting times using the booking slot", () => {
    const formatted = formatStoredMeetingTimeWithDate("2026-03-19T21:03:55.000Z");

    expect(formatted).toContain("Fri");
    expect(formatted).toContain("Mar");
    expect(formatted).toContain("20");
    expect(formatted).toContain("5:00");
    expect(formatted).not.toContain("5:03");
  });
});
