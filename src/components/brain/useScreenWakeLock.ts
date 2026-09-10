"use client";

/**
 * AYAS — screen wake lock while a voice turn is in progress.
 *
 * On iPhone the biggest cause of "the page reloaded itself after a few minutes"
 * is the device screen Auto-Lock: the backgrounded WebKit page is suspended,
 * then its web-content process is evicted, and it reopens from scratch — an
 * installed PWA relaunches from `start_url`. A web page cannot stop that
 * eviction, but it CAN keep the screen from locking while the user is actively
 * talking to / listening to AYAS.
 *
 * `navigator.wakeLock` (Screen Wake Lock API; iOS Safari 16.4+, Chrome, Edge):
 *  - request `"screen"` while `active`; release when it goes false;
 *  - the browser auto-releases the sentinel when the tab is hidden, so
 *    re-acquire on `visibilitychange` / `pageshow` / `focus` → visible;
 *  - a rejected request (Low Power Mode, an unsupported PWA context) is retried
 *    a few times with backoff, then given up on silently — voice, chat and TTS
 *    all work exactly the same without it, they're just more likely to be
 *    interrupted by an OS screen lock;
 *  - `onStatus(held)` reports whether a lock is currently held, so the Brain
 *    lifecycle telemetry can record "the screen lock was NOT holding right
 *    before the reload" — the evidence that the reload was a background eviction.
 *
 * No polling, no network, no execution primitive. It only asks the OS to keep
 * the display on.
 */

import { useEffect } from "react";

const RETRY_BACKOFF_MS = [1_000, 3_000, 8_000] as const;

export function useScreenWakeLock(active: boolean, onStatus?: (held: boolean) => void): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    const wakeLock = navigator.wakeLock;
    if (!wakeLock || typeof wakeLock.request !== "function") {
      onStatus?.(false);
      return;
    }
    if (!active) {
      onStatus?.(false);
      return;
    }

    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const release = () => {
      const held = sentinel;
      sentinel = null;
      if (held) void held.release().catch(() => {});
      onStatus?.(false);
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer || retries >= RETRY_BACKOFF_MS.length) return;
      const wait = RETRY_BACKOFF_MS[retries];
      retries += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void acquire();
      }, wait);
      (retryTimer as { unref?: () => void }).unref?.();
    };

    const acquire = async () => {
      if (disposed || sentinel || document.visibilityState !== "visible") return;
      try {
        const held = await wakeLock.request("screen");
        if (disposed) {
          void held.release().catch(() => {});
          return;
        }
        sentinel = held;
        retries = 0;
        clearRetry();
        onStatus?.(true);
        held.addEventListener("release", () => {
          if (sentinel === held) {
            sentinel = null;
            onStatus?.(false);
          }
        });
      } catch {
        // NotAllowedError / Low Power Mode / unsupported PWA context — retry a
        // few times, then leave the screen to the OS.
        onStatus?.(false);
        scheduleRetry();
      }
    };

    // The browser auto-releases the lock when the tab is hidden; re-acquire on
    // any signal that we're foreground again.
    const reacquire = () => {
      if (document.visibilityState === "visible") {
        retries = 0;
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", reacquire);
    window.addEventListener("pageshow", reacquire);
    window.addEventListener("focus", reacquire);
    return () => {
      disposed = true;
      clearRetry();
      document.removeEventListener("visibilitychange", reacquire);
      window.removeEventListener("pageshow", reacquire);
      window.removeEventListener("focus", reacquire);
      release();
    };
  }, [active, onStatus]);
}

export default useScreenWakeLock;
