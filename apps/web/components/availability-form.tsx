"use client";

import type { RiderProfile } from "@hop/shared";
import { type FormEvent, useState } from "react";

type AvailabilityFormProps = {
  profile: RiderProfile;
  matcherBaseUrl: string;
};

function defaultDate(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString().slice(0, 16);
}

export function AvailabilityForm({ profile, matcherBaseUrl }: AvailabilityFormProps) {
  const [windowStart, setWindowStart] = useState(defaultDate(24));
  const [windowEnd, setWindowEnd] = useState(defaultDate(28));
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const matcherResponse = await fetch(`${matcherBaseUrl}/matcher/submit-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        pickupOriginId: "nus-utown",
        windowStart,
        windowEnd,
      }),
    });
    const matcherPayload = await matcherResponse.json();

    if (!matcherResponse.ok) {
      setBusy(false);
      setStatus({
        type: "error",
        text: matcherPayload.error ?? "Could not process address privately.",
      });
      return;
    }

    const response = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        selfDeclaredGender: profile.selfDeclaredGender,
        sameGenderOnly: profile.sameGenderOnly,
        minGroupSize: profile.minGroupSize,
        maxGroupSize: profile.maxGroupSize,
        sealedDestinationRef: matcherPayload.sealedDestinationRef,
        routeDescriptorRef: matcherPayload.routeDescriptorRef,
        estimatedFareBand: matcherPayload.estimatedFareBand,
      }),
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setStatus({ type: "error", text: payload.error ?? "Could not save availability." });
      return;
    }

    setStatus({ type: "success", text: "Availability saved. Matching is running." });
    setAddress("");
    window.location.href = "/dashboard";
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
            Address stays private
          </strong>
          <p className="text-sm" style={{ marginTop: 4, color: "var(--text-secondary)" }}>
            Sent directly to the matcher service. Never stored on our main servers.
          </p>
        </div>
      </div>

      {/* Address */}
      <div className="card stack">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="avail-address">Home address</label>
          <small className="text-muted">Where you&apos;re heading after campus</small>
        </div>
        <textarea
          id="avail-address"
          rows={3}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 123 Clementi Ave 3, Singapore 120123"
          required
        />
      </div>

      {/* Time window */}
      <div className="card stack">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Time window</span>
          <small className="text-muted">When you want to leave NUS Utown</small>
        </div>

        <div className="grid-2">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="avail-start" className="text-xs">
              From
            </label>
            <input
              id="avail-start"
              type="datetime-local"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              required
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="avail-end" className="text-xs">
              Until
            </label>
            <input
              id="avail-end"
              type="datetime-local"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              required
            />
          </div>
        </div>
      </div>

      {/* Pickup note */}
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
            Pickup: NUS Utown
          </p>
          <p className="text-xs text-muted">Fixed origin for all matches</p>
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
            Submitting...
          </>
        ) : (
          "Save availability"
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
