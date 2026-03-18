"use client";

import { useCallback, useEffect, useState } from "react";
import { decryptEnvelope } from "../lib/crypto-browser";
import { Countdown } from "./countdown";

type GroupPayload = {
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
  };
  members: Array<{
    userId: string;
    displayName: string;
    accepted: boolean | null;
  }>;
  revealReady: boolean;
};

type RevealedAddress = { displayName: string; address: string };

const avatarClasses = ["rider-avatar-0", "rider-avatar-1", "rider-avatar-2", "rider-avatar-3"];

function formatWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("en-SG", { weekday: "short", month: "short", day: "numeric" });
  const st = s.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
  const et = e.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${st} – ${et}`;
}

function memberStatus(accepted: boolean | null) {
  if (accepted === true) return { label: "Confirmed", pillClass: "pill-success" };
  if (accepted === false) return { label: "Declined", pillClass: "pill-danger" };
  return { label: "Pending", pillClass: "pill-muted" };
}

export function GroupClient({ initialGroup }: { initialGroup: GroupPayload | null }) {
  const [group, setGroup] = useState<GroupPayload | null>(initialGroup);
  const [status, setStatus] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null,
  );
  const [revealed, setRevealed] = useState<RevealedAddress[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/groups/current", { cache: "no-store" });
    const payload = await response.json();
    setGroup(payload.group ? payload : null);
  }, []);

  useEffect(() => {
    if (!group) return;
    const interval = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(interval);
  }, [group, refresh]);

  async function acknowledge(accepted: boolean) {
    if (!group) return;
    setBusy(true);

    const response = await fetch(`/api/groups/${group.group.id}/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted, signature: "browser-signature-placeholder" }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not update acknowledgement." });
      return;
    }

    if (!accepted) {
      setStatus({ type: "info", text: "You declined. We'll try to rematch you." });
      setGroup(null);
      return;
    }

    setStatus({ type: "success", text: "Confirmed! Waiting for the rest of the group." });
    await refresh();
  }

  async function reveal() {
    if (!group) return;
    setBusy(true);

    const response = await fetch(`/api/groups/${group.group.id}/address-envelopes`, {
      cache: "no-store",
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not reveal addresses yet." });
      return;
    }

    const decrypted = await Promise.all(
      payload.envelopes.map(async (envelope: { ciphertext: string }) =>
        decryptEnvelope(envelope.ciphertext),
      ),
    );
    setRevealed(
      decrypted.map((entry) => ({
        displayName: entry.displayName,
        address: entry.address,
      })),
    );
    setStatus({ type: "success", text: "Addresses revealed successfully." });
    await refresh();
  }

  if (!group) {
    return (
      <div className="empty-state" style={{ animation: "fadeUp 0.5s var(--ease-out-expo) both" }}>
        <div className="empty-state-icon">👥</div>
        <h3>No active group</h3>
        <p className="text-muted">
          Submit your availability first. Matching runs automatically in the background.
        </p>
      </div>
    );
  }

  const confirmedCount = group.members.filter((m) => m.accepted === true).length;

  return (
    <div className="stack stagger">
      {/* Group summary card */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 16 }}>
          <span className="pill pill-accent pill-dot pill-pulse">
            {group.group.status === "revealed" ? "Revealed" : "Tentative group"}
          </span>
          <Countdown deadline={group.group.confirmationDeadline} />
        </div>

        <div className="group-info-grid">
          <div className="group-info-cell">
            <div className="cell-label">Pickup</div>
            <div className="cell-value" style={{ fontSize: 14 }}>
              {group.group.pickupLabel}
            </div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Members</div>
            <div className="cell-value">{group.group.groupSize}</div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Est. fare</div>
            <div className="cell-value" style={{ fontSize: 14 }}>
              {group.group.estimatedFareBand}
            </div>
          </div>
          <div className="group-info-cell">
            <div className="cell-label">Max detour</div>
            <div className="cell-value">{group.group.maxDetourMinutes}m</div>
          </div>
        </div>

        <p className="text-xs text-muted" style={{ marginTop: 12, textAlign: "center" }}>
          {formatWindow(group.group.windowStart, group.group.windowEnd)}
        </p>
      </div>

      {/* Confirmation progress */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 4 }}>
          <h3>Confirmations</h3>
          <span className="text-sm font-display fw-600 text-accent">
            {confirmedCount}/{group.members.length}
          </span>
        </div>
        <div className="progress-bar" style={{ marginBottom: 16 }}>
          <div
            className="progress-fill"
            style={{ width: `${(confirmedCount / group.members.length) * 100}%` }}
          />
        </div>

        {group.members.map((member, index) => {
          const ms = memberStatus(member.accepted);
          const initial =
            member.displayName?.charAt(member.displayName.length - 1) ||
            member.displayName?.charAt(0) ||
            "?";
          return (
            <div className="member-item" key={member.userId}>
              <div className={`rider-avatar ${avatarClasses[index % avatarClasses.length]}`}>
                {initial}
              </div>
              <div className="member-info">
                <div className="member-name">{member.displayName}</div>
              </div>
              <span className={`pill pill-sm ${ms.pillClass}`}>{ms.label}</span>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {group.group.status !== "revealed" && (
        <div className="row" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => acknowledge(true)}
            disabled={busy}
          >
            {busy ? "..." : "Confirm"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            style={{ flex: 1 }}
            onClick={() => acknowledge(false)}
            disabled={busy}
          >
            Decline
          </button>
        </div>
      )}

      {group.revealReady && group.group.status !== "revealed" && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={reveal}
          disabled={busy}
          style={{
            background: "linear-gradient(135deg, var(--privacy), #2aa89e)",
            animation: "glowPulse 3s ease-in-out infinite",
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
          </svg>
          Reveal addresses
        </button>
      )}

      {/* Revealed addresses */}
      {revealed.length > 0 && (
        <div className="card reveal-container">
          <h3 style={{ marginBottom: 12 }}>
            <span className="text-privacy">Revealed addresses</span>
          </h3>
          <div className="stack-sm">
            {revealed.map((entry, index) => (
              <div
                key={`${entry.displayName}-${entry.address}`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="text-xs text-muted font-display fw-600" style={{ marginBottom: 4 }}>
                  {entry.displayName}
                </div>
                <div className="reveal-address">{entry.address}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status messages */}
      {status && (
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
      )}
    </div>
  );
}
