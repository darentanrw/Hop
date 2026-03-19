"use client";

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
    estimatedFareBand: string;
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
    emoji: string;
    destinationLockedAt: string | null;
    qrToken: string | null;
    amountDueCents: number;
    paymentStatus: string;
  } | null;
  members: Array<{
    userId: string;
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

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
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

export function GroupClient({ initialGroup }: { initialGroup: ActiveTripPayload | null }) {
  const liveGroup = useQuery(api.trips.getActiveTrip);
  const group = liveGroup === undefined ? initialGroup : liveGroup;

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

  useEffect(() => {
    void syncLifecycle({});
    const interval = window.setInterval(() => {
      void syncLifecycle({});
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [syncLifecycle]);

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

  const activeMembers = useMemo(
    () => group?.members.filter((member) => member.participationStatus === "active") ?? [],
    [group],
  );

  const stopLiveScanner = useCallback(() => {
    scannerRef.current?.destroy();
    scannerRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    scannerBusyRef.current = false;
    setScannerOpen(false);
    setScannerState("idle");
  }, []);

  async function runAction(task: () => Promise<void>) {
    setBusy(true);
    setStatus(null);

    try {
      await task();
      await syncLifecycle({});
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
      scannerRef.current?.destroy();
    };
  }, []);

  const submitScannedQrToken = useCallback(
    async (rawValue: string) => {
      if (!group) return;

      const trimmedValue = rawValue.trim();
      if (!trimmedValue) return;

      const now = Date.now();
      if (
        scannerBusyRef.current ||
        (lastScannedTokenRef.current === trimmedValue &&
          now - lastScannedAtRef.current < SCAN_DEBOUNCE_MS)
      ) {
        return;
      }

      scannerBusyRef.current = true;
      lastScannedTokenRef.current = trimmedValue;
      lastScannedAtRef.current = now;
      setScanToken(trimmedValue);
      setStatus({ type: "info", text: "QR detected. Verifying rider attendance..." });

      try {
        await scanGroupQrToken({
          groupId: group.group.id as Id<"groups">,
          qrToken: trimmedValue,
        });
        await syncLifecycle({});
        setStatus({ type: "success", text: "Rider checked in successfully." });
      } catch (error) {
        setStatus({
          type: "error",
          text: error instanceof Error ? error.message : "Could not verify that rider.",
        });
      } finally {
        scannerBusyRef.current = false;
      }
    },
    [group, scanGroupQrToken, syncLifecycle],
  );

  const startLiveScanner = useCallback(() => {
    if (scannerOpen) return;
    setStatus(null);
    setScannerOpen(true);
    setScannerState("starting");
  }, [scannerOpen]);

  useEffect(() => {
    if (!scannerOpen || !group?.actions.canScanQr || !videoRef.current) {
      return;
    }

    let cancelled = false;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        void submitScannedQrToken(result.data);
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
        setStatus({
          type: "info",
          text: "Live scanner is on. Point the camera at each rider's QR code.",
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
        setStatus({
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
  }, [group?.actions.canScanQr, scannerOpen, submitScannedQrToken]);

  if (!group) {
    return (
      <div className="empty-state" style={{ animation: "fadeUp 0.5s var(--ease-out-expo) both" }}>
        <div className="empty-state-icon">🚕</div>
        <h3>No active ride group</h3>
        <p className="text-muted">
          Submit your availability first. Hop will build a dummy matched group while the live
          matcher is offline.
        </p>
      </div>
    );
  }

  const currentUserIsBooker = group.group.bookerUserId === group.currentUserId;
  const showDepartCard =
    currentUserIsBooker &&
    (group.group.status === "meetup_checkin" || group.group.status === "depart_ready");

  return (
    <div className="stack stagger">
      <div
        className="card"
        style={{
          border: `1px solid ${group.group.groupColor}33`,
          boxShadow: `0 10px 36px ${group.group.groupColor}1f`,
        }}
      >
        <div className="row-between" style={{ marginBottom: 16 }}>
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
          <span className="pill pill-accent pill-sm">{statusLabel(group.group.status)}</span>
        </div>

        <div className="group-info-grid">
          <div className="group-info-cell">
            <div className="cell-label">Meet</div>
            <div className="cell-value" style={{ fontSize: 14 }}>
              {group.group.meetingLocationLabel}
            </div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Time</div>
            <div className="cell-value" style={{ fontSize: 14 }}>
              {formatDateTime(group.group.meetingTime)}
            </div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Booker</div>
            <div className="cell-value">
              {group.members.find((member) => member.userId === group.group.bookerUserId)?.emoji ??
                "🙂"}
            </div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Fare</div>
            <div className="cell-value" style={{ fontSize: 14 }}>
              {group.group.finalCostCents !== null
                ? formatCurrency(group.group.finalCostCents)
                : group.group.estimatedFareBand}
            </div>
          </div>
        </div>

        <div className="stack-sm" style={{ marginTop: 16 }}>
          {group.group.status === "matched_pending_ack" ? (
            <div className="row-between">
              <span className="text-sm text-muted">Acknowledge before the group locks.</span>
              <Countdown deadline={group.group.confirmationDeadline} />
            </div>
          ) : null}
          {(group.group.status === "meetup_checkin" || group.group.status === "depart_ready") &&
          group.group.graceDeadline ? (
            <div className="row-between">
              <span className="text-sm text-muted">Grace period before the booker can depart.</span>
              <Countdown deadline={group.group.graceDeadline} />
            </div>
          ) : null}
          {group.group.status === "payment_pending" && group.group.paymentDueAt ? (
            <div className="row-between">
              <span className="text-sm text-muted">
                Payment proofs due within one day of the trip.
              </span>
              <Countdown deadline={group.group.paymentDueAt} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h3>Riders</h3>
          <span className="text-sm text-muted">
            {group.stats.checkedInCount}/{group.stats.activeMemberCount} checked in
          </span>
        </div>
        <div className="stack-sm">
          {group.members.map((member) => {
            const badge = memberBadge(member);
            return (
              <div className="member-item" key={member.userId}>
                <div className="rider-avatar rider-avatar-0">{member.emoji}</div>
                <div className="member-info">
                  <div className="member-name">
                    {member.emoji} {member.isBooker ? "Booker" : "Rider"}
                  </div>
                  <div className="text-xs text-muted">
                    {member.dropoffOrder
                      ? `Drop-off #${member.dropoffOrder}`
                      : "Awaiting route order"}
                  </div>
                </div>
                <span className={`pill pill-sm ${badge.pillClass}`}>{badge.label}</span>
              </div>
            );
          })}
        </div>
      </div>

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
                });
                setStatus({
                  type: "success",
                  text: "You acknowledged the group. Hop will lock the riders when the window resolves.",
                });
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
                });
                setStatus({
                  type: "info",
                  text: "You declined this group. Hop will remove you from the ride.",
                });
              })
            }
          >
            Decline
          </button>
        </div>
      ) : null}

      {!group.actions.canAcknowledge && group.currentUserMember?.destinationLockedAt ? (
        <div className="card stack-sm">
          <h3>Destination locked</h3>
          <p className="text-sm text-muted">
            Your destination was confirmed before this group formed, so riders cannot change it from
            inside the group.
          </p>
          <div className="notice notice-info">
            Need a different destination? Leave this group and create a new booking window.
          </div>
        </div>
      ) : null}

      {group.dropoffPreview.length > 0 ? (
        <div className="card stack-sm">
          <h3>Suggested drop-off order</h3>
          <p className="text-sm text-muted">
            This is a matcher-stubbed suggestion for tonight, based on the destinations already
            locked in.
          </p>
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

      {group.actions.canStartCheckIn ? (
        <div className="card stack-sm">
          <h3>Meetup check-in</h3>
          <p className="text-sm text-muted">
            When everyone reaches {group.group.meetingLocationLabel}, the booker starts check-in and
            scans each rider&apos;s QR code.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                await startMeetupCheckIn({ groupId: group.group.id as Id<"groups"> });
                setStatus({
                  type: "success",
                  text: "Check-in is open. The booker is now marked present.",
                });
              })
            }
          >
            Start check-in
          </button>
        </div>
      ) : null}

      {group.actions.canShowQr && group.currentUserMember?.qrToken ? (
        <div className="card stack-sm" style={{ alignItems: "center", textAlign: "center" }}>
          <h3>Your meetup QR</h3>
          <p className="text-sm text-muted">
            Show this screen to the booker so they can mark you present at the meeting point.
          </p>
          {qrCode ? (
            <img src={qrCode} alt="Your Hop check-in QR code" width={220} height={220} />
          ) : null}
          <div className="notice notice-info" style={{ width: "100%" }}>
            Backup token: <code>{group.currentUserMember.qrToken}</code>
          </div>
        </div>
      ) : null}

      {group.actions.canScanQr ? (
        <div className="card stack-sm">
          <h3>Scan rider QR</h3>
          <p className="text-sm text-muted">
            Open the live scanner on the booker&apos;s phone, then point it at each rider&apos;s QR
            code. Paste the rider token if the camera is unavailable.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy || scannerState === "starting"}
              onClick={startLiveScanner}
            >
              {scannerState === "live"
                ? "Scanner running"
                : scannerState === "starting"
                  ? "Opening camera..."
                  : "Open live scanner"}
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
              <div className="scanner-overlay" aria-hidden="true">
                <div className="scanner-frame" />
              </div>
            </div>
          ) : null}
          <input
            type="text"
            value={scanToken}
            onChange={(event) => setScanToken(event.target.value)}
            placeholder="Paste rider token"
          />
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={busy || scanToken.trim().length < 6}
            onClick={() =>
              runAction(async () => {
                await submitScannedQrToken(scanToken);
                setScanToken("");
              })
            }
          >
            Check in rider
          </button>
        </div>
      ) : null}

      {showDepartCard ? (
        <div className="card stack-sm">
          <h3>Depart the group</h3>
          <p className="text-sm text-muted">
            Once everyone is checked in, or the 5-minute grace period has expired, the booker can
            depart and late riders are removed automatically.
          </p>
          {!group.actions.canDepart ? (
            <div className="text-sm text-muted">
              Depart becomes available only after all riders are checked in or the 5-minute grace
              window ends.
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !group.actions.canDepart}
            onClick={() =>
              runAction(async () => {
                await departGroup({ groupId: group.group.id as Id<"groups"> });
                setStatus({
                  type: "success",
                  text: "Trip departed. Any riders who missed the meetup have been removed from the group.",
                });
              })
            }
          >
            Depart now
          </button>
        </div>
      ) : null}

      {group.actions.canUploadReceipt ? (
        <div className="card stack-sm">
          <h3>Upload the taxi receipt</h3>
          <p className="text-sm text-muted">
            The booker records the final fare once the trip is done. Hop will calculate each
            rider&apos;s share automatically.
          </p>
          <input
            type="number"
            min="0"
            step="0.01"
            value={receiptTotal}
            onChange={(event) => setReceiptTotal(event.target.value)}
            placeholder="24.80"
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
                  throw new Error("Attach the taxi receipt image first.");
                }
                const storageId = await uploadFile(receiptFile, generateUploadUrl);
                await submitReceipt({
                  groupId: group.group.id as Id<"groups">,
                  totalCostCents: Math.round(Number(receiptTotal) * 100),
                  storageId,
                });
                setReceiptFile(null);
                setReceiptTotal("");
                setStatus({
                  type: "success",
                  text: "Receipt uploaded. Payment shares are now ready.",
                });
              })
            }
          >
            Submit receipt
          </button>
        </div>
      ) : null}

      {group.actions.canSubmitPaymentProof ? (
        <div className="card stack-sm">
          <h3>Submit your payment proof</h3>
          <p className="text-sm text-muted">
            You owe {formatCurrency(group.currentUserMember?.amountDueCents ?? 0)} for this ride.
            Upload your transfer screenshot so the booker can verify it.
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
                });
                setPaymentFile(null);
                setStatus({
                  type: "success",
                  text: "Payment proof submitted for the booker to verify.",
                });
              })
            }
          >
            Upload payment proof
          </button>
        </div>
      ) : null}

      {group.actions.canVerifyPayments ? (
        <div className="card stack-sm">
          <h3>Verify rider payments</h3>
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
                        ? "Proof uploaded and waiting for verification."
                        : member.paymentStatus === "verified"
                          ? "Payment verified."
                          : "Still waiting on rider proof."}
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
                          });
                          setStatus({ type: "success", text: "Payment verified." });
                        })
                      }
                    >
                      Verify
                    </button>
                  ) : (
                    <span
                      className={`pill pill-sm ${member.paymentStatus === "verified" ? "pill-success" : "pill-muted"}`}
                    >
                      {member.paymentStatus}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {group.actions.canReport ? (
        <div className="card stack-sm">
          <h3>Report a rider or incident</h3>
          <p className="text-sm text-muted">
            Use this for no-shows, non-payment, unsafe behaviour, harassment, or anything the team
            should review later.
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
                });
                setReportDescription("");
                setReportedUserId("");
                setStatus({ type: "success", text: "Report saved for follow-up." });
              })
            }
          >
            Submit report
          </button>
        </div>
      ) : null}

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
