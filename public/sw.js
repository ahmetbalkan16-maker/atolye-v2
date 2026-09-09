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
 * Registered ONLY when `NEXT_PUBLIC_ATOLYE_PWA_SW === "on"` (see PwaRegister).
 */

const CACHE = "ayas-shell-v3";
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
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
  if (request.mode === "navigate" || request.destination === "document") {
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
