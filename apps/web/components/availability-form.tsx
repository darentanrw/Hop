"use client";

import type { RiderProfile } from "@hop/shared";
import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import { persistDestinationLabel } from "../lib/destination-storage";
import { getEligibilityError } from "../lib/ride-eligibility";
import {
  clampRange,
  getDefaultDateInput,
  getDefaultRange,
  getEarliestSlotForDate,
  slotsToIsoRange,
} from "../lib/time-range";
import { TimeRangePicker } from "./time-range-picker";

const matcherBaseUrl = process.env.NEXT_PUBLIC_MATCHER_BASE_URL ?? "http://localhost:4001";

type AddressSuggestion = {
  title: string;
  address: string;
  postal: string;
};

type AvailabilityFormProps = {
  profile: RiderProfile;
};

export function AvailabilityForm({ profile }: AvailabilityFormProps) {
  const createAvailability = useMutation(api.mutations.createAvailability);
  const eligibility = useQuery(api.trips.getRideEligibility, {});
  const initialDate = getDefaultDateInput();
  const defaultRange = getDefaultRange(initialDate);
  const [dateInput, setDateInput] = useState(initialDate);
  const [startSlot, setStartSlot] = useState(defaultRange.startSlot);
  const [endSlot, setEndSlot] = useState(defaultRange.endSlot);
  const minSlot = getEarliestSlotForDate(dateInput);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [status, setStatus] = useState<{ type: "info" | "error" | "success"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleAddressInput(text: string) {
    setAddressQuery(text);
    setDestinationAddress("");
    setAddressSearchError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `${matcherBaseUrl}/matcher/search?q=${encodeURIComponent(text.trim())}`,
        );
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          results?: AddressSuggestion[];
        } | null;
        if (!response.ok) {
          throw new Error(data?.error ?? "Address search is unavailable right now. Try again.");
        }
        const results = data?.results ?? [];
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (error) {
        setSuggestions([]);
        setShowSuggestions(false);
        setAddressSearchError(
          error instanceof Error
            ? error.message
            : "Address search is unavailable right now. Try again.",
        );
      }
    }, 300);
  }

  function selectSuggestion(suggestion: AddressSuggestion) {
    setDestinationAddress(suggestion.address);
    setAddressQuery(suggestion.address);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (eligibility) {
      const error = getEligibilityError({
        ...eligibility,
        hasOpenWindow: eligibility.hasOpenWindow ?? false,
      });
      if (error) {
        setStatus({ type: "error", text: error });
        return;
      }
    }

    const trimmedDestinationAddress = (destinationAddress || addressQuery).trim();
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
      };

      if (
        !matcherResponse.ok ||
        !matcherPayload.sealedDestinationRef ||
        !matcherPayload.routeDescriptorRef
      ) {
        throw new Error(matcherPayload.error ?? "Could not save destination.");
      }

      await createAvailability({
        windowStart,
        windowEnd,
        selfDeclaredGender: profile.selfDeclaredGender,
        sameGenderOnly: profile.sameGenderOnly,
        sealedDestinationRef: matcherPayload.sealedDestinationRef,
        routeDescriptorRef: matcherPayload.routeDescriptorRef,
      });
      persistDestinationLabel(matcherPayload.sealedDestinationRef, trimmedDestinationAddress);
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
    <form className="stack stagger" onSubmit={handleSubmit} style={{ overflow: "visible" }}>
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

      <div className="card stack" style={{ overflow: "visible", position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Destination</span>
          <small className="text-muted">Where you are heading after pickup from NUS Utown</small>
        </div>
        <div className="stack-xs">
          <label htmlFor="destination-address">Going to</label>
          <div style={{ position: "relative" }}>
            <input
              id="destination-address"
              type="text"
              className="input"
              value={addressQuery}
              onChange={(e) => handleAddressInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Search for your drop-off address"
              autoComplete="off"
              required
              style={{ width: "100%" }}
            />
            {destinationAddress ? (
              <div
                className="text-xs"
                style={{ color: "var(--color-success, #22c55e)", marginTop: 4 }}
              >
                {destinationAddress}
              </div>
            ) : null}
            {addressSearchError ? (
              <div className="text-xs" style={{ color: "var(--danger)", marginTop: 4 }}>
                {addressSearchError}
              </div>
            ) : null}
            {showSuggestions ? (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 999,
                  background: "var(--bg-elevated, var(--surface, #fff))",
                  border: "1px solid var(--border, #e2e2e2)",
                  borderRadius: "var(--radius-md, 8px)",
                  maxHeight: 220,
                  overflowY: "auto",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  marginTop: 4,
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={`${s.postal}-${s.address}`}
                    type="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      borderBottom: "1px solid var(--border, #eee)",
                      lineHeight: 1.4,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectSuggestion(s)}
                  >
                    <strong>{s.title}</strong>
                    <br />
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {s.address}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
          minSlot={minSlot}
          onDateInputChange={(nextDate) => {
            setDateInput(nextDate);
            const nextMinSlot = getEarliestSlotForDate(nextDate);
            const clamped = clampRange(startSlot, endSlot, nextMinSlot);
            setStartSlot(clamped.startSlot);
            setEndSlot(clamped.endSlot);
          }}
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
        disabled={busy || !(destinationAddress || addressQuery).trim()}
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
          ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
          className={`notice ${status.type === "error" ? "notice-error" : status.type === "success" ? "notice-success" : "notice-info"}`}
        >
          {status.text}
        </div>
      )}
    </form>
  );
}
