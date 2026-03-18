import { adminSnapshot } from "../../lib/store";

export default function AdminPage() {
  const snapshot = adminSnapshot();

  return (
    <div className="page-container no-nav">
      <div className="stack-lg stagger">
        <div style={{ paddingTop: 20 }}>
          <div className="row" style={{ gap: 10, marginBottom: 4 }}>
            <div
              className="hop-logo"
              style={{ width: 28, height: 28, fontSize: 13, borderRadius: 8 }}
            >
              H
            </div>
            <span className="pill pill-muted">Admin</span>
          </div>
          <h1>System overview</h1>
          <p style={{ marginTop: 4 }}>No address data is accessible from this panel.</p>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Live metrics</h2>
          <div className="admin-stat-row">
            <span className="admin-stat-label">Registered users</span>
            <span className="admin-stat-value">{snapshot.users}</span>
          </div>
          <div className="admin-stat-row">
            <span className="admin-stat-label">Active riders</span>
            <span className="admin-stat-value">{snapshot.riders}</span>
          </div>
          <div className="admin-stat-row">
            <span className="admin-stat-label">Open availability</span>
            <span className="admin-stat-value text-accent">{snapshot.openAvailabilities}</span>
          </div>
          <div className="admin-stat-row">
            <span className="admin-stat-label">Tentative groups</span>
            <span className="admin-stat-value">{snapshot.tentativeGroups}</span>
          </div>
          <div className="admin-stat-row">
            <span className="admin-stat-label">Revealed groups</span>
            <span className="admin-stat-value text-success">{snapshot.revealedGroups}</span>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 16 }}>Recent audit events</h2>
          {snapshot.auditEvents.length ? (
            snapshot.auditEvents.map((event) => (
              <div className="admin-stat-row" key={event.id}>
                <div>
                  <span className="font-display fw-600" style={{ fontSize: 14, display: "block" }}>
                    {event.action}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
                <span
                  className="pill pill-muted"
                  style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                >
                  {event.actorId.slice(0, 8)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted text-sm">No audit events yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
