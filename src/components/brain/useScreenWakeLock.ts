"use client";

/**
 * AYAS — screen wake lock while a voice turn is in progress.
 *
 * On iOS the biggest cause of "the page reloaded itself after ~2 minutes" is
 * the device auto-locking (default Auto-Lock is 30 s – 2 min): the backgrounded
 * WebKit page is suspended, then evicted, and reopened from scratch — an
 * installed PWA relaunches from `start_url`, a Safari tab reloads in place. A
 * web page cannot stop that eviction, but it CAN keep the screen from locking
 * in the first place while the user is actively talking to / listening to AYAS.
 *
 * `navigator.wakeLock` (Screen Wake Lock API; iOS Safari 16.4+, Chrome, Edge):
 *  - request `"screen"` while `active`; release when it goes false;
 *  - the browser auto-releases the sentinel when the tab is hidden, so
 *    re-acquire on `visibilitychange` → visible;
 *  - absent API / a rejected request → silent no-op. Voice, chat and TTS all
 *    work exactly the same without it.
 *
 * No timer, no polling, no network, no execution primitive. It only asks the OS
 * to keep the display on.
 */

import { useEffect } from "react";

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    const wakeLock = navigator.wakeLock;
    if (!wakeLock || typeof wakeLock.request !== "function") return;

    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;

    const release = () => {
      const held = sentinel;
      sentinel = null;
      if (held) void held.release().catch(() => {});
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
        held.addEventListener("release", () => {
          if (sentinel === held) sentinel = null;
        });
      } catch {
        /* NotAllowedError / unsupported — leave the screen to the OS */
      }
    };

    // The browser auto-releases the lock when the tab is hidden; re-acquire on return.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [active]);
}

export default useScreenWakeLock;
