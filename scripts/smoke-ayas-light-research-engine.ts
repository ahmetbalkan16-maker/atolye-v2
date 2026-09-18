import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { runAyasLightResearchScan, AYAS_LIGHT_SCAN_BASE_BACKOFF_MS } from "../src/lib/brain/autonomy/AyasLightResearchEngine";
import { createAyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part E/S — the LIGHT scan's
 * change-detection behavior. Clean-room: a real local fixture server, a
 * temp `data/brain`-shaped state root, `dangerouslyAllowPrivateNetworkForTests`
 * (this module's own documented test-only escape hatch — never set by the
 * real scheduler).
 *
 * Every scan below passes `minCheckIntervalMs: 0`: this suite exercises
 * CHANGE DETECTION, and several scenarios legitimately run two scans
 * back-to-back within the same millisecond, which the registry's own
 * per-source rate floor would otherwise — correctly — skip. That floor is
 * covered on its own terms in `smoke-ayas-research-source-resilience.ts`.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withFixtureServer(handler: http.RequestListener, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try { await fn(`http://127.0.0.1:${address.port}`); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function source(url: string): AyasResearchSource {
  return { sourceId: "fixture-source", provider: "Fixture", category: "OPEN_SOURCE_AI", kind: "atom", url, officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "test fixture" };
}

async function main() {
  await withFixtureServer(
    (req, res) => { res.writeHead(200, { "Content-Type": "application/atom+xml" }); res.end("<feed><entry><title>v1</title></entry></feed>"); },
    async (base) => {
      await scenario("a source checked for the first time is reported as changed (there is no prior baseline to compare against)", async () => {
        const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-first-") });
        const result = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [source(base)], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(result.sourcesChecked, 1);
        assert.equal(result.sourcesChanged, 1);
        assert.equal(result.results[0]!.status, "OK");
      });
    },
  );

  let hitCount = 0;
  await withFixtureServer(
    (req, res) => {
      hitCount += 1;
      res.writeHead(200, { "Content-Type": "application/atom+xml", ETag: '"same-etag"' });
      res.end("<feed><entry><title>same content every time</title></entry></feed>");
    },
    async (base) => {
      await scenario("an unchanged source (identical content hash on a second check) is reported as NOT changed", async () => {
        const stateStore = createAyasResourceSourceStateStoreHelper();
        const src = source(base);
        const first = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(first.sourcesChanged, 1);
        const second = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(second.sourcesChanged, 0, "identical content must never be reported as changed twice");
        assert.equal(second.results[0]!.status, "OK");
        assert.equal(hitCount, 2, "both checks must have reached the fixture server (no ETag stored yet to short-circuit via 304)");
      });
    },
  );

  function createAyasResourceSourceStateStoreHelper() {
    return createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-unchanged-") });
  }

  let etagRequestCount = 0;
  let conditionalHitWith304 = false;
  await withFixtureServer(
    (req, res) => {
      etagRequestCount += 1;
      if (req.headers["if-none-match"] === '"v1"') { conditionalHitWith304 = true; res.writeHead(304, { ETag: '"v1"' }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/atom+xml", ETag: '"v1"' });
      res.end("<feed><entry><title>content</title></entry></feed>");
    },
    async (base) => {
      await scenario("a second check sends the prior ETag via If-None-Match and honors a real 304 as unchanged", async () => {
        const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-etag-") });
        const src = source(base);
        await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        const second = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(conditionalHitWith304, true, "the second request must have used the stored ETag and received a real 304");
        assert.equal(second.sourcesChanged, 0);
        assert.equal(etagRequestCount, 2, "exactly two real requests must have reached the server");
      });
    },
  );

  await scenario("a changed source (different content hash) is correctly reported as changed", async () => {
    let responseBody = "<feed><entry><title>version A</title></entry></feed>";
    await withFixtureServer(
      (req, res) => { res.writeHead(200, { "Content-Type": "application/atom+xml" }); res.end(responseBody); },
      async (base) => {
        const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-changed-") });
        const src = source(base);
        const first = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(first.sourcesChanged, 1);
        responseBody = "<feed><entry><title>version B — materially different</title></entry></feed>";
        const second = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [src], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(second.sourcesChanged, 1, "a real content change must be detected");
      },
    );
  });

  await scenario("a source that always fails is recorded as ERROR with an increasing failure count, never crashes the scan", async () => {
    const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-fail-") });
    const badSource: AyasResearchSource = { sourceId: "bad-source", provider: "Bad", category: "OPEN_SOURCE_AI", kind: "atom", url: "http://127.0.0.1:1/", officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "unreachable" };
    const result = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [badSource], stateStore });
    assert.equal(result.sourcesFailed, 1);
    assert.equal(result.results[0]!.status, "ERROR");
    const state = stateStore.read("bad-source");
    assert.equal(state?.consecutiveFailures, 1);
  });

  await scenario("one failing source never blocks the rest of the registry from being checked", async () => {
    await withFixtureServer(
      (req, res) => { res.writeHead(200, { "Content-Type": "application/atom+xml" }); res.end("<feed><entry><title>ok</title></entry></feed>"); },
      async (base) => {
        const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-mixed-") });
        const badSource: AyasResearchSource = { sourceId: "bad-source", provider: "Bad", category: "OPEN_SOURCE_AI", kind: "atom", url: "http://127.0.0.1:1/", officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "unreachable" };
        const result = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [badSource, source(base)], stateStore, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(result.sourcesChecked, 2);
        assert.equal(result.sourcesFailed, 1);
        assert.equal(result.sourcesChanged, 1);
      },
    );
  });

  await scenario("a repeatedly-failing source backs off instead of being retried on every single tick", async () => {
    const stateStore = createAyasResearchSourceStateStore({ rootDir: tempDir("ayas-light-backoff-") });
    const badSource: AyasResearchSource = { sourceId: "bad-source", provider: "Bad", category: "OPEN_SOURCE_AI", kind: "atom", url: "http://127.0.0.1:1/", officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "unreachable" };
    await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [badSource], stateStore }); // consecutiveFailures now 1
    const immediateRetry = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [badSource], stateStore });
    assert.equal(immediateRetry.results[0]!.status, "SKIPPED_BACKOFF", "an immediate re-check of a just-failed source must be skipped, not re-attempted");
    assert.equal(immediateRetry.sourcesSkipped, 1);
    // simulate enough time passing for backoff to elapse
    const pastState = stateStore.read("bad-source")!;
    stateStore.write({ ...pastState, lastCheckedAt: new Date(Date.now() - AYAS_LIGHT_SCAN_BASE_BACKOFF_MS * 2).toISOString() });
    const afterBackoff = await runAyasLightResearchScan({ minCheckIntervalMs: 0, sources: [badSource], stateStore });
    assert.notEqual(afterBackoff.results[0]!.status, "SKIPPED_BACKOFF", "once the backoff window has elapsed, the source must be re-attempted");
  });

  console.log(`AYAS light research engine smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-light-research-engine", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exit(1); });
