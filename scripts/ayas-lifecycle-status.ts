/**
 * Stage 15E — lifecycle status, for the operator.
 *
 *   npx tsx scripts/ayas-lifecycle-status.ts [--live] [--deep] [--json]
 *
 * Prints the registry of record, its contract violations, the owner findings
 * and whether each recorded identity matches what is on this machine.
 * Read-only: it hashes local files and compares.
 *
 *   --live  also asks the local Ollama runtime (loopback only) which digest
 *           each tag serves. It lists models; it loads and runs none.
 *   --deep  hashes large files too (the speech model is 1.6 GB; this takes
 *           several seconds of disk reading).
 *   --json  machine-readable output.
 *
 * Exit code 1 when the registry has a violation or an identity mismatches.
 */
import fs from "node:fs";
import path from "node:path";

import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { auditAyasLifecycleRegistry, findAyasLifecycleFindings } from "../src/lib/ayas/lifecycle/AyasLifecycle";
import { AYAS_LIFECYCLE_REGISTRY } from "../src/lib/ayas/lifecycle/AyasLifecycleRegistry";
import { verifyAyasLifecycleIdentities } from "../src/lib/ayas/lifecycle/AyasLifecycleVerifier";

const HASH = /^[a-f0-9]{64}$/;

async function servedDigests(): Promise<Record<string, string> | undefined> {
  const { baseUrl } = resolveOllamaConfig(process.env);
  const host = new URL(baseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") throw new Error("AYAS_LIFECYCLE_LIVE_REQUIRES_LOOPBACK");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal, redirect: "error" });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { models?: readonly { name?: unknown; digest?: unknown }[] };
    const out: Record<string, string> = {};
    for (const model of body.models ?? []) if (typeof model.name === "string" && typeof model.digest === "string" && HASH.test(model.digest)) out[model.name] = model.digest;
    return out;
  } catch { return undefined; } finally { clearTimeout(timer); }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--live", "--deep", "--json"].includes(arg))) throw new Error("AYAS_LIFECYCLE_STATUS_ARGUMENTS_INVALID");
  const repoRoot = process.cwd();
  // Where entries with a non-repository locator live on this machine.
  const localFiles: Record<string, string> = {};
  for (const entry of AYAS_LIFECYCLE_REGISTRY) {
    if (entry.identity.type === "sha256-file" && entry.identity.locator.startsWith("env:")) {
      const value = process.env[entry.identity.locator.slice(4)]?.trim();
      if (value) localFiles[entry.id] = value;
    }
    if (entry.identity.type === "hf-revision") {
      const candidate = path.join(repoRoot, "bin", "ayas-local-coding", entry.identity.file);
      if (fs.existsSync(candidate)) localFiles[entry.id] = candidate;
    }
  }
  const live = args.includes("--live") ? await servedDigests() : undefined;
  const checks = verifyAyasLifecycleIdentities(AYAS_LIFECYCLE_REGISTRY, { repoRoot, deep: args.includes("--deep"), localFiles, ...(live ? { servedDigests: live } : {}) });
  const violations = auditAyasLifecycleRegistry(AYAS_LIFECYCLE_REGISTRY);
  const findings = findAyasLifecycleFindings(AYAS_LIFECYCLE_REGISTRY);
  const rows = AYAS_LIFECYCLE_REGISTRY.map((entry) => ({ id: entry.id, kind: entry.kind, role: entry.role, state: entry.state, admission: entry.admission, identity: entry.identity.type,
    check: checks.find((check) => check.id === entry.id)!.status, rollbackTarget: entry.rollbackTarget }));
  const mismatches = checks.filter((check) => check.status === "MISMATCH");
  if (args.includes("--json")) {
    console.log(JSON.stringify({ status: violations.length || mismatches.length ? "ATTENTION" : "OK", liveRuntime: args.includes("--live") ? (live ? "OBSERVED" : "UNAVAILABLE") : "NOT_ASKED", entries: rows, violations, findings, mismatches }, null, 2));
  } else {
    for (const row of rows) console.log(`${row.state.padEnd(10)} ${row.admission.padEnd(14)} ${row.check.padEnd(13)} ${row.id}`);
    console.log(`\nentries ${rows.length}; violations ${violations.length}; identity mismatches ${mismatches.length}; owner findings ${findings.length}`);
    if (args.includes("--live")) console.log(`local model runtime: ${live ? "observed" : "unavailable"}`);
    for (const violation of violations) console.log(`VIOLATION ${violation.id} ${violation.code}: ${violation.detail}`);
    for (const check of mismatches) console.log(`MISMATCH  ${check.id}: ${check.detail}`);
    for (const finding of findings) console.log(`FINDING   ${finding.id} ${finding.code}`);
  }
  if (violations.length || mismatches.length) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
