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
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO = path.resolve(__dirname, "..");
const swSource = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");

scenario("sw.js — non-GET requests are never intercepted", () => {
  assert.match(swSource, /request\.method\s*!==\s*"GET"\s*\)\s*return/);
});

scenario("sw.js — /api/ is bypassed before any cache logic (network-only)", () => {
  const code = swSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(code, /pathname\.startsWith\("\/api\/"\)\)\s*return;/);
  // the /api bypass appears BEFORE the first respondWith — so API is never cached.
  const apiIdx = code.indexOf('startsWith("/api/")');
  const firstRespond = code.indexOf("respondWith");
  assert.ok(apiIdx > 0 && apiIdx < firstRespond, "the /api bypass must precede any respondWith");
  // the only /api mention in the code (comments stripped) is that one bypass check.
  assert.equal((code.match(/\/api\//g) || []).length, 1, "no other /api reference in the SW code");
});

scenario("sw.js — navigations are NETWORK-ONLY (never a cached HTML page), /offline as the only fallback", () => {
  assert.match(swSource, /request\.mode\s*===\s*"navigate"/);
  assert.match(swSource, /request\.destination\s*===\s*"document"/);
  assert.match(swSource, /fetch\(request\)\.catch\(/);
  assert.match(swSource, /caches\.match\("\/offline"\)/);
  // the navigation branch must NOT fall back to `caches.match(request)` — a
  // stale HTML page references a prior build and renders as a client 404.
  const navBranch = swSource.slice(
    swSource.indexOf('request.mode === "navigate"'),
    swSource.indexOf("_next/static/"),
  );
  assert.ok(!/caches\.match\(request\)/.test(navBranch), "navigations must not serve a cached document");
});

scenario("sw.js — precache holds no auth-gated route (/ and /brain would break cache.add)", () => {
  const precache = swSource.slice(swSource.indexOf("PRECACHE = ["), swSource.indexOf("]"));
  assert.ok(!/["']\/["']/.test(precache) && !/\/brain/.test(precache), "no gated routes in PRECACHE");
  assert.match(swSource, /Promise\.allSettled/, "a bad precache entry must not abort install");
  assert.match(swSource, /ayas-shell-v3/, "cache name bumped so activate() purges the stale cache");
});

scenario("sw.js — no execution / eval / dynamic code / network beyond fetch(request)", () => {
  for (const banned of ["eval(", "Function(", "importScripts(", "XMLHttpRequest", "WebSocket", "indexedDB", "postMessage(", "PipelineRunner"]) {
    assert.ok(!swSource.includes(banned), `sw.js must not use "${banned}"`);
  }
});

scenario("sw.js — evaluates in a mock worker scope without throwing; registers the 4 lifecycle handlers", () => {
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

scenario("offline page exists and is static, no execution", () => {
  const src = fs.readFileSync(path.join(REPO, "app/offline/page.tsx"), "utf8");
  assert.match(src, /force-static/);
  assert.match(src, /çevrimdışı|çevrimiçi/i);
  for (const banned of ["fetch(", "askAyas", "PipelineRunner", "useEffect"]) {
    assert.ok(!src.includes(banned), `offline page must not use "${banned}"`);
  }
});

scenario("PwaRegister — OFF by default; on, SW-update reload is DEFERRED, never mid-use", () => {
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
