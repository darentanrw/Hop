import { describe, expect, test } from "vitest";
import {
  buildBookerChangedPushCopy,
  buildLateJoinPushCopy,
  buildLockedPushCopy,
  buildMatchedPushCopy,
  formatRideWindowForPush,
} from "../../lib/push-notification-copy";

const WINDOW_START = "2026-03-20T10:00:00.000Z";
const WINDOW_END = "2026-03-20T12:00:00.000Z";

describe("push notification copy", () => {
  test("formats ride windows with date and time", () => {
    const label = formatRideWindowForPush(WINDOW_START, WINDOW_END);

    expect(label).toContain("Fri");
    expect(label).toContain("Mar");
    expect(label).toContain("20");
    expect(label).toContain("6:00");
    expect(label).toContain("8:00");
  });

  test("uses the ride window instead of group names in match notifications", () => {
    const copy = buildMatchedPushCopy({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      isFullGroup: false,
      isLastMinuteGroup: false,
      remainingSeats: 1,
      meetingLocationLabel: "NUS University Town Plaza",
    });

    expect(copy.title).toBe("Ride matched");
    expect(copy.body).toContain("Fri");
    expect(copy.body).toContain("6:00");
    expect(copy.body).toContain("1 more passenger");
  });

  test("keeps late-join notifications anonymous", () => {
    const copy = buildLateJoinPushCopy({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(copy.title).toBe("Ride updated");
    expect(copy.body).toContain("Another rider joined");
    expect(copy.body).toContain("Fri");
  });

  test("keeps booker change notifications anonymous", () => {
    const copy = buildBookerChangedPushCopy({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(copy.title).toBe("Ride updated");
    expect(copy.body).toContain("booker");
    expect(copy.body).toContain("has changed");
    expect(copy.body).toContain("Fri");
  });

  test("includes the ride window when a ride is locked", () => {
    const copy = buildLockedPushCopy({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(copy.title).toBe("Ride locked");
    expect(copy.body).toContain("Confirm your");
    expect(copy.body).toContain("Fri");
  });
});
