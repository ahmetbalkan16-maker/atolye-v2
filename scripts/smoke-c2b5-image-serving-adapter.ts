/**
 * C.2B.5 — Runtime image serving adapter.
 *
 * Deterministic / no browser / $0 / no network. Proves the image GET route no
 * longer reads a physical `process.cwd()/data/projects` root: every read now
 * flows through `ImageStorage.readImage`, which resolves the logical
 * `data/projects/<slug>/assets/images/<file>` path against the canonical
 * runtime storage context (`ATOLYE_RUNTIME_ROOT`, else the legacy default) with
 * containment + symlink/junction rejection, exactly like the audio / video /
 * thumbnail routes.
 *
 * Run: npx tsx scripts/smoke-c2b5-image-serving-adapter.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ImageStorage } from "../src/lib/assets/storage/ImageStorage";
import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { GET as imageRouteGet } from "../app/api/assets/images/[slug]/[fileName]/route";

/* --------------------------------------------------------------- fixtures --- */

// 1x1 PNG, GIF and a minimal SVG / JPEG that satisfy the serving sanity check.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const SVG_DOC = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  "utf8",
);
const JPEG_DOC = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from("atolye-c2b5", "utf8"),
  Buffer.from([0xff, 0xd9]),
]);

/* ----------------------------------------------------------------- runner --- */

let count = 0;
const skipped: string[] = [];
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-c2b5-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeRoot = path.join(tempRoot, "runtime");
  const authorityRoot = path.join(tempRoot, "authority");
  await fsp.mkdir(workspaceRoot, { recursive: true });

  const slug = "c2b5-serving-project";
  const imagesDir = path.join(runtimeRoot, "projects", slug, "assets", "images");
  await fsp.mkdir(imagesDir, { recursive: true });

  const context: RuntimeStorageContext = createRuntimeStorageContext({
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    workspaceRoot,
    authorityRoot,
  });

  const write = (fileName: string, bytes: Buffer) =>
    fs.writeFileSync(path.join(imagesDir, fileName), bytes);

  write("photo.png", PNG_1X1);
  write("art.jpg", JPEG_DOC);
  write("loop.gif", GIF_1X1);
  write("mark.svg", SVG_DOC);
  write("truncated.png", PNG_1X1.subarray(0, 4));
  write("mislabeled.png", GIF_1X1);
  write("empty.png", Buffer.alloc(0));

  try {
    await scenario("external runtime root resolves — PNG served from ATOLYE_RUNTIME_ROOT", () => {
      const served = ImageStorage.readImage(slug, "photo.png", context);
      assert.equal(served.mimeType, "image/png");
      assert.ok(served.data.equals(PNG_1X1));
    });

    await scenario("JPEG served with image/jpeg", () => {
      const served = ImageStorage.readImage(slug, "art.jpg", context);
      assert.equal(served.mimeType, "image/jpeg");
      assert.ok(served.data.equals(JPEG_DOC));
    });

    await scenario("GIF served with image/gif", () => {
      const served = ImageStorage.readImage(slug, "loop.gif", context);
      assert.equal(served.mimeType, "image/gif");
      assert.ok(served.data.equals(GIF_1X1));
    });

    await scenario("SVG served with image/svg+xml", () => {
      const served = ImageStorage.readImage(slug, "mark.svg", context);
      assert.equal(served.mimeType, "image/svg+xml");
      assert.ok(served.data.equals(SVG_DOC));
    });

    await scenario("truncated / mislabeled / empty bytes fail closed", () => {
      for (const fileName of ["truncated.png", "mislabeled.png", "empty.png"]) {
        assert.throws(() => ImageStorage.readImage(slug, fileName, context));
      }
    });

    await scenario("missing file → throws (route maps to 404)", () => {
      assert.throws(() => ImageStorage.readImage(slug, "absent.png", context));
    });

    await scenario("unknown extension is rejected", () => {
      write("notes.txt", Buffer.from("hello", "utf8"));
      assert.throws(() => ImageStorage.readImage(slug, "notes.txt", context));
    });

    await scenario("path traversal in file name is rejected", () => {
      for (const evil of [
        "../art.jpg",
        "..\\art.jpg",
        "....//photo.png",
        "a/b.png",
        ".hidden.png",
      ]) {
        assert.throws(() => ImageStorage.readImage(slug, evil, context));
      }
    });

    await scenario("unsafe project slug is rejected", () => {
      for (const evil of ["../etc", "a/b", "a.b", ""]) {
        assert.throws(() => ImageStorage.readImage(evil, "photo.png", context));
      }
    });

    await scenario("symlinked image file is rejected (or skipped where unsupported)", () => {
      const outsideTarget = path.join(tempRoot, "outside-secret.png");
      fs.writeFileSync(outsideTarget, PNG_1X1);
      const linkPath = path.join(imagesDir, "linked.png");
      try {
        fs.symlinkSync(outsideTarget, linkPath, "file");
      } catch {
        skipped.push("symlink rejection (platform cannot create file symlinks)");
        return;
      }
      assert.throws(() => ImageStorage.readImage(slug, "linked.png", context));
      fs.rmSync(linkPath, { force: true });
    });

    await scenario("the image GET route serves the same bytes via ImageStorage", async () => {
      const prev = {
        root: process.env.ATOLYE_RUNTIME_ROOT,
        workspace: process.env.ATOLYE_WORKSPACE_ROOT,
      };
      process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
      process.env.ATOLYE_WORKSPACE_ROOT = workspaceRoot;
      try {
        const ok = await imageRouteGet(new Request("http://local/img"), {
          params: Promise.resolve({ slug, fileName: "photo.png" }),
        });
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get("Content-Type"), "image/png");
        assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");
        assert.ok(Buffer.from(await ok.arrayBuffer()).equals(PNG_1X1));

        const svgOk = await imageRouteGet(new Request("http://local/img"), {
          params: Promise.resolve({ slug, fileName: "mark.svg" }),
        });
        assert.equal(svgOk.status, 200);
        assert.match(
          svgOk.headers.get("Content-Security-Policy") ?? "",
          /default-src 'none'/,
        );

        const missing = await imageRouteGet(new Request("http://local/img"), {
          params: Promise.resolve({ slug, fileName: "absent.png" }),
        });
        assert.equal(missing.status, 404);

        const traversal = await imageRouteGet(new Request("http://local/img"), {
          params: Promise.resolve({ slug, fileName: "../art.jpg" }),
        });
        assert.equal(traversal.status, 404);
      } finally {
        restoreEnv("ATOLYE_RUNTIME_ROOT", prev.root);
        restoreEnv("ATOLYE_WORKSPACE_ROOT", prev.workspace);
      }
    });

    await scenario("no write touched the repository data/projects tree", () => {
      // The adapter is read-only; assert the smoke never created a repo path.
      const repoProjectDir = path.resolve(process.cwd(), "data", "projects", slug);
      assert.equal(fs.existsSync(repoProjectDir), false);
    });

    const result = {
      status: "PASS",
      suite: "c2b5-image-serving-adapter",
      scenarios: count,
      skipped,
    };
    console.log(`C.2B.5 image serving adapter: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${skipped.join("; ")}`);
    console.log(JSON.stringify(result));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("C.2B.5 image serving adapter FAILED:", error);
    process.exitCode = 1;
  }
})();
