/**
 * Implicit legacy-root write safety + canonical backup resolution smoke
 * (H8 post-closure major cleanup).
 *
 * Deterministic / $0 / no network / TEMP-only. Every root variable
 * (`ATOLYE_RUNTIME_ROOT`, `ATOLYE_RUNTIME_AUTHORITY_ROOT`, `ATOLYE_WORKSPACE_ROOT`,
 * `ATOLYE_RUNTIME_BACKUP_ROOT`) is removed, the process `cwd` is a run-owned TEMP
 * workspace and `os.tmpdir()` is redirected into the run root, so even the
 * implicit default authority / backup roots are run-owned. The repository's own
 * `data/projects` is listed before and after and must be unchanged.
 *
 * Before this sprint a process with no runtime root configured (tsx never loads
 * `.env.local`) silently resolved `<cwd>/data/projects` as a WRITABLE runtime
 * root — the incident that appended mock records to the real
 * `data/projects/unknown/ai-usage.json`. Now an implicit root stays readable but
 * every write fails closed `RUNTIME_STORAGE_CONTEXT_REQUIRED`. Backup inventory
 * and materialization resolve the canonical physical folder read-only instead of
 * through the write-authority resolver, so a historical slug copy in the legacy
 * root no longer blocks backing up the live UUID folder, while a true dual live
 * root (the same physical folder in both roots) still fails closed.
 *
 * Every scenario runs even if an earlier one fails; the summary lists each
 * failure, and PASS is printed only when none failed.
 * Run: npx tsx scripts/smoke-runtime-implicit-root-write-safety.ts
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import {
  isAuthenticProductionAcceptanceReprepareError,
  reprepareProductionAcceptanceMarker,
  type ProductionAcceptanceReprepareFileOperations,
} from "../src/lib/production/ProductionAcceptanceReprepareService";
import { clearProjectFolderIndexCache } from "../src/lib/projects/ProjectFolderIndex";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { bootstrapTestRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import { createVerifiedRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupService";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import {
  acquireExistingProjectWriteAuthority,
  acquireProjectWriteAuthority,
  assertProjectWriteAuthority,
  createRuntimeStorageContext,
  getExistingProjectRoot,
  getExistingProjectRootForWrite,
  resolveRuntimeLogicalPathForWrite,
  RuntimeStorageError,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { FileStorage } from "../src/lib/storage/FileStorage";
import type { AIProvider } from "../src/lib/ai/providers";

const failures: string[] = [];
let count = 0;
async function scenario(name: string, fn: () => Promise<void> | void) {
  count += 1;
  try {
    await fn();
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  } catch (error) {
    failures.push(`FAIL ${count}: ${name} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

const REPO_ROOT = path.resolve(__dirname, "..");
const REPO_PROJECTS = path.join(REPO_ROOT, "data", "projects");
const DIAG_SCRIPT = path.join(REPO_ROOT, "scripts", "diag-ollama-llm-chain.ts");
const ROOT_ENV = [
  "ATOLYE_RUNTIME_ROOT", "ATOLYE_RUNTIME_AUTHORITY_ROOT", "ATOLYE_WORKSPACE_ROOT", "ATOLYE_RUNTIME_BACKUP_ROOT",
] as const;
const TMP_ENV = ["TEMP", "TMP", "TMPDIR"] as const;
const savedEnv = Object.fromEntries([...ROOT_ENV, ...TMP_ENV].map((key) => [key, process.env[key]]));
const savedCwd = process.cwd();

const UUID = "6813e662-0000-4000-8000-00000000beef";
const ALIAS = "istanbul-topic";
const FIXTURE = "fixture-topic";
const FIXTURE_ID = "3f0c9a6e-0000-4000-8000-00000000cafe";

const fakeProvider: AIProvider = {
  async generate() {
    return { content: "{}", finishReason: "stop", refused: false, truncated: false, complete: true };
  },
};

function expectStorageCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof RuntimeStorageError, `expected RuntimeStorageError, got ${String(error)}`);
    assert.equal((error as RuntimeStorageError).code, code);
    return true;
  };
}

/** path + size + mtime listing digest — detects any create/modify/delete. */
function listingDigest(root: string): string {
  if (!fs.existsSync(root)) return "absent";
  const lines: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) { lines.push(`D ${relative}`); walk(absolute); continue; }
      const stat = fs.lstatSync(absolute);
      lines.push(`F ${relative} ${stat.size} ${stat.mtimeMs}`);
    }
  };
  walk(root);
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

function project(id: string, slug: string) {
  return {
    id, slug, title: slug, status: "research",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function seed(projectsRoot: string, folder: string, id: string, slug: string) {
  const directory = path.join(projectsRoot, folder);
  fs.mkdirSync(directory, { recursive: true });
  const record = project(id, slug);
  fs.writeFileSync(path.join(directory, "project.json"), JSON.stringify(record));
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    project: record, projectId: id, slug, version: 1, packages: {},
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  }));
  fs.writeFileSync(path.join(directory, "research.json"), JSON.stringify({ topic: slug }));
  clearProjectFolderIndexCache();
  return directory;
}

function clearRootEnv() {
  for (const key of ROOT_ENV) delete process.env[key];
}

// ── run-owned TEMP root; os.tmpdir() is redirected into it ─────────────────
const repoBefore = listingDigest(REPO_PROJECTS);
const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "atolye-implicit-root-")));
for (const key of TMP_ENV) process.env[key] = runRoot;
assert.equal(path.resolve(os.tmpdir()).toLowerCase(), runRoot.toLowerCase(), "os.tmpdir() must be run-owned");
const defaultAuthorityRoot = path.join(runRoot, "atolye-runtime-authority-v1");
let sequence = 0;

/** A TEMP workspace that becomes the process cwd with every root variable unset. */
function implicitWorkspace(options: { git?: boolean } = {}) {
  sequence += 1;
  const workspace = path.join(runRoot, `ws-${sequence}`);
  const projectsRoot = path.join(workspace, "data", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  if (options.git) execFileSync("git", ["init", "-q"], { cwd: workspace });
  seed(projectsRoot, FIXTURE, FIXTURE_ID, FIXTURE);
  clearRootEnv();
  process.chdir(workspace);
  assert.ok(fs.realpathSync(process.cwd()).toLowerCase().startsWith(runRoot.toLowerCase()), "cwd must be run-owned");
  return { workspace, projectsRoot };
}

/** An explicit external runtime whose workspace (legacy root) is also TEMP. */
function externalRuntime() {
  sequence += 1;
  const base = path.join(runRoot, `ext-${sequence}`);
  const workspace = path.join(base, "workspace");
  const runtimeRoot = path.join(base, "runtime");
  const authorityRoot = path.join(base, "authority");
  const projectsRoot = path.join(runtimeRoot, "projects");
  const legacyRoot = path.join(workspace, "data", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  clearRootEnv();
  const context = createRuntimeStorageContext({
    workspaceRoot: workspace,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    authorityRoot,
  });
  return { base, workspace, runtimeRoot, authorityRoot, projectsRoot, legacyRoot, context };
}

async function main() {
  // ── Storage: implicit root is readable, never writable ────────────────────
  await scenario("no runtime root + no workspace → legacy-default flagged implicit", () => {
    const { projectsRoot } = implicitWorkspace();
    const context = createRuntimeStorageContext();
    assert.equal(context.source, "legacy-default");
    assert.equal(context.classification, "legacy-repository");
    assert.equal(path.resolve(context.projectsRoot).toLowerCase(), path.resolve(projectsRoot).toLowerCase());
    assert.equal((context as RuntimeStorageContext & { rootSelection?: string }).rootSelection, "implicit-default");
  });

  await scenario("implicit root: ProjectWriter write to an existing project fails closed", async () => {
    const { projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    await assert.rejects(
      ProjectWriter.writeJSON(FIXTURE, "script.json", { leaked: true }),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"),
    );
    assert.equal(fs.existsSync(path.join(projectsRoot, FIXTURE, "script.json")), false);
    assert.equal(listingDigest(projectsRoot), before);
  });

  await scenario("implicit root: new-project creation fails closed", async () => {
    const { projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    await assert.rejects(
      ProjectManager.createProject("Implicit Root Topic"),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"),
    );
    assert.equal(listingDigest(projectsRoot), before);
  });

  await scenario("implicit root: authority primitives fail closed before the authority root", () => {
    const { projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    const code = expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED");
    assert.throws(() => acquireProjectWriteAuthority(FIXTURE), code);
    assert.throws(() => acquireExistingProjectWriteAuthority(FIXTURE), code);
    assert.throws(() => assertProjectWriteAuthority(FIXTURE), code);
    assert.throws(() => getExistingProjectRootForWrite(FIXTURE), code);
    assert.throws(() => resolveRuntimeLogicalPathForWrite(`data/projects/${FIXTURE}/x.json`), code);
    assert.equal(fs.existsSync(defaultAuthorityRoot), false, "no lock/claim may be created");
    assert.equal(listingDigest(projectsRoot), before);
  });

  await scenario("implicit root: FileStorage write fails closed", () => {
    const { projectsRoot } = implicitWorkspace();
    assert.throws(
      () => FileStorage.saveJson(`data/projects/${FIXTURE}/storage.json`, { leaked: true }),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"),
    );
    assert.equal(fs.existsSync(path.join(projectsRoot, FIXTURE, "storage.json")), false);
  });

  await scenario("implicit root: read-only inspection keeps working", async () => {
    const { projectsRoot } = implicitWorkspace();
    const loaded = await ProjectManager.getProject(FIXTURE);
    assert.equal(loaded?.id, FIXTURE_ID);
    const listed = await ProjectReader.listProjects();
    assert.ok((listed as Array<{ slug?: string }>).some((item) => item.slug === FIXTURE));
    assert.equal(
      path.resolve(getExistingProjectRoot(FIXTURE)).toLowerCase(),
      path.resolve(projectsRoot, FIXTURE).toLowerCase(),
    );
  });

  // ── Storage: explicit roots stay writable ─────────────────────────────────
  await scenario("explicit TEMP runtime root: writes land in that runtime only", async () => {
    const { projectsRoot: implicitProjects } = implicitWorkspace();
    const implicitBefore = listingDigest(implicitProjects);
    const runtimeRoot = path.join(runRoot, `rt-${sequence}`);
    seed(path.join(runtimeRoot, "projects"), UUID, UUID, ALIAS);
    process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(runRoot, `auth-${sequence}`);
    const context = createRuntimeStorageContext();
    assert.equal(context.classification, "explicit-external");
    assert.equal((context as RuntimeStorageContext & { rootSelection?: string }).rootSelection, "explicit");
    await ProjectWriter.writeJSON(ALIAS, "script.json", { ok: true });
    assert.equal(fs.existsSync(path.join(runtimeRoot, "projects", UUID, "script.json")), true);
    assert.equal(listingDigest(implicitProjects), implicitBefore);
  });

  await scenario("ATOLYE_WORKSPACE_ROOT alone names a readable TEMP workspace, not a write root", async () => {
    implicitWorkspace();
    const named = path.join(runRoot, `named-${sequence}`);
    seed(path.join(named, "data", "projects"), FIXTURE, FIXTURE_ID, FIXTURE);
    process.env.ATOLYE_WORKSPACE_ROOT = named;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(runRoot, `auth-${sequence}`);
    await assert.rejects(ProjectWriter.writeJSON(FIXTURE, "script.json", { leaked: true }),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"));
    assert.equal(fs.existsSync(path.join(named, "data", "projects", FIXTURE, "script.json")), false);
  });

  await scenario("programmatic workspaceRoot alone is read-only", async () => {
    implicitWorkspace();
    const named = path.join(runRoot, `option-${sequence}`);
    seed(path.join(named, "data", "projects"), FIXTURE, FIXTURE_ID, FIXTURE);
    const context = createRuntimeStorageContext({
      workspaceRoot: named, environment: {}, authorityRoot: path.join(runRoot, `auth-${sequence}`),
    });
    await assert.rejects(ProjectWriter.writeJSON(FIXTURE, "script.json", { leaked: true }, context),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"));
    assert.equal(fs.existsSync(path.join(named, "data", "projects", FIXTURE, "script.json")), false);
  });

  await scenario("explicit legacy mode (ATOLYE_RUNTIME_ROOT=<workspace>/data) is the named legacy write contract", async () => {
    const { workspace, projectsRoot } = implicitWorkspace();
    process.env.ATOLYE_RUNTIME_ROOT = path.join(workspace, "data");
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(runRoot, `auth-${sequence}`);
    const context = createRuntimeStorageContext();
    assert.equal(context.classification, "explicit-legacy");
    await ProjectWriter.writeJSON(FIXTURE, "script.json", { ok: true });
    assert.equal(fs.existsSync(path.join(projectsRoot, FIXTURE, "script.json")), true);
  });

  await scenario("operation scope: explicit context writes, implicit context in scope refuses", async () => {
    const { projectsRoot } = implicitWorkspace();
    const implicitContext = createRuntimeStorageContext();
    const implicitOperation = createProductionRuntimeOperationContext({
      operationId: "smoke-implicit-scope", operationType: "smoke-implicit-root",
      authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: implicitContext,
    });
    await assert.rejects(
      runWithProductionRuntimeOperationContext(implicitOperation,
        () => ProjectWriter.writeJSON(FIXTURE, "script.json", { leaked: true })),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"),
    );
    assert.equal(fs.existsSync(path.join(projectsRoot, FIXTURE, "script.json")), false);

    const external = externalRuntime();
    seed(external.projectsRoot, UUID, UUID, ALIAS);
    const explicitOperation = createProductionRuntimeOperationContext({
      operationId: "smoke-explicit-scope", operationType: "smoke-implicit-root",
      authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: external.context,
    });
    await runWithProductionRuntimeOperationContext(explicitOperation,
      () => ProjectWriter.writeJSON(ALIAS, "script.json", { ok: true }));
    assert.equal(fs.existsSync(path.join(external.projectsRoot, UUID, "script.json")), true);
  });

  await scenario("an invalid configured root still fails CONFIGURATION_INVALID", () => {
    implicitWorkspace();
    process.env.ATOLYE_RUNTIME_ROOT = "relative/runtime";
    assert.throws(() => createRuntimeStorageContext(), expectStorageCode("RUNTIME_STORAGE_CONFIGURATION_INVALID"));
  });

  // ── AI usage ──────────────────────────────────────────────────────────────
  await scenario("AI usage with no project context and no runtime root fails closed (no unknown ledger)", async () => {
    const { projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    const result = await runObservedAIRequest({
      prompt: "implicit", context: { operation: "research" }, provider: fakeProvider,
    });
    assert.equal(result.telemetryPersisted, false);
    assert.equal(result.errorCode, "AI_USAGE_PERSISTENCE_FAILED");
    assert.equal(fs.existsSync(path.join(projectsRoot, "unknown")), false);
    assert.equal(listingDigest(projectsRoot), before);
  });

  await scenario("AIUsageManager.appendRecord on an implicit root fails closed", async () => {
    const { projectsRoot } = implicitWorkspace();
    await assert.rejects(AIUsageManager.appendRecord({
      id: "implicit-record", projectSlug: FIXTURE, stage: "research", operation: "research",
      provider: "mock", model: "mock", status: "success", fallbackUsed: false, durationMs: 1,
      promptLength: 1, responseLength: 1, refused: false, responseComplete: true, truncated: false,
      estimatedCost: 0, pricingStatus: "free", createdAt: "2026-01-01T00:00:00.000Z",
    } as Parameters<typeof AIUsageManager.appendRecord>[0]), expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"));
    assert.equal(fs.existsSync(path.join(projectsRoot, FIXTURE, "ai-usage.json")), false);
  });

  await scenario("AI usage with an explicit TEMP runtime writes the TEMP runtime", async () => {
    const { projectsRoot: implicitProjects } = implicitWorkspace();
    const runtimeRoot = path.join(runRoot, `rt-ai-${sequence}`);
    fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
    process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(runRoot, `auth-${sequence}`);
    const result = await runObservedAIRequest({
      prompt: "explicit", context: { operation: "research" }, provider: fakeProvider,
    });
    assert.equal(result.telemetryPersisted, true);
    const ledger = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "projects", "unknown", "ai-usage.json"), "utf8"));
    assert.equal(ledger.records.length, 1);
    assert.equal(fs.existsSync(path.join(implicitProjects, "unknown")), false);
  });

  await scenario("AI usage inside a canonical production operation writes the canonical runtime", async () => {
    implicitWorkspace();
    const external = externalRuntime();
    seed(external.projectsRoot, UUID, UUID, ALIAS);
    const operation = createProductionRuntimeOperationContext({
      operationId: "smoke-canonical-usage", operationType: "smoke-implicit-root",
      authorityGeneration: initialRuntimeAuthorityGeneration, storageContext: external.context,
    });
    const result = await runWithProductionRuntimeOperationContext(operation, () => runObservedAIRequest({
      prompt: "canonical", context: { projectSlug: ALIAS, operation: "research" }, provider: fakeProvider,
    }));
    assert.equal(result.telemetryPersisted, true);
    assert.equal(fs.existsSync(path.join(external.projectsRoot, UUID, "ai-usage.json")), true);
    assert.equal(fs.existsSync(path.join(external.projectsRoot, ALIAS)), false);
  });

  // ── Diagnostics ───────────────────────────────────────────────────────────
  await scenario("diag-ollama-llm-chain with every root unset writes only its own run-owned TEMP root", () => {
    const { workspace, projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    const diagTemp = path.join(runRoot, `diag-tmp-${sequence}`);
    fs.mkdirSync(diagTemp);
    const environment: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ROOT_ENV) delete environment[key];
    for (const key of TMP_ENV) environment[key] = diagTemp;
    Object.assign(environment, {
      OLLAMA_HOST: "127.0.0.1:9", OLLAMA_MAX_RETRIES: "0", OLLAMA_TIMEOUT_MS: "1000", NODE_ENV: "test",
      // tsx looks for tsconfig (the `@/` aliases) from the cwd, which is a TEMP workspace here.
      TSX_TSCONFIG_PATH: path.join(REPO_ROOT, "tsconfig.json"),
    });
    const out = spawnSync(process.execPath, [...process.execArgv, DIAG_SCRIPT, "Implicit Root Diag"], {
      cwd: workspace, env: environment, encoding: "utf8", timeout: 120_000,
    });
    const output = `${out.stdout ?? ""}${out.stderr ?? ""}`;
    assert.equal(out.error, undefined, String(out.error));
    assert.equal(out.status, 1, `diag must finish its stages (exit 1 = mock fallback), got ${out.status}: ${output.slice(-400)}`);
    assert.match(output, /scenes:/);
    assert.equal(listingDigest(projectsRoot), before, "cwd workspace must be unchanged");
    assert.equal(fs.existsSync(path.join(REPO_PROJECTS, "diag-llm-chain")), false);
    assert.deepEqual(
      fs.readdirSync(diagTemp).filter((name) => !name.startsWith("tsx-")), [],
      "diag must remove its run-owned root (tsx's own compile cache aside)",
    );
  });

  for (const script of [
    "smoke-production-publish-reconciliation-hardening.ts",
    "smoke-pipeline-state-corruption.ts",
  ]) {
    await scenario(`${script} stays TEMP-isolated with every root unset`, () => {
      const before = listingDigest(REPO_PROJECTS);
      const environment: NodeJS.ProcessEnv = { ...process.env };
      for (const key of ROOT_ENV) delete environment[key];
      const out = spawnSync(process.execPath, [...process.execArgv, path.join(REPO_ROOT, "scripts", script)], {
        cwd: REPO_ROOT, env: environment, encoding: "utf8", timeout: 120_000,
      });
      assert.equal(out.error, undefined, String(out.error));
      assert.equal(out.status, 0, `${script}: ${(out.stderr ?? "").slice(-500)}`);
      assert.equal(listingDigest(REPO_PROJECTS), before);
    });
  }

  // ── Backup: canonical read-side resolution ────────────────────────────────
  function backupFixture() {
    implicitWorkspace();
    const external = externalRuntime();
    seed(external.projectsRoot, UUID, UUID, ALIAS);
    fs.writeFileSync(path.join(external.projectsRoot, UUID, "script.json"), JSON.stringify({ live: true }));
    // Historical legacy slug copy (the frozen genesis source layout).
    seed(external.legacyRoot, ALIAS, UUID, ALIAS);
    const authority = bootstrapTestRuntimeBackupStorageAuthority(
      external.context, path.join(external.base, "backup-root"),
    );
    return { ...external, authority };
  }

  await scenario("whole-runtime inventory ignores historical legacy slug copies", () => {
    const fixture = backupFixture();
    const manifest = collectRuntimeBackupInventory({ context: fixture.context });
    assert.equal(manifest.files.length, 4);
    assert.ok(manifest.files.every((file) => file.projectSlug === ALIAS));
  });

  await scenario("single-project inventory by slug alias resolves the canonical UUID folder", () => {
    const fixture = backupFixture();
    const manifest = collectRuntimeBackupInventory({ context: fixture.context, projectSlug: ALIAS });
    assert.equal(manifest.files.length, 4);
    assert.ok(manifest.files.some((file) => file.relativePath.endsWith("script.json")));
  });

  await scenario("inventory is read-only: it works on an implicit root", () => {
    const { projectsRoot } = implicitWorkspace();
    const before = listingDigest(projectsRoot);
    assert.equal(collectRuntimeBackupInventory().files.length, 3);
    assert.equal(collectRuntimeBackupInventory({ projectSlug: FIXTURE }).files.length, 3);
    assert.equal(listingDigest(projectsRoot), before);
  });

  await scenario("canonical backup create (whole runtime) from an explicit external root", () => {
    const fixture = backupFixture();
    const legacyBefore = listingDigest(fixture.legacyRoot);
    const liveBefore = listingDigest(fixture.projectsRoot);
    const result = createVerifiedRuntimeBackup({ authority: fixture.authority }, { backupId: "b-whole" });
    assert.equal(result.backupId, "b-whole");
    const payload = path.join(fixture.base, "backup-root", "backups", "b-whole", "payload", "projects", UUID);
    assert.equal(fs.existsSync(path.join(payload, "script.json")), true);
    assert.equal(listingDigest(fixture.legacyRoot), legacyBefore);
    assert.equal(listingDigest(fixture.projectsRoot), liveBefore);
  });

  await scenario("canonical backup create by slug alias with a historical legacy copy present", () => {
    const fixture = backupFixture();
    const result = createVerifiedRuntimeBackup(
      { authority: fixture.authority, projectSlug: ALIAS }, { backupId: "b-alias" },
    );
    assert.equal(result.backupId, "b-alias");
    const payload = path.join(fixture.base, "backup-root", "backups", "b-alias", "payload", "projects", UUID);
    assert.equal(fs.existsSync(path.join(payload, "script.json")), true);
  });

  await scenario("backup create refuses an implicit source root", () => {
    const { workspace } = implicitWorkspace({ git: true });
    const context = createRuntimeStorageContext({ authorityRoot: path.join(runRoot, `auth-${sequence}`) });
    const backupRoot = path.join(runRoot, `bk-implicit-${sequence}`);
    const authority = bootstrapTestRuntimeBackupStorageAuthority(context, backupRoot);
    assert.throws(
      () => createVerifiedRuntimeBackup({ authority }, { backupId: "b-implicit" }),
      expectStorageCode("RUNTIME_STORAGE_CONTEXT_REQUIRED"),
    );
    assert.equal(fs.existsSync(path.join(backupRoot, "backups", "b-implicit")), false);
    assert.equal(fs.existsSync(path.join(workspace, "data", "projects", FIXTURE)), true);
  });

  await scenario("a true dual live root (same physical folder in both roots) still fails closed", () => {
    const fixture = backupFixture();
    seed(fixture.legacyRoot, UUID, UUID, ALIAS);
    assert.throws(
      () => collectRuntimeBackupInventory({ context: fixture.context, projectSlug: UUID }),
      expectStorageCode("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"),
    );
    assert.throws(
      () => collectRuntimeBackupInventory({ context: fixture.context }),
      expectStorageCode("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"),
    );
    assert.throws(() => createVerifiedRuntimeBackup(
      { authority: fixture.authority, projectSlug: UUID }, { backupId: "b-dual" },
    ));
    assert.throws(() => createVerifiedRuntimeBackup(
      { authority: fixture.authority }, { backupId: "b-dual-whole" },
    ));
  });

  await scenario("an identity owned by two folders is ambiguous", () => {
    const fixture = backupFixture();
    seed(fixture.projectsRoot, "0aa9c1d2-0000-4000-8000-00000000dada", "0aa9c1d2-0000-4000-8000-00000000dada", ALIAS);
    assert.throws(
      () => collectRuntimeBackupInventory({ context: fixture.context, projectSlug: ALIAS }),
      expectStorageCode("RUNTIME_STORAGE_PROJECT_ROOT_AMBIGUOUS"),
    );
  });

  await scenario("a missing canonical root fails closed", () => {
    const fixture = backupFixture();
    assert.throws(() => collectRuntimeBackupInventory({ context: fixture.context, projectSlug: "no-such-topic" }));
    assert.throws(() => createVerifiedRuntimeBackup(
      { authority: fixture.authority, projectSlug: "no-such-topic" }, { backupId: "b-missing" },
    ));
  });

  await scenario("writes to a slug alias stay quarantined while the historical legacy copy exists", async () => {
    const fixture = backupFixture();
    await assert.rejects(
      ProjectWriter.writeJSON(ALIAS, "scenes.json", { leaked: true }, fixture.context),
      expectStorageCode("RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE"),
    );
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, UUID, "scenes.json")), false);
    await ProjectWriter.writeJSON(UUID, "scenes.json", { ok: true }, fixture.context);
    assert.equal(fs.existsSync(path.join(fixture.projectsRoot, UUID, "scenes.json")), true);
  });

  // ── Production acceptance reprepare (raw marker write) ────────────────────
  await scenario("reprepare refuses an implicit root before touching any file", async () => {
    implicitWorkspace();
    let touched = 0;
    const operations = new Proxy({}, {
      get: () => () => { touched += 1; throw new Error("file operation reached"); },
    }) as ProductionAcceptanceReprepareFileOperations;
    await assert.rejects(
      reprepareProductionAcceptanceMarker(FIXTURE, {
        environment: {} as NodeJS.ProcessEnv, fileOperations: operations,
      }),
      (error: unknown) => isAuthenticProductionAcceptanceReprepareError(error),
    );
    assert.equal(touched, 0);
  });
}

void main()
  .catch((error) => { failures.push(`FATAL — ${error instanceof Error ? error.message : String(error)}`); })
  .finally(() => {
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try {
      if (listingDigest(REPO_PROJECTS) !== repoBefore) failures.push("FAIL: repository data/projects changed");
    } finally {
      if (path.basename(runRoot).startsWith("atolye-implicit-root-")) fs.rmSync(runRoot, { recursive: true, force: true });
    }
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      console.error(`FAIL (${failures.length}/${count} scenarios failed)`);
      process.exitCode = 1;
    } else {
      console.log(`PASS (${count} scenarios)`);
    }
  });
