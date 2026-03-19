"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../convex/_generated/api";

type ActiveTripSnapshot = {
  group: {
    status: string;
    groupName: string;
    groupColor: string;
    confirmationDeadline: string;
    meetingTime: string;
    meetingLocationLabel: string;
  };
} | null;

type AvailabilitySnapshot = Array<{
  status: string;
}>;

type StatusState =
  | { kind: "idle" }
  | { kind: "searching"; count: number }
  | { kind: "action_needed"; groupName: string; groupColor: string; deadline: string }
  | {
      kind: "confirmed";
      groupName: string;
      groupColor: string;
      meetTime: string;
      meetLocation: string;
      groupStatus: string;
    };

function formatMeetTime(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resolveStatus(group: ActiveTripSnapshot, openCount: number): StatusState {
  if (!group) {
    return openCount > 0 ? { kind: "searching", count: openCount } : { kind: "idle" };
  }

  const status = group.group.status;

  if (status === "matched_pending_ack") {
    return {
      kind: "action_needed",
      groupName: group.group.groupName,
      groupColor: group.group.groupColor,
      deadline: group.group.confirmationDeadline,
    };
  }

  return {
    kind: "confirmed",
    groupName: group.group.groupName,
    groupColor: group.group.groupColor,
    meetTime: group.group.meetingTime,
    meetLocation: group.group.meetingLocationLabel,
    groupStatus: status,
  };
}

function StatusCard({ state }: { state: StatusState }) {
  if (state.kind === "idle") {
    return (
      <div className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
        <div
          style={{
            width: 48,
            height: 48,
            margin: "0 auto 14px",
            borderRadius: 14,
            background: "var(--surface-hover)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
        >
          🚗
        </div>
        <h3 style={{ marginBottom: 6 }}>Not looking for rides</h3>
        <p className="text-sm text-muted" style={{ maxWidth: 240, margin: "0 auto 16px" }}>
          Add a time window below to start matching with other riders.
        </p>
        <Link
          href="/availability"
          className="btn btn-primary btn-sm"
          style={{ display: "inline-flex" }}
        >
          Add a window
        </Link>
      </div>
    );
  }

  if (state.kind === "searching") {
    return (
      <div className="card" style={{ padding: "20px" }}>
        <div className="row" style={{ gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--accent-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
              animation: "softPulse 2.5s ease-in-out infinite",
            }}
          >
            🔍
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 16,
                marginBottom: 4,
              }}
            >
              Looking for a ride
            </div>
            <p className="text-sm text-muted">
              Searching across {state.count} window{state.count !== 1 ? "s" : ""}. You&apos;ll get
              an alert when a group forms.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "action_needed") {
    return (
      <Link href="/group" style={{ textDecoration: "none", display: "block" }}>
        <div
          className="card"
          style={{
            border: `1px solid ${state.groupColor}44`,
            boxShadow: `0 8px 28px ${state.groupColor}22`,
            cursor: "pointer",
          }}
        >
          <div className="row-between" style={{ marginBottom: 14 }}>
            <span
              className="pill pill-sm pill-dot pill-pulse"
              style={{
                background: `${state.groupColor}22`,
                color: state.groupColor,
                border: `1px solid ${state.groupColor}44`,
              }}
            >
              {state.groupName}
            </span>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={state.groupColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 18,
              marginBottom: 6,
            }}
          >
            Waiting for your confirmation
          </div>
          <p className="text-sm text-muted">Open the group to confirm or decline your spot.</p>
        </div>
      </Link>
    );
  }

  const phaseEmoji =
    state.groupStatus === "meetup_checkin" || state.groupStatus === "depart_ready"
      ? "📍"
      : state.groupStatus === "payment_pending" || state.groupStatus === "receipt_pending"
        ? "💸"
        : "✅";

  const phaseLabel =
    state.groupStatus === "meetup_checkin"
      ? "Head to the meetup point"
      : state.groupStatus === "depart_ready"
        ? "Ready to go"
        : state.groupStatus === "payment_pending"
          ? "Settle up with your booker"
          : state.groupStatus === "receipt_pending"
            ? "Waiting for the receipt"
            : "You're all set";

  return (
    <Link href="/group" style={{ textDecoration: "none", display: "block" }}>
      <div
        className="card"
        style={{
          border: `1px solid ${state.groupColor}44`,
          boxShadow: `0 8px 28px ${state.groupColor}22`,
          cursor: "pointer",
        }}
      >
        <div className="row-between" style={{ marginBottom: 14 }}>
          <span
            className="pill pill-sm"
            style={{
              background: `${state.groupColor}22`,
              color: state.groupColor,
              border: `1px solid ${state.groupColor}44`,
            }}
          >
            {state.groupName}
          </span>
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={state.groupColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>{phaseEmoji}</span>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            {phaseLabel}
          </div>
        </div>
        <p className="text-sm text-muted">
          Meet at {state.meetLocation} · {formatMeetTime(state.meetTime)}
        </p>
      </div>
    </Link>
  );
}

export function DashboardStatusCard({
  initialGroup,
  initialAvailabilities,
}: {
  initialGroup: ActiveTripSnapshot;
  initialAvailabilities: AvailabilitySnapshot;
}) {
  const liveGroup = useQuery(api.trips.getActiveTrip, {});
  const liveAvailabilities = useQuery(api.queries.listAvailabilities);
  const group = liveGroup === undefined ? initialGroup : liveGroup;
  const availabilities = liveAvailabilities ?? initialAvailabilities;
  const openCount = availabilities.filter((availability) => availability.status === "open").length;
  const state = resolveStatus(group, openCount);

  return <StatusCard state={state} />;
}
