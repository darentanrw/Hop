"use client";

import { useEffect, useState } from "react";

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false)
  );
}

export function PwaStatusCard() {
  const [installed, setInstalled] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPermission | "unsupported">("default");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => {
      setInstalled(isStandaloneMode());
      setNotifications(
        typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      );
    };

    sync();
    setHydrated(true);
    window.addEventListener("appinstalled", sync);
    const media = window.matchMedia?.("(display-mode: standalone)");
    media?.addEventListener?.("change", sync);

    return () => {
      window.removeEventListener("appinstalled", sync);
      media?.removeEventListener?.("change", sync);
    };
  }, []);

  return (
    <div className="card">
      <div className="section-header" style={{ marginBottom: 12 }}>
        <h2>Device readiness</h2>
      </div>
      <div className="stack-sm">
        <div className="pwa-status-row">
          <div>
            <div className="pwa-status-label">Installed</div>
            <p className="text-sm text-muted">
              {installed
                ? "Hop is installed and launches like a native app."
                : "Install Hop for faster launch and cleaner ride-day flow."}
            </p>
          </div>
          <span className={`pill pill-sm ${installed ? "pill-success" : "pill-muted"}`}>
            {installed ? "Ready" : "Pending"}
          </span>
        </div>
        <div className="pwa-status-row">
          <div>
            <div className="pwa-status-label">Notifications</div>
            <p className="text-sm text-muted">
              {notifications === "granted"
                ? "Ride-day alerts are enabled for this browser."
                : notifications === "denied"
                  ? "Notifications are blocked in browser settings."
                  : notifications === "unsupported"
                    ? "This browser does not support notifications."
                    : "Allow notifications so Hop can alert you when your group changes."}
            </p>
          </div>
          <span
            className={`pill pill-sm ${
              notifications === "granted"
                ? "pill-success"
                : notifications === "denied"
                  ? "pill-danger"
                  : "pill-muted"
            }`}
          >
            {notifications === "granted"
              ? "On"
              : notifications === "denied"
                ? "Blocked"
                : notifications === "unsupported"
                  ? "Unavailable"
                  : "Pending"}
          </span>
        </div>
      </div>
    </div>
  );
}
