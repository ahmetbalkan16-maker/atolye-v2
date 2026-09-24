/**
 * Stage 8 fixtures. Everything here builds TEMP state only: throwaway git
 * repositories under OS TEMP, a tiny deterministic benchmark that emits the
 * standard advisory report shape, and registries whose strategies are test
 * doubles. No live path, provider or network is used.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AYAS_RESEARCH_CAPABILITY_MAP, type AyasImprovementRegistry, type AyasImprovementStrategy } from "../../src/lib/brain/autonomy/AyasResearchExperimentRegistry";

export { FIXTURE_NOW, makeFinding, type FindingSpec } from "./ayas-research-improvement-findings";

export const FIXTURE_BENCHMARK_ID = "fixture-quality";
export const FIXTURE_BEHAVIOR_FILE = "src/fixture/behavior.ts";
export const FIXTURE_OTHER_FILE = "src/fixture/other.ts";

/** Case table of the fixture benchmark: id → dimension, held-out flag. */
export const FIXTURE_CASES: readonly { readonly id: string; readonly dimension: string; readonly heldOut: boolean }[] = [
  { id: "ref-follow-up", dimension: "REFERENCE_RESOLUTION", heldOut: false },
  { id: "ref-ordinal", dimension: "REFERENCE_RESOLUTION", heldOut: false },
  { id: "ref-pronoun", dimension: "REFERENCE_RESOLUTION", heldOut: false },
  { id: "temporal-past", dimension: "TEMPORAL_CORRECTNESS", heldOut: false },
  { id: "tool-required", dimension: "TOOL_DECISION_CORRECTNESS", heldOut: false },
  { id: "intent-greeting", dimension: "INTENT_ACCURACY", heldOut: false },
  { id: "hidden-ref", dimension: "REFERENCE_RESOLUTION", heldOut: true },
  { id: "hidden-temporal", dimension: "TEMPORAL_CORRECTNESS", heldOut: true },
];

/** Baseline behavior: two reference-resolution cases fail — the measurable local gap. */
export const FIXTURE_BASE_BEHAVIOR: Readonly<Record<string, boolean | string>> = {
  "ref-follow-up": false, "ref-ordinal": false, "ref-pronoun": true, "temporal-past": true,
  "tool-required": true, "intent-greeting": true, "hidden-ref": true, "hidden-temporal": true,
};

export function renderBehavior(behavior: Readonly<Record<string, boolean | string>>): string {
  return `export const behavior: Record<string, boolean | string> = ${JSON.stringify(behavior, null, 2)};\n`;
}

const BENCHMARK_SOURCE = `import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { behavior } from "../src/fixture/behavior";

const CASES = ${JSON.stringify(FIXTURE_CASES)};
async function main(): Promise<void> {
  for (const key of Object.keys(process.env)) if (/(API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)) throw new Error("credential visible to benchmark: " + key);
  if (behavior.__crash === true) throw new Error("fixture crash");
  if (behavior.__sleep === true) await new Promise(() => setInterval(() => undefined, 1_000));
  if (typeof behavior.__fetch === "string") { try { await fetch(behavior.__fetch); } catch { /* blocked */ } try { await new Promise((resolve) => { const req = http.get(behavior.__fetch as string, () => resolve(undefined)); req.on("error", () => resolve(undefined)); req.setTimeout(1500, () => { req.destroy(); resolve(undefined); }); }); } catch { /* blocked */ } }
  if (behavior.__writeTree === true) fs.writeFileSync(path.join(process.cwd(), "src", "fixture", "stray.txt"), "written by benchmark\\n");
  const i = process.argv.indexOf("--report");
  const out = process.argv[i + 1]!;
  if (behavior.__invalidReport === true) { fs.writeFileSync(out, "{not json"); return; }
  const rows = CASES.map((c) => ({ ...c, pass: behavior[c.id] === true }));
  const dimensions: Record<string, { passed: number; total: number }> = {};
  for (const row of rows) { const d = (dimensions[row.dimension] ??= { passed: 0, total: 0 }); d.total += 1; if (row.pass) d.passed += 1; }
  const failures = rows.filter((row) => !row.pass).map((row) => ({ id: row.id, dimension: row.dimension, category: "FIXTURE", heldOut: row.heldOut, knownLimitation: false, layer: "decision", error: false }));
  const evaluatorSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(process.cwd(), "scripts/fixture-benchmark.ts"))).digest("hex");
  const report = { schemaVersion: 1, fixtureVersion: 1, evaluatorSha256, caseCount: rows.length, passed: rows.filter((row) => row.pass).length,
    heldOut: { passed: rows.filter((row) => row.heldOut && row.pass).length, total: rows.filter((row) => row.heldOut).length },
    dimensions, failures, unexpectedFailures: failures, knownLimitations: [], qualityGaps: [] };
  fs.writeFileSync(out, JSON.stringify(report), { flag: "wx" });
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
`;

const GUARD_SOURCE = `import fs from "node:fs";
import { behavior } from "../src/fixture/behavior";
if (behavior.guardWrites === true) fs.writeFileSync("src/fixture/guard-cache.txt", "cache");
if (behavior.guardWritesIgnored === true) { fs.mkdirSync("ignored-cache", { recursive: true }); fs.writeFileSync("ignored-cache/state.txt", "cache"); }
if (behavior.guardBroken === true) { console.error("guard failed"); process.exitCode = 1; } else console.log("PASS (1 scenario)");
`;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export interface FixtureRepo {
  readonly root: string;
  head(): string;
  commit(file: string, content: string, message: string): string;
  remove(): void;
}

/** A committed TEMP git repository with the fixture benchmark, behavior module and guard suite. */
export function createFixtureRepo(behavior: Readonly<Record<string, boolean | string>> = FIXTURE_BASE_BEHAVIOR): FixtureRepo {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-research-fixture-repo-"));
  fs.mkdirSync(path.join(root, "src", "fixture"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\nignored-cache/\n");
  fs.writeFileSync(path.join(root, FIXTURE_BEHAVIOR_FILE), renderBehavior(behavior));
  fs.writeFileSync(path.join(root, FIXTURE_OTHER_FILE), "export const other = 1;\n");
  fs.writeFileSync(path.join(root, "scripts", "fixture-benchmark.ts"), BENCHMARK_SOURCE);
  fs.writeFileSync(path.join(root, "scripts", "smoke-fixture-guard.ts"), GUARD_SOURCE);
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "AYAS Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return {
    root,
    head: () => git(root, ["rev-parse", "HEAD"]),
    commit(file, content, message) {
      fs.writeFileSync(path.join(root, file), content);
      git(root, ["add", file]);
      git(root, ["commit", "--quiet", "-m", message]);
      return git(root, ["rev-parse", "HEAD"]);
    },
    remove() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

/** A strategy that rewrites the behavior module with overrides; `extra` can emit additional (out-of-scope) writes. */
export function behaviorStrategy(name: string, overrides: Readonly<Record<string, boolean | string>>, options: { readonly dimension?: string; readonly capability?: string; readonly exactFiles?: readonly string[]; readonly extra?: readonly { filePath: string; content: string }[]; readonly regressionSuites?: readonly string[]; readonly noop?: boolean; readonly raw?: string } = {}): AyasImprovementStrategy {
  return {
    strategyId: `exp-fixture-${name}`,
    version: 1,
    capability: options.capability ?? "conversation-memory-context",
    benchmarkId: FIXTURE_BENCHMARK_ID,
    dimensions: [options.dimension ?? "REFERENCE_RESOLUTION"],
    component: "FixtureReferenceResolver",
    summary: `fixture strategy ${name} adjusts the fixture resolver`,
    exactFiles: options.exactFiles ?? [FIXTURE_BEHAVIOR_FILE],
    maxChangedLines: 40,
    regressionSuites: options.regressionSuites ?? ["scripts/smoke-fixture-guard.ts"],
    generate(context) {
      if (options.noop) return [];
      const current = context.readFile(FIXTURE_BEHAVIOR_FILE);
      if (current === null) return [];
      const base = JSON.parse(current.slice(current.indexOf("{"), current.lastIndexOf("}") + 1)) as Record<string, boolean | string>;
      const content = options.raw ?? renderBehavior({ ...base, ...overrides });
      return [{ filePath: FIXTURE_BEHAVIOR_FILE, content }, ...(options.extra ?? [])];
    },
  };
}

export function fixtureRegistry(strategies: readonly AyasImprovementStrategy[]): AyasImprovementRegistry {
  return {
    benchmarks: [{ benchmarkId: FIXTURE_BENCHMARK_ID, script: "scripts/fixture-benchmark.ts", args: [], reportFlag: "--report", timeoutMs: 20_000, dimensions: ["REFERENCE_RESOLUTION", "TEMPORAL_CORRECTNESS", "TOOL_DECISION_CORRECTNESS", "INTENT_ACCURACY"] }],
    strategies,
    capabilityMap: {
      ...AYAS_RESEARCH_CAPABILITY_MAP,
      MEMORY_CONTEXT: { capability: "conversation-memory-context", component: "FixtureMemory", benchmarks: [{ benchmarkId: FIXTURE_BENCHMARK_ID, dimensions: ["REFERENCE_RESOLUTION", "TEMPORAL_CORRECTNESS"] }] },
      TOOL_USE: { capability: "tool-and-agent-selection", component: "FixtureTools", benchmarks: [{ benchmarkId: FIXTURE_BENCHMARK_ID, dimensions: ["TOOL_DECISION_CORRECTNESS"] }] },
      AI_ASSISTANTS: { capability: "assistant-answer-quality", component: "FixtureAssistant", benchmarks: [{ benchmarkId: FIXTURE_BENCHMARK_ID, dimensions: ["INTENT_ACCURACY"] }] },
    },
  };
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}
