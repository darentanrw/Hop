"use client";

import type { RiderProfile } from "@hop/shared";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../convex/_generated/api";
import { createStubMatcherSubmission } from "../lib/matcher-stub";
import { getDefaultDateInput, getDefaultRange, slotsToIsoRange } from "../lib/time-range";
import { TimeRangePicker } from "./time-range-picker";

type AvailabilityFormProps = {
  profile: RiderProfile;
};

export function AvailabilityForm({ profile }: AvailabilityFormProps) {
  const createAvailability = useMutation(api.mutations.createAvailability);
  const defaultRange = getDefaultRange();
  const [dateInput, setDateInput] = useState(getDefaultDateInput());
  const [startSlot, setStartSlot] = useState(defaultRange.startSlot);
  const [endSlot, setEndSlot] = useState(defaultRange.endSlot);
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination.trim()) {
      setStatus({ type: "error", text: "Please enter your drop-off destination." });
      return;
    }
    setBusy(true);
    setStatus(null);

    const { windowStart, windowEnd } = slotsToIsoRange(dateInput, startSlot, endSlot);
    const matcherPayload = createStubMatcherSubmission(
      `${profile.userId}:${dateInput}:${startSlot}:${endSlot}`,
      destination,
    );

    try {
      await createAvailability({
        windowStart,
        windowEnd,
        selfDeclaredGender: profile.selfDeclaredGender,
        sameGenderOnly: profile.sameGenderOnly,
        minGroupSize: profile.minGroupSize,
        maxGroupSize: profile.maxGroupSize,
        sealedDestinationRef: matcherPayload.sealedDestinationRef,
        routeDescriptorRef: matcherPayload.routeDescriptorRef,
        estimatedFareBand: matcherPayload.estimatedFareBand,
      });
      setStatus({ type: "success", text: "Window saved." });
      window.location.href = "/dashboard";
    } catch (err) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Could not save availability.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stagger" onSubmit={handleSubmit}>
      {/* Privacy badge */}
      <div className="card-privacy" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--privacy)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
          </svg>
        </div>
        <div>
          <strong
            style={{ fontSize: 13, color: "var(--privacy)", fontFamily: "var(--font-display)" }}
          >
            Destination stays private
          </strong>
          <p className="text-sm" style={{ marginTop: 4, color: "var(--text-secondary)" }}>
            Only riders in your confirmed group can see where you're going.
          </p>
        </div>
      </div>

      {/* Destination */}
      <div className="card stack-sm">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="destination" style={{ fontSize: 14 }}>
            Drop-off destination
          </label>
          <small className="text-muted">Where are you heading?</small>
        </div>
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: 16,
              pointerEvents: "none",
            }}
          >
            🏁
          </span>
          <input
            id="destination"
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. Clementi MRT, Holland V, Jurong East"
            style={{ paddingLeft: 42 }}
            required
            autoComplete="off"
          />
        </div>
      </div>

      {/* Time window */}
      <div className="card stack">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Departure window</span>
          <small className="text-muted">When you want to leave NUS Utown</small>
        </div>
        <TimeRangePicker
          dateInput={dateInput}
          startSlot={startSlot}
          endSlot={endSlot}
          onDateInputChange={setDateInput}
          onRangeChange={({ startSlot: nextStartSlot, endSlot: nextEndSlot }) => {
            setStartSlot(nextStartSlot);
            setEndSlot(nextEndSlot);
          }}
        />
      </div>

      {/* Origin fixed */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "12px 16px",
          background: "var(--surface)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 18 }}>📍</span>
        <div>
          <p
            className="text-sm fw-600"
            style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}
          >
            From: NUS Utown
          </p>
          <p className="text-xs text-muted">Fixed pickup for all matches</p>
        </div>
      </div>

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? (
          <>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{ animation: "spinSlow 1s linear infinite" }}
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="50" strokeDashoffset="20" />
            </svg>
            Saving…
          </>
        ) : (
          "Save window"
        )}
      </button>

      {status && (
        <div
          className={`notice ${status.type === "error" ? "notice-error" : status.type === "success" ? "notice-success" : "notice-info"}`}
        >
          {status.text}
        </div>
      )}
    </form>
  );
}
