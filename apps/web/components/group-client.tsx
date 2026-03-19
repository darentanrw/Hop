"use client";

import { MAX_GROUP_SIZE } from "@hop/shared";
import { useMutation, useQuery } from "convex/react";
import QrScanner from "qr-scanner";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Countdown } from "./countdown";

type ActiveTripPayload = {
  group: {
    id: string;
    status: string;
    pickupLabel: string;
    windowStart: string;
    windowEnd: string;
    groupSize: number;
    maxDetourMinutes: number;
    confirmationDeadline: string;
    meetingTime: string;
    meetingLocationLabel: string;
    graceDeadline: string;
    groupName: string;
    groupColor: string;
    bookerUserId: string | null;
    suggestedDropoffOrder: string[];
    finalCostCents: number | null;
    receiptSubmittedAt: string | null;
    paymentDueAt: string | null;
    reportCount: number;
  };
  currentUserId: string;
  currentUserMember: {
    userId: string;
    displayName: string;
    emoji: string;
    destinationLockedAt: string | null;
    qrToken: string | null;
    amountDueCents: number;
    paymentStatus: string;
  } | null;
  members: Array<{
    userId: string;
    displayName: string;
    emoji: string;
    acknowledgementStatus: string;
    participationStatus: string;
    checkedInAt: string | null;
    checkedInByUserId: string | null;
    destinationLockedAt: string | null;
    dropoffOrder: number | null;
    amountDueCents: number;
    paymentStatus: string;
    paymentSubmittedAt: string | null;
    paymentVerifiedAt: string | null;
    isBooker: boolean;
  }>;
  stats: {
    activeMemberCount: number;
    checkedInCount: number;
    destinationCount: number;
    outstandingPaymentCount: number;
  };
  dropoffPreview: Array<{
    userId: string;
    emoji: string;
    order: number | null;
  }>;
  actions: {
    canAcknowledge: boolean;
    canSubmitDestination: boolean;
    canShowQr: boolean;
    canScanQr: boolean;
    canStartCheckIn: boolean;
    canDepart: boolean;
    canUploadReceipt: boolean;
    canSubmitPaymentProof: boolean;
    canVerifyPayments: boolean;
    canReport: boolean;
  };
};

type StatusMessage = { type: "info" | "error" | "success"; text: string } | null;

const SCAN_DEBOUNCE_MS = 2_500;

function formatCurrency(cents: number | null) {
  if (cents === null) return "Pending";
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function friendlyStatus(status: string): string {
  const map: Record<string, string> = {
    tentative: "Forming",
    semi_locked: "Open to joiners",
    locked: "Locked",
    matched_pending_ack: "Confirming",
    acknowledged: "Confirmed",
    group_confirmed: "Confirmed",
    meetup_preparation: "Meetup prep",
    meetup_checkin: "Meeting up",
    depart_ready: "Ready to go",
    in_trip: "En route",
    receipt_pending: "Awaiting receipt",
    payment_pending: "Settling up",
    closed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberBadge(member: ActiveTripPayload["members"][number]) {
  if (member.participationStatus !== "active") {
    return { label: "Removed", pillClass: "pill-danger" };
  }
  if (member.paymentStatus === "verified") {
    return { label: "Paid", pillClass: "pill-success" };
  }
  if (member.paymentStatus === "submitted") {
    return { label: "Proof sent", pillClass: "pill-accent" };
  }
  if (member.checkedInAt) {
    return { label: "Checked in", pillClass: "pill-success" };
  }
  if (member.acknowledgementStatus === "accepted") {
    return { label: "Confirmed", pillClass: "pill-success" };
  }
  if (member.acknowledgementStatus === "declined") {
    return { label: "Declined", pillClass: "pill-danger" };
  }
  if (member.acknowledgementStatus === "timed_out") {
    return { label: "Timed out", pillClass: "pill-danger" };
  }
  return { label: "Pending", pillClass: "pill-muted" };
}

async function uploadFile(
  file: File,
  generateUploadUrl: (args: Record<string, never>) => Promise<string>,
) {
  const uploadUrl = await generateUploadUrl({});
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Could not upload the file.");
  }

  const payload = (await response.json()) as { storageId?: Id<"_storage"> };
  if (!payload.storageId) {
    throw new Error("The upload did not return a storage id.");
  }

  return payload.storageId;
}

export function GroupClient({
  initialGroup,
  qaActingUserId,
}: {
  initialGroup: ActiveTripPayload | null;
  qaActingUserId?: string;
}) {
  const qaArgs = useMemo(
    () =>
      qaActingUserId
        ? {
            actingUserId: qaActingUserId as Id<"users">,
          }
        : {},
    [qaActingUserId],
  );
  const liveGroup = useQuery(api.trips.getActiveTrip, qaArgs);
  const qaViewPending = Boolean(qaActingUserId) && liveGroup === undefined;
  const group = qaActingUserId
    ? (liveGroup ?? null)
    : liveGroup === undefined
      ? initialGroup
      : liveGroup;

  const syncLifecycle = useMutation(api.trips.advanceCurrentGroupLifecycle);
  const updateAcknowledgement = useMutation(api.mutations.updateAcknowledgement);
  const startMeetupCheckIn = useMutation(api.trips.startMeetupCheckIn);
  const scanGroupQrToken = useMutation(api.trips.scanGroupQrToken);
  const departGroup = useMutation(api.trips.departGroup);
  const generateUploadUrl = useMutation(api.trips.generateUploadUrl);
  const submitReceipt = useMutation(api.trips.submitReceipt);
  const submitPaymentProof = useMutation(api.trips.submitPaymentProof);
  const verifyPayment = useMutation(api.trips.verifyPayment);
  const createReport = useMutation(api.trips.createReport);

  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);
  const [scanToken, setScanToken] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerState, setScannerState] = useState<"idle" | "starting" | "live">("idle");
  const [scannerStatus, setScannerStatus] = useState<StatusMessage>(null);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerFlashKey, setScannerFlashKey] = useState(0);
  const [scannerFlashActive, setScannerFlashActive] = useState(false);
  const [receiptTotal, setReceiptTotal] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [reportCategory, setReportCategory] = useState("non_payment");
  const [reportDescription, setReportDescription] = useState("");
  const [reportedUserId, setReportedUserId] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const scannerBusyRef = useRef(false);
  const lastScannedTokenRef = useRef<string | null>(null);
  const lastScannedAtRef = useRef(0);
  const groupRef = useRef(group);
  const qaArgsRef = useRef(qaArgs);
  const scannerFlashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    void syncLifecycle(qaArgs);
    const interval = window.setInterval(() => {
      void syncLifecycle(qaArgs);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [qaArgs, syncLifecycle]);

  useEffect(() => {
    if (!group?.actions.canShowQr || !group.currentUserMember?.qrToken) {
      setQrCode("");
      return;
    }

    void QRCode.toDataURL(group.currentUserMember.qrToken, {
      margin: 1,
      width: 240,
      color: {
        dark: group.group.groupColor,
        light: "#ffffff",
      },
    }).then(setQrCode);
  }, [group]);

  useEffect(() => {
    groupRef.current = group;
  }, [group]);

  useEffect(() => {
    qaArgsRef.current = qaArgs;
  }, [qaArgs]);

  const activeMembers = useMemo(
    () => group?.members.filter((member) => member.participationStatus === "active") ?? [],
    [group],
  );

  const resetScannerFlash = useCallback(() => {
    if (scannerFlashTimeoutRef.current !== null) {
      window.clearTimeout(scannerFlashTimeoutRef.current);
      scannerFlashTimeoutRef.current = null;
    }
    setScannerFlashActive(false);
  }, []);

  const triggerScannerSuccessFlash = useCallback(() => {
    if (scannerFlashTimeoutRef.current !== null) {
      window.clearTimeout(scannerFlashTimeoutRef.current);
    }

    setScannerFlashKey((current) => current + 1);
    setScannerFlashActive(true);
    scannerFlashTimeoutRef.current = window.setTimeout(() => {
      setScannerFlashActive(false);
      scannerFlashTimeoutRef.current = null;
    }, 720);
  }, []);

  const stopLiveScanner = useCallback(() => {
    resetScannerFlash();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    scannerBusyRef.current = false;
    setScannerBusy(false);
    setScannerOpen(false);
    setScannerState("idle");
  }, [resetScannerFlash]);

  async function runAction(task: () => Promise<void>) {
    setBusy(true);
    setStatus(null);

    try {
      await task();
      await syncLifecycle(qaArgs);
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!group?.actions.canScanQr && scannerOpen) {
      stopLiveScanner();
    }
  }, [group?.actions.canScanQr, scannerOpen, stopLiveScanner]);

  useEffect(() => {
    return () => {
      if (scannerFlashTimeoutRef.current !== null) {
        window.clearTimeout(scannerFlashTimeoutRef.current);
      }
      scannerRef.current?.destroy();
    };
  }, []);

  const submitScannedQrToken = useCallback(
    async (rawValue: string) => {
      const currentGroup = groupRef.current;
      if (!currentGroup) return false;

      const currentQaArgs = qaArgsRef.current;

      const trimmedValue = rawValue.trim();
      if (!trimmedValue) return false;

      const now = Date.now();
      if (
        scannerBusyRef.current ||
        (lastScannedTokenRef.current === trimmedValue &&
          now - lastScannedAtRef.current < SCAN_DEBOUNCE_MS)
      ) {
        return false;
      }

      scannerBusyRef.current = true;
      setScannerBusy(true);
      lastScannedTokenRef.current = trimmedValue;
      lastScannedAtRef.current = now;
      setScanToken(trimmedValue);
      setScannerStatus({ type: "info", text: "QR detected. Verifying…" });

      try {
        await scanGroupQrToken({
          groupId: currentGroup.group.id as Id<"groups">,
          qrToken: trimmedValue,
          ...currentQaArgs,
        });
        await syncLifecycle(currentQaArgs);
        setScannerStatus({ type: "success", text: "Checked in successfully." });
        triggerScannerSuccessFlash();
        return true;
      } catch (error) {
        setScannerStatus({
          type: "error",
          text: error instanceof Error ? error.message : "Could not verify that rider.",
        });
        return false;
      } finally {
        scannerBusyRef.current = false;
        setScannerBusy(false);
      }
    },
    [scanGroupQrToken, syncLifecycle, triggerScannerSuccessFlash],
  );

  const submitScannedQrTokenRef = useRef(submitScannedQrToken);

  useEffect(() => {
    submitScannedQrTokenRef.current = submitScannedQrToken;
  }, [submitScannedQrToken]);

  const startLiveScanner = useCallback(() => {
    if (scannerOpen) return;
    resetScannerFlash();
    setScannerStatus(null);
    setScannerOpen(true);
    setScannerState("starting");
  }, [resetScannerFlash, scannerOpen]);

  useEffect(() => {
    if (!scannerOpen || !group?.actions.canScanQr || !videoRef.current) {
      return;
    }

    let cancelled = false;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        void submitScannedQrTokenRef.current(result.data);
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 12,
        returnDetailedScanResult: true,
      },
    );
    scannerRef.current = scanner;

    void scanner
      .start()
      .then(() => {
        if (cancelled) {
          scanner.destroy();
          return;
        }
        setScannerState("live");
        setScannerStatus({
          type: "info",
          text: "Scanner is on. Point at each rider's QR code.",
        });
      })
      .catch((error) => {
        if (scannerRef.current === scanner) {
          scannerRef.current = null;
        }
        scanner.destroy();
        if (cancelled) {
          return;
        }
        setScannerOpen(false);
        setScannerState("idle");
        setScannerStatus({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Camera access was blocked. Paste the rider token instead.",
        });
      });

    return () => {
      cancelled = true;
      if (scannerRef.current === scanner) {
        scannerRef.current = null;
      }
      scanner.destroy();
    };
  }, [group?.actions.canScanQr, scannerOpen]);

  if (!group) {
    if (qaViewPending) {
      return (
        <div className="empty-state" style={{ animation: "fadeUp 0.5s var(--ease-out-expo) both" }}>
          <div className="empty-state-icon">🪪</div>
          <h3>Switching QA view</h3>
          <p className="text-muted">Loading this group as the selected rider.</p>
        </div>
      );
    }

    return (
      <div className="empty-state" style={{ animation: "fadeUp 0.5s var(--ease-out-expo) both" }}>
        <div className="empty-state-icon">🚕</div>
        <h3>No active ride yet</h3>
        <p className="text-muted">Set your availability and Hop will match you with a group.</p>
      </div>
    );
  }

  const currentUserIsBooker = group.group.bookerUserId === group.currentUserId;
  const showDepartCard =
    currentUserIsBooker &&
    (group.group.status === "meetup_checkin" || group.group.status === "depart_ready");

  const bookerEmoji =
    group.members.find((m) => m.userId === group.group.bookerUserId)?.emoji ?? "🙂";

  return (
    <div className="stack stagger">
      {qaActingUserId ? (
        <div className="notice notice-info qa-view-banner">
          Viewing this QA group as {group.currentUserMember?.emoji ?? "🙂"}{" "}
          {group.currentUserMember?.displayName ?? "this rider"}.
        </div>
      ) : null}

      {/* ── Hero Card ── */}
      <div
        className="card group-hero-card"
        style={{
          border: `1px solid ${group.group.groupColor}33`,
          boxShadow: `0 10px 36px ${group.group.groupColor}1a`,
        }}
      >
        {/* Group name + status */}
        <div className="row-between" style={{ marginBottom: 20 }}>
          <span
            className="pill pill-sm"
            style={{
              background: `${group.group.groupColor}22`,
              color: group.group.groupColor,
              border: `1px solid ${group.group.groupColor}44`,
            }}
          >
            {group.group.groupName}
          </span>
          <span className="pill pill-muted pill-sm">{friendlyStatus(group.group.status)}</span>
        </div>

        {/* My identity */}
        <div className="group-identity-row">
          <div className="group-my-emoji">{group.currentUserMember?.emoji ?? "🙂"}</div>
          <div className="group-identity-labels">
            <span className="group-identity-you">You</span>
            <span className="group-identity-role">{currentUserIsBooker ? "Booker" : "Rider"}</span>
          </div>
          {!currentUserIsBooker && (
            <div className="group-booker-hint">
              <span className="group-booker-label">Booker</span>
              <span className="group-booker-emoji">{bookerEmoji}</span>
            </div>
          )}
        </div>

        <div className="divider" style={{ margin: "16px 0" }} />

        {/* Logistics */}
        <div className="group-logistics">
          <div className="group-logistics-row">
            <span className="group-logistics-icon">📍</span>
            <div>
              <div className="group-logistics-label">Meet at</div>
              <div className="group-logistics-value">{group.group.meetingLocationLabel}</div>
            </div>
          </div>
          <div className="group-logistics-row">
            <span className="group-logistics-icon">🕐</span>
            <div>
              <div className="group-logistics-label">Time</div>
              <div className="group-logistics-value">{formatDateTime(group.group.meetingTime)}</div>
            </div>
          </div>
          <div className="group-logistics-row">
            <span className="group-logistics-icon">🏁</span>
            <div>
              <div className="group-logistics-label">Destination</div>
              <div className="group-logistics-value">{group.group.pickupLabel}</div>
            </div>
          </div>
          <div className="group-logistics-row">
            <span className="group-logistics-icon">💰</span>
            <div>
              <div className="group-logistics-label">Fare</div>
              <div className="group-logistics-value">
                {group.group.finalCostCents !== null
                  ? formatCurrency(group.group.finalCostCents)
                  : "TBD after trip"}
              </div>
            </div>
          </div>
        </div>

        {/* Countdown rows */}
        {group.group.status === "matched_pending_ack" ? (
          <div className="group-countdown-row">
            <span className="text-sm text-muted">Confirm by</span>
            <Countdown deadline={group.group.confirmationDeadline} />
          </div>
        ) : null}
        {(group.group.status === "meetup_checkin" || group.group.status === "depart_ready") &&
        group.group.graceDeadline ? (
          <div className="group-countdown-row">
            <span className="text-sm text-muted">Departs in</span>
            <Countdown deadline={group.group.graceDeadline} />
          </div>
        ) : null}
        {group.group.status === "payment_pending" && group.group.paymentDueAt ? (
          <div className="group-countdown-row">
            <span className="text-sm text-muted">Pay by</span>
            <Countdown deadline={group.group.paymentDueAt} />
          </div>
        ) : null}
      </div>

      {/* ── Forming banner (tentative — rolling matching) ── */}
      {group.group.status === "tentative" ? (() => {
        const spotsLeft = MAX_GROUP_SIZE - group.stats.activeMemberCount;
        return (
          <div
            className="card"
            style={{
              background: `${group.group.groupColor}0d`,
              border: `1px solid ${group.group.groupColor}33`,
              textAlign: "center",
              padding: "20px 16px",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>
              {Array.from({ length: group.stats.activeMemberCount }, (_, i) =>
                group.members[i]?.emoji ?? "🙂",
              ).join(" ")}
              {spotsLeft > 0
                ? ` ${"⬜ ".repeat(spotsLeft).trim()}`
                : ""}
            </div>
            <h3 style={{ marginBottom: 4 }}>
              {group.stats.activeMemberCount} rider{group.stats.activeMemberCount > 1 ? "s" : ""} matched
            </h3>
            <p className="text-sm text-muted" style={{ maxWidth: 280, margin: "0 auto" }}>
              {spotsLeft > 0
                ? `Looking for up to ${spotsLeft} more rider${spotsLeft > 1 ? "s" : ""} with nearby destinations. The group locks 3 h before departure.`
                : "Group is full and will lock in soon."}
            </p>
          </div>
        );
      })() : null}

      {/* ── Semi-locked banner (T-3h lock — open to late joiners) ── */}
      {group.group.status === "semi_locked" ? (() => {
        const spotsLeft = MAX_GROUP_SIZE - group.stats.activeMemberCount;
        return (
          <div
            className="card"
            style={{
              background: `${group.group.groupColor}0d`,
              border: `1px solid ${group.group.groupColor}33`,
              textAlign: "center",
              padding: "20px 16px",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>
              {Array.from({ length: group.stats.activeMemberCount }, (_, i) =>
                group.members[i]?.emoji ?? "🙂",
              ).join(" ")}
              {spotsLeft > 0
                ? ` ${"⬜ ".repeat(spotsLeft).trim()}`
                : ""}
            </div>
            <h3 style={{ marginBottom: 4 }}>
              Open to +{spotsLeft}
            </h3>
            <p className="text-sm text-muted" style={{ maxWidth: 280, margin: "0 auto" }}>
              {group.stats.activeMemberCount} riders matched. New riders can join until 30 min before departure.
            </p>
          </div>
        );
      })() : null}

      {/* ── Locked banner (legacy fallback) ── */}
      {group.group.status === "locked" ? (
        <div className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
          <h3 style={{ marginBottom: 4 }}>Group locked</h3>
          <p className="text-sm text-muted" style={{ maxWidth: 280, margin: "0 auto" }}>
            {group.stats.activeMemberCount} riders confirmed. Waiting for the ride to be finalized.
          </p>
        </div>
      ) : null}

      {/* ── Rider QR code ── */}
      {group.actions.canShowQr && group.currentUserMember?.qrToken ? (
        <div className="card stack-sm" style={{ alignItems: "center", textAlign: "center" }}>
          <h3>Your check-in QR</h3>
          <p className="text-sm text-muted">Show this to the booker when you arrive.</p>
          {qrCode ? (
            <img src={qrCode} alt="Your check-in QR code" width={220} height={220} />
          ) : null}
          <div className="notice notice-info backup-code-notice" style={{ width: "100%" }}>
            Backup code:{" "}
            <code className="inline-token-code">{group.currentUserMember.qrToken}</code>
          </div>
        </div>
      ) : null}

      {/* ── Riders Card ── */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h3>Riders</h3>
          <span className="text-sm text-muted">
            {group.stats.checkedInCount}/{group.stats.activeMemberCount} checked in
          </span>
        </div>
        <div className="stack-sm">
          {group.members.map((member, index) => {
            const badge = memberBadge(member);
            const isMe = member.userId === group.currentUserId;
            return (
              <div className="member-item" key={member.userId}>
                <div className={`rider-avatar rider-avatar-${index % 4}`}>{member.emoji}</div>
                <div className="member-info">
                  <div className="member-name">
                    {member.displayName}
                    <span className="text-muted" style={{ fontWeight: 500 }}>
                      {" "}
                      · {member.isBooker ? "Booker" : "Rider"}
                    </span>
                    {isMe ? " · You" : ""}
                  </div>
                </div>
                <span className={`pill pill-sm ${badge.pillClass}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Confirm / Decline ── */}
      {group.actions.canAcknowledge ? (
        <div className="row" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await updateAcknowledgement({
                  groupId: group.group.id as Id<"groups">,
                  accepted: true,
                  ...qaArgs,
                });
                setStatus({ type: "success", text: "You're confirmed for this ride." });
              })
            }
          >
            Confirm
          </button>
          <button
            type="button"
            className="btn btn-danger"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await updateAcknowledgement({
                  groupId: group.group.id as Id<"groups">,
                  accepted: false,
                  ...qaArgs,
                });
                setStatus({ type: "info", text: "You've declined this ride." });
              })
            }
          >
            Decline
          </button>
        </div>
      ) : null}

      {/* ── Drop-off order preview ── */}
      {group.dropoffPreview.length > 0 ? (
        <div className="card stack-sm">
          <h3>Drop-off order</h3>
          <div className="stack-sm">
            {group.dropoffPreview.map((member) => (
              <div className="row-between" key={member.userId}>
                <span>
                  {member.order}. {member.emoji}
                </span>
                <span className="text-sm text-muted">Drop-off</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Start check-in (booker) ── */}
      {group.actions.canStartCheckIn ? (
        <div className="card stack-sm">
          <h3>Start check-in</h3>
          <p className="text-sm text-muted">
            Once everyone is at {group.group.meetingLocationLabel}, tap below to open check-in and
            scan each rider.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await startMeetupCheckIn({
                  groupId: group.group.id as Id<"groups">,
                  ...qaArgs,
                });
                setStatus({ type: "success", text: "Check-in is open." });
              })
            }
          >
            Start check-in
          </button>
        </div>
      ) : null}

      {/* ── Scan rider QR (booker) ── */}
      {group.actions.canScanQr ? (
        <div className="card stack-sm">
          <h3>Scan riders</h3>
          <p className="text-sm text-muted">
            Point your camera at each rider's QR, or paste their code below.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || scannerBusy || scannerState === "starting"}
              onClick={startLiveScanner}
            >
              {scannerState === "live"
                ? "Scanner on"
                : scannerState === "starting"
                  ? "Opening camera…"
                  : "Open camera"}
            </button>
            {scannerState === "live" ? (
              <button type="button" className="btn btn-secondary" onClick={() => stopLiveScanner()}>
                Stop
              </button>
            ) : null}
          </div>
          {scannerOpen ? (
            <div className="scanner-shell">
              <video ref={videoRef} className="scanner-preview" autoPlay muted playsInline />
              <div
                key={scannerFlashKey}
                className={`scanner-overlay ${scannerFlashActive ? "scanner-overlay-success" : ""}`}
                aria-hidden="true"
              >
                <div
                  className={`scanner-frame ${scannerFlashActive ? "scanner-frame-success" : ""}`}
                />
              </div>
            </div>
          ) : null}
          {scannerStatus ? (
            <div
              className={`notice ${
                scannerStatus.type === "error"
                  ? "notice-error"
                  : scannerStatus.type === "success"
                    ? "notice-success"
                    : "notice-info"
              }`}
            >
              {scannerStatus.text}
            </div>
          ) : null}
          <input
            type="text"
            value={scanToken}
            onChange={(event) => setScanToken(event.target.value)}
            placeholder="Paste rider code"
          />
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={busy || scannerBusy || scanToken.trim().length < 6}
            onClick={async () => {
              const checkedIn = await submitScannedQrToken(scanToken);
              if (checkedIn) {
                setScanToken("");
              }
            }}
          >
            Check in rider
          </button>
        </div>
      ) : null}

      {/* ── Depart (booker) ── */}
      {showDepartCard ? (
        <div className="card stack-sm">
          <h3>Depart</h3>
          <p className="text-sm text-muted">
            Once the grace period ends or everyone is checked in, you can depart. Riders who haven't
            checked in will be removed.
          </p>
          {!group.actions.canDepart ? (
            <div className="text-sm text-muted">
              Waiting for all riders or the grace window to end.
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !group.actions.canDepart}
            onClick={() =>
              runAction(async () => {
                await departGroup({ groupId: group.group.id as Id<"groups">, ...qaArgs });
                setStatus({ type: "success", text: "Departed. Safe travels!" });
              })
            }
          >
            Depart now
          </button>
        </div>
      ) : null}

      {/* ── Upload receipt (booker) ── */}
      {group.actions.canUploadReceipt ? (
        <div className="card stack-sm">
          <h3>Upload receipt</h3>
          <p className="text-sm text-muted">
            Enter the final fare and attach a photo of the receipt. Hop will split it automatically.
          </p>
          <input
            type="number"
            min="0"
            step="0.01"
            value={receiptTotal}
            onChange={(event) => setReceiptTotal(event.target.value)}
            placeholder="Total fare (e.g. 24.80)"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !receiptFile || Number(receiptTotal) <= 0}
            onClick={() =>
              runAction(async () => {
                if (!receiptFile) {
                  throw new Error("Attach the receipt photo first.");
                }
                const storageId = await uploadFile(receiptFile, generateUploadUrl);
                await submitReceipt({
                  groupId: group.group.id as Id<"groups">,
                  totalCostCents: Math.round(Number(receiptTotal) * 100),
                  storageId,
                  ...qaArgs,
                });
                setReceiptFile(null);
                setReceiptTotal("");
                setStatus({ type: "success", text: "Receipt uploaded. Shares calculated." });
              })
            }
          >
            Submit receipt
          </button>
        </div>
      ) : null}

      {/* ── Submit payment proof (rider) ── */}
      {group.actions.canSubmitPaymentProof ? (
        <div className="card stack-sm">
          <h3>Pay your share</h3>
          <p className="text-sm text-muted">
            You owe {formatCurrency(group.currentUserMember?.amountDueCents ?? 0)}. Transfer to the
            booker and upload a screenshot.
          </p>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setPaymentFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !paymentFile}
            onClick={() =>
              runAction(async () => {
                if (!paymentFile) {
                  throw new Error("Attach your payment screenshot first.");
                }
                const storageId = await uploadFile(paymentFile, generateUploadUrl);
                await submitPaymentProof({
                  groupId: group.group.id as Id<"groups">,
                  storageId,
                  ...qaArgs,
                });
                setPaymentFile(null);
                setStatus({
                  type: "success",
                  text: "Payment submitted. Waiting for confirmation.",
                });
              })
            }
          >
            Upload payment proof
          </button>
        </div>
      ) : null}

      {/* ── Verify payments (booker) ── */}
      {group.actions.canVerifyPayments ? (
        <div className="card stack-sm">
          <h3>Verify payments</h3>
          <div className="stack-sm">
            {activeMembers
              .filter((member) => !member.isBooker && member.amountDueCents > 0)
              .map((member) => (
                <div className="row-between" key={`payment-${member.userId}`}>
                  <div>
                    <div className="member-name">
                      {member.emoji} owes {formatCurrency(member.amountDueCents)}
                    </div>
                    <div className="text-xs text-muted">
                      {member.paymentStatus === "submitted"
                        ? "Proof uploaded — tap to confirm."
                        : member.paymentStatus === "verified"
                          ? "Payment confirmed."
                          : "Waiting for payment."}
                    </div>
                  </div>
                  {member.paymentStatus === "submitted" ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          await verifyPayment({
                            groupId: group.group.id as Id<"groups">,
                            memberUserId: member.userId,
                            ...qaArgs,
                          });
                          setStatus({ type: "success", text: "Payment confirmed." });
                        })
                      }
                    >
                      Confirm
                    </button>
                  ) : (
                    <span
                      className={`pill pill-sm ${member.paymentStatus === "verified" ? "pill-success" : "pill-muted"}`}
                    >
                      {member.paymentStatus === "verified" ? "Paid" : "Waiting"}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {/* ── Report ── */}
      {group.actions.canReport ? (
        <div className="card stack-sm">
          <h3>Report an issue</h3>
          <p className="text-sm text-muted">
            Report a no-show, non-payment, unsafe behaviour, or other concern.
          </p>
          <select
            value={reportCategory}
            onChange={(event) => setReportCategory(event.target.value)}
          >
            <option value="non_payment">Non-payment</option>
            <option value="no_show">No-show</option>
            <option value="unsafe_behavior">Unsafe behaviour</option>
            <option value="harassment">Harassment</option>
            <option value="misconduct">Misconduct</option>
            <option value="other">Other</option>
          </select>
          <select
            value={reportedUserId}
            onChange={(event) => setReportedUserId(event.target.value)}
          >
            <option value="">Report the situation only</option>
            {activeMembers
              .filter((member) => member.userId !== group.currentUserId)
              .map((member) => (
                <option key={`report-${member.userId}`} value={member.userId}>
                  {member.emoji}
                </option>
              ))}
          </select>
          <textarea
            rows={3}
            value={reportDescription}
            onChange={(event) => setReportDescription(event.target.value)}
            placeholder="What happened?"
          />
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={busy || reportDescription.trim().length < 8}
            onClick={() =>
              runAction(async () => {
                await createReport({
                  groupId: group.group.id as Id<"groups">,
                  reportedUserId: reportedUserId || undefined,
                  category: reportCategory as
                    | "no_show"
                    | "non_payment"
                    | "unsafe_behavior"
                    | "harassment"
                    | "misconduct"
                    | "other",
                  description: reportDescription.trim(),
                  ...qaArgs,
                });
                setReportDescription("");
                setReportedUserId("");
                setStatus({ type: "success", text: "Report submitted." });
              })
            }
          >
            Submit report
          </button>
        </div>
      ) : null}

      {/* ── Status notice ── */}
      {status ? (
        <div
          className={`notice ${
            status.type === "error"
              ? "notice-error"
              : status.type === "success"
                ? "notice-success"
                : "notice-info"
          }`}
        >
          {status.text}
        </div>
      ) : null}
    </div>
  );
}
