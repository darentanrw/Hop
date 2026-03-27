import { describe, expect, test } from "vitest";
import {
  buildBookerChangedPushCopy,
  buildLateJoinPushCopy,
  buildLockedPushCopy,
  buildMatchedPushCopy,
  formatRideMeetingTimeForPush,
} from "../../lib/push-notification-copy";

const MEETING_TIME = "2026-03-19T21:03:55.000Z";

describe("push notification copy", () => {
  test("formats ride meeting times with date and the booking slot", () => {
    const label = formatRideMeetingTimeForPush(MEETING_TIME);

    expect(label).toContain("Fri");
    expect(label).toContain("Mar");
    expect(label).toContain("20");
    expect(label).toContain("5:00");
    expect(label).not.toContain("5:03");
  });

  test("uses the meeting time instead of the full ride window in match notifications", () => {
    const copy = buildMatchedPushCopy({
      meetingTime: MEETING_TIME,
      isFullGroup: false,
      isLastMinuteGroup: false,
      remainingSeats: 1,
      meetingLocationLabel: "NUS University Town Plaza",
    });

    expect(copy.title).toBe("Ride matched");
    expect(copy.body).toContain("Fri");
    expect(copy.body).toContain("5:00");
    expect(copy.body).not.toContain("5:03");
    expect(copy.body).toContain("1 more passenger");
  });

  test("keeps late-join notifications anonymous", () => {
    const copy = buildLateJoinPushCopy({
      meetingTime: MEETING_TIME,
    });

    expect(copy.title).toBe("Ride updated");
    expect(copy.body).toContain("Another rider joined");
    expect(copy.body).toContain("Fri");
  });

  test("keeps booker change notifications anonymous", () => {
    const copy = buildBookerChangedPushCopy({
      meetingTime: MEETING_TIME,
    });

    expect(copy.title).toBe("Ride updated");
    expect(copy.body).toContain("booker");
    expect(copy.body).toContain("has changed");
    expect(copy.body).toContain("Fri");
  });

  test("includes the ride meeting time when a ride is locked", () => {
    const copy = buildLockedPushCopy({
      meetingTime: MEETING_TIME,
    });

    expect(copy.title).toBe("Ride locked");
    expect(copy.body).toContain("Confirm your");
    expect(copy.body).toContain("Fri");
  });
});
