"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { formatStoredWindow } from "../lib/time-range";

interface AvailabilityListProps {
  availabilities: Doc<"availabilities">[];
}

const statusConfig: Record<string, { icon: string; class: string; label: string }> = {
  open: { icon: "🔍", class: "status-open", label: "Searching" },
  matched: { icon: "✓", class: "status-matched", label: "Matched" },
  cancelled: { icon: "✕", class: "status-cancelled", label: "Cancelled" },
};

export function AvailabilityList({ availabilities }: AvailabilityListProps) {
  const cancelAvailability = useMutation(api.mutations.cancelAvailability);
  const [deletingId, setDeletingId] = useState<Id<"availabilities"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<Id<"availabilities">>>(new Set());

  // Filter to show only non-cancelled availabilities
  const activeAvailabilities = availabilities.filter(
    (a) => a.status !== "cancelled" && !deletedIds.has(a._id),
  );

  async function handleDelete(availabilityId: Id<"availabilities">) {
    if (!confirm("Delete this ride window?")) return;

    setDeletingId(availabilityId);
    setError(null);

    try {
      await cancelAvailability({ availabilityId });
      setDeletedIds((prev) => new Set([...prev, availabilityId]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete availability.");
    } finally {
      setDeletingId(null);
    }
  }

  if (activeAvailabilities.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "24px 16px" }}>
        <p className="text-muted text-sm">No availability submitted yet.</p>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--error-fg)",
            color: "var(--error)",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {activeAvailabilities.map((a) => {
        const config = statusConfig[a.status] ?? statusConfig.open;
        const isDeleting = deletingId === a._id;

        return (
          <div
            key={a._id}
            className="availability-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              opacity: isDeleting ? 0.6 : 1,
              pointerEvents: isDeleting ? "none" : "auto",
            }}
          >
            <div className={`avail-icon ${config.class}`}>{config.icon}</div>
            <div className="avail-info" style={{ flex: 1 }}>
              <div className="avail-time">{formatStoredWindow(a.windowStart, a.windowEnd)}</div>
              <div className="avail-meta">{config.label}</div>
            </div>
            <button
              onClick={() => handleDelete(a._id)}
              disabled={isDeleting}
              type="button"
              title="Delete this ride window"
              style={{
                background: "none",
                border: "none",
                cursor: isDeleting ? "not-allowed" : "pointer",
                padding: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                color: "var(--text-muted)",
                opacity: isDeleting ? 0.5 : 0.7,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!isDeleting) e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                if (!isDeleting) e.currentTarget.style.opacity = "0.7";
              }}
            >
              {isDeleting ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-label="Loading"
                >
                  <title>Loading</title>
                  <circle cx="12" cy="12" r="10" opacity="0.3" />
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-label="Delete"
                >
                  <title>Delete</title>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
