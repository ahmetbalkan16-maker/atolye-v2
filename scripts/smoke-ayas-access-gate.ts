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

  await scenario("isProtectedPath: app + api locked, auth + assets open", () => {
    for (const p of ["/", "/brain", "/api/pipeline", "/api/projects/x/pipeline/retry"]) {
      assert.equal(isProtectedPath(p), true, `${p} must be protected`);
    }
    for (const p of ["/login", "/login?next=/brain", "/api/auth/login", "/api/auth/logout", "/_next/static/x.js", "/favicon.ico"]) {
      assert.equal(isProtectedPath(p), false, `${p} must be open`);
    }
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
