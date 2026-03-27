import {
  MAX_PARTY_SIZE,
  clampPartySize,
  groupPassengerSeatTotal,
  sumPartySizes,
} from "@hop/shared";
import { describe, expect, it } from "vitest";

describe("clampPartySize", () => {
  it("defaults invalid input to 1", () => {
    expect(clampPartySize(undefined)).toBe(1);
    expect(clampPartySize(null)).toBe(1);
    expect(clampPartySize("2")).toBe(1);
    expect(clampPartySize(Number.NaN)).toBe(1);
  });

  it("clamps below 1 up to 1", () => {
    expect(clampPartySize(0)).toBe(1);
    expect(clampPartySize(-5)).toBe(1);
  });

  it("clamps above MAX_PARTY_SIZE down", () => {
    expect(clampPartySize(4)).toBe(MAX_PARTY_SIZE);
    expect(clampPartySize(99)).toBe(MAX_PARTY_SIZE);
  });

  it("floors non-integers into range", () => {
    expect(clampPartySize(2.9)).toBe(2);
    expect(clampPartySize(1.1)).toBe(1);
  });

  it("accepts 1, 2, 3", () => {
    expect(clampPartySize(1)).toBe(1);
    expect(clampPartySize(2)).toBe(2);
    expect(clampPartySize(3)).toBe(3);
  });
});

describe("sumPartySizes", () => {
  it("treats missing partySize as 1", () => {
    expect(sumPartySizes([{}, {}])).toBe(2);
    expect(sumPartySizes([{ partySize: undefined }])).toBe(1);
  });

  it("sums explicit party sizes", () => {
    expect(sumPartySizes([{ partySize: 2 }, { partySize: 3 }])).toBe(5);
    expect(sumPartySizes([{ partySize: 1 }, { partySize: 1 }, { partySize: 2 }])).toBe(4);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPartySizes([])).toBe(0);
  });
});

describe("groupPassengerSeatTotal", () => {
  it("prefers stored passengerSeatTotal when present", () => {
    expect(
      groupPassengerSeatTotal({ groupSize: 2, passengerSeatTotal: 4 }, [{ partySize: 1 }]),
    ).toBe(4);
  });

  it("sums member party sizes when passengerSeatTotal is absent", () => {
    expect(groupPassengerSeatTotal({ groupSize: 3 }, [{ partySize: 2 }, { partySize: 1 }])).toBe(3);
  });

  it("falls back to groupSize when member sum is zero", () => {
    expect(groupPassengerSeatTotal({ groupSize: 3 }, [])).toBe(3);
  });

  it("treats explicit undefined passengerSeatTotal same as absent", () => {
    expect(
      groupPassengerSeatTotal({ groupSize: 2, passengerSeatTotal: undefined }, [
        { partySize: 3 },
        { partySize: 1 },
      ]),
    ).toBe(4);
  });

  it("treats null passengerSeatTotal same as absent", () => {
    expect(
      groupPassengerSeatTotal({ groupSize: 2, passengerSeatTotal: null }, [
        { partySize: 2 },
        { partySize: 2 },
      ]),
    ).toBe(4);
  });

  it("returns 0 passengerSeatTotal when stored as 0 (trusts the stored value)", () => {
    expect(
      groupPassengerSeatTotal({ groupSize: 2, passengerSeatTotal: 0 }, [{ partySize: 1 }]),
    ).toBe(0);
  });
});
