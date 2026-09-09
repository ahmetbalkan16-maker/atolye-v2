"use client";

/**
 * Registers `/sw.js` (spec §7) — ONLY when `NEXT_PUBLIC_ATOLYE_PWA_SW === "on"`.
 *
 * Off by default: a service worker intercepts every request, so the operator
 * enables it after verifying the offline behaviour in a real browser. When the
 * flag is unset this component registers nothing and, if a stale worker exists,
 * unregisters it so toggling the flag off is a clean revert.
 *
 * SW-update reloads are DEFERRED, never mid-use: when a new worker takes control
 * (`controllerchange`) we reload immediately ONLY if the current page is very
 * young (it might have been served stale HTML by the old worker) or is hidden.
 * A page that has been running fine is left alone — the freshly-claimed worker
 * is network-only for navigations, so the live page keeps working; the reload
 * happens the next time the page is hidden / closed. A user mid-conversation is
 * NEVER interrupted by a service-worker update.
 */

import { useEffect } from "react";

/** A page older than this is not "stale-broken" (those fail within seconds). */
const STALE_PAGE_GRACE_MS = 6000;

export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const enabled = process.env.NEXT_PUBLIC_ATOLYE_PWA_SW === "on";

    if (!enabled) {
      navigator.serviceWorker.getRegistrations?.().then((regs) => {
        for (const reg of regs) {
          if (reg.active?.scriptURL.endsWith("/sw.js")) void reg.unregister();
        }
      }).catch(() => {});
      return;
    }

    let done = false;
    let reloadPending = false;

    const now = () => (typeof performance !== "undefined" ? performance.now() : STALE_PAGE_GRACE_MS + 1);
    const doReload = () => {
      if (done) return;
      done = true;
      // Leave a breadcrumb so the Brain classifies the next boot as an SW update
      // (not a suspected eviction).
      try {
        window.sessionStorage.setItem("ayas.sw.reloadedAt.v1", String(Date.now()));
      } catch {
        /* ignore */
      }
      window.location.reload();
    };
    const onHidden = () => {
      if (reloadPending && document.visibilityState === "hidden") doReload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (done) return;
      // Young page (possibly served stale HTML) or not visible → reload now.
      if (now() < STALE_PAGE_GRACE_MS || document.visibilityState !== "visible") {
        doReload();
        return;
      }
      // In-use page: the claimed worker already handles it correctly. Defer.
      reloadPending = true;
    });
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", () => {
      if (reloadPending) doReload();
    });

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        void reg.update().catch(() => {});
        const nudge = () => reg.waiting?.postMessage("skip-waiting");
        nudge();
        reg.addEventListener("updatefound", () => {
          reg.installing?.addEventListener("statechange", nudge);
        });
      })
      .catch(() => {
        /* registration is best-effort — the app works without it */
      });

    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  return null;
}

export default PwaRegister;
