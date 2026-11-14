import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import nextConfig from "../next.config";

/**
 * 14 Nov 2026 security audit: no AYAS response carried a framing rule, so any site could load AYAS in a hidden frame
 * and steer the owner's click onto a one-click action ("ONAYLA VE UYGULA"). `next.config.ts` now sends
 * `X-Frame-Options: SAMEORIGIN` and a pinned `Referrer-Policy` on every path. Source-only: no server, no network.
 */

let count = 0;
async function scenario(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();

  await scenario("every path gets SAMEORIGIN framing and the pinned Referrer-Policy", () => {
    const all = rules.find((rule) => rule.source === "/:path*");
    assert.ok(all, "a catch-all header rule exists");
    assert.equal(all.has, undefined, "the catch-all is unconditional");
    assert.equal(all.missing, undefined, "the catch-all is unconditional");
    const value = (key: string) => all.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
    assert.equal(value("X-Frame-Options"), "SAMEORIGIN");
    assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  });

  await scenario("the referrer policy still sends a same-origin Referer (the CSRF backstop's fallback reads it)", () => {
    const value = rules.find((rule) => rule.source === "/:path*")!.headers.find((h) => h.key === "Referrer-Policy")!.value;
    assert.ok(!["no-referrer", "origin", "strict-origin"].includes(value), `${value} would drop the same-origin path`);
  });

  await scenario("the service worker keeps its own no-store rule", () => {
    const sw = rules.find((rule) => rule.source === "/sw.js");
    assert.ok(sw);
    assert.equal(sw.headers.find((h) => h.key === "Cache-Control")?.value, "no-cache, no-store, must-revalidate");
  });

  await scenario("no app/middleware code loosens framing on its own (ALLOWALL / ALLOW-FROM / frame-ancestors *)", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(path.join(REPO_ROOT, "app")), path.join(REPO_ROOT, "middleware.ts")]) {
      const text = fs.readFileSync(file, "utf8");
      if (/X-Frame-Options["'`]?\s*[:,]\s*["'`](?!SAMEORIGIN|DENY)/i.test(text) || /frame-ancestors\s+(\*|https?:)/i.test(text)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    assert.deepEqual(offenders, []);
  });

  console.log(`PASS (${count} scenarios)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
