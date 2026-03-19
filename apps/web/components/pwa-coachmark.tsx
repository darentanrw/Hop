"use client";

import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import { urlBase64ToUint8Array } from "../lib/pwa";

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }
}

const INSTALL_DISMISS_KEY = "hop-install-dismissed-at";
const NOTIFICATION_DISMISS_KEY = "hop-notification-dismissed-at";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false)
  );
}

function isiOSSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);
  return isAppleMobile && isSafari;
}

export function PwaCoachmark() {
  const upsertPushSubscription = useMutation(api.mutations.upsertPushSubscription);
  const disablePushSubscription = useMutation(api.mutations.disablePushSubscription);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneMode());
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [notificationsDismissed, setNotificationsDismissed] = useState(false);
  const attemptedRegistration = useRef(false);

  const installCopy = useMemo(() => {
    if (isStandalone) return null;
    if (deferredPrompt) {
      return {
        title: "Install Hop",
        body: "Add Hop to your home screen for the full ride-day experience — match alerts, check-in, and payment all in one tap.",
        action: "Install app",
        instruction: null,
      };
    }
    if (isiOSSafari()) {
      return {
        title: "Add Hop to your home screen",
        body: "In Safari, tap the Share button then choose Add to Home Screen to get trip alerts and seamless access.",
        action: null,
        instruction: "Tap Share → Add to Home Screen",
      };
    }
    return {
      title: "Install Hop",
      body: "Use your browser's Install or Add to Home Screen option to pin Hop for the best ride-day experience.",
      action: null,
      instruction: "Look for Install App or Add to Home Screen in your browser menu",
    };
  }, [deferredPrompt, isStandalone]);

  useEffect(() => {
    try {
      const installDismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) ?? "0");
      const notificationDismissedAt = Number(localStorage.getItem(NOTIFICATION_DISMISS_KEY) ?? "0");
      setInstallDismissed(
        Boolean(installDismissedAt && Date.now() - installDismissedAt < ONE_DAY_MS),
      );
      setNotificationsDismissed(
        Boolean(notificationDismissedAt && Date.now() - notificationDismissedAt < ONE_DAY_MS),
      );
    } catch {}
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Unable to register Hop service worker", error);
    });
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const syncInstallState = () => setIsStandalone(isStandaloneMode());

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", syncInstallState);
    const media = window.matchMedia?.("(display-mode: standalone)");
    media?.addEventListener?.("change", syncInstallState);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", syncInstallState);
      media?.removeEventListener?.("change", syncInstallState);
    };
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (attemptedRegistration.current) return;
    if (notificationPermission !== "granted") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    attemptedRegistration.current = true;

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing) return;

        const payload = existing.toJSON();
        if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) return;

        await upsertPushSubscription({
          endpoint: payload.endpoint,
          p256dh: payload.keys.p256dh,
          auth: payload.keys.auth,
          userAgent: navigator.userAgent,
        });
      } catch (error) {
        console.error("Unable to sync existing Hop notification subscription", error);
      }
    })();
  }, [notificationPermission, upsertPushSubscription]);

  async function handleInstall() {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
      setIsStandalone(true);
      return;
    }

    dismissInstall();
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      setNotificationStatus("This browser does not support notifications.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission !== "granted") {
      setNotificationStatus("Allow notifications in the browser prompt to receive ride alerts.");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotificationStatus("Notifications enabled, but push is not supported on this device.");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      const subscription =
        existing ??
        (publicKey
          ? await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey),
            })
          : null);

      if (!subscription) {
        setNotificationStatus("Notifications enabled on this device.");
        return;
      }

      const payload = subscription.toJSON();
      if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
        setNotificationStatus("Could not read the push subscription details.");
        return;
      }

      await upsertPushSubscription({
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        userAgent: navigator.userAgent,
      });

      setNotificationStatus("You're all set — Hop will send ride-day alerts to this device.");
    } catch (error) {
      console.error("Unable to enable Hop notifications", error);
      setNotificationStatus("Could not finish notification setup.");
    }
  }

  async function disableNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!existing) return;
      const endpoint = existing.endpoint;
      await existing.unsubscribe();
      await disablePushSubscription({ endpoint });
      setNotificationStatus("Push alerts disabled for this device.");
    } catch (error) {
      console.error("Unable to disable Hop notifications", error);
    }
  }

  function dismissInstall() {
    setInstallDismissed(true);
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {}
  }

  function dismissNotifications() {
    setNotificationsDismissed(true);
    try {
      localStorage.setItem(NOTIFICATION_DISMISS_KEY, String(Date.now()));
    } catch {}
  }

  const showInstall = !isStandalone && !installDismissed && installCopy;
  const showNotifications =
    !notificationsDismissed &&
    (notificationPermission === "default" ||
      notificationPermission === "denied" ||
      notificationStatus !== null);

  if (!showInstall && !showNotifications) {
    return null;
  }

  return (
    <div className="pwa-overlay">
      <div className="pwa-overlay-backdrop" />
      <div className="pwa-overlay-card">
        {showInstall ? (
          <div className="pwa-modal-content">
            <div className="pwa-modal-icon">📱</div>
            <h2>{installCopy.title}</h2>
            <p
              className="text-secondary"
              style={{ textAlign: "center", fontSize: 15, lineHeight: 1.6 }}
            >
              {installCopy.body}
            </p>
            {installCopy.instruction ? (
              <div className="notice notice-info" style={{ width: "100%", textAlign: "left" }}>
                {installCopy.instruction}
              </div>
            ) : null}
            {installCopy.action ? (
              <button type="button" className="btn btn-primary btn-block" onClick={handleInstall}>
                {installCopy.action}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-block" onClick={dismissInstall}>
              Not now
            </button>
          </div>
        ) : showNotifications ? (
          <div className="pwa-modal-content">
            <div className="pwa-modal-icon">🔔</div>
            <h2>Stay in the loop</h2>
            <p
              className="text-secondary"
              style={{ textAlign: "center", fontSize: 15, lineHeight: 1.6 }}
            >
              Get alerts when your group is confirmed, when it's time to head to the meetup, and
              when payment is due.
            </p>
            {notificationPermission === "granted" ? (
              <div className="stack-sm" style={{ width: "100%" }}>
                <div className="notice notice-success">
                  {notificationStatus ?? "Notifications are on for this device."}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={disableNotifications}
                >
                  Turn off on this device
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={dismissNotifications}
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="stack-sm" style={{ width: "100%" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={enableNotifications}
                >
                  Turn on notifications
                </button>
                {notificationPermission === "denied" ? (
                  <div className="notice notice-error">
                    Notifications are blocked. Re-enable them in your browser settings to receive
                    ride alerts.
                  </div>
                ) : null}
                {notificationStatus ? (
                  <div className="notice notice-info">{notificationStatus}</div>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={dismissNotifications}
                >
                  Not now
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
