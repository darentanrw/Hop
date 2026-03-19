"use client";

import type { SimulatorRequest, SimulatorResponse } from "@hop/shared";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultSimulatorRequest,
  toSimulatorJson,
  validateSimulatorRequest,
} from "../lib/admin-simulator";
import {
  clampRange,
  formatRangeSummaryParts,
  getDefaultDateInput,
  getDefaultRange,
  getEarliestSlotForDate,
  slotsToIsoRange,
} from "../lib/time-range";
import { TimeRangePicker } from "./time-range-picker";

const matcherBaseUrl = process.env.NEXT_PUBLIC_MATCHER_BASE_URL ?? "http://localhost:4001";

const AdminSimulatorMap = dynamic(
  () =>
    import("./admin-simulator-map").then((module) => ({
      default: module.AdminSimulatorMap,
    })),
  {
    ssr: false,
    loading: () => <div className="admin-simulator-map-skeleton" />,
  },
);

type AddressSuggestion = {
  title: string;
  address: string;
  postal: string;
};

type AddressEntry = {
  id: string;
  address: string;
  verifiedTitle: string | null;
  postal: string | null;
};

type ActivityTone = "neutral" | "success" | "warning" | "danger";

type ActivityEntry = {
  id: string;
  message: string;
  tone: ActivityTone;
};

function createId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}`;
}

function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number) {
  return `${Math.round(seconds / 60)} min`;
}

function buildAddressEntriesFromRequest(request: SimulatorRequest): AddressEntry[] {
  return request.riders.map((rider) => ({
    id: createId("address"),
    address: rider.address,
    verifiedTitle: null,
    postal: null,
  }));
}

function formatAddressSnippet(address: string, maxLength = 72) {
  const trimmed = address.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function buildRequestFromControls(args: {
  addresses: AddressEntry[];
  dateInput: string;
  startSlot: number;
  endSlot: number;
}): SimulatorRequest {
  const { windowStart, windowEnd } = slotsToIsoRange(args.dateInput, args.startSlot, args.endSlot);

  return {
    riders: args.addresses
      .map((entry) => entry.address.trim())
      .filter(Boolean)
      .map((address, index) => ({
        label: `Rider ${index + 1}`,
        address,
        windowStart,
        windowEnd,
        selfDeclaredGender: "prefer_not_to_say" as const,
        sameGenderOnly: false,
      })),
  };
}

async function searchAddresses(query: string): Promise<AddressSuggestion[]> {
  if (query.trim().length < 2) return [];
  const response = await fetch(
    `${matcherBaseUrl}/matcher/search?q=${encodeURIComponent(query.trim())}`,
  );
  const data = (await response.json().catch(() => null)) as {
    error?: string;
    results?: AddressSuggestion[];
  } | null;
  if (!response.ok) {
    throw new Error(data?.error ?? "Address search is unavailable right now. Try again.");
  }
  return data?.results ?? [];
}

export function AdminSimulatorClient() {
  const sampleRequest = useMemo(() => buildDefaultSimulatorRequest(), []);
  const initialDate = useMemo(() => getDefaultDateInput(), []);
  const initialRange = useMemo(() => getDefaultRange(initialDate), [initialDate]);

  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);
  const [searchResults, setSearchResults] = useState<AddressSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState(initialDate);
  const [startSlot, setStartSlot] = useState(initialRange.startSlot);
  const [endSlot, setEndSlot] = useState(initialRange.endSlot);
  const [result, setResult] = useState<SimulatorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [visibleRiderCount, setVisibleRiderCount] = useState(0);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const loggedVisibleCountRef = useRef(0);
  const importTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (showImportModal) {
      requestAnimationFrame(() => importTextareaRef.current?.focus());
    }
  }, [showImportModal]);

  useEffect(() => {
    const minSlot = getEarliestSlotForDate(dateInput);
    const next = clampRange(startSlot, endSlot, minSlot);
    if (next.startSlot !== startSlot) setStartSlot(next.startSlot);
    if (next.endSlot !== endSlot) setEndSlot(next.endSlot);
  }, [dateInput, endSlot, startSlot]);

  useEffect(() => {
    if (!result) {
      setVisibleRiderCount(0);
      loggedVisibleCountRef.current = 0;
      return;
    }

    setVisibleRiderCount(0);
    loggedVisibleCountRef.current = 0;

    const interval = window.setInterval(() => {
      setVisibleRiderCount((current) => {
        if (current >= result.riders.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 260);

    return () => window.clearInterval(interval);
  }, [result]);

  useEffect(() => {
    if (!result) return;
    if (visibleRiderCount <= loggedVisibleCountRef.current) return;

    const nextEntries = result.riders
      .slice(loggedVisibleCountRef.current, visibleRiderCount)
      .map((rider) => {
        const group = result.groups.find((entry) => entry.groupId === rider.groupId);
        return {
          id: createId("log"),
          tone: rider.groupId ? "success" : "warning",
          message: rider.groupId
            ? `${rider.alias} → ${group?.name ?? "group"} · ${rider.maskedLocationLabel}`
            : `${rider.alias} unmatched · ${rider.maskedLocationLabel}`,
        } satisfies ActivityEntry;
      });

    loggedVisibleCountRef.current = visibleRiderCount;
    setActivityLog((current) => [...current, ...nextEntries]);
  }, [result, visibleRiderCount]);

  const generatedRequest = useMemo(
    () =>
      buildRequestFromControls({
        addresses,
        dateInput,
        startSlot,
        endSlot,
      }),
    [addresses, dateInput, endSlot, startSlot],
  );

  const generatedJson = useMemo(() => toSimulatorJson(generatedRequest), [generatedRequest]);
  const { dateLabel, timeLabel } = formatRangeSummaryParts(dateInput, startSlot, endSlot);

  function appendLog(message: string, tone: ActivityTone = "neutral") {
    setActivityLog((current) => [...current, { id: createId("log"), message, tone }]);
  }

  function replaceLogs(entries: ActivityEntry[]) {
    setActivityLog(entries);
  }

  function resetSearchBox() {
    setAddressQuery("");
    setSelectedSuggestion(null);
    setSearchResults([]);
    setShowDropdown(false);
    setSearchError(null);
  }

  function handleAddressQueryChange(value: string) {
    setAddressQuery(value);
    setSelectedSuggestion(null);
    setSearchError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchAddresses(value);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch (searchFailure) {
        setSearchResults([]);
        setShowDropdown(false);
        setSearchError(
          searchFailure instanceof Error
            ? searchFailure.message
            : "Address search is unavailable right now. Try again.",
        );
      }
    }, 240);
  }

  function selectSuggestion(suggestion: AddressSuggestion) {
    setAddresses((current) => [
      ...current,
      {
        id: createId("address"),
        address: suggestion.address,
        verifiedTitle: suggestion.title,
        postal: suggestion.postal,
      },
    ]);
    appendLog(`+ ${suggestion.title}`, "success");
    resetSearchBox();
  }

  function addCurrentAddress() {
    const nextAddress = (selectedSuggestion?.address ?? addressQuery).trim();
    if (!nextAddress) {
      appendLog("Search for an address before adding.", "warning");
      return;
    }

    setAddresses((current) => [
      ...current,
      {
        id: createId("address"),
        address: nextAddress,
        verifiedTitle: selectedSuggestion?.title ?? null,
        postal: selectedSuggestion?.postal ?? null,
      },
    ]);

    appendLog(`+ ${selectedSuggestion?.title ?? formatAddressSnippet(nextAddress, 50)}`, "success");

    resetSearchBox();
  }

  function loadSample() {
    const sampleAddresses = buildAddressEntriesFromRequest(sampleRequest);
    setAddresses(sampleAddresses);
    setError(null);
    resetSearchBox();
    appendLog(`Loaded ${sampleAddresses.length} sample addresses.`, "success");
  }

  function clearAddresses() {
    setAddresses([]);
    setResult(null);
    setError(null);
    loggedVisibleCountRef.current = 0;
    resetSearchBox();
    replaceLogs([{ id: createId("log"), message: "Cleared.", tone: "warning" }]);
  }

  function submitImport() {
    const trimmed = importText.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      const validation = validateSimulatorRequest(parsed);
      if (!validation.ok) {
        setError(validation.error);
        appendLog(validation.error, "danger");
        return;
      }
      const imported = buildAddressEntriesFromRequest(validation.data);
      setAddresses(imported);
      setResult(null);
      setError(null);
      resetSearchBox();
      setShowImportModal(false);
      setImportText("");
      replaceLogs([
        {
          id: createId("log"),
          message: `Imported ${imported.length} riders from JSON`,
          tone: "success",
        },
      ]);
    } catch {
      setError("Invalid JSON.");
      appendLog("Invalid JSON.", "danger");
    }
  }

  function removeAddress(id: string, index: number) {
    setAddresses((current) => current.filter((entry) => entry.id !== id));
    appendLog(`Removed Rider ${index + 1}.`, "warning");
  }

  async function runSimulation() {
    if (generatedRequest.riders.length < 2) {
      const message = "Add at least 2 addresses.";
      setError(message);
      replaceLogs([{ id: createId("log"), message, tone: "danger" }]);
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);
    loggedVisibleCountRef.current = 0;

    replaceLogs([
      {
        id: createId("log"),
        message: `Sending ${generatedRequest.riders.length} riders → matcher`,
        tone: "neutral",
      },
    ]);

    try {
      const response = await fetch("/api/admin/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generatedRequest),
      });
      const payload = (await response.json().catch(() => null)) as
        | SimulatorResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : "Simulation failed.");
      }

      const simulation = payload as SimulatorResponse;
      setActivityLog((current) => [
        ...current,
        {
          id: createId("log"),
          message: `${simulation.stats.groupsFormed} group${simulation.stats.groupsFormed === 1 ? "" : "s"}, ${simulation.stats.compatiblePairCount} compatible pair${simulation.stats.compatiblePairCount === 1 ? "" : "s"}`,
          tone: "success",
        },
      ]);

      startTransition(() => {
        setResult(simulation);
      });
    } catch (simulationError) {
      const message =
        simulationError instanceof Error ? simulationError.message : "Simulation failed.";
      setError(message);
      setActivityLog((current) => [...current, { id: createId("log"), message, tone: "danger" }]);
    } finally {
      setRunning(false);
    }
  }

  const reversedLog = useMemo(() => [...activityLog].reverse(), [activityLog]);

  return (
    <div className="page-container no-nav admin-simulator-page">
      <div className="stack-lg stagger admin-simulator-shell">
        {/* Hero */}
        <div className="admin-simulator-hero admin-simulator-hero-compact">
          <div className="admin-simulator-toolbar">
            <div className="stack-xs">
              <div className="row-wrap" style={{ gap: 6 }}>
                <span className="pill pill-muted">Admin</span>
                <span className="pill pill-accent">Simulator</span>
              </div>
              <h1>Match route simulator</h1>
            </div>
            <div className="admin-simulator-hero-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void runSimulation()}
                disabled={running}
              >
                {running ? "Running…" : "Run"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadSample}
                disabled={running}
              >
                Sample
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowImportModal(true)}
                disabled={running}
              >
                Import
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearAddresses}
                disabled={running}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="notice notice-error">{error}</div> : null}

        {/* Workbench */}
        <section className="admin-simulator-workbench">
          {/* Left — Compat matrix + Addresses */}
          <aside
            className="admin-simulator-sidecard"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Compatibility matrix — inline in left column */}
            {result?.compatibilityEdges.length ? (
              <div className="card" style={{ padding: 12 }}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                    Compatibility
                  </h3>
                  <span className="pill pill-accent" style={{ fontSize: 10, padding: "2px 8px" }}>
                    {result.compatibilityEdges.length} pairs
                  </span>
                </div>
                <div className="admin-compat-list">
                  {result.compatibilityEdges.map((edge) => (
                    <div
                      className="admin-compat-edge"
                      key={`${edge.leftRiderId}-${edge.rightRiderId}`}
                    >
                      <div className="row-between" style={{ marginBottom: 4 }}>
                        <span className="font-display fw-600" style={{ fontSize: 11 }}>
                          {edge.leftAlias} ↔ {edge.rightAlias}
                        </span>
                        <span
                          className="font-display fw-700"
                          style={{
                            fontSize: 14,
                            color:
                              edge.score >= 0.7
                                ? "var(--success)"
                                : edge.score >= 0.4
                                  ? "var(--accent)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {edge.score.toFixed(2)}
                        </span>
                      </div>
                      <div className="admin-compat-bars">
                        <div className="admin-compat-bar-row">
                          <span className="text-xs text-muted">Route</span>
                          <div className="admin-compat-bar-track">
                            <div
                              className="admin-compat-bar-fill"
                              style={{ width: `${edge.routeOverlap * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted">
                            {edge.routeOverlap.toFixed(2)}
                          </span>
                        </div>
                        <div className="admin-compat-bar-row">
                          <span className="text-xs text-muted">Prox.</span>
                          <div className="admin-compat-bar-track">
                            <div
                              className="admin-compat-bar-fill admin-compat-bar-fill--privacy"
                              style={{ width: `${edge.destinationProximity * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted">
                            {edge.destinationProximity.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="row-wrap" style={{ marginTop: 4, gap: 4 }}>
                        <span
                          className="pill pill-muted"
                          style={{ fontSize: 9, padding: "1px 6px" }}
                        >
                          {edge.detourMinutes.toFixed(1)}m detour
                        </span>
                        <span
                          className="pill pill-muted"
                          style={{ fontSize: 9, padding: "1px 6px" }}
                        >
                          {edge.spreadDistanceKm.toFixed(1)}km
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              className="card"
              style={{ gap: 10, display: "flex", flexDirection: "column", padding: 12 }}
            >
              <div className="row-between">
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Addresses
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {generatedRequest.riders.length}
                </span>
              </div>

              {/* Search input */}
              <div style={{ position: "relative" }}>
                <input
                  id="sim-address-search"
                  type="text"
                  value={addressQuery}
                  onChange={(event) => handleAddressQueryChange(event.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 180)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCurrentAddress();
                    }
                  }}
                  placeholder="Search OneMap…"
                  disabled={running}
                  style={{ fontSize: 13, padding: "10px 12px" }}
                />
                {selectedSuggestion ? (
                  <div className="text-xs text-accent" style={{ marginTop: 4 }}>
                    ✓ {selectedSuggestion.title}
                  </div>
                ) : null}
                {searchError ? (
                  <div className="text-xs text-danger" style={{ marginTop: 4 }}>
                    {searchError}
                  </div>
                ) : null}
                {showDropdown ? (
                  <div className="admin-simulator-suggestions">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.postal}-${result.address}`}
                        type="button"
                        className="admin-simulator-suggestion-button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSuggestion(result)}
                      >
                        <strong>{result.title}</strong>
                        <span>{result.address}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm w-full"
                onClick={addCurrentAddress}
                disabled={running}
                style={{ fontSize: 12 }}
              >
                + Add
              </button>

              {/* Compact address list */}
              <div className="admin-sim-addr-list">
                {addresses.map((entry, index) => (
                  <div className="admin-sim-addr-row" key={entry.id}>
                    <span className="admin-sim-addr-idx">{index + 1}</span>
                    <span className="admin-sim-addr-text" title={entry.address}>
                      {entry.verifiedTitle ?? formatAddressSnippet(entry.address, 40)}
                    </span>
                    <button
                      type="button"
                      className="admin-sim-addr-rm"
                      onClick={() => removeAddress(entry.id, index)}
                      disabled={running}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {addresses.length === 0 ? (
                  <p
                    className="text-muted"
                    style={{ fontSize: 11, textAlign: "center", padding: "12px 0" }}
                  >
                    No addresses yet
                  </p>
                ) : null}
              </div>
            </div>
          </aside>

          {/* Center — Map */}
          <section className="card stack admin-simulator-map-stage">
            <div className="row-between admin-simulator-map-stage-header">
              <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                Route map
                {result ? (
                  <span className="text-muted fw-600" style={{ marginLeft: 8, fontSize: 11 }}>
                    {visibleRiderCount}/{result.riders.length} placed
                  </span>
                ) : null}
              </h3>
              <div className="row-wrap" style={{ gap: 4 }}>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {dateLabel}
                </span>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {timeLabel}
                </span>
              </div>
            </div>
            <div className="admin-simulator-map-frame">
              <AdminSimulatorMap result={result} visibleRiderCount={visibleRiderCount} />
            </div>
          </section>

          {/* Right — Summary + Log */}
          <aside
            className="admin-simulator-sidecard"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Compact summary stats */}
            <div className="card" style={{ padding: 14 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Summary
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {result ? `${result.stats.groupsFormed} grp` : "—"}
                </span>
              </div>
              <div className="admin-sim-stats">
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{generatedRequest.riders.length}</span>
                  <span className="admin-sim-stat-k">Riders</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v text-success">
                    {result?.stats.matchedRiders ?? 0}
                  </span>
                  <span className="admin-sim-stat-k">Matched</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{result?.stats.unmatchedRiders ?? 0}</span>
                  <span className="admin-sim-stat-k">Unmatched</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{result?.stats.groupsFormed ?? 0}</span>
                  <span className="admin-sim-stat-k">Groups</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">
                    {result?.stats.averagePairScore?.toFixed(2) ?? "—"}
                  </span>
                  <span className="admin-sim-stat-k">Avg score</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">
                    {formatDistance(result?.stats.totalRouteDistanceMeters ?? 0)}
                  </span>
                  <span className="admin-sim-stat-k">Distance</span>
                </div>
              </div>

              {/* Group cards */}
              {result?.groups.length ? (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {result.groups.map((group) => (
                    <div
                      className="admin-sim-group"
                      key={group.groupId}
                      style={{ borderLeftColor: group.color }}
                    >
                      <div className="row-between">
                        <strong style={{ fontSize: 12, color: group.color }}>{group.name}</strong>
                        <span className="font-mono text-muted" style={{ fontSize: 10 }}>
                          avg {group.averageScore.toFixed(2)} · {group.maxDetourMinutes.toFixed(0)}m
                          detour
                        </span>
                      </div>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {group.members.map((m) => m.alias).join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Activity log — newest first */}
            <div
              className="card"
              style={{
                padding: 14,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="row-between" style={{ marginBottom: 6 }}>
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Log
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {activityLog.length}
                </span>
              </div>
              <div className="admin-simulator-log-list">
                {reversedLog.length > 0 ? (
                  reversedLog.map((entry) => (
                    <div className="admin-simulator-log-item" data-tone={entry.tone} key={entry.id}>
                      {entry.message}
                    </div>
                  ))
                ) : (
                  <p
                    className="text-muted"
                    style={{ fontSize: 11, textAlign: "center", padding: 12 }}
                  >
                    No activity yet
                  </p>
                )}
              </div>
            </div>
          </aside>
        </section>

        {/* Time window */}
        <section className="card stack admin-simulator-window-card">
          <div className="row-between">
            <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
              Ride window
            </h3>
            <span className="pill pill-accent" style={{ fontSize: 10, padding: "2px 8px" }}>
              {dateLabel} · {timeLabel}
            </span>
          </div>
          <TimeRangePicker
            dateInput={dateInput}
            startSlot={startSlot}
            endSlot={endSlot}
            minSlot={getEarliestSlotForDate(dateInput)}
            onDateInputChange={setDateInput}
            onRangeChange={(next) => {
              setStartSlot(next.startSlot);
              setEndSlot(next.endSlot);
            }}
          />
        </section>

        <details className="card stack">
          <summary className="admin-simulator-summary">
            <span>Raw payload</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, marginLeft: "auto" }}
              onClick={(e) => {
                e.preventDefault();
                navigator.clipboard.writeText(generatedJson);
                appendLog("Copied payload to clipboard.", "success");
              }}
            >
              Copy
            </button>
          </summary>
          <pre className="admin-simulator-json-preview">{generatedJson}</pre>
        </details>
      </div>

      {showImportModal ? (
        <div
          className="admin-import-backdrop"
          onClick={() => setShowImportModal(false)}
          onKeyDown={(e) => e.key === "Escape" && setShowImportModal(false)}
        >
          <div
            className="admin-import-modal card"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={() => {}}
          >
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h3 className="font-display fw-700" style={{ fontSize: 15 }}>
                Import JSON
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImportModal(false)}
              >
                ✕
              </button>
            </div>
            <textarea
              className="admin-import-textarea"
              ref={importTextareaRef}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"riders": [{"label": "Rider 1", "address": "...", ...}]}'
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  submitImport();
                }
              }}
            />
            <div className="row-between" style={{ marginTop: 12 }}>
              <span className="text-xs text-muted">⌘ Enter to submit</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={submitImport}
                disabled={!importText.trim()}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
