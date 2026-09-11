"use client";

/**
 * AYAS phone-off-PC fallback config (Phase 2 · P0-A.4 · Option A).
 *
 * Deliberately isolated from `accessGate.ts` / the wake-voice modules — this
 * is a NEW, separate, narrow piece: it does not touch the PC's session-cookie
 * gate, the PWA manifest, the service worker, or any wake/voice code.
 *
 * Two responsibilities:
 *  - `resolveAyasWorkerUrl()` — reads the public (non-secret) Worker origin
 *    from `NEXT_PUBLIC_AYAS_WORKER_URL`, validated to an https origin.
 *  - `bootstrapAyasPhoneKeyFromUrl` / `getStoredAyasPhoneKey` — a one-time,
 *    per-device `?ayasPhoneKey=...` capture into `localStorage`, so the phone
 *    key (the Worker's OWN auth secret — not `AYAS_ACCESS_KEY`) never has to
 *    be baked into the client bundle. The query param is stripped from the
 *    visible URL immediately after capture and never sent to the PC.
 *
 * All of it fails silently (never throws into the caller) — a missing/denied
 * `localStorage` (private mode, blocked storage) just means the phone
 * fallback stays unavailable; the existing honest "AYAS şu an yanıt veremiyor"
 * message still applies. No behavior here can affect the PC-on path.
 */

const STORAGE_KEY = "ayasPhoneKey";
const QUERY_PARAM = "ayasPhoneKey";

/** The deployed Worker's origin, or `null` if unset/invalid. Safe to read at any time (public URL, not a secret). */
export function resolveAyasWorkerUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_AYAS_WORKER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * `storage` is a test seam — defaults to the browser's `localStorage`. Safe to
 * call outside a browser (no `window`) — resolves to `null`, never throws.
 */
export function getStoredAyasPhoneKey(storage?: Pick<Storage, "getItem">): string | null {
  try {
    const source = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!source) return null;
    const v = source.getItem(STORAGE_KEY);
    return v && v.trim().length >= 12 ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Call once at app mount. Captures `?ayasPhoneKey=...` into `localStorage`
 * and strips it from the address bar via `history.replaceState` (never a
 * navigation, never sent anywhere). No-op when the param is absent or storage
 * is unavailable.
 */
export function bootstrapAyasPhoneKeyFromUrl(win: Window): void {
  try {
    const url = new URL(win.location.href);
    const key = url.searchParams.get(QUERY_PARAM);
    if (!key || key.trim().length < 12) return;
    win.localStorage.setItem(STORAGE_KEY, key.trim());
    url.searchParams.delete(QUERY_PARAM);
    win.history.replaceState(win.history.state, "", url.toString());
  } catch {
    /* ignore — private mode / blocked storage / malformed URL */
  }
}
