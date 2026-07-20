"use client";

import { useEffect } from "react";

/** Registers the service worker once the page is interactive. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline shell is a comfort, never a blocker.
      });
    }
  }, []);
  return null;
}
