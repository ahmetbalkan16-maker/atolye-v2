import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PRIVATE_ASSET_CACHE_CONTROL } from "../src/lib/assets/storage/PrivateAssetCacheControl";
import { isProtectedPath } from "../src/lib/auth/accessGate";

/**
 * 14 Nov 2026 security audit: the four stored-asset routes answered `Cache-Control: public, max-age=31536000`. The
 * phone reaches AYAS through the Cloudflare named tunnel, whose default cache keeps .mp4/.png/.jpg/.webp responses that
 * the origin marks `public` — keyed by URL, without the session cookie — so one logged-in view could be replayed from
 * the edge to anyone with the URL, past `middleware.ts`. This smoke pins the shared value and scans every route
 * handler under a session-gated path for a shared-cacheable literal (`public` or `s-maxage`).
 * Source-only: no server, no network, no runtime state.
 */

let count = 0;
function scenario(name: string, fn: () => void): void {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = process.cwd();
const ASSET_ROUTES = ["images", "videos", "audio", "thumbnails"].map((kind) => path.join("app", "api", "assets", kind, "[slug]", "[fileName]", "route.ts"));

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

/** `app/api/a/[x]/route.ts` → `/api/a/x` (a dynamic segment stands for any value; only the prefix matters here). */
function urlPathOf(file: string): string {
  const rel = path.relative(path.join(REPO_ROOT, "app"), path.dirname(file)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
  return `/${rel.map((s) => s.replace(/^\[+\.{0,3}|\]+$/g, "")).join("/")}`;
}

function main(): void {
  scenario("the shared asset value forbids shared caches and keeps the browser's own cache", () => {
    const directives = PRIVATE_ASSET_CACHE_CONTROL.split(",").map((d) => d.trim().toLowerCase());
    assert.ok(directives.includes("private"));
    assert.ok(!directives.includes("public"));
    assert.ok(!directives.some((d) => d.startsWith("s-maxage")));
    assert.ok(directives.some((d) => /^max-age=\d+$/.test(d)), "the owner's browser may still cache immutable assets");
  });

  scenario("each stored-asset route uses the shared value and no literal of its own", () => {
    for (const rel of ASSET_ROUTES) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      assert.match(text, /"Cache-Control":\s*PRIVATE_ASSET_CACHE_CONTROL/, rel);
      assert.match(text, /from "@\/lib\/assets\/storage\/PrivateAssetCacheControl"/, rel);
    }
  });

  scenario("no route handler under a session-gated path sends a shared-cacheable Cache-Control literal", () => {
    const offenders: string[] = [];
    const files = routeFiles(path.join(REPO_ROOT, "app"));
    assert.ok(files.length >= 30, `expected the app's route handlers, found ${files.length}`);
    for (const file of files) {
      if (!isProtectedPath(urlPathOf(file))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/["']Cache-Control["']\s*[:,]\s*["'`]([^"'`]*)["'`]/gi)) {
        if (/\bpublic\b|s-maxage/i.test(m[1]!)) offenders.push(`${path.relative(REPO_ROOT, file)}: ${m[1]}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  scenario("the scan sees the asset routes as session-gated (it would not pass vacuously)", () => {
    for (const rel of ASSET_ROUTES) assert.ok(isProtectedPath(urlPathOf(path.join(REPO_ROOT, rel))), rel);
    assert.equal(isProtectedPath(urlPathOf(path.join(REPO_ROOT, "app", "api", "auth", "login", "route.ts"))), false);
  });

  console.log(`PASS (${count} scenarios)`);
}

main();
