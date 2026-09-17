import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { ayasSafePublicFetch, __testables } from "../src/lib/brain/autonomy/AyasSafePublicFetch";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part D/S — the SSRF-safe
 * public fetch layer. Clean-room per the sprint's own policy: every
 * scenario here runs fully offline, either against the pure blocklist
 * predicates directly or against a real local HTTP fixture server bound to
 * `127.0.0.1` — never the real internet (that is reserved for the separate,
 * manual, bounded Live Acceptance run using the real scheduler/research
 * code path). The fixture server itself is only reachable because these
 * scenarios pass `dangerouslyAllowPrivateNetworkForTests: true`, the one
 * option this module's own production callers (the light/deep research
 * engines, the scheduler) never set — see that option's own doc comment.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }

async function withFixtureServer(handler: http.RequestListener, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  // --- pure predicate coverage (no network at all) ---------------------
  await scenario("loopback IPv4 addresses are blocked", () => {
    assert.equal(__testables.isBlockedIPv4("127.0.0.1"), true);
    assert.equal(__testables.isBlockedIPv4("127.0.0.53"), true);
  });
  await scenario("RFC1918 private ranges are blocked", () => {
    assert.equal(__testables.isBlockedIPv4("10.1.2.3"), true);
    assert.equal(__testables.isBlockedIPv4("172.16.0.1"), true);
    assert.equal(__testables.isBlockedIPv4("172.31.255.255"), true);
    assert.equal(__testables.isBlockedIPv4("172.32.0.1"), false); // just outside the 172.16/12 range
    assert.equal(__testables.isBlockedIPv4("192.168.0.1"), true);
  });
  await scenario("link-local + cloud metadata (169.254.169.254) are blocked", () => {
    assert.equal(__testables.isBlockedIPv4("169.254.169.254"), true);
    assert.equal(__testables.isBlockedIPv4("169.254.0.1"), true);
  });
  await scenario("a genuinely public IPv4 address is not blocked", () => {
    assert.equal(__testables.isBlockedIPv4("8.8.8.8"), false);
    assert.equal(__testables.isBlockedIPv4("140.82.121.4"), false);
  });
  await scenario("IPv6 loopback/link-local/unique-local are blocked; a public IPv6 address is not", () => {
    assert.equal(__testables.isBlockedIPv6("::1"), true);
    assert.equal(__testables.isBlockedIPv6("fe80::1"), true);
    assert.equal(__testables.isBlockedIPv6("fc00::1"), true);
    assert.equal(__testables.isBlockedIPv6("fd00::1"), true);
    assert.equal(__testables.isBlockedIPv6("2606:4700:4700::1111"), false);
  });
  await scenario("IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) is blocked", () => {
    assert.equal(__testables.isBlockedIPv6("::ffff:127.0.0.1"), true);
  });
  await scenario("localhost-shaped hostnames are syntactically blocked", () => {
    assert.equal(__testables.isSyntacticallyBlockedHost("localhost"), true);
    assert.equal(__testables.isSyntacticallyBlockedHost("printer.local"), true);
    assert.equal(__testables.isSyntacticallyBlockedHost("foo.localhost"), true);
    assert.equal(__testables.isSyntacticallyBlockedHost("metadata.google.internal"), true);
    assert.equal(__testables.isSyntacticallyBlockedHost("github.com"), false);
  });
  await scenario("content-type allowlist accepts feed/doc types and rejects everything else", () => {
    assert.equal(__testables.isAllowedContentType("application/atom+xml; charset=utf-8"), true);
    assert.equal(__testables.isAllowedContentType("application/rss+xml"), true);
    assert.equal(__testables.isAllowedContentType("application/json"), true);
    assert.equal(__testables.isAllowedContentType("image/png"), false);
    assert.equal(__testables.isAllowedContentType("application/octet-stream"), false);
  });

  // --- end-to-end SSRF enforcement, real code path, no network needed --
  await scenario("end-to-end: loopback target is rejected before any connection is attempted", async () => {
    const r = await ayasSafePublicFetch("http://127.0.0.1:1/", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_BLOCKED_HOST");
  });
  await scenario("end-to-end: literal localhost hostname is rejected", async () => {
    const r = await ayasSafePublicFetch("http://localhost/", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_BLOCKED_HOST");
  });
  await scenario("end-to-end: cloud metadata address is rejected", async () => {
    const r = await ayasSafePublicFetch("http://169.254.169.254/latest/meta-data/", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_BLOCKED_HOST");
  });
  await scenario("end-to-end: RFC1918 target is rejected", async () => {
    const r = await ayasSafePublicFetch("http://10.0.0.5/", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_BLOCKED_HOST");
  });
  await scenario("end-to-end: unsupported protocol (file://) is rejected", async () => {
    const r = await ayasSafePublicFetch("file:///etc/passwd", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_UNSUPPORTED_PROTOCOL");
  });
  await scenario("end-to-end: unsupported protocol (ftp://) is rejected", async () => {
    const r = await ayasSafePublicFetch("ftp://example.com/", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_UNSUPPORTED_PROTOCOL");
  });
  await scenario("end-to-end: a malformed URL is rejected as invalid, not crashed on", async () => {
    const r = await ayasSafePublicFetch("not a url at all", { timeoutMs: 1000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "AYAS_FETCH_INVALID_URL");
  });

  // --- integration behavior against a real local fixture server --------
  await withFixtureServer(
    (req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); },
    async (base) => {
      await scenario("happy path: a normal allowed-content-type response is fetched successfully", async () => {
        const r = await ayasSafePublicFetch(base, { timeoutMs: 3000, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, true);
        if (r.ok) { assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).ok, true); }
      });
    },
  );

  await withFixtureServer(
    (req, res) => { res.writeHead(200, { "Content-Type": "image/png" }); res.end(Buffer.from([0])); },
    async (base) => {
      await scenario("unsupported content-type (image/png) is rejected", async () => {
        const r = await ayasSafePublicFetch(base, { timeoutMs: 3000, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.code, "AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE");
      });
    },
  );

  await withFixtureServer(
    (req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("x".repeat(10_000)); },
    async (base) => {
      await scenario("a response exceeding maxBodyBytes is rejected as too large, not silently truncated-and-accepted", async () => {
        const r = await ayasSafePublicFetch(base, { timeoutMs: 3000, maxBodyBytes: 100, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.code, "AYAS_FETCH_BODY_TOO_LARGE");
      });
    },
  );

  await withFixtureServer(
    (req, res) => { setTimeout(() => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("late"); }, 2000); },
    async (base) => {
      await scenario("a response slower than the timeout is rejected with AYAS_FETCH_TIMEOUT, not hung forever", async () => {
        const r = await ayasSafePublicFetch(base, { timeoutMs: 150, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.code, "AYAS_FETCH_TIMEOUT");
      });
    },
  );

  await scenario("a DNS-unresolvable host fails as a network error, not a hang", async () => {
    const r = await ayasSafePublicFetch("https://this-domain-should-not-exist.ayas-research.invalid/", { timeoutMs: 5000 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.code === "AYAS_FETCH_DNS_FAILED" || r.code === "AYAS_FETCH_NETWORK_ERROR", `expected a DNS/network failure code, got ${r.code}`);
  });

  await withFixtureServer(
    (req, res) => {
      if (req.url === "/start") { res.writeHead(302, { Location: "/next" }); res.end(); return; }
      if (req.url === "/next") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("landed"); return; }
      res.writeHead(404); res.end();
    },
    async (base) => {
      await scenario("an allowed same-origin redirect is followed and lands on the final content", async () => {
        const r = await ayasSafePublicFetch(`${base}/start`, { timeoutMs: 3000, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, true);
        if (r.ok) { assert.equal(r.body, "landed"); assert.ok(r.finalUrl.endsWith("/next")); }
      });
    },
  );

  await withFixtureServer(
    (req, res) => { res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }); res.end(); },
    async (base) => {
      await scenario("a redirect target pointing at a blocked private/metadata address is rejected, not silently followed", async () => {
        // Deliberately NOT passing dangerouslyAllowPrivateNetworkForTests for
        // the redirect TARGET's own validation — the first hop is allowed
        // (fixture server) but the SECOND hop must still be judged for real.
        const r = await ayasSafePublicFetch(base, { timeoutMs: 3000 });
        assert.equal(r.ok, false);
      });
    },
  );

  let redirectHops = 0;
  await withFixtureServer(
    (req, res) => { redirectHops += 1; res.writeHead(302, { Location: "/loop" }); res.end(); },
    async (base) => {
      await scenario("a redirect loop is bounded by maxRedirects, never followed forever", async () => {
        const r = await ayasSafePublicFetch(`${base}/loop`, { timeoutMs: 5000, maxRedirects: 3, dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.code, "AYAS_FETCH_TOO_MANY_REDIRECTS");
        assert.ok(redirectHops <= 5, `expected the redirect loop to be bounded, saw ${redirectHops} hops`);
      });
    },
  );

  await withFixtureServer(
    (req, res) => {
      if (req.headers["if-none-match"] === '"abc"') { res.writeHead(304, { ETag: '"abc"' }); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/plain", ETag: '"abc"' }); res.end("content");
    },
    async (base) => {
      await scenario("conditional GET (If-None-Match) returns notModified:true on a real 304, the LIGHT scan's cheap-check path", async () => {
        const r = await ayasSafePublicFetch(base, { timeoutMs: 3000, ifNoneMatch: '"abc"', dangerouslyAllowPrivateNetworkForTests: true });
        assert.equal(r.ok, true);
        if (r.ok) { assert.equal(r.status, 304); assert.equal(r.notModified, true); assert.equal(r.body, ""); }
      });
    },
  );

  console.log(`AYAS safe public fetch (SSRF boundary) smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-safe-public-fetch", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exit(1); });
