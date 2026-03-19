import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { PreferencesForm } from "../../../components/preferences-form";
import { PwaStatusCard } from "../../../components/pwa-status-card";
import { api } from "../../../convex/_generated/api";
import { formatStoredWindow } from "../../../lib/time-range";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const statusConfig: Record<string, { icon: string; class: string; label: string }> = {
  open: { icon: "🔍", class: "status-open", label: "Searching" },
  matched: { icon: "✓", class: "status-matched", label: "Matched" },
  cancelled: { icon: "✕", class: "status-cancelled", label: "Cancelled" },
};

export default async function DashboardPage() {
  const token = await convexAuthNextjsToken();
  if (!token) return null;

  await fetchAction(api.mutations.runMatching, {}, { token });
  await fetchMutation(api.trips.advanceCurrentGroupLifecycle, {}, { token });

  const [riderProfile, availabilities, group, eligibility] = await Promise.all([
    fetchQuery(api.queries.getRiderProfile, {}, { token }),
    fetchQuery(api.queries.listAvailabilities, {}, { token }),
    fetchQuery(api.trips.getActiveTrip, {}, { token }),
    fetchQuery(api.trips.getRideEligibility, {}, { token }),
  ]);

  if (!riderProfile) return null;

  const activeAvailabilities = (availabilities ?? []).filter((a) => a.status !== "cancelled");
  const isSearchingForGroup = activeAvailabilities.some(
    (availability) => availability.status === "open",
  );

  return (
    <div className="stack-lg stagger">
      {/* Greeting */}
      <div style={{ paddingTop: 4 }}>
        <p className="text-muted text-sm">{getGreeting()}</p>
        <h1 style={{ marginTop: 2 }}>{riderProfile.name?.trim() ?? ""}</h1>
      </div>

      {/* Active group card */}
      {group ? (
        <Link href="/group" style={{ textDecoration: "none" }}>
          <div className="card-accent" style={{ cursor: "pointer" }}>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="pill pill-accent pill-dot pill-pulse">Active group</span>
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
            <div className="row" style={{ gap: 16 }}>
              <div>
                <p className="text-sm text-muted">Group</p>
                <p className="font-display fw-700">{group.group.groupName}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Members</p>
                <p className="font-display fw-700">{group.stats.activeMemberCount}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Status</p>
                <p className="font-display fw-600 text-accent">
                  {group.group.status.replaceAll("_", " ")}
                </p>
              </div>
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 12 }}>
              Meet at {group.group.meetingLocationLabel}
            </p>
          </div>
        </Link>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 12px",
              borderRadius: 14,
              background: "var(--surface-hover)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            🚗
          </div>
          <h3 style={{ marginBottom: 4 }}>
            {isSearchingForGroup ? "Searching for a group" : "No active group"}
          </h3>
          <p className="text-sm text-muted" style={{ maxWidth: 240, margin: "0 auto" }}>
            {isSearchingForGroup
              ? "Matching is running automatically for your current ride window."
              : eligibility?.blocked
                ? "Clear your previous payment before scheduling another ride."
                : "Submit your availability and matching will run automatically."}
          </p>
          {!eligibility?.blocked ? (
            <Link
              href="/availability"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 16, display: "inline-flex" }}
            >
              Add a ride window
            </Link>
          ) : null}
        </div>
      )}

      {/* Availability list */}
      <PwaStatusCard />

      {/* Availability list */}
      <div>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2>Your windows</h2>
          <Link href="/availability">+ Add</Link>
        </div>

        {activeAvailabilities.length > 0 ? (
          <div className="stack-sm">
            {activeAvailabilities.map((a) => {
              const config = statusConfig[a.status] ?? statusConfig.open;
              return (
                <div key={a._id} className="availability-item">
                  <div className={`avail-icon ${config.class}`}>{config.icon}</div>
                  <div className="avail-info">
                    <div className="avail-time">
                      {formatStoredWindow(a.windowStart, a.windowEnd)}
                    </div>
                    <div className="avail-meta">{config.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", padding: "24px 16px" }}>
            <p className="text-muted text-sm">No availability submitted yet.</p>
          </div>
        )}
      </div>

      {/* Preferences */}
      <PreferencesForm profile={riderProfile} />
    </div>
  );
}
