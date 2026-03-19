import { describe, expect, test } from "vitest";
import { canViewGroupReceipt, canViewPaymentProof } from "../../lib/trip-receipts";

describe("trip receipt visibility", () => {
  test("lets current group members view the booker's fare receipt", () => {
    expect(canViewGroupReceipt({ isCurrentGroupMember: true })).toBe(true);
    expect(canViewGroupReceipt({ isCurrentGroupMember: false })).toBe(false);
  });

  test("lets the booker view a rider's payment proof", () => {
    expect(
      canViewPaymentProof({
        viewerUserId: "user-booker",
        bookerUserId: "user-booker",
        memberUserId: "user-rider",
      }),
    ).toBe(true);
  });

  test("lets a rider view their own payment proof", () => {
    expect(
      canViewPaymentProof({
        viewerUserId: "user-rider",
        bookerUserId: "user-booker",
        memberUserId: "user-rider",
      }),
    ).toBe(true);
  });

  test("blocks other riders from viewing someone else's payment proof", () => {
    expect(
      canViewPaymentProof({
        viewerUserId: "user-rider-b",
        bookerUserId: "user-booker",
        memberUserId: "user-rider-a",
      }),
    ).toBe(false);
  });
});
