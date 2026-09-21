import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverAyasNovelPatchCandidates } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasSandboxUnvalidatableStore, type AyasSandboxUnvalidatableStore } from "../src/lib/brain/autonomy/AyasSandboxUnvalidatableStore";
import type { AyasDaemonObservation } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
const git = (cwd: string, args: readonly string[]) => execFileSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
const oversize = (tag: string) => `import assert from "node:assert/strict";\nassert.equal(1, 1);\n${Array.from({ length: 260 }, (_, index) => `// ${tag}-${index} ${"x".repeat(84)}`).join("\n")}\n`;
const broken = 'import assert from "node:assert/strict";\nassert.equal(1, 1);\nconsole.log("never emits the required PASS envelope");\n';

function fixture(): { readonly root: string; head(): string; commit(message: string): string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-policy-suppression-"));
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.com"]); git(root, ["config", "user.name", "fixture"]); git(root, ["config", "core.autocrlf", "false"]);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "smoke-aaa-oversize.ts"), oversize("a"), "utf8");
  fs.writeFileSync(path.join(root, "scripts", "smoke-bbb-broken.ts"), broken, "utf8");
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  for (const dependency of ["tsx", "typescript", "@types"]) fs.symlinkSync(path.join(process.cwd(), "node_modules", dependency), path.join(root, "node_modules", dependency), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["scripts/**/*.ts"], exclude: ["node_modules"] }), "utf8");
  git(root, ["add", "scripts", "tsconfig.json"]); git(root, ["commit", "-q", "-m", "fixture"]);
  return { root, head: () => git(root, ["rev-parse", "HEAD"]), commit(message) { git(root, ["add", "scripts"]); git(root, ["commit", "-q", "-m", message]); return git(root, ["rev-parse", "HEAD"]); } };
}

function observation(root: string, now: string): AyasDaemonObservation {
  return { now, branch: git(root, ["branch", "--show-current"]), head: git(root, ["rev-parse", "HEAD"]), repoClean: true, graphifyFresh: true, machineAction: "ALLOW", gaps: [] };
}

function stores() {
  return {
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-policy-artifacts-")) }),
    sandboxUnvalidatableStore: createAyasSandboxUnvalidatableStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-policy-memory-")) }),
  };
}

async function main() {
  await scenario("a deterministic over-limit rejection is remembered and no longer blocks the next candidate", async () => {
    const repo = fixture(); const state = stores();
    const first = await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:00:00.000Z"), maxAttemptsPerTick: 1, ...state });
    assert.equal(first.rejections.length, 1); assert.match(first.rejections[0]!.reason, /file-size/);
    const second = await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:05:00.000Z"), maxAttemptsPerTick: 1, ...state });
    assert.equal(second.rejections.length, 1); assert.match(second.rejections[0]!.reason, /sandbox validation failed/);
  });

  await scenario("unchanged policy-rejected content does not spend another attempt or append another rejection", async () => {
    const repo = fixture(); const state = stores();
    await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:00:00.000Z"), maxAttemptsPerTick: 1, ...state });
    const second = await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:05:00.000Z"), maxAttemptsPerTick: 1, ...state });
    assert.ok(second.rejections.every((entry) => !entry.candidateId.includes("aaa-oversize")));
    assert.equal(state.sandboxUnvalidatableStore.list().find((entry) => entry.semanticKey.includes("aaa-oversize"))?.attemptCount, 1);
  });

  await scenario("a source edit changes the fingerprint and reopens policy evaluation", async () => {
    const repo = fixture(); const state = stores();
    await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:00:00.000Z"), maxAttemptsPerTick: 1, ...state });
    fs.writeFileSync(path.join(repo.root, "scripts", "smoke-aaa-oversize.ts"), oversize("changed"), "utf8"); repo.commit("change source");
    const changed = await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:10:00.000Z"), maxAttemptsPerTick: 1, ...state });
    assert.equal(changed.rejections.length, 1); assert.match(changed.rejections[0]!.reason, /file-size/);
  });

  await scenario("suppression persistence failure is fail-soft and never weakens the policy gate", async () => {
    const repo = fixture();
    const failing: AyasSandboxUnvalidatableStore = { dir: "fixture", record() { throw new Error("disk full"); }, shouldSkip() { return false; }, load() { return undefined; }, list() { return []; }, clear() {} };
    const result = await discoverAyasNovelPatchCandidates({ repoRoot: repo.root, observation: observation(repo.root, "2026-09-21T00:00:00.000Z"), maxAttemptsPerTick: 1, artifactStore: stores().artifactStore, sandboxUnvalidatableStore: failing });
    assert.deepEqual(result.candidates, []); assert.match(result.rejections[0]!.reason, /file-size/);
  });

  console.log(`AYAS novel patch policy suppression smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-novel-patch-policy-suppression", scenarios: count }));
}
main().catch((error) => { console.error("AYAS novel patch policy suppression smoke FAILED:", error); process.exitCode = 1; });
