import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Expected = number | string;
type Harness = { readonly name: string; readonly suite: string; readonly script: string;
  readonly scenarios: Expected; readonly timeoutMs?: number;
  readonly environment?: Readonly<Record<string, string>> };

const harnesses: Readonly<Record<string, Harness>> = Object.freeze({
  visual: h("Visual", "production-visual-asset-wiring", "smoke-production-visual-asset-wiring.ts", 54),
  animation: h("Animation", "production-animation-provider", "smoke-production-animation-provider.ts", 30),
  video: h("Scene-video", "production-scene-video-rendering", "smoke-production-scene-video-rendering.ts", 23),
  retry: h("Retry continuation", "pipeline-retry-continuation-hardening", "smoke-pipeline-retry-continuation-hardening.ts", 23),
  persistence: h("Retry persistence", "retry-persistence", "smoke-retry-persistence.ts", "5 groups"),
  youtubePackage: h("YouTube package", "production-youtube-package-pipeline", "smoke-production-youtube-package-pipeline.ts", 58),
  youtubePublish: h("YouTube publish", "production-youtube-publish-pipeline", "smoke-production-youtube-publish-pipeline.ts", 31),
  sprint12928: h("Sprint 129.28", "sprint-129-28-production-acceptance-reauthorization",
    "smoke-sprint-129-28-production-acceptance-reauthorization.ts", 137, 300_000),
});
const migratedOrder = ["visual", "animation", "video", "retry", "persistence",
  "youtubePackage", "youtubePublish", "sprint12928"] as const;
const broad: readonly Harness[] = [
  h("Sprint 129.27", "sprint-129-27-audio-remediation", "smoke-sprint-129-27-audio-remediation.ts", 77, 300_000),
  h("Durable execution attempt", "production-execution-durable-attempt", "smoke-production-execution-durable-attempt.ts", 58),
  h("Durable recovery", "production-execution-durable-recovery", "smoke-production-execution-durable-recovery.ts", 29),
  h("Recovery bootstrap", "production-recovery-bootstrap", "smoke-production-recovery-bootstrap.ts", 18),
  h("Worker lifecycle", "production-worker-lifecycle", "smoke-production-worker-lifecycle.ts", 21),
  h("Runtime context", "sprint-129-25c-runtime-context", "smoke-sprint-129-25c-2b-4-runtime-context.ts", 48),
  h("Audio wiring", "production-audio-asset-wiring", "smoke-production-audio-asset-wiring.ts", 73),
  h("Assembly wiring", "production-video-assembly-wiring", "smoke-production-video-assembly-wiring.ts", 46),
  h("Thumbnail full", "production-thumbnail-pipeline", "smoke-production-thumbnail-pipeline.ts", 42),
  h("Production E2E", "production-end-to-end", "smoke-production-end-to-end.ts", 20),
  h("Durable execution persistence", "production-execution-persistence",
    "smoke-production-execution-persistence.ts", 71),
  h("Production E2E stabilization", "production-end-to-end-stabilization",
    "smoke-production-end-to-end-stabilization.ts", 26),
  h("Production pipeline durable wiring", "production-pipeline-durable-wiring",
    "smoke-production-pipeline-durable-wiring.ts", 19),
  h("Sprint 128.1 production acceptance", "sprint-128-1-production-acceptance",
    "smoke-sprint-128-1-production-acceptance.ts", 30),
  h("Animation motion-plan contract", "animation-motion-plan-contract",
    "smoke-animation-motion-plan-contract.ts", 21),
  h("Assembly scene-video consumption", "assembly-scene-video-consumption",
    "smoke-assembly-scene-video-consumption.ts", 19),
  h("Pipeline history persistence", "pipeline-history-persistence",
    "smoke-pipeline-history-persistence.ts", 6),
  h("Pipeline orchestration", "pipeline-orchestration", "smoke-pipeline-orchestration.ts", 10),
  h("Production health service", "production-health-service",
    "smoke-production-health-service.ts", 24),
  h("Production readiness acceptance", "production-readiness-acceptance",
    "smoke-production-readiness-acceptance.ts", 24),
  h("Production snapshot builder", "production-snapshot-builder",
    "smoke-production-snapshot-builder.ts", 29),
  { ...h("Thumbnail isolated", "production-thumbnail-pipeline",
    "smoke-production-thumbnail-pipeline.ts", 1),
    environment: { THUMBNAIL_SMOKE_SCENARIO: "undefined and blank provider default to mock" } },
];

function h(name: string, suite: string, script: string, scenarios: Expected,
  timeoutMs?: number): Harness { return { name, suite, script, scenarios, timeoutMs }; }

function runHarness(harness: Harness, ordinal: number): void {
  const repositoryProjects = path.join(process.cwd(), "data", "projects");
  const shared = path.join(os.tmpdir(), "atolye-runtime-authority-v1");
  const productionBefore = inventory(repositoryProjects), sharedBefore = inventory(shared);
  const remaindersBefore = discoverRemainders();
  const gitBefore = dataProjectsGitState();
  const cli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const childArguments = harness.suite === "canonical-smoke-runtime-foundation"
    ? [cli, path.join(process.cwd(), "scripts", harness.script)]
    : [cli, path.join(process.cwd(), "scripts", "run-canonical-smoke-child.ts"), harness.script];
  const child = spawnSync(process.execPath, childArguments, {
    cwd: process.cwd(), env: { ...hostileEnvironment(), ...harness.environment,
      ...(harness.environment?.THUMBNAIL_SMOKE_SCENARIO
        ? { ATOLYE_EXTERNAL_THUMBNAIL_SMOKE_SCENARIO:
          harness.environment.THUMBNAIL_SMOKE_SCENARIO } : {}) }, encoding: "utf8",
    timeout: harness.timeoutMs ?? 180_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(child.error, undefined, `${harness.name} launch/timeout failed: ${child.error?.message}`);
  assert.equal(child.status, 0, `${harness.name} failed (${child.status}).\n${child.stdout}\n${child.stderr}`);
  assertTerminalResult(child.stdout, harness);
  assert.deepEqual(inventory(repositoryProjects), productionBefore, `${harness.name} changed production inventory.`);
  assert.deepEqual(inventory(shared), sharedBefore, `${harness.name} changed shared authority inventory.`);
  assert.deepEqual(dataProjectsGitState(), gitBefore, `${harness.name} changed data/projects Git state.`);
  assert.deepEqual(discoverRemainders(), remaindersBefore, `${harness.name} left a run-owned remainder.`);
  process.stdout.write(`PASS ${ordinal}: ${harness.name}\n`);
}

function assertTerminalResult(stdout: string, harness: Harness): void {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const terminal = lines.filter((line) => line.startsWith("ATOLYE_SMOKE_RESULT "));
  assert.equal(terminal.length, 1, `${harness.name} must emit exactly one terminal result.`);
  assert.equal(lines.at(-1), terminal[0], `${harness.name} terminal result must be last stdout record.`);
  const parsed = JSON.parse(terminal[0].slice("ATOLYE_SMOKE_RESULT ".length)) as
    { status?: unknown; suite?: unknown; scenarios?: unknown };
  assert.deepEqual(parsed, { status: "PASS", suite: harness.suite, scenarios: harness.scenarios },
    `${harness.name} terminal result mismatch.`);
}

interface InventoryEntry { readonly relativePath: string; readonly type: "file" | "directory";
  readonly reparse: boolean; readonly device: string; readonly inode: string; readonly size: string;
  readonly mtimeNs: string; readonly contentHash?: string }

function inventory(root: string): { readonly entries: readonly InventoryEntry[]; readonly digest: string } {
  if (!fs.existsSync(root)) return { entries: [], digest: digest([]) };
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Inventory root is unsafe: ${root}`);
  const entries: InventoryEntry[] = [];
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort(codeUnitCompare)) {
      const target = path.join(directory, name), stat = fs.lstatSync(target, { bigint: true });
      const relativePath = path.relative(root, target).replaceAll("\\", "/");
      const reparse = stat.isSymbolicLink() || (Number(stat.mode) & 0o170000) === 0o120000;
      if (reparse) throw new Error(`Inventory encountered reparse entry: ${relativePath}`);
      if (stat.isDirectory()) {
        entries.push({ relativePath, type: "directory", reparse, device: String(stat.dev),
          inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs) });
        visit(target);
      } else if (stat.isFile()) entries.push({ relativePath, type: "file", reparse,
        device: String(stat.dev), inode: String(stat.ino), size: String(stat.size),
        mtimeNs: String(stat.mtimeNs), contentHash: fileHash(target) });
      else throw new Error(`Inventory encountered unsupported entry: ${relativePath}`);
    }
  };
  visit(root);
  return { entries, digest: digest(entries) };
}

function discoverRemainders(): readonly string[] {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("atolye-smoke-")).sort(codeUnitCompare)
    .map((name) => {
      const root = path.join(os.tmpdir(), name);
      const manifest = path.join(root, "canonical-smoke-ownership.json");
      return `${name}:${fs.existsSync(manifest) ? fileHash(manifest) : "manifest-missing"}`;
    });
}

function dataProjectsGitState(): string {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", "data/projects"],
    { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git production state failed: ${result.stderr}`);
  return result.stdout;
}

function hostileEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env,
    AI_PROVIDER: "hostile-ai", IMAGE_PROVIDER: "hostile-image", AUDIO_PROVIDER: "hostile-audio",
    ANIMATION_PROVIDER: "hostile-animation", VIDEO_PROVIDER: "hostile-video",
    VIDEO_ASSEMBLY_PROVIDER: "hostile-assembly", THUMBNAIL_PROVIDER: "hostile-thumbnail",
    YOUTUBE_PROVIDER: "hostile-youtube", YOUTUBE_PUBLISH_PROVIDER: "hostile-publish",
    OPENAI_API_KEY: "hostile-secret", YOUTUBE_ACCESS_TOKEN: "hostile-token",
    OPENAI_MODEL: "hostile-model", OPENAI_TTS_MODEL: "hostile-tts-model",
    OPENAI_BASE_URL: "http://127.0.0.1:1/hostile", OPENAI_API_BASE: "http://127.0.0.1:1/hostile",
    FFMPEG_PATH: "hostile-ffmpeg", FFPROBE_PATH: "hostile-ffprobe", FFMPEG_TIMEOUT_MS: "1",
    OPENAI_TTS_TIMEOUT_MS: "1", OPENAI_TTS_MAX_RESPONSE_BYTES: "1",
    YOUTUBE_CHANNEL_ID: "hostile-channel", ATOLYE_DURABLE_PIPELINE_EXECUTION: "hostile",
  };
}

function digest(entries: readonly InventoryEntry[]): string {
  return createHash("sha256").update(entries.map((entry) => JSON.stringify(entry)).join("\n")).digest("hex");
}
function fileHash(value: string): string {
  return createHash("sha256").update(fs.readFileSync(value)).digest("hex");
}
function codeUnitCompare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function main(): void {
  runExternalValidatorSelfReview();
  const suiteFilter = process.argv.find((argument) => argument.startsWith("--suite="))?.slice(8);
  if (suiteFilter) {
    const selected = [...Object.values(harnesses), ...broad].find((item) =>
      item.suite === suiteFilter || item.script === suiteFilter || item.name === suiteFilter);
    assert(selected, `Unknown smoke suite: ${suiteFilter}`);
    runHarness(selected, 1);
    process.stdout.write("Canonical external smoke validation matrix: PASS (completed=1 failed=0 skipped=0)\n");
    return;
  }
  if (process.argv.includes("--blocker-regression")) {
    const e2e = broad.find((item) => item.suite === "production-end-to-end")!;
    const persistence = broad.find((item) => item.suite === "production-execution-persistence")!;
    const sequence = [e2e, e2e, e2e, persistence, persistence, persistence,
      e2e, persistence, e2e, persistence, e2e, persistence,
      persistence, e2e, persistence, e2e, persistence, e2e];
    sequence.forEach((item, index) => runHarness(item, index + 1));
    process.stdout.write(`Canonical blocker regression matrix: PASS (completed=${sequence.length} failed=0 skipped=0)\n`);
    return;
  }
  const quick = process.argv.includes("--quick"), broadOnly = process.argv.includes("--broad-only");
  let ordinal = 0;
  if (!broadOnly) runHarness(h("Foundation invariants", "canonical-smoke-runtime-foundation",
    "smoke-canonical-smoke-runtime-foundation.ts", 29), ++ordinal);
  if (!broadOnly) for (const key of migratedOrder) runHarness(harnesses[key], ++ordinal);
  if (!broadOnly) for (let index = 0; index < (quick ? 1 : 10); index += 1) {
    runHarness({ ...harnesses.retry, name: `Retry isolated ${index + 1}/${quick ? 1 : 10}` }, ++ordinal);
  }
  for (const harness of broad) runHarness(harness, ++ordinal);
  process.stdout.write(`Canonical external smoke validation matrix: PASS (completed=${ordinal} failed=0 skipped=0)\n`);
}

function runExternalValidatorSelfReview(): void {
  const harness = h("Protocol self-test", "protocol-self-test", "smoke-protocol-self-test.ts", 1);
  assertTerminalResult('human\nATOLYE_SMOKE_RESULT {"status":"PASS","suite":"protocol-self-test","scenarios":1}\n', harness);
  assert.throws(() => assertTerminalResult(
    'ATOLYE_SMOKE_RESULT {"status":"PASS","suite":"protocol-self-test","scenarios":1}\n' +
    'ATOLYE_SMOKE_RESULT {"status":"FAIL","suite":"protocol-self-test","scenarios":1}\n', harness));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-external-inventory-self-review-"));
  try {
    const empty = inventory(root);
    const target = path.join(root, "entry.txt");
    fs.writeFileSync(target, "one");
    const added = inventory(root); assert.notDeepEqual(added, empty);
    fs.writeFileSync(target, "two");
    const contentChanged = inventory(root); assert.notDeepEqual(contentChanged, added);
    fs.rmSync(target); assert.deepEqual(inventory(root), empty);
  } finally { fs.rmSync(root, { recursive: true, force: false }); }
}

main();
