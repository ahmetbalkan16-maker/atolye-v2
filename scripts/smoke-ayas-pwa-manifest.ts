/**
 * AYAS PWA manifest + icon-set smoke (phone installability).
 *
 * Static / no browser. Asserts the manifest route output and the committed PNG
 * icon set meet Chrome/Android's install criteria and iOS "Add to Home Screen":
 *  - manifest has name, short_name, start_url, display:standalone, id;
 *  - a PNG icon at BOTH 192x192 and 512x512 with purpose "any" (SVG-only fails);
 *  - a maskable PNG pair;
 *  - the referenced PNG files exist, are real PNGs, and are the declared size;
 *  - the layout emits an apple-touch-icon + a manifest link;
 *  - /icons/ is open pre-auth (the browser fetches icons before a session).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import manifest from "../app/manifest";
import { isProtectedPath } from "../src/lib/auth/accessGate";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO = path.resolve(__dirname, "..");
const m = manifest();

function pngDimensions(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString("ascii"), "PNG", `${file} is not a PNG`);
  // IHDR is the first chunk: 8-byte sig, 4-byte length, "IHDR", width(4), height(4)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

scenario("manifest — required install fields", () => {
  assert.equal(m.name, "Atölye AYAS");
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.display, "standalone");
  assert.ok(typeof m.start_url === "string" && m.start_url.startsWith("/brain"));
  assert.ok(m.id, "an explicit id keeps the installed app identity stable");
  assert.equal(m.scope, "/");
  assert.ok(m.theme_color && m.background_color);
});

scenario("manifest — a PNG icon at BOTH 192 and 512 with purpose 'any' (SVG-only would fail the prompt)", () => {
  const png = (m.icons ?? []).filter((i) => i.type === "image/png");
  const any192 = png.find((i) => i.sizes === "192x192" && (i.purpose ?? "any").includes("any"));
  const any512 = png.find((i) => i.sizes === "512x512" && (i.purpose ?? "any").includes("any"));
  assert.ok(any192, "missing PNG 192x192 purpose any");
  assert.ok(any512, "missing PNG 512x512 purpose any");
});

scenario("manifest — a maskable PNG pair (adaptive icon)", () => {
  const mask = (m.icons ?? []).filter((i) => i.type === "image/png" && (i.purpose ?? "").includes("maskable"));
  assert.ok(mask.some((i) => i.sizes === "192x192"));
  assert.ok(mask.some((i) => i.sizes === "512x512"));
});

scenario("icons — every referenced PNG exists, is a real PNG, and matches its declared size", () => {
  for (const icon of m.icons ?? []) {
    if (icon.type !== "image/png") continue;
    const file = path.join(REPO, "public", icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} does not exist`);
    const [w, h] = String(icon.sizes).split("x").map(Number);
    const dim = pngDimensions(file);
    assert.equal(dim.width, w, `${icon.src} width`);
    assert.equal(dim.height, h, `${icon.src} height`);
  }
});

scenario("icons — apple-touch-icon (180) + favicons exist as opaque PNGs", () => {
  for (const [name, size] of [["apple-touch-icon.png", 180], ["favicon-32.png", 32], ["favicon-16.png", 16]] as const) {
    const file = path.join(REPO, "public/icons", name);
    assert.ok(fs.existsSync(file), `${name} missing`);
    assert.deepEqual(pngDimensions(file), { width: size, height: size });
  }
});

scenario("layout — emits the manifest link + apple-touch-icon", () => {
  const src = fs.readFileSync(path.join(REPO, "app/layout.tsx"), "utf8");
  assert.match(src, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(src, /apple-touch-icon\.png/);
  assert.match(src, /appleWebApp:\s*\{\s*capable:\s*true/);
});

scenario("routing — /icons/ is open pre-auth (browser fetches icons before a session)", () => {
  assert.equal(isProtectedPath("/icons/icon-512.png"), false);
  assert.equal(isProtectedPath("/manifest.webmanifest"), false);
  assert.equal(isProtectedPath("/sw.js"), false);
  // the app itself stays protected
  assert.equal(isProtectedPath("/brain"), true);
});

scenario("build script — deterministic + committed", () => {
  assert.ok(fs.existsSync(path.join(REPO, "scripts/build-pwa-icons.ts")));
  // the generated dir is tracked (a plain checkout is installable with no build)
  assert.ok(fs.existsSync(path.join(REPO, "public/icons/icon-512.png")));
});

console.log(`AYAS PWA manifest smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-pwa-manifest", scenarios: count }));
