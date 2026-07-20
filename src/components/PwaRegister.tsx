"use client";

import { useEffect } from "react";

/**
 * Registers the service worker; when notification permission is already
 * granted, quietly (re)subscribes to web push so chat notifications
 * reach the installed app.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (registration) => {
        const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapid || typeof Notification === "undefined") return;
        if (Notification.permission !== "granted") return;
        try {
          const subscription =
            (await registration.pushManager.getSubscription()) ??
            (await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapid
            }));
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription.toJSON())
          });
        } catch {
          // Push is a comfort, never a blocker.
        }
      })
      .catch(() => {
        // Offline shell is a comfort, never a blocker.
      });
  }, []);
  return null;
}
