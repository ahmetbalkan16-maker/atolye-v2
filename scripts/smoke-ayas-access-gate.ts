/**
 * AYAS shared-passcode access gate (Master Sprint §24).
 *
 * Deterministic / no browser / $0 / no network. Exercises the pure gate logic
 * behind `middleware.ts` + `/api/auth/login`: session signing/verification,
 * protected-path routing, the CSRF same-origin backstop, and the per-IP
 * brute-force limiter. Also a static check that the wiring imports the gate.
 *
 * Run: npx tsx scripts/smoke-ayas-access-gate.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  AYAS_SESSION_TTL_SECONDS,
  clearAttempts,
  evaluateAttempt,
  isProtectedPath,
  isRequestOverHttps,
  isSameOriginRequest,
  issueSession,
  resolveAccessGate,
  timingSafeEqual,
  verifySession,
  type AttemptLimiterState,
} from "../src/lib/auth/accessGate";

const REPO_ROOT = path.resolve(__dirname, "..");
const KEY = "correct-horse-battery-staple";
const NOW = 1_760_000_000_000;

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function main() {
  await scenario("resolveAccessGate: enforced when a long key is set", () => {
    const gate = resolveAccessGate({ AYAS_ACCESS_KEY: `  ${KEY}  ` });
    assert.equal(gate.mode, "enforced");
    assert.equal(gate.key, KEY);
  });

  await scenario("resolveAccessGate: disabled-dev when unset outside production", () => {
    assert.equal(resolveAccessGate({ NODE_ENV: "development" }).mode, "disabled-dev");
    assert.equal(resolveAccessGate({}).mode, "disabled-dev");
  });

  await scenario("resolveAccessGate: misconfigured in production without a key", () => {
    assert.equal(resolveAccessGate({ NODE_ENV: "production" }).mode, "misconfigured");
  });

  await scenario("resolveAccessGate: misconfigured when the key is too short", () => {
    assert.equal(
      resolveAccessGate({ AYAS_ACCESS_KEY: "short", NODE_ENV: "development" }).mode,
      "misconfigured",
    );
  });

  await scenario("session round-trips for the issuing key", async () => {
    const token = await issueSession(KEY, NOW);
    assert.equal(await verifySession(token, KEY, NOW), true);
    assert.equal(
      await verifySession(token, KEY, NOW + (AYAS_SESSION_TTL_SECONDS - 60) * 1000),
      true,
    );
  });

  await scenario("session fails for a different key", async () => {
    const token = await issueSession(KEY, NOW);
    assert.equal(await verifySession(token, "another-long-passphrase", NOW), false);
  });

  await scenario("session fails once expired", async () => {
    const token = await issueSession(KEY, NOW);
    assert.equal(
      await verifySession(token, KEY, NOW + (AYAS_SESSION_TTL_SECONDS + 5) * 1000),
      false,
    );
  });

  await scenario("tampered / malformed tokens fail", async () => {
    const token = await issueSession(KEY, NOW);
    const [body, sig] = token.split(".");
    assert.equal(await verifySession(`${body}.${sig}x`, KEY, NOW), false);
    assert.equal(await verifySession(`${body}x.${sig}`, KEY, NOW), false);
    assert.equal(await verifySession("not-a-token", KEY, NOW), false);
    assert.equal(await verifySession("a.b.c", KEY, NOW), false);
    assert.equal(await verifySession(undefined, KEY, NOW), false);
  });

  await scenario("isProtectedPath: app + api locked, auth + assets + PWA shell open", () => {
    for (const p of ["/", "/brain", "/api/pipeline", "/api/projects/x/pipeline/retry", "/api/ayas/chat/stream"]) {
      assert.equal(isProtectedPath(p), true, `${p} must be protected`);
    }
    for (const p of [
      "/login", "/login?next=/brain", "/api/auth/login", "/api/auth/logout", "/_next/static/x.js",
      "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline", "/ayas-icon.svg", "/ayas-icon-maskable.svg",
    ]) {
      assert.equal(isProtectedPath(p), false, `${p} must be open`);
    }
  });

  await scenario("isProtectedPath: on-device wake-engine assets are OPEN (a 307→/login breaks addModule / WASM)", () => {
    for (const p of [
      "/wake/ayas.onnx",
      "/wake/melspectrogram.onnx",
      "/wake/embedding_model.onnx",
      "/ort/ort-wasm-simd-threaded.wasm",
      "/ort/ort-wasm-simd-threaded.jsep.mjs",
      "/worklets/d2-wake-lab-processor.js",
      "/worklets/d2-audio-lab-processor.js",
    ]) {
      assert.equal(isProtectedPath(p), false, `${p} must be open — the wake engine loads it before/without a live session`);
    }
    // still protected: the STT + chat routes, and anything that isn't a wake asset
    assert.equal(isProtectedPath("/api/ayas/stt"), true);
    assert.equal(isProtectedPath("/wakeup"), true, "prefix match must be exact — /wakeup is not /wake/");
  });

  await scenario("isRequestOverHttps: forwarded-proto aware, production always secure, dev http not", () => {
    // production → always Secure (production must be HTTPS)
    assert.equal(isRequestOverHttps({ urlProtocol: "http:", forwardedProto: null, forwardedSsl: null, nodeEnv: "production" }), true);
    // dev over plain localhost → not Secure (so a dev login works)
    assert.equal(isRequestOverHttps({ urlProtocol: "http:", forwardedProto: null, forwardedSsl: null, nodeEnv: "development" }), false);
    // behind a TLS-terminating proxy → Secure
    assert.equal(isRequestOverHttps({ urlProtocol: "http:", forwardedProto: "https", forwardedSsl: null, nodeEnv: "development" }), true);
    assert.equal(isRequestOverHttps({ urlProtocol: "http:", forwardedProto: "https, http", forwardedSsl: null, nodeEnv: "development" }), true);
    assert.equal(isRequestOverHttps({ urlProtocol: "http:", forwardedProto: null, forwardedSsl: "on", nodeEnv: "development" }), true);
    // direct HTTPS → Secure
    assert.equal(isRequestOverHttps({ urlProtocol: "https:", forwardedProto: null, forwardedSsl: null, nodeEnv: "development" }), true);
  });

  await scenario("same-origin backstop: GET always ok, cross-origin POST blocked", () => {
    assert.equal(
      isSameOriginRequest({ method: "GET", origin: "https://evil.test", referer: null, host: "studio.local" }),
      true,
    );
    assert.equal(
      isSameOriginRequest({ method: "POST", origin: "http://studio.local", referer: null, host: "studio.local" }),
      true,
    );
    assert.equal(
      isSameOriginRequest({ method: "POST", origin: "https://evil.test", referer: null, host: "studio.local" }),
      false,
    );
    assert.equal(
      isSameOriginRequest({ method: "POST", origin: null, referer: null, host: "studio.local" }),
      true,
    );
    assert.equal(
      isSameOriginRequest({ method: "POST", origin: null, referer: "https://evil.test/x", host: "studio.local" }),
      false,
    );
  });

  await scenario("forwarded-header safety: X-Forwarded-Proto cannot bypass auth or CSRF (§8)", () => {
    // (1) the same-origin backstop is driven by Origin/Referer vs Host — NOT by
    // any forwarded-proto header, so a spoofed proto changes nothing here.
    assert.equal(
      isSameOriginRequest({ method: "POST", origin: "https://evil.test", referer: null, host: "studio.local" }),
      false,
      "a cross-origin POST is still blocked regardless of forwarded headers",
    );
    // (2) isRequestOverHttps only ever flips the cookie toward MORE restrictive
    // (Secure). A spoofed `https` on a plain-HTTP request just makes the cookie
    // Secure (browser then won't send it over HTTP) — a fail-safe, not a bypass.
    const spoofed = isRequestOverHttps({ urlProtocol: "http:", forwardedProto: "https", forwardedSsl: null, nodeEnv: "development" });
    assert.equal(spoofed, true);
    // (3) it never makes a genuine HTTPS request "insecure": a spoofed `http`
    // while actually on HTTPS still yields Secure via urlProtocol / production.
    assert.equal(
      isRequestOverHttps({ urlProtocol: "https:", forwardedProto: "http", forwardedSsl: null, nodeEnv: "development" }),
      true,
    );
    assert.equal(
      isRequestOverHttps({ urlProtocol: "http:", forwardedProto: "http", forwardedSsl: null, nodeEnv: "production" }),
      true,
    );
    // (4) session verification is HMAC over the key — no header influences it.
    // (covered by the "session fails for a different key" / "tampered tokens" scenarios)
  });

  await scenario("brute-force limiter: allows the window, then blocks, then resets", () => {
    const store = new Map<string, AttemptLimiterState>();
    const opts = { limit: 3, windowSeconds: 60 };
    let now = NOW;
    for (let i = 0; i < 3; i += 1) {
      assert.equal(evaluateAttempt(store, "ip", opts, now).allowed, true);
    }
    const blocked = evaluateAttempt(store, "ip", opts, now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
    now += 61_000;
    assert.equal(evaluateAttempt(store, "ip", opts, now).allowed, true);
  });

  await scenario("clearAttempts drops the bucket after a successful login", () => {
    const store = new Map<string, AttemptLimiterState>();
    const opts = { limit: 1, windowSeconds: 60 };
    evaluateAttempt(store, "ip", opts, NOW);
    assert.equal(evaluateAttempt(store, "ip", opts, NOW).allowed, false);
    clearAttempts(store, "ip");
    assert.equal(evaluateAttempt(store, "ip", opts, NOW).allowed, true);
  });

  await scenario("timingSafeEqual compares full length", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "ab"), false);
  });

  await scenario("wiring: middleware + login route import the gate; Execution Gate untouched", () => {
    const mw = fs.readFileSync(path.join(REPO_ROOT, "middleware.ts"), "utf8");
    assert.match(mw, /@\/lib\/auth\/accessGate/);
    assert.match(mw, /verifySession/);
    assert.match(mw, /isSameOriginRequest/);
    const login = fs.readFileSync(
      path.join(REPO_ROOT, "app/api/auth/login/route.ts"),
      "utf8",
    );
    assert.match(login, /issueSession/);
    assert.match(login, /evaluateAttempt/);
    for (const source of [mw, login]) {
      assert.ok(
        !/executionGate|approve[A-Z]|PipelineRunner|BrainWorkerCycle/.test(source),
        "the auth layer must not touch the execution chain",
      );
    }
  });

  console.log(`AYAS access gate: PASS (${count} scenarios)`);
  console.log(
    JSON.stringify({ status: "PASS", suite: "ayas-access-gate", scenarios: count }),
  );
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("AYAS access gate FAILED:", error);
    process.exitCode = 1;
  }
})();
