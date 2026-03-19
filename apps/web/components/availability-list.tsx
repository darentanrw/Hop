"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { decodeStubDestinationRef } from "../lib/matcher-stub";

interface AvailabilityListProps {
  availabilities?: Doc<"availabilities">[];
}

function formatWindow(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

export function AvailabilityList({ availabilities: initialAvailabilities }: AvailabilityListProps) {
  const liveAvailabilities = useQuery(api.queries.listAvailabilities);
  const cancelAvailability = useMutation(api.mutations.cancelAvailability);
  const [deletingId, setDeletingId] = useState<Id<"availabilities"> | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<Id<"availabilities">>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const availabilities = liveAvailabilities ?? initialAvailabilities;
  const activeItems = (availabilities ?? [])
    .filter((availability) => {
      return availability.status !== "cancelled" && !deletedIds.has(availability._id);
    })
    .sort((a, b) => new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime());

  if (liveAvailabilities === undefined && initialAvailabilities === undefined) {
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
      {error ? <div className="notice notice-error">{error}</div> : null}

      {activeItems.map((availability) => {
        const { day, range } = formatWindow(availability.windowStart, availability.windowEnd);
        const destination = getDestinationLabel(availability.sealedDestinationRef);
        const pill = STATUS_PILL[availability.status] ?? STATUS_PILL.open;
        const isDeleting = deletingId === availability._id;

        return (
          <div key={availability._id} className="availability-item">
            <div
              className="avail-icon"
              style={{
                background:
                  availability.status === "open"
                    ? "var(--accent-subtle)"
                    : availability.status === "matched"
                      ? "var(--success-subtle)"
                      : "var(--surface-hover)",
                fontSize: 18,
              }}
            >
              {availability.status === "open"
                ? "🔍"
                : availability.status === "matched"
                  ? "✓"
                  : "✕"}
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
              {availability.status === "open" ? (
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
                    if (!confirm("Delete this ride window?")) return;

                    setDeletingId(availability._id);
                    setError(null);

                    try {
                      await cancelAvailability({ availabilityId: availability._id });
                      setDeletedIds((prev) => new Set([...prev, availability._id]));
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Failed to delete availability.",
                      );
                    } finally {
                      setDeletingId(null);
                    }
                  }}
                >
                  {isDeleting ? "Removing..." : "Remove"}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
