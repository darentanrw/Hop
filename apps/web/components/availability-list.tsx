"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { decodeStubDestinationRef } from "../lib/matcher-stub";

function formatWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("en-SG", { weekday: "short", month: "short", day: "numeric" });
  const startTime = s.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
  const endTime = e.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
  return { day, range: `${startTime} – ${endTime}` };
}

function getDestinationLabel(sealedDestinationRef: string): string {
  if (sealedDestinationRef.startsWith("stub:")) {
    return decodeStubDestinationRef(sealedDestinationRef);
  }
  return "Your destination";
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  open: { label: "Searching", cls: "pill-accent pill-dot pill-pulse" },
  matched: { label: "Matched", cls: "pill-success" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
};

export function AvailabilityList() {
  const availabilities = useQuery(api.queries.listAvailabilities);
  const cancelAvailability = useMutation(api.mutations.cancelAvailability);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const activeItems = (availabilities ?? [])
    .filter((a) => a.status !== "cancelled")
    .sort((a, b) => new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime());

  if (availabilities === undefined) {
    return (
      <div className="stack-sm">
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 72,
              background: "var(--surface)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    );
  }

  if (activeItems.length === 0) {
    return (
      <div
        className="card"
        style={{ textAlign: "center", padding: "24px 16px", background: "transparent" }}
      >
        <p className="text-muted text-sm">No windows yet. Add one to start matching.</p>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      {activeItems.map((a) => {
        const { day, range } = formatWindow(a.windowStart, a.windowEnd);
        const destination = getDestinationLabel(a.sealedDestinationRef);
        const pill = STATUS_PILL[a.status] ?? STATUS_PILL.open;
        const isDeleting = deletingId === a._id;

        return (
          <div key={a._id} className="availability-item">
            <div
              className="avail-icon"
              style={{
                background:
                  a.status === "open"
                    ? "var(--accent-subtle)"
                    : a.status === "matched"
                      ? "var(--success-subtle)"
                      : "var(--surface-hover)",
                fontSize: 18,
              }}
            >
              {a.status === "open" ? "🔍" : a.status === "matched" ? "✓" : "✕"}
            </div>
            <div className="avail-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="avail-time">{day}</div>
              <div className="avail-dest">
                🏁{" "}
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {destination}
                </span>
              </div>
              <div className="avail-meta">{range}</div>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}
            >
              <span className={`pill pill-sm ${pill.cls}`}>{pill.label}</span>
              {a.status === "open" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    color: "var(--danger)",
                    opacity: isDeleting ? 0.5 : 1,
                  }}
                  disabled={isDeleting}
                  onClick={async () => {
                    setDeletingId(a._id);
                    try {
                      await cancelAvailability({
                        availabilityId: a._id as Id<"availabilities">,
                      });
                    } finally {
                      setDeletingId(null);
                    }
                  }}
                >
                  {isDeleting ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
