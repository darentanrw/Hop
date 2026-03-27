import { describe, expect, it } from "vitest";
import { pointerXToPartySize } from "../../lib/party-size-pointer";

describe("pointerXToPartySize", () => {
  const rect = { left: 100, width: 300 };

  it("maps the left edge of the track to party size 1", () => {
    expect(pointerXToPartySize(100, rect)).toBe(1);
  });

  it("maps the first third (inclusive of 1/3) to party size 1", () => {
    expect(pointerXToPartySize(100 + 300 / 3, rect)).toBe(1);
  });

  it("maps just past the first third to party size 2", () => {
    const xPastFirstThird = 100 + 300 / 3 + 1;
    expect(pointerXToPartySize(xPastFirstThird, rect)).toBe(2);
  });

  it("maps the middle of the track to party size 2", () => {
    expect(pointerXToPartySize(100 + 150, rect)).toBe(2);
  });

  it("maps two-thirds position (inclusive) to party size 2", () => {
    expect(pointerXToPartySize(100 + (2 * 300) / 3, rect)).toBe(2);
  });

  it("maps just past two-thirds to party size 3", () => {
    const x = 100 + (2 * 300) / 3 + 1;
    expect(pointerXToPartySize(x, rect)).toBe(3);
  });

  it("maps the right edge of the track to party size 3", () => {
    expect(pointerXToPartySize(400, rect)).toBe(3);
  });

  it("returns 1 when track width is zero or negative", () => {
    expect(pointerXToPartySize(50, { left: 0, width: 0 })).toBe(1);
    expect(pointerXToPartySize(50, { left: 0, width: -10 })).toBe(1);
  });

  it("allows clicks left of the track (t < 0) to map to 1", () => {
    expect(pointerXToPartySize(50, rect)).toBe(1);
  });

  it("maps clicks right of the track (t > 1) to party size 3", () => {
    expect(pointerXToPartySize(500, rect)).toBe(3);
  });
});
