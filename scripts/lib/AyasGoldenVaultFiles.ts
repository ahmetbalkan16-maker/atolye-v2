/** Filesystem and process side of the Stage 15O golden vault, for the operator script and its suites. It reads and runs; it never writes. */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AyasGoldenCaseResult, AyasGoldenPin, AyasGoldenVault } from "../../src/lib/ayas/golden/AyasGoldenVault";

const IMPORT = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'](\.[^"']+)["']/g;

/**
 * A golden script and every file under `scripts/` it imports, transitively, sorted. These are the grader and the
 * fixtures: the bytes that decide a case's result. Source under `src/` is what a case measures, so it is not pinned.
 */
export function ayasGoldenScriptClosure(repoRoot: string, script: string): string[] {
  const seen = new Set<string>(); const stack = [script];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const match of fs.readFileSync(path.join(repoRoot, file), "utf8").matchAll(IMPORT)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!));
      if (!base.startsWith("scripts/")) continue;
      const found = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, `${base}/index.ts`].find((candidate) => {
        try { return fs.statSync(path.join(repoRoot, candidate)).isFile(); } catch { return false; }
      });
      if (found) stack.push(found);
    }
  }
  return [...seen].sort();
}

export function ayasGoldenPinsFor(repoRoot: string, script: string): AyasGoldenPin[] {
  return ayasGoldenScriptClosure(repoRoot, script).map((file) => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(repoRoot, file))).digest("hex") }));
}

export const AYAS_GOLDEN_CASE_TIMEOUT_MS = 120_000;

/** Runs every case of `vault` in `repoRoot`, one at a time, each as its own bounded child process with no arguments. */
export function runAyasGoldenVault(repoRoot: string, vault: AyasGoldenVault, env: NodeJS.ProcessEnv = process.env, timeoutMs = AYAS_GOLDEN_CASE_TIMEOUT_MS): { readonly results: AyasGoldenCaseResult[]; readonly durationsMs: Record<string, number> } {
  const loader = pathToFileURL(path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;
  const results: AyasGoldenCaseResult[] = []; const durationsMs: Record<string, number> = {};
  for (const item of vault.cases) {
    const started = performance.now();
    const run = spawnSync(process.execPath, ["--import", loader, item.script], { cwd: repoRoot, env, encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 4_000_000 });
    const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || run.signal !== null;
    results.push({ id: item.id, pass: !timedOut && !run.error && run.status === 0, timedOut });
    durationsMs[item.id] = Math.round(performance.now() - started);
  }
  return { results, durationsMs };
}
