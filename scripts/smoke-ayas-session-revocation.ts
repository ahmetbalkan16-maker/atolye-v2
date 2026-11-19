/**
 * Server-side logout (owner approval 19 Nov 2026). Before it, "Çıkış" only cleared the browser's cookie: a copy of the
 * cookie stayed valid for its whole 7-day life because the edge middleware could not see anything the logout route
 * wrote. Now the middleware runs on the Node.js runtime and refuses a cookie the logout recorded.
 *
 * Deterministic: temp roots under os.tmpdir(), no server, no network. The middleware is called in-process with
 * `process.chdir` into a temp root (its revocation folder is cwd-relative, like the live app's `data/brain`).
 *
 * Run: npx tsx scripts/smoke-ayas-session-revocation.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import { AYAS_SESSION_TTL_SECONDS, issueSession, sessionRevocationTarget, verifySession } from "../src/lib/auth/accessGate";
import {
  AYAS_SESSION_REVOCATION_DIR,
  isSessionRevoked,
  isSessionTokenRevoked,
  pruneExpiredRevocations,
  revokeSession,
  sessionRevocationDir,
  verifyActiveSession,
} from "../src/lib/auth/sessionRevocation";
import { middleware, config as middlewareConfig } from "../middleware";
import { POST as logout } from "../app/api/auth/logout/route";

const REPO_ROOT = path.resolve(__dirname, "..");
const KEY = "correct-horse-battery-staple-xyz";
const NOW = 1_763_000_000_000;

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>): Promise<void> {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-session-revocation-"));
}

/** A legacy (pre-13-Nov) cookie: no nonce, same signature scheme. */
async function legacyToken(key: string, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, iat, exp: iat + AYAS_SESSION_TTL_SECONDS })).toString("base64url");
  const signature = Buffer.from(
    await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(body)),
  ).toString("base64url");
  return `${body}.${signature}`;
}

async function inCwd<T>(root: string, run: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(root);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}

async function main(): Promise<void> {
  const roots: string[] = [];
  const fresh = () => {
    const root = tempRoot();
    roots.push(root);
    return root;
  };

  try {
    await scenario("the revocation id is stable per cookie, differs between cookies and keys, and is not the cookie", async () => {
      const a = await issueSession(KEY, NOW);
      const b = await issueSession(KEY, NOW);
      const ta = await sessionRevocationTarget(a, KEY, NOW);
      const ta2 = await sessionRevocationTarget(a, KEY, NOW + 5_000);
      const tb = await sessionRevocationTarget(b, KEY, NOW);
      assert.ok(ta && ta2 && tb);
      assert.match(ta.id, /^[0-9a-f]{64}$/);
      assert.equal(ta.id, ta2.id, "the same cookie always maps to the same record");
      assert.notEqual(ta.id, tb.id, "two logins in the same second still differ (nonce)");
      assert.ok(!a.includes(ta.id), "the id is not part of the cookie");
      assert.equal(ta.expiresAt, Math.floor(NOW / 1000) + AYAS_SESSION_TTL_SECONDS);
      assert.equal(await sessionRevocationTarget(a, `${KEY}-other`, NOW), null, "another key: not a session");
      assert.equal(await sessionRevocationTarget("garbage", KEY, NOW), null);
      assert.equal(await sessionRevocationTarget(a, KEY, NOW + (AYAS_SESSION_TTL_SECONDS + 1) * 1000), null, "expired: nothing to revoke");
    });

    await scenario("a logged-out cookie is refused; another session of the owner stays valid", async () => {
      const root = fresh();
      const phone = await issueSession(KEY, NOW);
      const pc = await issueSession(KEY, NOW);
      assert.equal(await verifyActiveSession(phone, KEY, { root, now: NOW }), true);
      const result = await revokeSession(phone, KEY, { root, now: NOW });
      assert.equal(result.kind, "revoked");
      assert.equal(await verifySession(phone, KEY, NOW + 1000), true, "the signature alone still verifies — the record is what ends it");
      assert.equal(await verifyActiveSession(phone, KEY, { root, now: NOW + 1000 }), false, "the copy of the logged-out cookie is refused");
      assert.equal(await isSessionTokenRevoked(phone, KEY, { root, now: NOW + 1000 }), true);
      assert.equal(await verifyActiveSession(pc, KEY, { root, now: NOW + 1000 }), true, "the other device is not signed out");
    });

    await scenario("a cookie from before the change (no nonce) is revoked the same way", async () => {
      const root = fresh();
      const old = await legacyToken(KEY, NOW);
      assert.equal(await verifySession(old, KEY, NOW), true);
      assert.equal(await verifyActiveSession(old, KEY, { root, now: NOW }), true, "existing sessions keep working");
      assert.equal((await revokeSession(old, KEY, { root, now: NOW })).kind, "revoked");
      assert.equal(await verifyActiveSession(old, KEY, { root, now: NOW }), false);
    });

    await scenario("records are atomic files named by the id, holding only times; nothing else in the folder", async () => {
      const root = fresh();
      const token = await issueSession(KEY, NOW);
      const result = await revokeSession(token, KEY, { root, now: NOW });
      assert.equal(result.kind, "revoked");
      const dir = sessionRevocationDir(root);
      assert.equal(dir, path.join(root, "data", "brain", "phone-access", "session-revocations"));
      assert.deepEqual(fs.readdirSync(dir), [`${(result as { id: string }).id}.json`]);
      const record = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), "utf8")) as Record<string, unknown>;
      assert.deepEqual(Object.keys(record).sort(), ["expiresAt", "revokedAt", "schemaVersion"]);
      assert.ok(!fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]!), "utf8").includes(token.split(".")[1]!), "no signature on disk");
    });

    await scenario("revoking a forged, expired or missing cookie writes nothing", async () => {
      const root = fresh();
      for (const token of [undefined, "", "a.b", await issueSession(`${KEY}-other`, NOW), await issueSession(KEY, NOW - (AYAS_SESSION_TTL_SECONDS + 10) * 1000)]) {
        assert.equal((await revokeSession(token, KEY, { root, now: NOW })).kind, "not-a-session");
      }
      assert.equal(fs.existsSync(sessionRevocationDir(root)), false);
    });

    await scenario("fail closed: an unreadable record location refuses the cookie; a bad id counts as revoked", async () => {
      const root = fresh();
      const token = await issueSession(KEY, NOW);
      const target = (await sessionRevocationTarget(token, KEY, NOW))!;
      // A lookup that fails for any reason but "no such file" refuses (here: a path stat rejects outright).
      const broken = `${root}\0bad`;
      assert.equal(isSessionRevoked(target.id, broken), true);
      assert.equal(await verifyActiveSession(token, KEY, { root: broken, now: NOW }), false);
      assert.equal(await verifyActiveSession(token, KEY, { root, now: NOW }), true, "no record: the session is fine");
      // The revocation folder is a FILE: the record cannot be written.
      fs.mkdirSync(path.dirname(sessionRevocationDir(root)), { recursive: true });
      fs.writeFileSync(sessionRevocationDir(root), "not a folder");
      assert.equal(isSessionRevoked("../../etc", root), true);
      assert.equal(isSessionRevoked("A".repeat(64), root), true);
      // ...and the write failure is reported, not hidden.
      assert.equal((await revokeSession(token, KEY, { root, now: NOW })).kind, "write-failed");
    });

    await scenario("pruning drops records whose cookie expired, keeps live and unreadable ones and fresh temp files", async () => {
      const root = fresh();
      const live = await issueSession(KEY, NOW);
      const old = await issueSession(KEY, NOW - (AYAS_SESSION_TTL_SECONDS - 60) * 1000);
      await revokeSession(live, KEY, { root, now: NOW });
      await revokeSession(old, KEY, { root, now: NOW });
      const dir = sessionRevocationDir(root);
      fs.writeFileSync(path.join(dir, `${"c".repeat(64)}.json`), "{ broken");
      fs.writeFileSync(path.join(dir, ".pending-1-2-3"), "x");
      assert.equal(fs.readdirSync(dir).length, 4);
      const later = NOW + 120_000; // the old cookie has expired by itself
      assert.equal(pruneExpiredRevocations(root, later), 1);
      assert.equal(await verifyActiveSession(live, KEY, { root, now: later }), false, "the live revoked cookie stays refused");
      assert.ok(fs.existsSync(path.join(dir, `${"c".repeat(64)}.json`)), "an unreadable record is kept (fail closed)");
      assert.ok(fs.existsSync(path.join(dir, ".pending-1-2-3")), "a temp file from this minute is kept");
      const stale = new Date(Date.now() - 5 * 60_000);
      fs.utimesSync(path.join(dir, ".pending-1-2-3"), stale, stale);
      assert.equal(pruneExpiredRevocations(root, Date.now()) >= 1, true);
      assert.equal(fs.existsSync(path.join(dir, ".pending-1-2-3")), false);
      assert.equal(pruneExpiredRevocations(path.join(root, "nowhere"), later), 0, "a missing folder is not an error");
    });

    await scenario("middleware: a logged-out cookie gets the login redirect (page) and 401 (API); a live one passes", async () => {
      const root = fresh();
      process.env.AYAS_ACCESS_KEY = KEY;
      try {
        await inCwd(root, async () => {
          const live = await issueSession(KEY);
          const ended = await issueSession(KEY);
          await revokeSession(ended, KEY, { root });
          const page = (cookie: string) => new NextRequest("https://ayas.example/brain", { headers: { host: "ayas.example", accept: "text/html", cookie: `ayas_session=${cookie}` } });
          const api = (cookie: string) => new NextRequest("https://ayas.example/api/brain/snapshot", { headers: { host: "ayas.example", cookie: `ayas_session=${cookie}` } });
          const okPage = await middleware(page(live));
          assert.equal(okPage.headers.get("x-middleware-next"), "1", "the live session passes through");
          assert.equal(okPage.headers.get("x-ayas-access-gate"), "enforced");
          const refusedPage = await middleware(page(ended));
          assert.equal(refusedPage.status, 307);
          assert.equal(new URL(refusedPage.headers.get("location")!).pathname, "/login");
          const refusedApi = await middleware(api(ended));
          assert.equal(refusedApi.status, 401);
          assert.deepEqual(await refusedApi.json(), { error: "authentication_required" });
          assert.equal((await middleware(api(live))).headers.get("x-middleware-next"), "1");
        });
      } finally {
        delete process.env.AYAS_ACCESS_KEY;
      }
    });

    await scenario("logout route: records the cookie on the server, clears it in the browser, still refuses cross-site posts", async () => {
      const root = fresh();
      process.env.AYAS_ACCESS_KEY = KEY;
      try {
        await inCwd(root, async () => {
          const token = await issueSession(KEY);
          const form = new NextRequest("https://ayas.example/api/auth/logout", {
            method: "POST",
            headers: { host: "ayas.example", origin: "https://ayas.example", "content-type": "application/x-www-form-urlencoded", cookie: `ayas_session=${token}` },
            body: "",
          });
          const res = await logout(form);
          assert.equal(res.status, 303);
          assert.equal(res.headers.get("location"), "/login");
          assert.match(res.headers.get("set-cookie") ?? "", /ayas_session=;.*Max-Age=0/i);
          assert.equal(await verifyActiveSession(token, KEY, { root }), false, "the server no longer accepts this cookie");
          assert.equal(fs.readdirSync(sessionRevocationDir(root)).length, 1);

          const other = await issueSession(KEY);
          const crossSite = new NextRequest("https://ayas.example/api/auth/logout", {
            method: "POST",
            headers: { host: "ayas.example", origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded", cookie: `ayas_session=${other}` },
            body: "",
          });
          assert.equal((await logout(crossSite)).status, 403);
          assert.equal(await verifyActiveSession(other, KEY, { root }), true, "a cross-site post cannot end a session");

          const noCookie = new NextRequest("https://ayas.example/api/auth/logout", { method: "POST", headers: { host: "ayas.example" } });
          assert.equal((await logout(noCookie)).status, 200, "logout without a cookie still answers");
        });
      } finally {
        delete process.env.AYAS_ACCESS_KEY;
      }
    });

    await scenario("wiring: Node.js middleware runtime, revocation checked after verifySession, store is Git-ignored", () => {
      assert.equal((middlewareConfig as { runtime?: string }).runtime, "nodejs", "the edge runtime cannot read the logout records");
      const mw = fs.readFileSync(path.join(REPO_ROOT, "middleware.ts"), "utf8");
      assert.match(mw, /verifySession\(token, gate\.key as string\) && !await isSessionTokenRevoked\(token, gate\.key as string\)/);
      const ignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
      assert.ok(ignore.split(/\r?\n/).includes("/data/brain/phone-access/"), "the records live in an ignored folder");
      assert.ok(AYAS_SESSION_REVOCATION_DIR.split(path.sep).join("/").startsWith("data/brain/phone-access/"));
      const route = fs.readFileSync(path.join(REPO_ROOT, "app/api/auth/logout/route.ts"), "utf8");
      assert.match(route, /revokeSession\(/);
    });
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`AYAS session revocation: PASS (${count} scenarios)`);
}

main().catch((error: unknown) => {
  console.error("AYAS session revocation FAILED:", error);
  process.exitCode = 1;
});
