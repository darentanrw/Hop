"use client";

import type {
  SimulatorInputRider,
  SimulatorRunResponse,
  SimulatorSession,
  SimulatorSessionRider,
} from "@hop/shared";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCycleAssignments,
  buildSimulatorAlias,
  buildSimulatorStats,
  clearStoredAdminSimulatorState,
  createEmptySimulatorSession,
  loadStoredAdminSimulatorState,
  normalizeSimulatorSession,
  persistStoredAdminSimulatorState,
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
  lat: string;
  lng: string;
};

type ActivityTone = "neutral" | "success" | "warning" | "danger";

type ActivityEntry = {
  id: string;
  message: string;
  tone: ActivityTone;
};

type SimulatorFilter = "all" | "matched" | "open";
type SimulatorQueueExport = {
  version: 1;
  riders: SimulatorInputRider[];
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

function formatAddressSnippet(address: string, maxLength = 72) {
  const trimmed = address.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function formatWindowSummary(windowStart: string, windowEnd: string) {
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(start)
    .concat(" - ")
    .concat(
      new Intl.DateTimeFormat("en-SG", {
        hour: "numeric",
        minute: "2-digit",
      }).format(end),
    );
}

function formatDepartureTime(isoDatetime: string) {
  return new Intl.DateTimeFormat("en-SG", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoDatetime));
}

function getGroupDepartureTime(memberRiderIds: string[], riders: SimulatorSessionRider[]) {
  const memberTimes = memberRiderIds
    .map((riderId) => riders.find((rider) => rider.id === riderId)?.windowStart)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());

  if (memberTimes.length === 0) return null;
  return new Date(Math.max(...memberTimes)).toISOString();
}

function isImportedQueueRider(value: unknown): value is SimulatorInputRider {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.label === "string" &&
    typeof record.address === "string" &&
    (record.verifiedTitle == null || typeof record.verifiedTitle === "string") &&
    (record.postal == null || typeof record.postal === "string") &&
    typeof record.windowStart === "string" &&
    !Number.isNaN(Date.parse(record.windowStart)) &&
    typeof record.windowEnd === "string" &&
    !Number.isNaN(Date.parse(record.windowEnd)) &&
    (record.selfDeclaredGender === "woman" ||
      record.selfDeclaredGender === "man" ||
      record.selfDeclaredGender === "nonbinary" ||
      record.selfDeclaredGender === "prefer_not_to_say") &&
    typeof record.sameGenderOnly === "boolean"
  );
}

function buildQueueExport(session: SimulatorSession): SimulatorQueueExport {
  return {
    version: 1,
    riders: session.riders.map((rider) => ({
      label: rider.label,
      address: rider.address,
      verifiedTitle: rider.verifiedTitle,
      postal: rider.postal,
      windowStart: rider.windowStart,
      windowEnd: rider.windowEnd,
      selfDeclaredGender: rider.selfDeclaredGender,
      sameGenderOnly: rider.sameGenderOnly,
    })),
  };
}

function parseQueueImport(rawText: string): SimulatorInputRider[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Import a valid JSON queue export.");
  }

  const riderValues = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { riders?: unknown[] }).riders)
      ? (parsed as { riders: unknown[] }).riders
      : null;

  if (!riderValues) {
    throw new Error("Queue import must be a rider array or an object with a riders array.");
  }

  if (riderValues.length === 0) {
    throw new Error("Imported queue is empty.");
  }

  if (!riderValues.every(isImportedQueueRider)) {
    throw new Error("One or more imported riders are invalid.");
  }

  return riderValues;
}

function resetSimulationState(session: SimulatorSession): SimulatorSession {
  return normalizeSimulatorSession({
    ...session,
    nextCycleNumber: 1,
    groups: [],
    openRiderIds: [],
    riders: session.riders.map((rider) => ({
      ...rider,
      state: "new",
      lastProcessedCycleNumber: null,
      matchedGroupId: null,
      color: null,
      dropoffOrder: null,
      clusterKey: null,
      maskedLocationLabel: null,
      coordinate: null,
    })),
  });
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

async function submitDestination(address: string) {
  const response = await fetch("/api/matcher/destination", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    sealedDestinationRef?: string;
    routeDescriptorRef?: string;
  } | null;

  if (!response.ok || !payload?.sealedDestinationRef || !payload?.routeDescriptorRef) {
    throw new Error(payload?.error ?? "Could not save destination.");
  }

  return {
    sealedDestinationRef: payload.sealedDestinationRef,
    routeDescriptorRef: payload.routeDescriptorRef,
  };
}

async function resolveInitialMapPreview(
  rider: SimulatorInputRider,
  suggestion?: AddressSuggestion | null,
) {
  const match =
    suggestion ?? (await searchAddresses(rider.address).then((results) => results[0] ?? null));
  if (!match) return { coordinate: null, maskedLocationLabel: rider.verifiedTitle?.trim() || null };

  const lat = Number.parseFloat(match.lat);
  const lng = Number.parseFloat(match.lng);
  return {
    coordinate:
      Number.isFinite(lat) && Number.isFinite(lng)
        ? {
            lat,
            lng,
          }
        : null,
    maskedLocationLabel: match.title.trim() || rider.verifiedTitle?.trim() || null,
  };
}

async function appendInputRiderToSession(
  session: SimulatorSession,
  rider: SimulatorInputRider,
  suggestion?: AddressSuggestion | null,
): Promise<SimulatorSession> {
  const [destination, preview] = await Promise.all([
    submitDestination(rider.address),
    resolveInitialMapPreview(rider, suggestion).catch(() => ({
      coordinate: null,
      maskedLocationLabel: rider.verifiedTitle?.trim() || null,
    })),
  ]);
  const nextRider: SimulatorSessionRider = {
    id: createId("sim_rider"),
    label: rider.label.trim() || buildSimulatorAlias(session.nextArrivalIndex),
    arrivalIndex: session.nextArrivalIndex,
    address: rider.address.trim(),
    verifiedTitle: rider.verifiedTitle?.trim() || null,
    postal: rider.postal?.trim() || null,
    windowStart: rider.windowStart,
    windowEnd: rider.windowEnd,
    selfDeclaredGender: rider.selfDeclaredGender,
    sameGenderOnly: rider.sameGenderOnly,
    sealedDestinationRef: destination.sealedDestinationRef,
    routeDescriptorRef: destination.routeDescriptorRef,
    state: "new",
    lastProcessedCycleNumber: null,
    matchedGroupId: null,
    maskedLocationLabel: preview.maskedLocationLabel,
    coordinate: preview.coordinate,
    clusterKey: null,
    color: null,
    dropoffOrder: null,
  };

  return normalizeSimulatorSession({
    ...session,
    nextArrivalIndex: session.nextArrivalIndex + 1,
    riders: [...session.riders, nextRider],
  });
}

export function AdminSimulatorClient() {
  const initialDate = useMemo(() => getDefaultDateInput(), []);
  const initialRange = useMemo(() => getDefaultRange(initialDate), [initialDate]);
  const [session, setSession] = useState<SimulatorSession>(() => createEmptySimulatorSession());
  const [lastRun, setLastRun] = useState<SimulatorRunResponse | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);
  const [searchResults, setSearchResults] = useState<AddressSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState(initialDate);
  const [startSlot, setStartSlot] = useState(initialRange.startSlot);
  const [endSlot, setEndSlot] = useState(initialRange.endSlot);
  const [filter, setFilter] = useState<SimulatorFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [savingRider, setSavingRider] = useState(false);
  const [importingQueue, setImportingQueue] = useState(false);
  const [compatibilityExpanded, setCompatibilityExpanded] = useState(false);
  const [highlightedGroupId, setHighlightedGroupId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const stored = loadStoredAdminSimulatorState();
    if (stored) {
      setSession(stored.session);
      setLastRun(stored.lastRun);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistStoredAdminSimulatorState({
      version: 1,
      session,
      lastRun,
    });
  }, [hydrated, lastRun, session]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showImportModal) return;
    requestAnimationFrame(() => importTextareaRef.current?.focus());
  }, [showImportModal]);

  useEffect(() => {
    const minSlot = getEarliestSlotForDate(dateInput);
    const next = clampRange(startSlot, endSlot, minSlot);
    if (next.startSlot !== startSlot) setStartSlot(next.startSlot);
    if (next.endSlot !== endSlot) setEndSlot(next.endSlot);
  }, [dateInput, endSlot, startSlot]);

  const stats = useMemo(
    () => buildSimulatorStats(session, lastRun?.compatibilityEdges ?? []),
    [lastRun?.compatibilityEdges, session],
  );
  const cycleAssignments = useMemo(() => buildCycleAssignments(session), [session]);
  const matchedGroups = useMemo(() => session.groups, [session.groups]);
  const openPoolRiders = useMemo(
    () => session.riders.filter((rider) => rider.state !== "matched"),
    [session.riders],
  );
  const visibleOpenPoolRiders = useMemo(
    () => openPoolRiders.filter(() => filter !== "matched"),
    [filter, openPoolRiders],
  );
  const reversedLog = useMemo(() => [...activityLog].reverse(), [activityLog]);
  const { dateLabel, timeLabel } = formatRangeSummaryParts(dateInput, startSlot, endSlot);

  function appendLog(message: string, tone: ActivityTone = "neutral") {
    setActivityLog((current) => [...current, { id: createId("log"), message, tone }]);
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

  async function addCurrentRider() {
    const nextAddress = (selectedSuggestion?.address ?? addressQuery).trim();
    if (!nextAddress) {
      setError("Search for an address before adding a rider.");
      appendLog("Search for an address before adding a rider.", "warning");
      return;
    }

    setSavingRider(true);
    setError(null);

    const { windowStart, windowEnd } = slotsToIsoRange(dateInput, startSlot, endSlot);

    try {
      const nextSession = await appendInputRiderToSession(
        session,
        {
          label: buildSimulatorAlias(session.nextArrivalIndex),
          address: nextAddress,
          verifiedTitle: selectedSuggestion?.title ?? null,
          postal: selectedSuggestion?.postal ?? null,
          windowStart,
          windowEnd,
          selfDeclaredGender: "prefer_not_to_say",
          sameGenderOnly: false,
        },
        selectedSuggestion,
      );
      setSession(nextSession);
      setLastRun(null);
      appendLog(
        `Added ${selectedSuggestion?.title ?? formatAddressSnippet(nextAddress, 40)} for cycle queue.`,
        "success",
      );
      resetSearchBox();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Could not add rider.";
      setError(message);
      appendLog(message, "danger");
    } finally {
      setSavingRider(false);
    }
  }

  function exportQueue() {
    if (session.riders.length === 0) {
      const message = "Add riders before exporting the queue.";
      setError(message);
      appendLog(message, "warning");
      return;
    }

    const queueJson = JSON.stringify(buildQueueExport(session), null, 2);
    const blob = new Blob([queueJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hop-simulator-queue-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    appendLog(
      `Exported ${session.riders.length} queued rider${session.riders.length === 1 ? "" : "s"}.`,
      "success",
    );
  }

  async function importQueue() {
    setImportingQueue(true);
    setError(null);

    try {
      const riders = parseQueueImport(importText.trim());
      let nextSession = session;
      for (const rider of riders) {
        nextSession = await appendInputRiderToSession(nextSession, rider);
      }
      setSession(nextSession);
      setLastRun(null);
      setImportText("");
      setShowImportModal(false);
      appendLog(
        `Imported ${riders.length} queued rider${riders.length === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (importError) {
      const message =
        importError instanceof Error ? importError.message : "Could not import queue.";
      setError(message);
      appendLog(message, "danger");
    } finally {
      setImportingQueue(false);
    }
  }

  function clearSession() {
    const nextSession = createEmptySimulatorSession();
    setSession(nextSession);
    setLastRun(null);
    setError(null);
    clearStoredAdminSimulatorState();
    appendLog("Cleared simulator session.", "warning");
  }

  function removeRider(riderId: string) {
    const nextSession = resetSimulationState({
      ...session,
      riders: session.riders.filter((rider) => rider.id !== riderId),
    });
    setSession(nextSession);
    setLastRun(null);
    appendLog("Removed rider and reset simulated matches.", "warning");
  }

  async function runSimulation() {
    if (session.riders.length === 0) {
      setError("Add at least one rider before running the simulator.");
      appendLog("Add at least one rider before running the simulator.", "warning");
      return;
    }

    setRunning(true);
    setError(null);
    appendLog(
      `Running ${cycleAssignments.length || 1} simulated cycle${cycleAssignments.length === 1 ? "" : "s"} across ${session.riders.length} riders.`,
    );

    try {
      const response = await fetch("/api/admin/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
      const payload = (await response.json().catch(() => null)) as
        | SimulatorRunResponse
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("session" in payload)) {
        throw new Error(payload && "error" in payload ? payload.error : "Simulation failed.");
      }

      setSession(payload.session);
      setLastRun(payload);
      appendLog(
        `Run complete: ${payload.stats.groupsFormed} groups, ${payload.stats.unmatchedRiders} riders still open.`,
        "success",
      );
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Simulation failed.";
      setError(message);
      appendLog(message, "danger");
    } finally {
      setRunning(false);
    }
  }

  const visibleMatchedGroups = filter === "open" ? [] : matchedGroups;

  return (
    <div className="page-container no-nav admin-simulator-page">
      <div className="stack-lg stagger admin-simulator-shell">
        <div className="admin-simulator-hero admin-simulator-hero-compact">
          <div className="admin-simulator-toolbar">
            <div className="stack-xs">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/admin"
                  className="btn btn-ghost btn-sm"
                  style={{ minWidth: 0, paddingInline: 10 }}
                >
                  ← Back
                </Link>
                <h1 style={{ margin: 0 }}>Incremental match simulator</h1>
              </div>
              <p className="admin-simulator-hero-copy">
                Add riders one by one, keep local pool, simulate rolling matching cycles instead of
                one giant batch.
              </p>
            </div>
            <div className="admin-simulator-hero-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void runSimulation()}
                disabled={running || savingRider || importingQueue}
              >
                {running ? "Running…" : "Run matching"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={exportQueue}
                disabled={running || savingRider || importingQueue}
              >
                Export
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImportModal(true)}
                disabled={running || savingRider || importingQueue}
              >
                Import
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearSession}
                disabled={running || savingRider || importingQueue}
              >
                Clear session
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="notice notice-error">{error}</div> : null}

        <section className="admin-simulator-workbench">
          <aside
            className="admin-simulator-sidecard"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div
              className="card"
              style={{ gap: 12, display: "flex", flexDirection: "column", padding: 14 }}
            >
              <div className="row-between">
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Add rider
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  #{session.nextArrivalIndex + 1}
                </span>
              </div>

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
                      void addCurrentRider();
                    }
                  }}
                  placeholder="Search OneMap…"
                  disabled={running || savingRider || importingQueue}
                  style={{ fontSize: 13, padding: "10px 12px" }}
                />
                {selectedSuggestion ? (
                  <div className="text-xs text-accent" style={{ marginTop: 4 }}>
                    Selected: {selectedSuggestion.title}
                  </div>
                ) : null}
                {searchError ? (
                  <div className="text-xs text-danger" style={{ marginTop: 4 }}>
                    {searchError}
                  </div>
                ) : null}
                {showDropdown ? (
                  <div className="admin-simulator-suggestions">
                    {searchResults.map((result, index) => (
                      <button
                        key={`${result.title}-${result.postal ?? "nil"}-${result.address}-${index}`}
                        type="button"
                        className="admin-simulator-suggestion-button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setSelectedSuggestion(result)}
                      >
                        <strong>{result.title}</strong>
                        <span>{result.address}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="admin-simulator-window-card">
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <span className="text-sm fw-600">Ride window</span>
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
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm w-full"
                onClick={() => void addCurrentRider()}
                disabled={running || savingRider || importingQueue}
                style={{ fontSize: 12 }}
              >
                {savingRider ? "Saving…" : "+ Add rider"}
              </button>
            </div>

            <div
              className="card admin-simulator-fill-card"
              style={{ padding: 14, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Queue
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {session.riders.length}
                </span>
              </div>
              <div className="admin-sim-addr-list">
                {session.riders.map((rider) => (
                  <div className="admin-sim-rider-row" key={rider.id}>
                    <div className="row-between" style={{ gap: 8 }}>
                      <div>
                        <div className="admin-sim-rider-title">{rider.label}</div>
                        <div className="admin-sim-rider-subtle">
                          {rider.verifiedTitle ?? formatAddressSnippet(rider.address, 42)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="admin-sim-addr-rm"
                        onClick={() => removeRider(rider.id)}
                        disabled={running || savingRider || importingQueue}
                        title="Remove rider"
                      >
                        ×
                      </button>
                    </div>
                    <div className="admin-sim-rider-meta">
                      <span className="pill pill-muted">arrival {rider.arrivalIndex + 1}</span>
                      <span className="pill pill-muted">
                        {formatWindowSummary(rider.windowStart, rider.windowEnd)}
                      </span>
                    </div>
                    <div className="admin-sim-rider-meta">
                      {rider.state === "matched" ? (
                        <span className="pill pill-accent">Matched</span>
                      ) : rider.state === "open" ? (
                        <span className="pill pill-muted">Carry-over unmatched</span>
                      ) : (
                        <span className="pill pill-muted">New this run</span>
                      )}
                      {rider.lastProcessedCycleNumber ? (
                        <span className="pill pill-muted">
                          cycle {rider.lastProcessedCycleNumber}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {session.riders.length === 0 ? (
                  <p
                    className="text-muted"
                    style={{ fontSize: 11, textAlign: "center", padding: "12px 0" }}
                  >
                    No riders yet
                  </p>
                ) : null}
              </div>
            </div>
          </aside>

          <section className="card stack admin-simulator-map-stage">
            <div className="row-between admin-simulator-map-stage-header">
              <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                Route map
              </h3>
              <div className="row-wrap" style={{ gap: 6 }}>
                <button
                  type="button"
                  className={`btn btn-sm admin-simulator-filter-chip ${filter === "all" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`btn btn-sm admin-simulator-filter-chip ${filter === "matched" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter("matched")}
                >
                  Matched
                </button>
                <button
                  type="button"
                  className={`btn btn-sm admin-simulator-filter-chip ${filter === "open" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setFilter("open")}
                >
                  Open pool
                </button>
              </div>
            </div>
            <div className="admin-simulator-map-frame">
              <AdminSimulatorMap
                session={session}
                filter={filter}
                highlightedGroupId={highlightedGroupId}
              />
            </div>

            <div className="admin-simulator-under-map-grid">
              <div
                className="card admin-simulator-compact-card"
                style={{ minHeight: 0, display: "flex", flexDirection: "column" }}
              >
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                    Open pool
                  </h3>
                  <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                    {openPoolRiders.length}
                  </span>
                </div>
                <div className="admin-simulator-log-list">
                  {visibleOpenPoolRiders.length > 0 ? (
                    visibleOpenPoolRiders.map((rider) => (
                      <div className="admin-sim-open-rider" key={rider.id}>
                        <div className="row-between" style={{ gap: 8 }}>
                          <strong style={{ fontSize: 12 }}>{rider.label}</strong>
                          {rider.state === "new" ? (
                            <span className="pill pill-muted">New</span>
                          ) : (
                            <span className="pill pill-muted">Carry-over unmatched</span>
                          )}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {rider.maskedLocationLabel ??
                            rider.verifiedTitle ??
                            formatAddressSnippet(rider.address, 42)}
                        </div>
                        <div className="admin-sim-rider-meta">
                          <span className="pill pill-muted">
                            {formatWindowSummary(rider.windowStart, rider.windowEnd)}
                          </span>
                          {rider.lastProcessedCycleNumber ? (
                            <span className="pill pill-muted">
                              cycle {rider.lastProcessedCycleNumber}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p
                      className="text-muted"
                      style={{ fontSize: 11, textAlign: "center", padding: 12 }}
                    >
                      No riders in the open pool
                    </p>
                  )}
                </div>
              </div>

              <div
                className="card admin-simulator-compact-card"
                style={{ minHeight: 0, display: "flex", flexDirection: "column" }}
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
                      <div
                        className="admin-simulator-log-item"
                        data-tone={entry.tone}
                        key={entry.id}
                      >
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
            </div>
          </section>

          <aside
            className="admin-simulator-sidecard"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="card" style={{ padding: 14 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Summary
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  cycle {session.nextCycleNumber}
                </span>
              </div>
              <div className="admin-sim-stats">
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{stats.totalRiders}</span>
                  <span className="admin-sim-stat-k">Riders</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v text-success">{stats.matchedRiders}</span>
                  <span className="admin-sim-stat-k">Matched</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{stats.unmatchedRiders}</span>
                  <span className="admin-sim-stat-k">Open pool</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{stats.groupsFormed}</span>
                  <span className="admin-sim-stat-k">Groups</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">{stats.averagePairScore.toFixed(2)}</span>
                  <span className="admin-sim-stat-k">Avg score</span>
                </div>
                <div className="admin-sim-stat">
                  <span className="admin-sim-stat-v">
                    {formatDistance(stats.totalRouteDistanceMeters)}
                  </span>
                  <span className="admin-sim-stat-k">Distance</span>
                </div>
              </div>

              {cycleAssignments.length ? (
                <div
                  className="admin-simulator-cycles-section"
                  style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <h4 className="font-display fw-700" style={{ fontSize: 12 }}>
                    Upcoming cycles
                  </h4>
                  <div className="admin-simulator-cycles-list">
                    {cycleAssignments.map((assignment) => (
                      <div className="admin-sim-cycle" key={assignment.cycleNumber}>
                        <strong>Cycle {assignment.cycleNumber}</strong>
                        <span>
                          {assignment.riderIds.length > 0
                            ? `${assignment.riderIds.length} new rider${assignment.riderIds.length === 1 ? "" : "s"}`
                            : "recheck open pool"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div
              className="card admin-simulator-fill-card"
              style={{ padding: 14, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                  Matched groups
                </h3>
                <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
                  {matchedGroups.length}
                </span>
              </div>
              <div className="admin-simulator-scroll-stack" style={{ gap: 8 }}>
                {visibleMatchedGroups.map((group) => {
                  const departureTime = getGroupDepartureTime(group.memberRiderIds, session.riders);
                  const orderedStops = group.memberRiderIds
                    .map(
                      (riderId, index) =>
                        `${index + 1}.${session.riders.find((rider) => rider.id === riderId)?.label ?? riderId}`,
                    )
                    .join(" → ");

                  return (
                    <div
                      className="admin-sim-group"
                      key={group.groupId}
                      style={{ borderLeftColor: group.color }}
                      onMouseEnter={() => setHighlightedGroupId(group.groupId)}
                      onMouseLeave={() =>
                        setHighlightedGroupId((current) =>
                          current === group.groupId ? null : current,
                        )
                      }
                    >
                      <div className="row-between" style={{ gap: 8 }}>
                        <strong style={{ fontSize: 12, color: group.color }}>{group.name}</strong>
                        <span className="font-mono text-muted" style={{ fontSize: 10 }}>
                          {formatDuration(group.totalTimeSeconds)}
                        </span>
                      </div>
                      {departureTime ? (
                        <div className="admin-sim-rider-meta" style={{ marginTop: 4 }}>
                          <span className="pill pill-muted">
                            Departs {formatDepartureTime(departureTime)}
                          </span>
                        </div>
                      ) : null}
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {orderedStops}
                      </div>
                    </div>
                  );
                })}
                {visibleMatchedGroups.length === 0 ? (
                  <p
                    className="text-muted"
                    style={{ fontSize: 11, textAlign: "center", padding: "10px 0" }}
                  >
                    No matched groups in this filter
                  </p>
                ) : null}
              </div>
            </div>

            {lastRun?.compatibilityEdges.length ? (
              <div className="card admin-simulator-collapsible-card" style={{ padding: 12 }}>
                <div
                  className="row-between"
                  style={{ marginBottom: compatibilityExpanded ? 8 : 0 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 className="font-display fw-700" style={{ fontSize: 13 }}>
                      Compatibility
                    </h3>
                    <span className="pill pill-accent" style={{ fontSize: 10, padding: "2px 8px" }}>
                      {lastRun.compatibilityEdges.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm admin-simulator-collapse-button"
                    onClick={() => setCompatibilityExpanded((current) => !current)}
                  >
                    {compatibilityExpanded ? "Minimise" : "Expand"}
                  </button>
                </div>
                {compatibilityExpanded ? (
                  <div className="admin-compat-list">
                    {lastRun.compatibilityEdges.map((edge) => (
                      <div
                        className="admin-compat-edge"
                        key={`${edge.leftRiderId}-${edge.rightRiderId}-${edge.cycleNumber}`}
                      >
                        <div className="row-between" style={{ marginBottom: 4 }}>
                          <span className="font-display fw-600" style={{ fontSize: 11 }}>
                            {edge.leftAlias} ↔ {edge.rightAlias}
                          </span>
                          <span className="font-display fw-700" style={{ fontSize: 14 }}>
                            {edge.score.toFixed(2)}
                          </span>
                        </div>
                        <div className="row-wrap" style={{ gap: 4 }}>
                          <span
                            className="pill pill-muted"
                            style={{ fontSize: 9, padding: "1px 6px" }}
                          >
                            cycle {edge.cycleNumber}
                          </span>
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
                            {edge.spreadDistanceKm.toFixed(1)}km spread
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        </section>
      </div>

      {showImportModal ? (
        <div
          className="admin-import-backdrop"
          onClick={() => {
            if (!importingQueue) setShowImportModal(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !importingQueue) {
              setShowImportModal(false);
            }
          }}
        >
          <div
            className="admin-import-modal card"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={() => {}}
          >
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h3 className="font-display fw-700" style={{ fontSize: 15 }}>
                Import queue
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowImportModal(false)}
                disabled={importingQueue}
              >
                ✕
              </button>
            </div>
            <textarea
              ref={importTextareaRef}
              className="admin-import-textarea"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='{"version":1,"riders":[{"label":"Rider 1","address":"...","windowStart":"...","windowEnd":"...","selfDeclaredGender":"prefer_not_to_say","sameGenderOnly":false}]}'
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.metaKey) {
                  event.preventDefault();
                  void importQueue();
                }
              }}
            />
            <div className="row-between" style={{ marginTop: 12 }}>
              <span className="text-xs text-muted">
                Appends to the current queue. Cmd+Enter to import.
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void importQueue()}
                disabled={!importText.trim() || importingQueue}
              >
                {importingQueue ? "Importing…" : "Import queue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
