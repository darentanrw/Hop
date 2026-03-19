"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";

const localQaRequested = process.env.NEXT_PUBLIC_ENABLE_LOCAL_QA === "true";
const matcherBaseUrl = process.env.NEXT_PUBLIC_MATCHER_BASE_URL ?? "http://localhost:4001";

type SearchResult = {
  title: string;
  address: string;
  postal: string;
  lat: string;
  lng: string;
};

type MatcherDestination = {
  address: string;
  sealedDestinationRef: string;
  routeDescriptorRef: string;
};

type MatcherEdge = {
  leftRef: string;
  rightRef: string;
  score: number;
  detourMinutes: number;
  spreadDistanceKm: number;
  routeOverlap: number;
  destinationProximity: number;
};

type LiveTestResult = {
  destinations: MatcherDestination[];
  edges: MatcherEdge[];
};

async function searchAddresses(query: string): Promise<SearchResult[]> {
  if (query.trim().length < 2) return [];
  const response = await fetch(
    `${matcherBaseUrl}/matcher/search?q=${encodeURIComponent(query.trim())}`,
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { results: SearchResult[] };
  return data.results ?? [];
}

async function submitAddressToMatcher(address: string): Promise<MatcherDestination> {
  const response = await fetch(`${matcherBaseUrl}/matcher/submit-destination`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Matcher rejected address: ${address}`);
  }
  const result = (await response.json()) as {
    sealedDestinationRef: string;
    routeDescriptorRef: string;
  };
  return { address, ...result };
}

async function scoreWithMatcher(routeDescriptorRefs: string[]): Promise<MatcherEdge[]> {
  const response = await fetch(`${matcherBaseUrl}/matcher/compatibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ routeDescriptorRefs }),
  });
  if (!response.ok) throw new Error("Matcher compatibility scoring failed.");
  const result = (await response.json()) as { edges: MatcherEdge[] };
  return result.edges;
}

function AddressInput({
  index,
  value,
  onChange,
  disabled,
}: {
  index: number;
  value: string;
  onChange: (address: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  function handleInput(text: string) {
    setQuery(text);
    onChange("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const hits = await searchAddresses(text);
      setResults(hits);
      setShowDropdown(hits.length > 0);
    }, 300);
  }

  function selectResult(result: SearchResult) {
    const fullAddress = result.address;
    setQuery(fullAddress);
    onChange(fullAddress);
    setShowDropdown(false);
    setResults([]);
  }

  return (
    <div style={{ position: "relative" }}>
      <label className="text-xs text-muted" style={{ marginBottom: 2, display: "block" }}>
        Rider {index + 1} destination
        <input
          type="text"
          className="input"
          placeholder="Search Singapore address..."
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          disabled={disabled}
          style={{ width: "100%", fontSize: 13 }}
        />
      </label>
      {value ? (
        <div className="text-xs" style={{ color: "var(--color-success)", marginTop: 2 }}>
          Selected
        </div>
      ) : null}
      {showDropdown ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--bg-elevated, #fff)",
            border: "1px solid var(--border, #e2e2e2)",
            borderRadius: 8,
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {results.map((result) => (
            <button
              key={`${result.postal}-${result.address}`}
              type="button"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: 12,
                borderBottom: "1px solid var(--border, #eee)",
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectResult(result)}
            >
              <strong>{result.title}</strong>
              <br />
              <span className="text-muted">{result.address}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LocalQaPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const snapshot = useQuery(api.admin.localQaSnapshot);
  const bootstrapLocalQaUser = useMutation(api.admin.bootstrapLocalQaUser);
  const seedLocalQaPool = useMutation(api.admin.seedLocalQaPool);
  const createLocalQaGroup = useMutation(api.admin.createLocalQaGroup);
  const forceLocalQaBotAcknowledgements = useMutation(api.admin.forceLocalQaBotAcknowledgements);
  const forceLockGroups = useMutation(api.admin.forceLockGroups);
  const forceHardLockGroups = useMutation(api.admin.forceHardLockGroups);
  const deleteCurrentLocalQaGroup = useMutation(api.admin.deleteCurrentLocalQaGroup);
  const syncLifecycle = useMutation(api.trips.advanceCurrentGroupLifecycle);
  const runMatching = useAction(api.mutations.runMatching);
  const runMatchingWithEdges = useAction(api.mutations.runMatchingWithEdges);
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [liveResult, setLiveResult] = useState<LiveTestResult | null>(null);
  const [liveAddresses, setLiveAddresses] = useState<string[]>(["", "", ""]);

  const localQaEnabled = localQaRequested && snapshot?.enabled === true;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!localQaEnabled) {
    return null;
  }

  async function run(
    actionKey: string,
    task: () => Promise<unknown>,
    successText: string | ((result: unknown) => string),
  ) {
    setBusyAction(actionKey);
    setStatus(null);
    try {
      const result = await task();
      setStatus({
        type: "success",
        text: typeof successText === "function" ? successText(result) : successText,
      });
    } catch (error) {
      setStatus({
        type: "error",
        text: error instanceof Error ? error.message : "Local QA action failed.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const activeGroup = snapshot?.activeGroup;
  const qaViewerUserId = searchParams.get("qaUserId");
  const otherTokens = (snapshot?.qrTokens ?? []).filter((member) => !member.isCurrentUser);
  const pendingBotAcknowledgements = otherTokens.filter(
    (member) => member.acknowledgementStatus !== "accepted",
  ).length;
  const canForceBotConfirmations =
    activeGroup?.status === "matched_pending_ack" && otherTokens.length > 0;
  const canForceLock = activeGroup?.status === "tentative";
  const canForceHardLock = activeGroup?.status === "semi_locked";

  function openGroupAs(userId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (userId === snapshot?.user.id) {
      params.delete("qaUserId");
    } else {
      params.set("qaUserId", userId);
    }
    const query = params.toString();
    const targetPath = activeGroup ? "/group" : pathname;
    router.push(query ? `${targetPath}?${query}` : targetPath);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="qa-fab"
        onClick={() => setOpen(true)}
        aria-label="Open local QA controls"
      >
        <span className="qa-fab-badge">QA</span>
        <span className="qa-fab-label">Local tools</span>
      </button>

      {open ? (
        <div className="qa-screen">
          <button
            type="button"
            className="qa-screen-backdrop"
            aria-label="Close local QA controls"
            onClick={() => setOpen(false)}
          />

          <div className="qa-screen-panel">
            <div className="qa-screen-header">
              <div>
                <div className="row" style={{ gap: 10, marginBottom: 6 }}>
                  <span className="pill pill-accent">Local QA</span>
                  <span className="pill pill-muted">Dev only</span>
                </div>
                <h2 style={{ marginBottom: 4 }}>Manual QA controls</h2>
                <p className="text-sm text-muted">
                  Seed test data, run matching, create demo groups, and push bot riders through the
                  confirmation step.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Close local QA controls"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="qa-screen-body">
              <div className="card stack">
                <div className="stack-sm">
                  <div className="admin-stat-row">
                    <span className="admin-stat-label">QA account ready</span>
                    <span className="admin-stat-value">
                      {snapshot?.user.emailVerified && snapshot?.user.onboardingComplete
                        ? "Yes"
                        : "No"}
                    </span>
                  </div>
                  <div className="admin-stat-row">
                    <span className="admin-stat-label">Open availabilities</span>
                    <span className="admin-stat-value">{snapshot?.availability.open ?? 0}</span>
                  </div>
                  <div className="admin-stat-row">
                    <span className="admin-stat-label">Active group</span>
                    <span className="admin-stat-value">
                      {activeGroup ? `${activeGroup.name} (${activeGroup.status})` : "None"}
                    </span>
                  </div>
                  <div className="admin-stat-row">
                    <span className="admin-stat-label">Pending bot confirmations</span>
                    <span className="admin-stat-value">{pendingBotAcknowledgements}</span>
                  </div>
                </div>
              </div>

              <div className="card stack">
                <h3>Setup and matching</h3>
                <div className="stack-sm">
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() =>
                      run("bootstrap", () => bootstrapLocalQaUser({}), "Your QA account is ready.")
                    }
                    disabled={busyAction !== null}
                  >
                    {busyAction === "bootstrap"
                      ? "Preparing QA account..."
                      : "Prepare my QA account"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() =>
                      run(
                        "seed",
                        () => seedLocalQaPool({}),
                        "Seeded a fresh local matching pool for manual testing.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    {busyAction === "seed"
                      ? "Seeding availabilities..."
                      : "Seed open availabilities"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() =>
                      run(
                        "matching",
                        () => runMatching({}),
                        "Triggered the matching workflow on the current open availabilities.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    {busyAction === "matching" ? "Running matching..." : "Run matching now"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() =>
                      run(
                        "force-bot-acks",
                        async () => {
                          const result = await forceLocalQaBotAcknowledgements({});
                          await syncLifecycle({});
                          return result;
                        },
                        (result) => {
                          const updatedCount =
                            typeof result === "object" &&
                            result !== null &&
                            "updatedCount" in result &&
                            typeof result.updatedCount === "number"
                              ? result.updatedCount
                              : 0;
                          return updatedCount > 0
                            ? `Forced ${updatedCount} bot rider confirmation${updatedCount === 1 ? "" : "s"}.`
                            : "All bot riders were already confirmed.";
                        },
                      )
                    }
                    disabled={busyAction !== null || !canForceBotConfirmations}
                  >
                    {busyAction === "force-bot-acks"
                      ? "Confirming bot riders..."
                      : "Force bot confirmations"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger btn-block"
                    onClick={() =>
                      run(
                        "delete-group",
                        () => deleteCurrentLocalQaGroup({}),
                        "Deleted the current QA testing group.",
                      )
                    }
                    disabled={busyAction !== null || !activeGroup}
                  >
                    {busyAction === "delete-group"
                      ? "Deleting testing group..."
                      : "Delete current testing group"}
                  </button>
                </div>
              </div>

              <div className="card stack">
                <h3>Rolling match lifecycle</h3>
                <p className="text-xs text-muted">
                  Test the tentative → semi_locked → locked flow. Create a rolling match group, then
                  step through each lock phase.
                </p>
                <div className="stack-sm">
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() =>
                      run(
                        "group-rolling",
                        () => createLocalQaGroup({ scenario: "rolling_match" }),
                        "Created a tentative group. Use the lock buttons to advance it.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    {busyAction === "group-rolling"
                      ? "Creating tentative group..."
                      : "Create tentative group"}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() =>
                      run(
                        "force-lock",
                        () => forceLockGroups({}),
                        (result) => {
                          const newStatus =
                            typeof result === "object" &&
                            result !== null &&
                            "newStatus" in result &&
                            typeof result.newStatus === "string"
                              ? result.newStatus
                              : "unknown";
                          return `Group advanced to "${newStatus}".`;
                        },
                      )
                    }
                    disabled={busyAction !== null || !canForceLock}
                  >
                    {busyAction === "force-lock"
                      ? "Locking..."
                      : `Force T-3h lock${canForceLock ? "" : " (needs tentative group)"}`}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() =>
                      run(
                        "force-hard-lock",
                        () => forceHardLockGroups({}),
                        "Group hard-locked. Booker assigned and addresses revealed.",
                      )
                    }
                    disabled={busyAction !== null || !canForceHardLock}
                  >
                    {busyAction === "force-hard-lock"
                      ? "Hard-locking..."
                      : `Force T-30min hard lock${canForceHardLock ? "" : " (needs semi_locked group)"}`}
                  </button>
                </div>
              </div>

              <div className="card stack">
                <h3>Create a demo group</h3>
                <div className="qa-grid">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run(
                        "group-matched",
                        () => createLocalQaGroup({ scenario: "matched" }),
                        "Created a matched QA group with your acknowledgement still pending.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    Matched group
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run(
                        "group-meetup",
                        () => createLocalQaGroup({ scenario: "meetup" }),
                        "Created a meetup-ready QA group.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    Meetup group
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run(
                        "group-trip",
                        () => createLocalQaGroup({ scenario: "in_trip" }),
                        "Created an in-trip QA group.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    In-trip group
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run(
                        "group-payment",
                        () => createLocalQaGroup({ scenario: "payment" }),
                        "Created a payment-ready QA group.",
                      )
                    }
                    disabled={busyAction !== null}
                  >
                    Payment group
                  </button>
                </div>
              </div>

              {snapshot?.qrTokens.length ? (
                <div className="card stack">
                  <div className="stack-xs">
                    <h3>Switch group view</h3>
                    <p className="text-xs text-muted">
                      Open the current group as any rider in this QA group so you can compare the
                      booker and rider interfaces.
                    </p>
                  </div>
                  <div className="qa-member-switcher">
                    {snapshot.qrTokens.map((member) => {
                      const isSelected =
                        qaViewerUserId === member.userId ||
                        (!qaViewerUserId && member.isCurrentUser);
                      const isBooker = activeGroup?.bookerUserId === member.userId;
                      return (
                        <button
                          type="button"
                          key={member.userId}
                          className={`qa-member-option${isSelected ? " qa-member-option-active" : ""}`}
                          onClick={() => openGroupAs(member.userId)}
                        >
                          <span className="qa-member-option-header">
                            <span>
                              {member.emoji} {member.displayName}
                            </span>
                            {isSelected ? (
                              <span className="pill pill-accent pill-sm">Viewing</span>
                            ) : null}
                          </span>
                          <span className="qa-member-option-meta">
                            {member.isCurrentUser ? "Your account" : "QA rider"} ·{" "}
                            {isBooker ? "Booker" : "Rider"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {otherTokens.length > 0 ? (
                <div className="card stack">
                  <div className="stack-xs">
                    <h3>Bot rider QR tokens</h3>
                    <p className="text-xs text-muted">
                      Paste these into the booker fallback input on the group page when you want to
                      simulate rider check-ins.
                    </p>
                  </div>
                  <div className="stack-sm">
                    {otherTokens.map((member) => (
                      <div className="admin-stat-row" key={member.userId}>
                        <div>
                          <strong style={{ fontSize: 14 }}>
                            {member.emoji} {member.displayName}
                          </strong>
                          <div
                            className="text-xs text-muted"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {member.qrToken}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(member.qrToken ?? "")
                              .catch(() => undefined);
                            setStatus({
                              type: "success",
                              text: `Copied ${member.displayName}'s QR token.`,
                            });
                          }}
                        >
                          Copy token
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="card stack">
                <div className="stack-xs">
                  <h3>Live location test</h3>
                  <p className="text-xs text-muted">
                    Search for real Singapore addresses, score pairwise compatibility via OneMap
                    routing, then seed and match with actual location data.
                  </p>
                </div>
                <div className="stack-sm">
                  {[0, 1, 2].map((i) => (
                    <AddressInput
                      key={i}
                      index={i}
                      value={liveAddresses[i]}
                      onChange={(addr) =>
                        setLiveAddresses((prev) => {
                          const next = [...prev];
                          next[i] = addr;
                          return next;
                        })
                      }
                      disabled={busyAction !== null}
                    />
                  ))}

                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() =>
                      run(
                        "live-score",
                        async () => {
                          const filled = liveAddresses.filter(Boolean);
                          if (filled.length < 2) {
                            throw new Error("Select at least 2 addresses to score.");
                          }
                          const destinations = await Promise.all(
                            filled.map(submitAddressToMatcher),
                          );
                          const edges = await scoreWithMatcher(
                            destinations.map((d) => d.routeDescriptorRef),
                          );
                          const result: LiveTestResult = { destinations, edges };
                          setLiveResult(result);
                          return result;
                        },
                        (result) => {
                          const r = result as LiveTestResult;
                          return `Scored ${r.destinations.length} destinations → ${r.edges.length} edge${r.edges.length === 1 ? "" : "s"}`;
                        },
                      )
                    }
                    disabled={busyAction !== null || liveAddresses.filter(Boolean).length < 2}
                  >
                    {busyAction === "live-score"
                      ? "Geocoding & scoring..."
                      : "Score real locations"}
                  </button>

                  {liveResult ? (
                    <div className="stack-sm">
                      {liveResult.edges.length === 0 ? (
                        <div className="text-xs text-muted">
                          No compatible pairs found (destinations too far apart).
                        </div>
                      ) : (
                        liveResult.edges.map((edge) => {
                          const leftAddr =
                            liveResult.destinations.find(
                              (d) => d.routeDescriptorRef === edge.leftRef,
                            )?.address ?? edge.leftRef;
                          const rightAddr =
                            liveResult.destinations.find(
                              (d) => d.routeDescriptorRef === edge.rightRef,
                            )?.address ?? edge.rightRef;
                          return (
                            <div
                              key={`${edge.leftRef}::${edge.rightRef}`}
                              className="card"
                              style={{ padding: 10 }}
                            >
                              <div className="text-xs" style={{ marginBottom: 6 }}>
                                <strong>{leftAddr.split(",")[0]}</strong> ↔{" "}
                                <strong>{rightAddr.split(",")[0]}</strong>
                              </div>
                              <div
                                className="text-xs text-muted"
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: 2,
                                }}
                              >
                                <span>Score: {edge.score}</span>
                                <span>Detour: {edge.detourMinutes} min</span>
                                <span>Spread: {edge.spreadDistanceKm} km</span>
                                <span>Route overlap: {edge.routeOverlap}</span>
                                <span>Proximity: {edge.destinationProximity}</span>
                              </div>
                            </div>
                          );
                        })
                      )}

                      <button
                        type="button"
                        className="btn btn-primary btn-block"
                        onClick={() =>
                          run(
                            "live-seed-match",
                            async () => {
                              await seedLocalQaPool({
                                liveDestinations: liveResult.destinations.map((d) => ({
                                  sealedDestinationRef: d.sealedDestinationRef,
                                  routeDescriptorRef: d.routeDescriptorRef,
                                })),
                              });
                              const result = await runMatchingWithEdges({
                                edges: liveResult.edges,
                              });
                              return result;
                            },
                            (result) => {
                              const r = result as { created: number };
                              return r.created > 0
                                ? `Seeded pool and created ${r.created} group${r.created === 1 ? "" : "s"} from live scores.`
                                : "Seeded pool but no groups could be formed from the live scores.";
                            },
                          )
                        }
                        disabled={busyAction !== null || liveResult.edges.length === 0}
                      >
                        {busyAction === "live-seed-match"
                          ? "Seeding & matching..."
                          : "Seed pool & match with these scores"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {status ? (
                <div
                  className={`notice ${status.type === "error" ? "notice-error" : "notice-success"}`}
                >
                  {status.text}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
