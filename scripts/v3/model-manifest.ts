/**
 * Atölye V3 — writes the manifest of a reviewed model folder (`<dir>/atolye-manifest.json`), which the local model
 * servers check before loading (scripts/v3/model_manifest.py): the source repository and every file with its size;
 * code-carrying files (.py, .pt, .pth, .bin, .ckpt, .pkl) and files under 50 MB also with their SHA-256. Run once
 * after a download has been reviewed; an existing manifest is never overwritten.
 *
 *   npx tsx scripts/v3/model-manifest.ts <model-dir> <hf-repo-id>
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";

const CODE = new Set([".py", ".pt", ".pth", ".bin", ".ckpt", ".pkl"]);
const HASH_LIMIT = 50 * 1024 * 1024;

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (rel.startsWith(".cache") || e.name === "atolye-manifest.json") continue;
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

async function main() {
  const [dir, repo] = process.argv.slice(2);
  if (!dir || !repo) throw new Error("Kullanım: model-manifest.ts <model-klasörü> <hf-repo-id>");
  const target = path.join(dir, "atolye-manifest.json");
  if (existsSync(target)) throw new Error(`zaten var (üzerine yazılmaz): ${target}`);
  const files = [];
  for (const rel of await walk(dir)) {
    const full = path.join(dir, rel);
    const bytes = (await fs.stat(full)).size;
    const hashed = CODE.has(path.extname(rel).toLowerCase()) || bytes <= HASH_LIMIT;
    files.push({ file: rel, bytes, ...(hashed ? { sha256: await sha256(full) } : {}) });
  }
  await fs.writeFile(target, `${JSON.stringify({ repository: repo, written: new Date().toISOString(), files }, null, 2)}\n`);
  console.log(`${files.length} dosya, ${files.filter((f) => f.sha256).length} tanesi hash'li → ${target}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
