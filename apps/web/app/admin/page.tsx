import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "../../convex/_generated/api";

export default async function AdminPage() {
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");

  const snapshot = await fetchQuery(api.queries.adminSnapshot, {}, { token });
  if (!snapshot) redirect("/login");

  return (
    <div className="admin-dash">
      {/* ── Top bar ── */}
      <header className="admin-dash-header">
        <div className="row" style={{ gap: 8 }}>
          <div
            className="hop-logo"
            style={{ width: 26, height: 26, fontSize: 12, borderRadius: 7 }}
          >
            H
          </div>
          <span className="pill pill-accent pill-dot" style={{ fontSize: 11 }}>
            Admin
          </span>
        </div>
        <Link href="/admin/simulator" className="btn btn-primary btn-sm">
          Open simulator →
        </Link>
      </header>

      {/* ── KPI strip ── */}
      <div className="admin-kpi-strip">
        <div className="admin-kpi">
          <span className="admin-kpi-n">{snapshot.users}</span>
          <span className="admin-kpi-l">Riders</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n text-accent">{snapshot.openAvailabilities}</span>
          <span className="admin-kpi-l">Open pool</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n">{snapshot.tentativeGroups}</span>
          <span className="admin-kpi-l">Tentative</span>
        </div>
        <div className="admin-kpi">
          <span className="admin-kpi-n text-success">{snapshot.revealedGroups}</span>
          <span className="admin-kpi-l">Revealed</span>
        </div>
      </div>

      {/* ── Three-column body ── */}
      <div className="admin-dash-body">
        {/* Column 1 — Pipeline */}
        <section className="admin-col">
          <h3 className="admin-col-title">
            Matching pipeline
            <span className="pill pill-privacy" style={{ fontSize: 10, padding: "2px 8px" }}>
              Privacy-first
            </span>
          </h3>
          <ol className="admin-pipe">
            <li>
              <strong>Seal</strong> Address geocoded &amp; AES-256-GCM encrypted. Convex never sees
              plaintext.
            </li>
            <li>
              <strong>Score</strong> Pairwise: 55% route overlap · 30% proximity · 15% time window.
              Reject if detour &gt;12 min or spread &gt;8 km.
            </li>
            <li>
              <strong>Group</strong> Greedy: try size 4 → 3 → 2. Rank by avg score, then min score,
              then detour. Hold small groups until T-36 h.
            </li>
            <li>
              <strong>Lock</strong> T-3 h lock → acknowledgement. 2+ accepted → meetup. Others
              reopened.
            </li>
            <li>
              <strong>Reveal</strong> RSA per-recipient envelopes. Each rider decrypts only their
              own group's addresses.
            </li>
          </ol>
        </section>

        {/* Column 2 — Scoring + params */}
        <section className="admin-col">
          <h3 className="admin-col-title">Scoring formula</h3>
          <div className="admin-formula">
            <code>score = 0.55·route + 0.30·prox + 0.15·time</code>
          </div>
          <div className="admin-bars">
            <div className="admin-bar-row">
              <span>Route overlap</span>
              <div className="admin-bar-track">
                <div className="admin-bar-fill" style={{ width: "55%" }} />
              </div>
              <span className="font-mono">55%</span>
            </div>
            <div className="admin-bar-row">
              <span>Dest. proximity</span>
              <div className="admin-bar-track">
                <div className="admin-bar-fill admin-bar-fill--teal" style={{ width: "30%" }} />
              </div>
              <span className="font-mono">30%</span>
            </div>
            <div className="admin-bar-row">
              <span>Time window</span>
              <div className="admin-bar-track">
                <div className="admin-bar-fill admin-bar-fill--muted" style={{ width: "15%" }} />
              </div>
              <span className="font-mono">15%</span>
            </div>
          </div>

          <h3 className="admin-col-title" style={{ marginTop: 14 }}>
            Constraints
          </h3>
          <div className="admin-params">
            <div className="admin-param">
              <span className="admin-param-v font-mono">12 min</span>
              <span className="admin-param-k">Max detour</span>
            </div>
            <div className="admin-param">
              <span className="admin-param-v font-mono">8 km</span>
              <span className="admin-param-k">Max spread</span>
            </div>
            <div className="admin-param">
              <span className="admin-param-v font-mono">2–4</span>
              <span className="admin-param-k">Group size</span>
            </div>
            <div className="admin-param">
              <span className="admin-param-v font-mono">GH-6</span>
              <span className="admin-param-k">Geohash</span>
            </div>
            <div className="admin-param">
              <span className="admin-param-v font-mono">36 h</span>
              <span className="admin-param-k">Small hold</span>
            </div>
            <div className="admin-param">
              <span className="admin-param-v font-mono">30 min</span>
              <span className="admin-param-k">Ack window</span>
            </div>
          </div>
        </section>

        {/* Column 3 — Audit */}
        <section className="admin-col">
          <h3 className="admin-col-title">
            Audit trail
            <span className="pill pill-muted" style={{ fontSize: 10, padding: "2px 8px" }}>
              {snapshot.auditEvents.length}
            </span>
          </h3>
          {snapshot.auditEvents.length ? (
            <div className="admin-audit">
              {snapshot.auditEvents.map((event) => (
                <div className="admin-audit-row" key={event._id}>
                  <div>
                    <span className="admin-audit-act">{event.action}</span>
                    <span className="admin-audit-ts">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="font-mono text-muted" style={{ fontSize: 10 }}>
                    {event.actorId.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted" style={{ fontSize: 12 }}>
              No audit events yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
