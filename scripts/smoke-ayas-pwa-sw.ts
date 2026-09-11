/**
 * AYAS PWA service worker safety smoke (spec §7).
 *
 * Static / no browser. Parses `public/sw.js` and asserts its safety contract:
 *  - never intercepts a non-GET request;
 *  - `/api/**` is always the network — never cached, never served from cache
 *    (AYAS execution / auth / stream / snapshot stay online-only);
 *  - navigations are network-first with an `/offline` fallback;
 *  - no execution / eval / dynamic-code primitive;
 *  - the offline page + registration flag exist and the SW is OFF by default.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO = path.resolve(__dirname, "..");
const swSource = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");

async function run() {
await scenario("sw.js — non-GET requests are never intercepted", () => {
  assert.match(swSource, /request\.method\s*!==\s*"GET"\s*\)\s*return/);
});

await scenario("sw.js — /api/ is bypassed before any cache logic (network-only)", () => {
  const code = swSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(code, /pathname\.startsWith\("\/api\/"\)\)\s*return;/);
  // the /api bypass appears BEFORE the first respondWith — so API is never cached.
  const apiIdx = code.indexOf('startsWith("/api/")');
  const firstRespond = code.indexOf("respondWith");
  assert.ok(apiIdx > 0 && apiIdx < firstRespond, "the /api bypass must precede any respondWith");
  // the only /api mention in the code (comments stripped) is that one bypass check.
  assert.equal((code.match(/\/api\//g) || []).length, 1, "no other /api reference in the SW code");
});

await scenario("sw.js — navigations are NETWORK-ONLY (never a cached HTML page) except the ONE documented offline-capable route", () => {
  assert.match(swSource, /request\.mode\s*===\s*"navigate"/);
  assert.match(swSource, /request\.destination\s*===\s*"document"/);
  assert.match(swSource, /fetch\(request\)\.catch\(/);
  assert.match(swSource, /caches\.match\("\/offline"\)/);
  const navigateMarker = swSource.indexOf('request.mode === "navigate"');
  // NOTE: `_next/static/` also appears earlier, in this file's own top
  // comment — search must start AFTER the navigate marker, or `.slice()`
  // silently gets an empty (start > end) string and this assertion is a
  // no-op that always "passes". Bounding it correctly is what lets the count
  // below mean anything.
  const navBranchEnd = swSource.indexOf("_next/static/", navigateMarker);
  const navBranch = swSource.slice(navigateMarker, navBranchEnd);
  assert.ok(navBranchEnd > navigateMarker, "sanity: the slice must be non-empty");
  const cacheMatchRequestCount = (navBranch.match(/caches\.match\(request\)/g) ?? []).length;
  // Exactly one — the documented `OFFLINE_CAPABLE_ROUTE` exception (proven
  // behaviorally in the next scenario). Any other count means either the
  // exception vanished or a NEW route started caching documents unnoticed.
  assert.equal(cacheMatchRequestCount, 1, "navigations must not serve a cached document, except the one documented exception");
});

await scenario("sw.js — precache holds no auth-gated route (/ and /brain would break cache.add)", () => {
  const precache = swSource.slice(swSource.indexOf("PRECACHE = ["), swSource.indexOf("]"));
  assert.ok(!/["']\/["']/.test(precache) && !/\/brain/.test(precache), "no gated routes in PRECACHE");
  assert.match(swSource, /Promise\.allSettled/, "a bad precache entry must not abort install");
  assert.match(swSource, /ayas-shell-v3/, "cache name bumped so activate() purges the stale cache");
});

await scenario("sw.js — no execution / eval / dynamic code / network beyond fetch(request)", () => {
  for (const banned of ["eval(", "Function(", "importScripts(", "XMLHttpRequest", "WebSocket", "indexedDB", "postMessage(", "PipelineRunner"]) {
    assert.ok(!swSource.includes(banned), `sw.js must not use "${banned}"`);
  }
});

await scenario("sw.js — evaluates in a mock worker scope without throwing; registers the 4 lifecycle handlers", () => {
  const handlers: string[] = [];
  const sandbox = {
    self: {
      addEventListener: (type: string) => handlers.push(type),
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://example.test" },
    },
    caches: {
      open: () => Promise.resolve({ addAll: () => Promise.resolve(), put: () => Promise.resolve(), match: () => Promise.resolve(undefined) }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: () => Promise.resolve(undefined),
    },
    fetch: () => Promise.resolve(new Response("")),
    URL,
    Response,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  assert.deepEqual(handlers.sort(), ["activate", "fetch", "install", "message"]);
});

await scenario("sw.js — the ONE offline-capable route (phone-llm lab) is named and documented, distinct from the generic shell fallback", () => {
  assert.match(swSource, /OFFLINE_CAPABLE_ROUTE\s*=\s*"\/brain\/voice-lab\/phone-llm"/);
  assert.match(swSource, /url\.pathname === OFFLINE_CAPABLE_ROUTE/);
});

// Behavioral, not regex-slicing (a static slice bounded by the first
// `_next/static/` substring is unreliable — that phrase also appears earlier,
// in this file's own top comment). This actually EXECUTES the real fetch
// handler against two navigations while "offline" (fetch always rejects) and
// asserts the two routes get genuinely different treatment.
function makeFetchSandbox(cacheStore: Map<string, Response>) {
  let fetchHandler:
    | ((event: { request: { method: string; url: string; mode?: string }; respondWith: (p: Promise<Response>) => void }) => void)
    | null = null;
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: unknown) => {
        if (type === "fetch") fetchHandler = fn as typeof fetchHandler;
      },
      skipWaiting: () => {},
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://example.test" },
    },
    caches: {
      open: () =>
        Promise.resolve({
          addAll: () => Promise.resolve(),
          put: (req: { url: string } | string, res: Response) => {
            cacheStore.set(typeof req === "string" ? req : req.url, res);
            return Promise.resolve();
          },
          match: (req: { url: string } | string) => Promise.resolve(cacheStore.get(typeof req === "string" ? req : req.url)),
        }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: (req: { url: string } | string) => Promise.resolve(cacheStore.get(typeof req === "string" ? req : req.url)),
    },
    fetch: () => Promise.reject(new Error("offline")),
    URL,
    Response,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(swSource, sandbox);
  const dispatch = (url: string) =>
    new Promise<Response>((resolve) => {
      fetchHandler!({
        request: { method: "GET", url, mode: "navigate" },
        respondWith: (p) => {
          void p.then(resolve);
        },
      });
    });
  return { dispatch, hasHandler: () => fetchHandler !== null };
}

await scenario(
  "sw.js executed: phone-llm navigation serves a cached copy of ITSELF offline; an unrelated route still only gets the generic shell",
  async () => {
    const cacheStore = new Map<string, Response>();
    cacheStore.set("https://example.test/brain/voice-lab/phone-llm", new Response("phone-llm cached shell"));
    // sw.js calls `caches.match("/offline")` with a bare relative string here — a
    // different lookup shape than the `caches.match(request)` object-with-.url
    // case above, so it needs its own key matching that exact call.
    cacheStore.set("/offline", new Response("generic offline shell"));
    const { dispatch, hasHandler } = makeFetchSandbox(cacheStore);
    assert.ok(hasHandler(), "fetch handler registered");

    const phoneLlm = await dispatch("https://example.test/brain/voice-lab/phone-llm");
    assert.equal(await phoneLlm.text(), "phone-llm cached shell", "offline + previously cached → its OWN cached page, not the generic shell");

    const unrelated = await dispatch("https://example.test/research");
    assert.equal(await unrelated.text(), "generic offline shell", "a route with no special handling is untouched — still only the generic /offline fallback");
  },
);

await scenario(
  "sw.js executed: the PWA launch route (/brain) redirects to the cached phone-llm lab when offline (Phone-LLM #50 fix), instead of a dead-end shell",
  async () => {
    const cacheStore = new Map<string, Response>();
    // sw.js's `/brain` branch looks the lab route up via `caches.match(OFFLINE_CAPABLE_ROUTE)`
    // — a bare relative string, exactly like the pre-existing `caches.match("/offline")`
    // call elsewhere in this file. A real browser's Cache API resolves a relative
    // string against the SW's own origin before matching; this mock does a plain
    // string-key lookup, so the seed key must be the bare string too.
    cacheStore.set("/brain/voice-lab/phone-llm", new Response("phone-llm cached shell"));
    cacheStore.set("/offline", new Response("generic offline shell"));
    const { dispatch } = makeFetchSandbox(cacheStore);

    const brain = await dispatch("https://example.test/brain");
    assert.equal(brain.status, 302, "a redirect, not a directly-served page");
    assert.equal(brain.headers.get("location"), "https://example.test/brain/voice-lab/phone-llm", "redirects specifically to the offline-capable lab route");
  },
);

await scenario(
  "sw.js executed: /brain offline WITHOUT the lab route cached still falls back to the generic shell — never redirects to a dead cache entry",
  async () => {
    const cacheStore = new Map<string, Response>();
    // Deliberately no phone-llm entry this time.
    cacheStore.set("/offline", new Response("generic offline shell"));
    const { dispatch } = makeFetchSandbox(cacheStore);

    const brain = await dispatch("https://example.test/brain");
    assert.equal(brain.status, 200);
    assert.equal(await brain.text(), "generic offline shell");
  },
);

await scenario("offline page exists and is static, no execution", () => {
  const src = fs.readFileSync(path.join(REPO, "app/offline/page.tsx"), "utf8");
  assert.match(src, /force-static/);
  assert.match(src, /çevrimdışı|çevrimiçi/i);
  for (const banned of ["fetch(", "askAyas", "PipelineRunner", "useEffect"]) {
    assert.ok(!src.includes(banned), `offline page must not use "${banned}"`);
  }
});

await scenario("PwaRegister — OFF by default; on, SW-update reload is DEFERRED, never mid-use", () => {
  const src = fs.readFileSync(path.join(REPO, "src/components/PwaRegister.tsx"), "utf8");
  assert.match(src, /NEXT_PUBLIC_ATOLYE_PWA_SW\s*===\s*"on"/);
  assert.match(src, /if\s*\(!enabled\)/);
  assert.match(src, /unregister\(\)/);
  assert.match(src, /register\("\/sw\.js"/);
  assert.match(src, /updateViaCache:\s*"none"/, "sw.js itself is always revalidated");
  assert.match(src, /controllerchange/);
  assert.match(src, /window\.location\.reload\(\)/);
  // reload exactly once — a `done` latch
  assert.match(src, /done\s*=\s*true/);
  // a visible, established page is NOT reloaded — the reload is deferred
  assert.match(src, /reloadPending/, "an in-use page defers the reload");
  assert.match(src, /visibilityState/, "reload only when hidden / young");
  assert.match(src, /pagehide/, "deferred reload happens on pagehide");
  assert.match(src, /ayas\.sw\.reloadedAt/, "leaves a breadcrumb so the next boot classifies as sw-update");
});

console.log(`AYAS PWA service worker smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-pwa-sw", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS PWA service worker smoke FAILED:", error);
  process.exitCode = 1;
});
