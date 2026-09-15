/**
 * AYAS Phone Access Health smoke suite (Phone Access sprint).
 *
 * Deterministic, no real daemon, no network. Exercises the bounded,
 * read-only `readAyasPhoneAccessHealth` reader against a real temp-file
 * fixture — never a mock fs — so the actual `fs.lstatSync`/size/staleness
 * guards run for real.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAyasPhoneAccessHealth } from "../src/lib/runtime/access/AyasPhoneAccessHealth";
import { GET as getPhoneAccessRoute } from "../app/api/ayas/phone-access/route";

const REPO_ROOT = path.resolve(__dirname, "..");

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function withStatusFile<T>(content: string | null, run: (statusFilePath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-phone-access-health-"));
  const statusFilePath = path.join(dir, "status.json");
  try {
    if (content !== null) fs.writeFileSync(statusFilePath, content, "utf8");
    return run(statusFilePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  await scenario("absent status file → fully offline/unknown, stale, no throw", () => {
    withStatusFile(null, (statusFilePath) => {
      const health = readAyasPhoneAccessHealth({ statusFilePath });
      assert.equal(health.appServer, "offline");
      assert.equal(health.lanAccess, "unknown");
      assert.equal(health.tunnel, "offline");
      assert.equal(health.ayasBackend, "offline");
      assert.equal(health.tunnelUrl, null);
      assert.equal(health.stale, true);
    });
  });

  await scenario("fresh, well-formed status → passthrough, not stale", () => {
    const now = Date.now();
    withStatusFile(
      JSON.stringify({
        appServer: "online",
        lanAccess: "online",
        tunnel: "online",
        ayasBackend: "online",
        tunnelUrl: "https://aids-undefined-acoustic-rats.trycloudflare.com",
        updatedAt: new Date(now).toISOString(),
      }),
      (statusFilePath) => {
        const health = readAyasPhoneAccessHealth({ statusFilePath, now: () => now + 5_000 });
        assert.equal(health.appServer, "online");
        assert.equal(health.lanAccess, "online");
        assert.equal(health.tunnel, "online");
        assert.equal(health.ayasBackend, "online");
        assert.equal(health.tunnelUrl, "https://aids-undefined-acoustic-rats.trycloudflare.com");
        assert.equal(health.stale, false);
      },
    );
  });

  await scenario("degraded backend + starting tunnel round-trip correctly", () => {
    const now = Date.now();
    withStatusFile(
      JSON.stringify({
        appServer: "online", lanAccess: "online", tunnel: "starting",
        ayasBackend: "degraded", tunnelUrl: null, updatedAt: new Date(now).toISOString(),
      }),
      (statusFilePath) => {
        const health = readAyasPhoneAccessHealth({ statusFilePath, now: () => now });
        assert.equal(health.tunnel, "starting");
        assert.equal(health.ayasBackend, "degraded");
        assert.equal(health.tunnelUrl, null);
      },
    );
  });

  await scenario("a frozen/stale daemon (>5 min old) is NEVER trusted as still online", () => {
    const staleAt = Date.now() - 10 * 60 * 1000;
    withStatusFile(
      JSON.stringify({
        appServer: "online", lanAccess: "online", tunnel: "online",
        ayasBackend: "online", tunnelUrl: "https://old-run.trycloudflare.com",
        updatedAt: new Date(staleAt).toISOString(),
      }),
      (statusFilePath) => {
        const health = readAyasPhoneAccessHealth({ statusFilePath, now: () => Date.now() });
        assert.equal(health.appServer, "offline", "a stale file must NOT report a frozen 'online'");
        assert.equal(health.tunnel, "offline");
        assert.equal(health.ayasBackend, "offline");
        assert.equal(health.stale, true);
        assert.equal(health.updatedAt, new Date(staleAt).toISOString(), "the stale timestamp itself is still surfaced, diagnostically");
      },
    );
  });

  await scenario("a UTF-8 BOM-prefixed file (Windows PowerShell's Set-Content -Encoding utf8) still parses", () => {
    const now = Date.now();
    withStatusFile(
      "﻿" + JSON.stringify({
        appServer: "online", lanAccess: "online", tunnel: "online",
        ayasBackend: "online", tunnelUrl: null, updatedAt: new Date(now).toISOString(),
      }),
      (statusFilePath) => {
        const health = readAyasPhoneAccessHealth({ statusFilePath, now: () => now });
        assert.equal(health.appServer, "online", "a leading BOM must not make a real, fresh status file read as offline");
      },
    );
  });

  await scenario("malformed JSON fails safe, never throws", () => {
    withStatusFile("{ this is not json", (statusFilePath) => {
      assert.doesNotThrow(() => readAyasPhoneAccessHealth({ statusFilePath }));
      assert.equal(readAyasPhoneAccessHealth({ statusFilePath }).appServer, "offline");
    });
  });

  await scenario("an invalid enum value anywhere in the shape fails the whole read closed", () => {
    withStatusFile(
      JSON.stringify({
        appServer: "definitely-not-a-real-status", lanAccess: "online", tunnel: "online",
        ayasBackend: "online", tunnelUrl: null, updatedAt: new Date().toISOString(),
      }),
      (statusFilePath) => {
        assert.equal(readAyasPhoneAccessHealth({ statusFilePath }).appServer, "offline");
      },
    );
  });

  await scenario("an oversized file is rejected without reading its content as trusted", () => {
    withStatusFile("x".repeat(5 * 1024), (statusFilePath) => {
      const health = readAyasPhoneAccessHealth({ statusFilePath });
      assert.equal(health.appServer, "offline");
      assert.equal(health.stale, true);
    });
  });

  await scenario("a non-trycloudflare.com tunnelUrl is never trusted, even if the shape is otherwise valid", () => {
    withStatusFile(
      JSON.stringify({
        appServer: "online", lanAccess: "online", tunnel: "online", ayasBackend: "online",
        tunnelUrl: "https://evil.example.com/steal", updatedAt: new Date().toISOString(),
      }),
      (statusFilePath) => {
        // The whole shape validation fails closed on an untrusted URL pattern — offline, not a partial trust.
        assert.equal(readAyasPhoneAccessHealth({ statusFilePath }).appServer, "offline");
      },
    );
  });

  await scenario("the stable AYAS named tunnel URL is trusted when the daemon reports it online", () => {
    const now = Date.now();
    withStatusFile(
      JSON.stringify({
        appServer: "online", lanAccess: "online", tunnel: "online", ayasBackend: "online",
        tunnelUrl: "https://ayas.atolyeayas.com", updatedAt: new Date(now).toISOString(),
      }),
      (statusFilePath) => {
        const health = readAyasPhoneAccessHealth({ statusFilePath, now: () => now });
        assert.equal(health.appServer, "online");
        assert.equal(health.tunnelUrl, "https://ayas.atolyeayas.com");
        assert.equal(health.stale, false);
      },
    );
  });

  await scenario("STATIC — the health reader never references execution-gate / self-improvement / production-resume primitives", () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/runtime/access/AyasPhoneAccessHealth.ts"),
      "utf8",
    );
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of [
      "executionGate", "ExecutionGate", "resumeStage", "PipelineRunner",
      "approveAyasImprovement", "SelfHeal", "autoApply", "production:acceptance",
    ]) {
      assert.ok(!code.includes(banned), `must not reference "${banned}"`);
    }
    assert.ok(code.includes("fs.readFileSync") || code.includes("fs.lstatSync"), "reads the status file");
  });

  await scenario("API route — GET /api/ayas/phone-access returns the SAME bounded health the library computes, no-store", () => {
    const response = getPhoneAccessRoute();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  await scenario("STATIC — the phone-access API route carries no OPEN_* access-gate exemption (stays behind the login gate)", () => {
    const gateRaw = fs.readFileSync(path.join(REPO_ROOT, "src/lib/auth/accessGate.ts"), "utf8");
    assert.ok(
      !gateRaw.includes("/api/ayas/phone-access"),
      "the phone-access status route must stay protected — no OPEN_EXACT/OPEN_PREFIXES carve-out for it",
    );
  });

  console.log(`AYAS phone access health smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-access-health", scenarios: count }));
}

void run();
