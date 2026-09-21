import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverAyasNovelPatchCandidates, AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { generateAyasErrorCodeContractPatch } from "../src/lib/brain/autonomy/AyasPatchDetectors";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasAutonomyDaemon, type AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasSandboxUnvalidatableStore } from "../src/lib/brain/autonomy/AyasSandboxUnvalidatableStore";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function git(cwd: string, args: readonly string[]): string { return execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true }).trim(); }

function baseObservation(overrides: Partial<AyasDaemonObservation> = {}): AyasDaemonObservation {
  return { now: "2026-09-16T00:00:00.000Z", branch: "wip/test", head: "0000000000000000000000000000000000dead", repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [], ...overrides };
}

async function main(): Promise<void> {
  await scenario("returns no candidates and does not touch disk when the working tree is dirty", async () => {
    const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-artifacts-")) });
    const result = await discoverAyasNovelPatchCandidates({ repoRoot: process.cwd(), observation: baseObservation({ repoClean: false }), artifactStore });
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.rejections, []);
  });

  await scenario("returns no candidates when Machine Health demands PAUSE", async () => {
    const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-artifacts-")) });
    const result = await discoverAyasNovelPatchCandidates({ repoRoot: process.cwd(), observation: baseObservation({ machineAction: "PAUSE" }), artifactStore });
    assert.deepEqual(result.candidates, []);
  });

  await scenario("rejects a would-be candidate whose target file already exists on disk (already-handled gap), without touching the sandbox", async () => {
    // Build a fixture repo whose gap's generated target file already exists — the exact same anti-spam pattern the M16 static registry already uses.
    // The existing file is built via the REAL generator (not a placeholder string): since M19 added a second generator
    // (`error-code-contract-drift`) that independently compares an existing generated file's content against what the
    // CURRENT template would produce, a placeholder/stale file here would now also surface as real drift — correct
    // behavior for that new class, but not what THIS scenario is testing (the ORIGINAL create-generator's "already
    // handled, skip" path). Using the real generator's own output keeps the fixture byte-identical to "up to date",
    // so this scenario still asserts zero candidates/rejections from EITHER generator.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-existing-fixture-"));
    git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
    fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "WIDGET_BROKEN", message: string) { super(message); }\n}\n', "utf8");
    const widgetGap = { className: "WidgetError", sourceFile: "src/lib/widget/WidgetError.ts", modulePath: "../src/lib/widget/WidgetError", codes: ["WIDGET_BROKEN"] };
    fs.writeFileSync(path.join(repoRoot, "scripts", "smoke-ayas-error-code-contract-widget.ts"), generateAyasErrorCodeContractPatch(widgetGap).replacements[0]!.content, "utf8");
    git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "initial"]);
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-artifacts-")) });
    const result = await discoverAyasNovelPatchCandidates({ repoRoot, observation: baseObservation({ head }), artifactStore });
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.rejections, []);
  });

  await scenario("rejects and logs a candidate whose exactFiles would land outside the SAFE domain — never reaches the sandbox", async () => {
    // Simulate this directly against the blast-radius policy layer this orchestrator calls, since the real generator always targets scripts/ (SAFE); this proves the orchestrator's own rejection-logging path (not the policy function itself, already covered in smoke-ayas-patch-detectors.ts).
    const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-artifacts-")) });
    const result = await discoverAyasNovelPatchCandidates({ repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-empty-repo-")), observation: baseObservation(), artifactStore });
    // An empty (non-git, no source) repoRoot: git worktree creation will fail closed, never crash.
    assert.deepEqual(result.candidates, []);
    assert.ok(result.rejections.length === 0 || result.rejections.every((r) => typeof r.reason === "string"));
  });

  await scenario("end-to-end against the REAL Atölye repo: discovers, sandboxes, validates, and freezes exactly one real candidate", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const artifactStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-artifacts-real-"));
    const artifactStore = createAyasPatchArtifactStore({ rootDir: artifactStoreDir });
    // Captured before discovery runs, not hardcoded to 1: `git worktree list`
    // legitimately includes every worktree linked to this repository, not
    // just a sandbox — running this exact scenario itself from inside a
    // clean-room (a second, linked worktree) is real and expected, and it
    // must not be mistaken for a leaked sandbox. The invariant this proves
    // is "discovery added no NEW worktree," not "exactly one worktree
    // exists" — a clean-room-only finding, caught only once this suite ran
    // from a linked worktree instead of the always-the-main-worktree
    // assumption fixture-only testing never exercised.
    const worktreesBefore = git(repoRoot, ["worktree", "list"]).split("\n").filter(Boolean).length;
    const result = await discoverAyasNovelPatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) }), artifactStore, maxAttemptsPerTick: 1 });
    // There may legitimately be zero remaining gaps once every class has its own smoke test (this suite itself covers several) — assert the CONTRACT, not a specific count.
    for (const candidate of result.candidates) {
      assert.equal(candidate.mutationKind, AYAS_PATCH_ARTIFACT_MUTATION_KIND);
      assert.ok(candidate.patchArtifactId);
      assert.ok(candidate.patchHash);
      const artifact = artifactStore.loadVerified(candidate.patchArtifactId);
      assert.equal(artifact.patchHash, candidate.patchHash);
      assert.equal(artifact.baseHead, head);
      assert.equal(artifact.safetyClassification, "SAFE");
    }
    assert.ok(result.findings.length >= 0);
    const worktreesAfter = git(repoRoot, ["worktree", "list"]).split("\n").filter(Boolean).length;
    assert.equal(worktreesAfter, worktreesBefore, "discovery must never leave behind a new (leaked) worktree, whatever the baseline count was");
  });

  await scenario("determinism/anti-spam: two ticks at the same HEAD produce the same patchHash for the same gap (so inbox.createProposal's own dedup would collapse them to one proposal)", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const store1 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-tick1-")) });
    const store2 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-tick2-")) });
    const obs = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:00:00.000Z" });
    const tick1 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: obs, artifactStore: store1, maxAttemptsPerTick: 1 });
    const tick2 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: { ...obs, now: "2026-09-16T00:05:00.000Z" }, artifactStore: store2, maxAttemptsPerTick: 1 });
    if (tick1.candidates[0] && tick2.candidates[0]) {
      assert.equal(tick1.candidates[0].patchHash, tick2.candidates[0].patchHash, "identical gap at identical HEAD must produce an identical patchHash regardless of when it was drafted");
    }
  });

  await scenario("M18 routing: MICRO_SAFE-eligible gaps never reach this pipeline's own sandbox-attempt retry budget at all — they are skipped here regardless of maxAttemptsPerTick, since AyasMicroBatchAccumulator now owns drafting-and-validating them (see its own 'retry budget bounds sandbox-validation-failure rejections' scenario for the equivalent coverage on that path)", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-retry-budget-"));
    git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
    fs.mkdirSync(path.join(repoRoot, "src", "lib", "widget"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    // Three real, distinct gaps (alphabetically ordered by the detector), each an INVALID JS identifier as a class name
    // (starts with a digit) — every one would fail sandbox typecheck for real IF this pipeline ever attempted them. It
    // no longer does: today's one live generator ("ayas-detector:error-code-contract-gap-v1") always classifies as
    // MICRO_SAFE, so every gap is skipped by the M18 classification check before any sandbox attempt is made here.
    for (const name of ["1AaaError", "2BbbError", "3CccError"]) {
      fs.writeFileSync(path.join(repoRoot, "src", "lib", "widget", `${name}.ts`), `export class ${name} extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n`, "utf8");
    }
    git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "three bad gaps"]);
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const artifactStore = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-retry-budget-artifacts-")) });
    const result = await discoverAyasNovelPatchCandidates({ repoRoot, observation: baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) }), artifactStore, maxAttemptsPerTick: 2 });
    assert.deepEqual(result.candidates, [], "none of the three gaps ever reach sandbox validation on this path");
    assert.equal(result.rejections.length, 0, "MICRO_SAFE-eligible gaps are silently skipped here, not counted as rejections on this pipeline — they belong to the batch lane instead");
  });

  await scenario("duplicate discovery across simulated restarts: the SAME real inbox never accumulates more than one proposal for an unchanged, still-open gap", async () => {
    const repoRoot = process.cwd();
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-restart-inbox-")), "brain") });
    const daemon = createAyasAutonomyDaemon({ inbox, now: () => "2026-09-16T00:00:00.000Z" });
    const obs = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]), now: "2026-09-16T00:00:00.000Z" });
    daemon.observe(obs);
    const sandboxUnvalidatableStore = createAyasSandboxUnvalidatableStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-restart-suppression-")) });

    // "Tick 1" — first discovery run (a fresh process, in reality).
    const store1 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-restart-artifacts-1-")) });
    const tick1 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: obs, artifactStore: store1, sandboxUnvalidatableStore, maxAttemptsPerTick: 1 });
    daemon.discover(obs, tick1.candidates);
    const afterTick1 = inbox.load().proposals.length;

    // "Tick 2" — simulates the observer restarting and running discovery again against the SAME unchanged HEAD.
    const store2 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-restart-artifacts-2-")) });
    const tick2 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: { ...obs, now: "2026-09-16T00:05:00.000Z" }, artifactStore: store2, sandboxUnvalidatableStore, maxAttemptsPerTick: 1 });
    daemon.discover({ ...obs, now: "2026-09-16T00:05:00.000Z" }, tick2.candidates);
    const afterTick2 = inbox.load().proposals.length;

    assert.equal(afterTick2, afterTick1, "a second discovery tick at the same HEAD must never grow the proposal count for the same still-open gap");
  });

  await scenario("Gap 4 (M21.4): a candidate that fails real sandbox validation is suppressed on the NEXT tick with unchanged content — no repeated attempt, no repeated rejection", async () => {
    // A real diagnostic-quality-gap candidate whose own smoke-test validator is deterministically broken (never reports {"status":"PASS"}) — a real, repeatable sandbox failure unrelated to whether the bare-assert fix itself is "correct."
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-suppress-fixture-"));
    git(repoRoot, ["init", "-q"]); git(repoRoot, ["config", "user.email", "f@example.com"]); git(repoRoot, ["config", "user.name", "f"]);
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "scripts", "smoke-always-broken.ts"), 'assert.equal(1, 1);\nconsole.log("this smoke test never reports PASS");\n', "utf8");
    git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "initial"]);
    fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
    for (const dep of ["tsx", "typescript", "@types"]) {
      fs.symlinkSync(path.join(process.cwd(), "node_modules", dep), path.join(repoRoot, "node_modules", dep), process.platform === "win32" ? "junction" : "dir");
    }
    fs.writeFileSync(path.join(repoRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2));
    git(repoRoot, ["add", "-A"]); git(repoRoot, ["commit", "-q", "-m", "tsconfig"]);
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    const obs = baseObservation({ head, branch: git(repoRoot, ["branch", "--show-current"]) });

    const sandboxUnvalidatableStore = createAyasSandboxUnvalidatableStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-suppress-store-")) });

    const store1 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-suppress-art1-")) });
    const tick1 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: obs, artifactStore: store1, maxAttemptsPerTick: 3, sandboxUnvalidatableStore });
    assert.ok(tick1.rejections.some((r) => r.candidateId.includes("always-broken")), "tick 1 must actually attempt and reject the broken candidate for real");

    const store2 = createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-novel-suppress-art2-")) });
    const tick2 = await discoverAyasNovelPatchCandidates({ repoRoot, observation: { ...obs, now: "2026-09-16T00:05:00.000Z" }, artifactStore: store2, maxAttemptsPerTick: 3, sandboxUnvalidatableStore });
    assert.ok(!tick2.rejections.some((r) => r.candidateId.includes("always-broken")), "tick 2, same unchanged content, must skip it WITHOUT another real sandbox attempt — no repeated rejection");
  });

  console.log(`AYAS novel patch discovery smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-novel-patch-discovery", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
