import { describe, expect, it } from "vitest";
import { computeSplitAmounts } from "../../lib/group-lifecycle";

describe("computeSplitAmounts (party-weighted)", () => {
  it("splits reimbursement pool when every booking is party 1 (booker’s seat share excluded)", () => {
    const map = computeSplitAmounts(
      100,
      [
        { userId: "booker", partySize: 1 },
        { userId: "a", partySize: 1 },
        { userId: "b", partySize: 1 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect((map.get("a") ?? 0) + (map.get("b") ?? 0)).toBe(67);
    expect(new Set([map.get("a"), map.get("b")])).toEqual(new Set([33, 34]));
  });

  it("non-booker party of 3 reimburses all but the booker’s single seat share", () => {
    const map = computeSplitAmounts(
      100,
      [
        { userId: "booker", partySize: 1 },
        { userId: "big", partySize: 3 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect(map.get("big")).toBe(75);
  });

  it("splits reimbursement 1:3 between two non-booker accounts (5 seats total)", () => {
    const map = computeSplitAmounts(
      100,
      [
        { userId: "booker", partySize: 1 },
        { userId: "a", partySize: 1 },
        { userId: "b", partySize: 3 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect((map.get("a") ?? 0) + (map.get("b") ?? 0)).toBe(80);
    expect(map.get("a")).toBe(20);
    expect(map.get("b")).toBe(60);
  });
});
