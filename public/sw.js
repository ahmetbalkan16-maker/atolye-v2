/*
 * Atölye AYAS — service worker (spec §7).
 *
 * Conservative by design, and deliberately NOT an HTML cache:
 *  - NEVER intercepts a non-GET request.
 *  - NEVER caches or serves `/api/**` from cache — every execution / auth /
 *    stream / snapshot call goes to the network.
 *  - Navigations: NETWORK-ONLY. The only fallback is a cached `/offline` shell,
 *    and ONLY when the network is truly unreachable. A stale cached HTML page
 *    would reference a previous build's chunks/RSC and render as a client-side
 *    404 after a redeploy — so it is never served.
 *  - `_next/static/**` is content-hash-immutable → cache-first is safe.
 *  - The precache holds only assets that return 200 unconditionally. `/` and
 *    `/brain` are auth-gated (they 307 → /login) — precaching them makes
 *    `cache.addAll` reject and the whole install fail, so they are NOT listed.
 *  - Every step is failure-tolerant: a bad precache entry never blocks install.
 *
 * ONE deliberate, narrow exception to "navigations are network-only":
 * `/brain/voice-lab/phone-llm` (the phone-local-LLM lab — see the page's own
 * header comment). It is not gated by a session (`accessGate.ts`'s
 * `OPEN_PREFIXES`) and its whole purpose is to still open when the PC — and
 * therefore the network entirely — is unreachable. Network-first (so a
 * redeploy is picked up the moment it's reachable, same staleness guarantee
 * as everywhere else), but on failure it falls back to a CACHED COPY OF THIS
 * EXACT PATH rather than the generic `/offline` shell. The model weights
 * themselves are never touched here — those live in Transformers.js's own
 * browser cache (IndexedDB / Cache Storage), populated only when the operator
 * presses "MODELİ İNDİR" on that page; this worker never precaches them.
 *
 * It is ALSO in `PRECACHE` below (safe now — unlike `/` and `/brain`, it is
 * not auth-gated, so it always 200s and can't fail `cache.addAll`). This
 * closes a real gap the runtime-caching-on-navigation approach alone left
 * open: a page's OWN first-ever load happens before any Service Worker
 * exists to intercept it, so it is never itself cached by the navigation
 * handler above — only a LATER navigation, once the worker has activated and
 * claimed the page, would populate the cache. `PwaRegister`'s update reload
 * is deliberately DEFERRED while a page stays open and visible (never
 * interrupt a live session) — so if the operator never backgrounds the app
 * before going offline, that later navigation may never happen, and the
 * route silently falls back to the generic `/offline` shell instead of its
 * own UI. Precaching it at `install` time removes the dependency on that
 * reload entirely.
 *
 * Registered ONLY when `NEXT_PUBLIC_ATOLYE_PWA_SW === "on"` (see PwaRegister).
 */

const CACHE = "ayas-shell-v3";

/** The one navigable route allowed to survive a fully offline reload (see header). */
const OFFLINE_CAPABLE_ROUTE = "/brain/voice-lab/phone-llm";

const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  OFFLINE_CAPABLE_ROUTE,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Execution / auth / stream / snapshot — always the network, never the cache.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations / documents — NETWORK ONLY. Whatever the network says (200, a
  // 307 to /login, …) is authoritative. Only a genuine network failure falls
  // back, and only to the offline shell — never to a cached page.
  //
  // EXCEPT the one offline-capable lab route (see header): network-first,
  // but on failure it falls back to a cache of ITSELF, not the generic shell.
  if (request.mode === "navigate" || request.destination === "document") {
    if (url.pathname === OFFLINE_CAPABLE_ROUTE) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => caches.match(request).then((hit) => hit || caches.match("/offline").then((h) => h || Response.error()))),
      );
      return;
    }
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((hit) => hit || Response.error())),
    );
    return;
  }

  // Content-hashed build assets — cache-first (immutable).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Precached static shell assets — cache-first, network fallback.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
