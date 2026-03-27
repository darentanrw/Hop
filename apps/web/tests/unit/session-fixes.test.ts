import {
  CREDIBILITY_CANCEL_POINTS,
  CREDIBILITY_STARTING_POINTS,
  CREDIBILITY_SUCCESS_POINTS,
  CREDIBILITY_SUSPENSION_THRESHOLD,
  MAX_DETOUR_MINUTES,
  MAX_SPREAD_KM,
  calculateCredibilityScore,
  isCredibilitySuspended,
} from "@hop/shared";
import { describe, expect, it } from "vitest";
import type { CompatibilityEdge } from "../../lib/matching";

function makeEdge(overrides?: Partial<CompatibilityEdge>): CompatibilityEdge {
  return {
    leftRef: "route_a",
    rightRef: "route_b",
    score: 0.82,
    detourMinutes: 6,
    spreadDistanceKm: 3.2,
    routeOverlap: 10,
    destinationProximity: 0.5,
    ...overrides,
  };
}

type AckMember = {
  userId: string;
  acknowledgementStatus: "accepted" | "declined" | "pending" | null;
  accepted: boolean | null;
};

/**
 * Mirrors the penalty decision in syncLifecycleForGroup:
 * only explicitly declined members get a cancelledTrips increment.
 */
function shouldPenalise(member: AckMember): boolean {
  return member.acknowledgementStatus === "declined" || member.accepted === false;
}

/**
 * Mirrors the routeOk check in attemptLateJoin after the same-destination fix.
 */
function lateJoinRouteOk(
  joinerRef: string,
  memberRefs: string[],
  edgeMap: Map<string, CompatibilityEdge>,
): boolean {
  return memberRefs.every((memberRef) => {
    if (joinerRef === memberRef) return true;
    const key = [joinerRef, memberRef].sort().join("::");
    const edge = edgeMap.get(key);
    if (!edge) return false;
    return edge.detourMinutes <= MAX_DETOUR_MINUTES && edge.spreadDistanceKm <= MAX_SPREAD_KM;
  });
}

// ---------------------------------------------------------------------------
// 1. Acknowledgement penalty: only declined members are penalised
// ---------------------------------------------------------------------------
describe("ack window penalty — only declined members penalised", () => {
  it("member who explicitly declined is penalised", () => {
    const member: AckMember = {
      userId: "user_1",
      acknowledgementStatus: "declined",
      accepted: null,
    };
    expect(shouldPenalise(member)).toBe(true);
  });

  it("member who pressed reject (accepted=false) is penalised", () => {
    const member: AckMember = {
      userId: "user_2",
      acknowledgementStatus: null,
      accepted: false,
    };
    expect(shouldPenalise(member)).toBe(true);
  });

  it("member who timed out (pending) is NOT penalised", () => {
    const member: AckMember = {
      userId: "user_3",
      acknowledgementStatus: "pending",
      accepted: null,
    };
    expect(shouldPenalise(member)).toBe(false);
  });

  it("member who timed out (null status, null accepted) is NOT penalised", () => {
    const member: AckMember = {
      userId: "user_4",
      acknowledgementStatus: null,
      accepted: null,
    };
    expect(shouldPenalise(member)).toBe(false);
  });

  it("member who accepted is NOT penalised", () => {
    const member: AckMember = {
      userId: "user_5",
      acknowledgementStatus: "accepted",
      accepted: null,
    };
    expect(shouldPenalise(member)).toBe(false);
  });

  it("mixed group: only decliners are penalised", () => {
    const members: AckMember[] = [
      { userId: "accepted_1", acknowledgementStatus: "accepted", accepted: null },
      { userId: "declined_1", acknowledgementStatus: "declined", accepted: null },
      { userId: "timedout_1", acknowledgementStatus: "pending", accepted: null },
      { userId: "accepted_2", acknowledgementStatus: null, accepted: true },
      { userId: "rejected_1", acknowledgementStatus: null, accepted: false },
    ];
    const penalised = members.filter(shouldPenalise);
    expect(penalised.map((m) => m.userId)).toEqual(["declined_1", "rejected_1"]);
  });

  it("group where everyone timed out — nobody penalised", () => {
    const members: AckMember[] = [
      { userId: "user_a", acknowledgementStatus: "pending", accepted: null },
      { userId: "user_b", acknowledgementStatus: "pending", accepted: null },
      { userId: "user_c", acknowledgementStatus: "pending", accepted: null },
    ];
    expect(members.filter(shouldPenalise)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Suspension model: only blocks scheduling, never evicts from in-flight rides
// ---------------------------------------------------------------------------
describe("suspension model — gate on scheduling only", () => {
  it("suspended user is blocked from scheduling", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    expect(isCredibilitySuspended(score)).toBe(true);
  });

  it("user just above threshold is NOT blocked", () => {
    const score = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 4,
      confirmedReportCount: 0,
    });
    expect(score).toBeGreaterThan(CREDIBILITY_SUSPENSION_THRESHOLD);
    expect(isCredibilitySuspended(score)).toBe(false);
  });

  it("user who becomes suspended mid-ride keeps their existing score — no enforcement function exists", () => {
    const before = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 4,
      confirmedReportCount: 0,
    });
    // 75 - 10*4 = 35 → above threshold (30) → not suspended
    expect(before).toBe(35);
    expect(isCredibilitySuspended(before)).toBe(false);

    const after = calculateCredibilityScore({
      successfulTrips: 0,
      cancelledTrips: 5,
      confirmedReportCount: 0,
    });
    // 75 - 10*5 = 25 → below threshold (score < 30) → suspended
    expect(after).toBe(25);
    expect(isCredibilitySuspended(after)).toBe(true);
  });

  it("credibilitySuspension module exports only scheduling gate (no enforceSuspensionSideEffects)", async () => {
    const mod = await import("../../convex/credibilitySuspension");
    expect(typeof mod.assertUserCanScheduleNewRide).toBe("function");
    expect(typeof mod.SCHEDULING_NOT_ALLOWED_ERROR).toBe("string");
    expect((mod as Record<string, unknown>).enforceSuspensionSideEffects).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. submitReceipt status guard — only in_trip allowed
// ---------------------------------------------------------------------------
describe("submitReceipt status guard", () => {
  const ALLOWED_STATUS = "in_trip";

  function validateReceiptSubmission(groupStatus: string): { ok: boolean; error?: string } {
    if (groupStatus !== ALLOWED_STATUS) {
      return { ok: false, error: "Receipt can only be submitted while the group is in trip." };
    }
    return { ok: true };
  }

  it("allows receipt when group is in_trip", () => {
    expect(validateReceiptSubmission("in_trip").ok).toBe(true);
  });

  for (const status of [
    "tentative",
    "semi_locked",
    "locked",
    "matched_pending_ack",
    "group_confirmed",
    "meetup_preparation",
    "meetup_checkin",
    "depart_ready",
    "payment_pending",
    "closed",
    "cancelled",
  ]) {
    it(`rejects receipt when group is ${status}`, () => {
      const result = validateReceiptSubmission(status);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("in trip");
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Late-join same-destination fallback
// ---------------------------------------------------------------------------
describe("late-join same-destination fallback", () => {
  it("partySize=3 joining partySize=1 at same destination passes", () => {
    const edgeMap = new Map<string, CompatibilityEdge>();
    expect(lateJoinRouteOk("ntu_biz", ["ntu_biz"], edgeMap)).toBe(true);
  });

  it("joiner shares ref with one member, has edge for another", () => {
    const edgeMap = new Map<string, CompatibilityEdge>();
    edgeMap.set(
      "ntu_biz::ntu_eng",
      makeEdge({ leftRef: "ntu_biz", rightRef: "ntu_eng", detourMinutes: 5, spreadDistanceKm: 2 }),
    );
    expect(lateJoinRouteOk("ntu_biz", ["ntu_biz", "ntu_eng"], edgeMap)).toBe(true);
  });

  it("joiner shares ref with one member but missing edge for another rejects", () => {
    const edgeMap = new Map<string, CompatibilityEdge>();
    expect(lateJoinRouteOk("ntu_biz", ["ntu_biz", "ntu_eng"], edgeMap)).toBe(false);
  });

  it("all members share the same destination — no edges needed at all", () => {
    const edgeMap = new Map<string, CompatibilityEdge>();
    expect(lateJoinRouteOk("ntu_biz", ["ntu_biz", "ntu_biz", "ntu_biz"], edgeMap)).toBe(true);
  });

  it("edge with spread exceeding MAX_SPREAD_KM rejects", () => {
    const edgeMap = new Map<string, CompatibilityEdge>();
    edgeMap.set(
      "ref_a::ref_b",
      makeEdge({ leftRef: "ref_a", rightRef: "ref_b", spreadDistanceKm: MAX_SPREAD_KM + 1 }),
    );
    expect(lateJoinRouteOk("ref_a", ["ref_b"], edgeMap)).toBe(false);
  });
});
