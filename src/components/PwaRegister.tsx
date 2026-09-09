"use client";

/**
 * Registers `/sw.js` (spec §7) — ONLY when `NEXT_PUBLIC_ATOLYE_PWA_SW === "on"`.
 *
 * Off by default: a service worker intercepts every request, so the operator
 * enables it after verifying the offline behaviour in a real browser. When the
 * flag is unset this component registers nothing and, if a stale worker exists,
 * unregisters it so toggling the flag off is a clean revert.
 */

import { useEffect } from "react";

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

    // A superseded worker keeps serving stale HTML until it is replaced — so
    // always revalidate `sw.js` itself, push any waiting worker to activate, and
    // reload ONCE when a new worker takes control.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
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
  }, []);

  return null;
}

export default PwaRegister;
