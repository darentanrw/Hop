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
        title: "Install Hop on this device",
        body: "Install Hop for faster access, proper full-screen navigation, and trip alerts right from your home screen.",
        action: "Install app",
      };
    }
    if (isiOSSafari()) {
      return {
        title: "Add Hop to your home screen",
        body: "In Safari, tap Share, then choose Add to Home Screen so match and trip updates feel like a real app.",
        action: null,
      };
    }
    return {
      title: "Install Hop for faster access",
      body: "Use your browser's install or Add to Home Screen option to pin Hop and get a better ride-day experience.",
      action: null,
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
      setNotificationStatus("Notifications stay off until you allow them in the browser prompt.");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotificationStatus("Notifications are enabled, but push is not supported on this device.");
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
        setNotificationStatus(
          "Notifications are enabled locally. Add NEXT_PUBLIC_VAPID_PUBLIC_KEY to finish push subscription setup.",
        );
        return;
      }

      const payload = subscription.toJSON();
      if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
        setNotificationStatus("Could not read the browser's push subscription details.");
        return;
      }

      await upsertPushSubscription({
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        userAgent: navigator.userAgent,
      });

      setNotificationStatus("Notifications are on. Hop will be ready to send ride-day alerts.");
    } catch (error) {
      console.error("Unable to enable Hop notifications", error);
      setNotificationStatus("Could not finish notification setup on this device.");
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
      setNotificationStatus(
        "Hop won't send push alerts to this device until you enable them again.",
      );
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
    <div className="stack-sm" style={{ marginBottom: 20 }}>
      {showInstall ? (
        <div className="card pwa-card">
          <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
            <div className="stack-xs" style={{ flex: 1 }}>
              <span className="pill pill-accent pill-sm">Install</span>
              <h3>{installCopy.title}</h3>
              <p className="text-sm">{installCopy.body}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={dismissInstall}>
              Later
            </button>
          </div>
          {installCopy.action ? (
            <button type="button" className="btn btn-primary btn-block" onClick={handleInstall}>
              {installCopy.action}
            </button>
          ) : (
            <div className="notice notice-info">
              {isiOSSafari()
                ? "Safari path: Share -> Add to Home Screen."
                : "Look for Install App, Add to Home Screen, or Create Shortcut in your browser menu."}
            </div>
          )}
        </div>
      ) : null}

      {showNotifications ? (
        <div className="card pwa-card">
          <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
            <div className="stack-xs" style={{ flex: 1 }}>
              <span className="pill pill-privacy pill-sm">Alerts</span>
              <h3>Turn on ride-day notifications</h3>
              <p className="text-sm">
                Hop can use notifications for match acknowledgements, meetup timing, and payment
                reminders.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={dismissNotifications}>
              Later
            </button>
          </div>
          {notificationPermission === "granted" ? (
            <div className="stack-sm">
              <div className="notice notice-success">
                {notificationStatus ?? "Notifications are already enabled on this device."}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={disableNotifications}
              >
                Remove this device subscription
              </button>
            </div>
          ) : (
            <div className="stack-sm">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={enableNotifications}
              >
                Enable notifications
              </button>
              {notificationPermission === "denied" ? (
                <div className="notice notice-error">
                  Notifications are blocked. Re-enable them from your browser or device settings for
                  Hop to alert you.
                </div>
              ) : null}
              {notificationStatus ? (
                <div className="notice notice-info">{notificationStatus}</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
