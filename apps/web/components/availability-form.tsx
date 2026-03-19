"use client";

import type { RiderProfile } from "@hop/shared";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { api } from "../convex/_generated/api";
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
  const [destinationAddress, setDestinationAddress] = useState("");
  const [status, setStatus] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedDestinationAddress = destinationAddress.trim();
    if (!trimmedDestinationAddress) {
      setStatus({ type: "error", text: "Enter the address you are heading to." });
      return;
    }

    setBusy(true);
    setStatus(null);

    const { windowStart, windowEnd } = slotsToIsoRange(dateInput, startSlot, endSlot);

    try {
      const matcherResponse = await fetch("/api/matcher/destination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmedDestinationAddress }),
      });
      const matcherPayload = (await matcherResponse.json()) as {
        error?: string;
        sealedDestinationRef?: string;
        routeDescriptorRef?: string;
        estimatedFareBand?: "S$10-15" | "S$16-20" | "S$21-25" | "S$26+";
      };

      if (
        !matcherResponse.ok ||
        !matcherPayload.sealedDestinationRef ||
        !matcherPayload.routeDescriptorRef ||
        !matcherPayload.estimatedFareBand
      ) {
        throw new Error(matcherPayload.error ?? "Could not save destination.");
      }

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
            Hop matches on the destination tied to this booking window. Once a group forms, you will
            need a new booking window to change it.
          </p>
        </div>
      </div>

      <div className="card stack">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Destination</span>
          <small className="text-muted">Where you are heading after pickup from NUS Utown</small>
        </div>
        <div className="stack-xs">
          <label htmlFor="destination-address">Going to</label>
          <textarea
            id="destination-address"
            value={destinationAddress}
            onChange={(event) => setDestinationAddress(event.target.value)}
            placeholder="Enter your address or nearest drop-off point"
            rows={3}
            autoComplete="street-address"
            required
          />
        </div>
      </div>

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

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={busy || !destinationAddress.trim()}
      >
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
