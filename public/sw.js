/*
 * Atölye AYAS — service worker (spec §7).
 *
 * Conservative by design:
 *  - NEVER intercepts a non-GET request.
 *  - NEVER caches or serves `/api/**` from cache — every execution / auth /
 *    stream / snapshot call goes to the network. AYAS execution stays
 *    online-only + authenticated; there is no offline execution path.
 *  - Navigations: network-first, falling back to a cached `/offline` shell.
 *  - Static assets (`/_next/static/**`, icons, manifest): cache-first.
 *  - Everything else: passthrough (no `respondWith`).
 *
 * Registered ONLY when `NEXT_PUBLIC_ATOLYE_PWA_SW === "on"` (see PwaRegister) —
 * off by default so the operator enables it after verifying in a real browser.
 */

const CACHE = "ayas-shell-v2";
const SHELL = [
  "/",
  "/brain",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
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

  // Navigations — network-first, offline shell as the fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((hit) => hit || caches.match("/offline")),
      ),
    );
    return;
  }

  // Static assets — cache-first.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
