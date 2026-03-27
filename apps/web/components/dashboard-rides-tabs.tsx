"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { AvailabilityList } from "./availability-list";

export type PastRideSummary = {
  groupId: Doc<"groups">["_id"];
  groupName: string;
  groupColor: string;
  status: string;
  pickupLabel: string;
  meetingTime: string;
  closedAt: string | null;
  finalCostCents: number | null;
  endedAt: string;
};

type AvailabilityRow = Doc<"availabilities">;

function formatPastRideWhen(iso: string) {
  return new Date(iso).toLocaleString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFare(cents: number | null) {
  if (cents === null) return null;
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(cents / 100);
}

function pastRideStatusMeta(status: string) {
  const map: Record<string, string> = {
    closed: "Completed",
    cancelled: "Cancelled",
    dissolved: "Did not form",
    reported: "Reported",
    did_not_start: "Did not start",
    no_show: "No-show",
  };

  const pillClass =
    status === "closed" ? "pill-success" : status === "reported" ? "pill-danger" : "pill-muted";

  return {
    label: map[status] ?? status.replace(/_/g, " "),
    pillClass,
    muted:
      status === "cancelled" ||
      status === "dissolved" ||
      status === "did_not_start" ||
      status === "no_show",
  };
}

function PastRidesList({ rides }: { rides: PastRideSummary[] }) {
  if (rides.length === 0) {
    return (
      <div
        className="card"
        style={{ textAlign: "center", padding: "24px 16px", background: "transparent" }}
      >
        <p className="text-muted text-sm">No past rides yet. Finished trips will show up here.</p>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      {rides.map((ride) => {
        const fare = formatFare(ride.finalCostCents);
        const statusMeta = pastRideStatusMeta(ride.status);
        const cardStyle = statusMeta.muted
          ? {
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "none",
              opacity: 0.72,
            }
          : statusMeta.pillClass === "pill-danger"
            ? {
                border: "1px solid rgba(239, 107, 107, 0.26)",
                boxShadow: "0 4px 18px rgba(239, 107, 107, 0.12)",
              }
            : {
                border: `1px solid ${ride.groupColor}44`,
                boxShadow: `0 4px 18px ${ride.groupColor}18`,
              };
        const groupPillStyle = statusMeta.muted
          ? {
              background: "rgba(85, 93, 126, 0.15)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }
          : {
              background: `${ride.groupColor}22`,
              color: ride.groupColor,
              border: `1px solid ${ride.groupColor}44`,
            };
        return (
          <div key={ride.groupId} className="card" style={cardStyle}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="pill pill-sm" style={groupPillStyle}>
                {ride.groupName}
              </span>
              <span className={`pill pill-sm ${statusMeta.pillClass}`}>{statusMeta.label}</span>
            </div>
            <p className="text-sm text-muted" style={{ marginBottom: 4 }}>
              {ride.pickupLabel} · {formatPastRideWhen(ride.meetingTime)}
            </p>
            <p className="text-xs text-muted">Ended {formatPastRideWhen(ride.endedAt)}</p>
            {ride.status === "closed" && fare ? (
              <p className="text-sm" style={{ marginTop: 8, fontWeight: 600 }}>
                Total {fare}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function DashboardRidesTabs({
  initialAvailabilities,
  initialPastRides,
  showAddLink,
}: {
  initialAvailabilities: AvailabilityRow[];
  initialPastRides: PastRideSummary[];
  showAddLink: boolean;
}) {
  const [tab, setTab] = useState<"windows" | "history">("windows");
  const livePastRides = useQuery(api.trips.listPastRides);
  const pastRides = livePastRides ?? initialPastRides;

  return (
    <div>
      <div className="group-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`group-tab ${tab === "windows" ? "group-tab-active" : ""}`}
          onClick={() => setTab("windows")}
        >
          Windows
        </button>
        <button
          type="button"
          className={`group-tab ${tab === "history" ? "group-tab-active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      {tab === "windows" ? (
        <>
          <div className="section-header" style={{ marginBottom: 12 }}>
            <h2>Your windows</h2>
            {showAddLink ? (
              <Link href="/availability" style={{ fontSize: 13, fontWeight: 600 }}>
                + Add
              </Link>
            ) : null}
          </div>
          <AvailabilityList availabilities={initialAvailabilities} />
        </>
      ) : (
        <>
          <div className="section-header" style={{ marginBottom: 12 }}>
            <h2>Past rides</h2>
          </div>
          <PastRidesList rides={pastRides} />
        </>
      )}
    </div>
  );
}
