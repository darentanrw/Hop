import { describe, expect, it } from "vitest";
import { computeSplitAmounts, getUnusedGroupTheme } from "../../lib/group-lifecycle";

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

  it("returns all zeros when the only member is the booker", () => {
    const map = computeSplitAmounts(100, [{ userId: "booker", partySize: 2 }], "booker");
    expect(map.get("booker")).toBe(0);
    expect(map.size).toBe(1);
  });

  it("total of all debts equals reimbursement pool (no rounding leak)", () => {
    const total = 1000;
    const map = computeSplitAmounts(
      total,
      [
        { userId: "booker", partySize: 1 },
        { userId: "a", partySize: 1 },
        { userId: "b", partySize: 2 },
      ],
      "booker",
    );
    const bookerShare = Math.floor((total * 1) / 4);
    const debtSum = (map.get("a") ?? 0) + (map.get("b") ?? 0);
    expect(debtSum).toBe(total - bookerShare);
  });

  it("handles zero total cost gracefully", () => {
    const map = computeSplitAmounts(
      0,
      [
        { userId: "booker", partySize: 1 },
        { userId: "a", partySize: 1 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect(map.get("a")).toBe(0);
  });

  it("booker with partySize 3 pays nothing and sole debtor covers the rest", () => {
    const map = computeSplitAmounts(
      100,
      [
        { userId: "booker", partySize: 3 },
        { userId: "rider", partySize: 1 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect(map.get("rider")).toBe(25);
  });

  it("equal party sizes produce equal split among debtors", () => {
    const map = computeSplitAmounts(
      120,
      [
        { userId: "booker", partySize: 2 },
        { userId: "a", partySize: 2 },
      ],
      "booker",
    );
    expect(map.get("booker")).toBe(0);
    expect(map.get("a")).toBe(60);
  });
});

describe("getUnusedGroupTheme", () => {
  it("does not reuse a color that is already claimed", () => {
    const usedColors = new Set(["#3b82f6", "#f97316", "#22c55e"]);

    const theme = getUnusedGroupTheme("sim-seed", usedColors);

    expect(theme.color).not.toBe("#3b82f6");
    expect(theme.color).not.toBe("#f97316");
    expect(theme.color).not.toBe("#22c55e");
    expect(usedColors.has(theme.color)).toBe(true);
  });
});
