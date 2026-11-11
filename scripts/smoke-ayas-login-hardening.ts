/**
 * AYAS login hardening (11 Nov 2026 security review).
 *
 * Deterministic / no browser / $0 / no network / no server. Covers the three
 * gate fixes of that review:
 *  - the login guess limiter: a client key that a forged X-Forwarded-For cannot
 *    rotate away from the brake, a header-independent worldwide brake on FAILED
 *    attempts that slows instead of locking out, and a bounded bucket map;
 *  - the post-login redirect (`/\evil.example` was an open redirect);
 *  - the `disabled-dev` gate serving only this machine.
 * The owner's normal login (correct passcode, brake off) must stay immediate.
 *
 * Run: npx tsx scripts/smoke-ayas-login-hardening.ts
 */

import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import {
  admitLoginAttempt,
  AYAS_SESSION_COOKIE,
  evaluateAttempt,
  isLoopbackDevRequest,
  issueSession,
  LOGIN_BRAKE_OPTIONS,
  loginClientBucket,
  newLoginBrakeState,
  pruneAttempts,
  safeRedirectPath,
  settleLoginAttempt,
  type AttemptLimiterState,
  type LoginBrakeState,
} from "../src/lib/auth/accessGate";
import { middleware } from "../middleware";

const KEY = "correct-horse-battery-staple-xyz";
const NOW = 1_760_000_000_000;
const PER_CLIENT = { limit: 8, windowSeconds: 600 };

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** One attempt exactly as the login route runs it, with an injected clock and no real waiting. */
function attempt(
  buckets: Map<string, AttemptLimiterState>,
  brake: LoginBrakeState,
  forwardedFor: string | null,
  ok: boolean,
  now: number,
): { kind: "now" | "wait" | "refuse"; waitMs: number; checkedAt: number | null } {
  const bucket = loginClientBucket(forwardedFor);
  pruneAttempts(buckets, 1000, now);
  const perClient = evaluateAttempt(buckets, bucket, PER_CLIENT, now);
  const admission = admitLoginAttempt(brake, !perClient.allowed, LOGIN_BRAKE_OPTIONS, now);
  if (admission.kind === "refuse") return { kind: "refuse", waitMs: 0, checkedAt: null };
  const waitMs = admission.kind === "wait" ? admission.waitMs : 0;
  const checkedAt = now + waitMs;
  settleLoginAttempt(brake, ok, LOGIN_BRAKE_OPTIONS, checkedAt);
  return { kind: admission.kind, waitMs, checkedAt };
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const name of Object.keys(values)) {
    previous[name] = process.env[name];
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
  return run().finally(() => {
    for (const name of Object.keys(previous)) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
}

async function main() {
  /* ---------------------------------------------------------- FIX 1: limiter --- */

  await scenario("client key: the LAST X-Forwarded-For entry (Cloudflare/Caddy/socket), not the client's own first one", () => {
    assert.equal(loginClientBucket("6.6.6.6, 203.0.113.9"), "login:203.0.113.9");
    assert.equal(loginClientBucket("203.0.113.9"), "login:203.0.113.9");
    assert.equal(loginClientBucket(null), "login:local");
    assert.equal(loginClientBucket(" , "), "login:local");
    assert.equal(loginClientBucket(`1.1.1.1, ${"x".repeat(500)}`).length, "login:".length + 64, "a forged value is capped");
  });

  await scenario("the old per-client window alone never limits a guesser who rotates X-Forwarded-For (the bug)", () => {
    const store = new Map<string, AttemptLimiterState>();
    for (let i = 0; i < 200; i += 1) {
      assert.equal(evaluateAttempt(store, `login:10.0.${i >> 8}.${i & 255}`, PER_CLIENT, NOW).allowed, true);
    }
  });

  await scenario("brake: many failures, each with a new X-Forwarded-For, engage the worldwide brake after 20", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    for (let i = 0; i < 21; i += 1) {
      assert.equal(attempt(buckets, brake, `10.1.0.${i}`, false, NOW + i).kind, "now", `failure ${i + 1} is checked at once`);
    }
    const next = attempt(buckets, brake, "10.1.0.99", false, NOW + 30);
    assert.equal(next.kind, "wait", "the 22nd attempt waits in the slow lane");
    assert.equal(next.waitMs, LOGIN_BRAKE_OPTIONS.slotMs);
  });

  await scenario("brake: a burst of parallel guesses is checked at most once per 3 s slot, the rest refused with Retry-After", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    const checks: number[] = [];
    let refused = 0;
    // 2000 guesses at one instant, every one with its own forged header.
    for (let i = 0; i < 2000; i += 1) {
      const r = attempt(buckets, brake, `198.51.${i >> 8}.${i & 255}`, false, NOW);
      if (r.checkedAt === null) refused += 1;
      else checks.push(r.checkedAt);
    }
    assert.equal(checks.length, 21 + 10, "21 before the brake, then 10 slots of 3 s (≤ 30 s of waiting)");
    assert.equal(refused, 2000 - checks.length);
    // A refusal tells when to come back.
    const late = admitLoginAttempt(brake, false, LOGIN_BRAKE_OPTIONS, NOW);
    assert.equal(late.kind, "refuse");
    assert.ok(late.kind === "refuse" && late.retryAfterSeconds >= 1 && late.retryAfterSeconds <= 30);
    // Sustained over 10 minutes: never more than ~20 checks a minute.
    let t = NOW;
    let sustained = 0;
    while (t < NOW + 10 * 60_000) {
      t += 500;
      for (let i = 0; i < 5; i += 1) if (attempt(buckets, brake, `192.0.2.${(t / 500 + i) % 250}`, false, t).checkedAt !== null) sustained += 1;
    }
    assert.ok(sustained <= 10 * 20 + 1, `≤ 20 per minute under a sustained flood (got ${sustained})`);
    assert.ok(buckets.size <= 1000, `the bucket map stays under its cap (size ${buckets.size})`);
  });

  await scenario("brake: the owner's correct passcode during the brake gets in after the delay; success does not reset the count", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    for (let i = 0; i < 25; i += 1) attempt(buckets, brake, `10.2.0.${i}`, false, NOW + i);
    const failuresBefore = brake.failures;
    const brakeUntilBefore = brake.brakeUntil;
    const owner = attempt(buckets, brake, "203.0.113.50", true, NOW + 10_000);
    assert.equal(owner.kind, "wait");
    assert.ok(owner.waitMs > 0 && owner.waitMs <= LOGIN_BRAKE_OPTIONS.maxWaitMs, `waits ≤ 30 s (${owner.waitMs} ms)`);
    assert.equal(brake.failures, failuresBefore, "a success leaves the attacker's failure count alone");
    assert.equal(brake.brakeUntil, brakeUntilBefore, "and the brake stays on");
  });

  await scenario("brake off: the correct passcode is never delayed; a few typos do not engage anything", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    assert.deepEqual(attempt(buckets, brake, "203.0.113.50", true, NOW), { kind: "now", waitMs: 0, checkedAt: NOW });
    for (let i = 0; i < 3; i += 1) attempt(buckets, brake, "203.0.113.50", false, NOW + i);
    const owner = attempt(buckets, brake, "203.0.113.50", true, NOW + 10);
    assert.equal(owner.kind, "now");
    assert.equal(owner.waitMs, 0);
    assert.equal(brake.brakeUntil, 0, "the brake engages only on failures above the limit");
  });

  await scenario("per-client limit: past 8 tries the client is slowed (≤ 30 s), not locked out for 10 minutes — a forged key cannot lock the owner out", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    // A LAN neighbour forges the owner's own key 8 times.
    for (let i = 0; i < 8; i += 1) assert.equal(attempt(buckets, brake, "203.0.113.50", false, NOW + i).kind, "now");
    const owner = attempt(buckets, brake, "203.0.113.50", true, NOW + 100);
    assert.equal(owner.kind, "wait", "the owner's next try waits in the lane");
    assert.ok(owner.waitMs <= LOGIN_BRAKE_OPTIONS.slotMs, "an idle lane: one slot");
    assert.equal(brake.brakeUntil, 0, "8 failures do not engage the worldwide brake");
  });

  await scenario("brake: switches itself off after a quiet window", () => {
    const buckets = new Map<string, AttemptLimiterState>();
    const brake = newLoginBrakeState();
    for (let i = 0; i < 25; i += 1) attempt(buckets, brake, `10.3.0.${i}`, false, NOW + i);
    assert.ok(brake.brakeUntil > NOW);
    const later = NOW + 11 * 60_000 + LOGIN_BRAKE_OPTIONS.maxWaitMs;
    assert.equal(attempt(buckets, brake, "203.0.113.50", true, later).kind, "now");
  });

  await scenario("bucket map: never grows past its cap; expired buckets go first", () => {
    const store = new Map<string, AttemptLimiterState>();
    for (let i = 0; i < 5000; i += 1) {
      pruneAttempts(store, 1000, NOW);
      evaluateAttempt(store, `login:k${i}`, PER_CLIENT, NOW);
      assert.ok(store.size <= 1000);
    }
    const aged = new Map<string, AttemptLimiterState>();
    for (let i = 0; i < 1000; i += 1) aged.set(`old${i}`, { count: 1, resetAt: i < 500 ? NOW - 1 : NOW + 60_000 });
    pruneAttempts(aged, 1000, NOW);
    assert.equal(aged.size, 500, "the 500 expired buckets are dropped, the live ones kept");
    const small = new Map<string, AttemptLimiterState>([["a", { count: 1, resetAt: NOW - 1 }]]);
    pruneAttempts(small, 1000, NOW);
    assert.equal(small.size, 1, "below the cap nothing is scanned");
  });

  await scenario("login route: 21 failures with forged X-Forwarded-For make the next try wait; the correct passcode still gets in", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY }, async () => {
      const { POST } = await import("../app/api/auth/login/route");
      const post = (key: string, forwardedFor: string) => POST(new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
        body: JSON.stringify({ key }),
      }));
      // Brake off: the owner's login is immediate (form and JSON), and `next` is sanitized.
      const t0 = Date.now();
      const json = await post(KEY, "203.0.113.50");
      assert.equal(json.status, 200);
      assert.ok(json.cookies.get(AYAS_SESSION_COOKIE)?.value, "a session cookie is set");
      const form = (next: string) => POST(new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: KEY, next }).toString(),
      }));
      const good = await form("/brain?panel=research");
      assert.equal(good.status, 303);
      assert.equal(good.headers.get("location"), "/brain?panel=research");
      const evil = await form("/\\evil.example");
      assert.equal(evil.headers.get("location"), "/brain", "an open redirect target falls back to /brain");
      assert.ok(Date.now() - t0 < 2000, "no delay while the brake is off");
      // An attacker rotating the forged first entry and the last one.
      for (let i = 0; i < 21; i += 1) {
        const r = await post("wrong-passcode-0000", `6.6.6.${i}, 10.9.0.${i}`);
        assert.equal(r.status, 401);
      }
      const t1 = Date.now();
      const owner = await post(KEY, "203.0.113.51");
      const waited = Date.now() - t1;
      assert.equal(owner.status, 200, "the correct passcode gets in during the brake");
      assert.ok(waited >= LOGIN_BRAKE_OPTIONS.slotMs - 500, `…after the slow lane's delay (${waited} ms)`);
      assert.ok(waited <= LOGIN_BRAKE_OPTIONS.maxWaitMs, "and never longer than 30 s");
    });
  });

  /* ------------------------------------------------- FIX 2: redirect target --- */

  await scenario("safe redirect: same-site paths pass, every protocol-relative or backslash form is refused", () => {
    for (const ok of ["/brain", "/brain?panel=research", "/", "/brain?ayasPhoneKey=abc123"]) assert.equal(safeRedirectPath(ok), ok, ok);
    for (const bad of ["//x", "/\\x", "/\\/x", "\\x", "https://x", "/a\\b", "/brain\nx", "/brain\tx", "/brain\u007f", "", "brain", null, undefined]) {
      assert.equal(safeRedirectPath(bad), null, JSON.stringify(bad));
    }
  });

  /* ------------------------------------------------ FIX 3: dev-mode locality --- */

  await scenario("dev locality: loopback hosts pass; a LAN address, a name, an empty Host, a forged LAN X-Forwarded-For or Cloudflare do not", () => {
    const local = (host: string | null, forwardedFor: string | null = null, cfConnectingIp: string | null = null) =>
      isLoopbackDevRequest({ host, forwardedFor, cfConnectingIp });
    for (const host of ["localhost:3000", "127.0.0.1:3111", "[::1]:3000", "localhost", "LOCALHOST:3210", "127.0.0.1"]) assert.equal(local(host), true, host);
    for (const forwarded of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.1, ::1"]) assert.equal(local("127.0.0.1:3210", forwarded), true, forwarded);
    for (const host of ["192.168.1.20:3000", "ayas-pc:3000", "ayas.atolyeayas.com", "", null, "localhost.evil.example", "127.0.0.1.nip.io", "[::1", "localhost:3000:1"]) {
      assert.equal(local(host), false, String(host));
    }
    assert.equal(local("localhost:3000", "192.168.1.20"), false, "Next filled the LAN socket address");
    assert.equal(local("localhost:3000", "127.0.0.1, 192.168.1.20"), false);
    assert.equal(local("localhost:3000", ""), false);
    assert.equal(local("localhost:3000", null, "203.0.113.9"), false, "came through Cloudflare");
  });

  await scenario("middleware disabled-dev: this machine passes, a LAN client gets 403 with how to set AYAS_ACCESS_KEY", async () => {
    await withEnv({ AYAS_ACCESS_KEY: undefined }, async () => {
      const local = await middleware(new NextRequest("http://localhost:3000/brain", { headers: { host: "localhost:3000" } }));
      assert.equal(local.status, 200);
      assert.equal(local.headers.get("x-ayas-access-gate"), "disabled-dev");
      const audit = await middleware(new NextRequest("http://127.0.0.1:3210/api/brain/snapshot", { headers: { host: "127.0.0.1:3210", "x-forwarded-for": "127.0.0.1" } }));
      assert.equal(audit.status, 200);
      const lan = await middleware(new NextRequest("http://192.168.1.20:3000/brain", { headers: { host: "192.168.1.20:3000", accept: "text/html" } }));
      assert.equal(lan.status, 403);
      assert.match(await lan.text(), /AYAS_ACCESS_KEY/);
      const lanApi = await middleware(new NextRequest("http://192.168.1.20:3000/api/ayas/chat/stream", { method: "POST", headers: { host: "192.168.1.20:3000" } }));
      assert.equal(lanApi.status, 403);
      assert.equal(((await lanApi.json()) as { error: string }).error, "access_gate_dev_local_only");
      const forged = await middleware(new NextRequest("http://localhost:3000/brain", { method: "POST", headers: { host: "localhost:3000", "x-forwarded-for": "192.168.1.20" } }));
      assert.equal(forged.status, 403);
      const open = await middleware(new NextRequest("http://192.168.1.20:3000/login", { headers: { host: "192.168.1.20:3000" } }));
      assert.equal(open.status, 200, "open paths are not gated");
    });
  });

  await scenario("middleware enforced / misconfigured: unchanged for every Host", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY }, async () => {
      const lan = await middleware(new NextRequest("http://192.168.1.20:3000/brain", { headers: { host: "192.168.1.20:3000", accept: "text/html" } }));
      assert.equal(lan.status, 307, "no session → the login redirect, as before");
      const token = await issueSession(KEY);
      const phone = await middleware(new NextRequest("https://ayas.atolyeayas.com/brain", {
        headers: { host: "ayas.atolyeayas.com", cookie: `${AYAS_SESSION_COOKIE}=${token}`, "cf-connecting-ip": "203.0.113.50", "x-forwarded-for": "203.0.113.50" },
      }));
      assert.equal(phone.status, 200, "a session through the tunnel passes");
      assert.equal(phone.headers.get("x-ayas-access-gate"), "enforced");
    });
    await withEnv({ AYAS_ACCESS_KEY: "short" }, async () => {
      const res = await middleware(new NextRequest("http://localhost:3000/api/x", { headers: { host: "localhost:3000" } }));
      assert.equal(res.status, 503);
    });
  });

  console.log(`AYAS login hardening: PASS (${count} scenarios)`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("AYAS login hardening FAILED:", error);
    process.exitCode = 1;
  }
})();
