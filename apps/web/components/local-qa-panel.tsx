"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";

const localQaRequested = process.env.NEXT_PUBLIC_ENABLE_LOCAL_QA === "true";

export function LocalQaPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const snapshot = useQuery(api.admin.localQaSnapshot);
  const bootstrapLocalQaUser = useMutation(api.admin.bootstrapLocalQaUser);
  const seedLocalQaPool = useMutation(api.admin.seedLocalQaPool);
  const createLocalQaGroup = useMutation(api.admin.createLocalQaGroup);
  const forceLocalQaBotAcknowledgements = useMutation(api.admin.forceLocalQaBotAcknowledgements);
  const deleteCurrentLocalQaGroup = useMutation(api.admin.deleteCurrentLocalQaGroup);
  const syncLifecycle = useMutation(api.trips.advanceCurrentGroupLifecycle);
  const runMatching = useAction(api.mutations.runMatching);
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
