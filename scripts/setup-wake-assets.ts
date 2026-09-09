/**
 * Stage the browser wake-word assets into `public/` (Voice Closure Sprint).
 *
 *   public/ort/    onnxruntime-web WASM, copied from node_modules
 *   public/wake/   melspectrogram.onnx + embedding_model.onnx (openWakeWord,
 *                  Apache-2.0) — copied from a local openWakeWord install or
 *                  fetched from the openWakeWord GitHub release
 *
 * `public/wake/ayas.onnx` is produced separately by
 * `scripts/wake/train_ayas_wake.py` (the trained wake model). Both dirs are
 * gitignored; run this after `npm install` / on a fresh checkout.
 *
 *   npx tsx scripts/setup-wake-assets.ts
 */

import { createWriteStream } from "node:fs";
import { mkdir, copyFile, access, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const REPO = process.cwd();
const ORT_SRC = path.join(REPO, "node_modules", "onnxruntime-web", "dist");
const ORT_DST = path.join(REPO, "public", "ort");
const WAKE_DST = path.join(REPO, "public", "wake");

const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

const FEATURE_MODELS: { name: string; url: string }[] = [
  {
    name: "melspectrogram.onnx",
    url: "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx",
  },
  {
    name: "embedding_model.onnx",
    url: "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx",
  },
];

const LOCAL_OWW = [
  path.join(REPO, ".venv-wake", "Lib", "site-packages", "openwakeword", "resources", "models"),
  path.join(REPO, ".venv-wake", "lib", "python3.11", "site-packages", "openwakeword", "resources", "models"),
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

async function main(): Promise<void> {
  await mkdir(ORT_DST, { recursive: true });
  await mkdir(WAKE_DST, { recursive: true });

  for (const f of ORT_FILES) {
    const src = path.join(ORT_SRC, f);
    if (!(await exists(src))) throw new Error(`missing ${src} — run "npm install" first`);
    await copyFile(src, path.join(ORT_DST, f));
    console.log(`ort   ${f}`);
  }

  const localDir = (await Promise.all(LOCAL_OWW.map(exists))).findIndex(Boolean);
  for (const m of FEATURE_MODELS) {
    const dst = path.join(WAKE_DST, m.name);
    if (await exists(dst)) {
      console.log(`wake  ${m.name} (already present)`);
      continue;
    }
    if (localDir >= 0 && (await exists(path.join(LOCAL_OWW[localDir], m.name)))) {
      await copyFile(path.join(LOCAL_OWW[localDir], m.name), dst);
      console.log(`wake  ${m.name} (from local openWakeWord)`);
    } else {
      await download(m.url, dst);
      console.log(`wake  ${m.name} (downloaded)`);
    }
  }

  const ayas = path.join(WAKE_DST, "ayas.onnx");
  if (await exists(ayas)) {
    const s = await stat(ayas);
    console.log(`wake  ayas.onnx present (${(s.size / 1024).toFixed(0)} KB)`);
  } else {
    console.log("wake  ayas.onnx NOT present — train it: python scripts/wake/train_ayas_wake.py");
  }
  console.log("done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
