import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  aggregateRuntimeFileRecords,
  emptyClassificationTotals,
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
  validateRuntimeBackupManifest,
  type RuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  createVerifiedRuntimeBackup,
  restoreAndVerifyRuntimeBackup,
  RuntimeBackupError,
} from "../src/lib/runtime/backup/RuntimeBackupService";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { collectRuntimeTrackingInventory } from "./lib/runtime-tracking-inventory";

const repositoryRoot = process.cwd();
const liveSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const liveMarker = path.join(repositoryRoot, "data", "projects", liveSlug, "production-acceptance.json");
let scenarios = 0;
let productionBoundaryCalls = 0;

async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function sha256(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runtimeDiff() {
  return execFileSync("git", ["diff", "--", "data/projects"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

async function main() {
  if (process.argv[2] === "--concurrent-create-child") {
    await runConcurrentCreateChild(process.argv.slice(3));
    return;
  }
  const beforeMarker = sha256(liveMarker);
  const beforeTracking = collectRuntimeTrackingInventory(repositoryRoot);
  const beforeDiff = runtimeDiff();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-backup-smoke-"));
  try {
    const fixtureRepository = path.join(sandbox, "fixture-repository");
    const fixtureProjects = path.join(fixtureRepository, "data", "projects");
    const fixtureContext = createRuntimeStorageContext({
      workspaceRoot: fixtureRepository,
      environment: { ATOLYE_RUNTIME_ROOT: path.join(fixtureRepository, "data") },
      authorityRoot: path.join(sandbox, "authority"),
    });
    createFixture(fixtureRepository, fixtureProjects);
    initializeGitFixture(fixtureRepository);
    const fixedNow = "2026-07-16T12:00:00.000Z";

    await scenario("empty tree inventory is deterministic", () => {
      const root = path.join(sandbox, "empty", "projects");
      fs.mkdirSync(root, { recursive: true });
      const context = createRuntimeStorageContext({
        workspaceRoot: path.join(sandbox, "empty-workspace"),
        environment: { ATOLYE_RUNTIME_ROOT: path.dirname(root) },
      });
      const first = collectRuntimeBackupInventory({ context, now: () => fixedNow });
      const second = collectRuntimeBackupInventory({ context, now: () => fixedNow });
      assert.equal(first.inventory.files, 0);
      assert.equal(first.inventory.bytes, 0);
      assert.equal(first.aggregateFingerprint, second.aggregateFingerprint);
      assert.equal(serializeRuntimeBackupManifest(first), serializeRuntimeBackupManifest(second));
    });

    let inventory!: RuntimeBackupManifest;
    await scenario("multi-project binary zero-byte nested and Git metadata inventory", () => {
      inventory = collectRuntimeBackupInventory({
        context: fixtureContext,
        repositoryRoot: fixtureRepository,
        now: () => fixedNow,
      });
      assert.equal(inventory.inventory.projects, 2);
      assert.ok(inventory.inventory.files >= 10);
      assert.ok(inventory.files.some((file) => file.sizeBytes === 0));
      assert.ok(inventory.files.some((file) => file.classification === "generated-asset"));
      assert.ok(inventory.files.some((file) => file.classification === "durable-execution"));
      assert.ok(inventory.files.some((file) => file.git?.tracked));
      assert.ok(inventory.files.some((file) => file.git?.tracked === false));
      assert.deepEqual(inventory.files.map((file) => file.relativePath),
        [...inventory.files].map((file) => file.relativePath).sort(compareText));
    });

    await scenario("same byte tree on another root has identical aggregate", () => {
      const otherRuntime = path.join(sandbox, "other-runtime");
      fs.cpSync(fixtureProjects, path.join(otherRuntime, "projects"), { recursive: true });
      const other = createRuntimeStorageContext({
        workspaceRoot: path.join(sandbox, "other-workspace"),
        environment: { ATOLYE_RUNTIME_ROOT: otherRuntime },
      });
      const otherInventory = collectRuntimeBackupInventory({ context: other, now: () => "2030-01-01T00:00:00.000Z" });
      assert.equal(otherInventory.aggregateFingerprint, inventory.aggregateFingerprint);
    });

    await scenario("manifest is exact and Windows-portable", () => {
      const serialized = serializeRuntimeBackupManifest(inventory);
      assert.equal(serialized.includes(fixtureRepository), false);
      assert.equal(serialized.includes(os.homedir()), false);
      const first = inventory.files[0];
      const upper = { ...first, relativePath: `Case/${first.relativePath}` };
      const lower = { ...first, relativePath: `case/${first.relativePath}` };
      const files = [upper, lower].sort((a, b) => compareText(a.relativePath, b.relativePath));
      assert.throws(() => validateRuntimeBackupManifest(manifestWithFiles(inventory, files)), /collision/);
      for (const segment of [
        "CON",
        "nul.txt",
        "trailing.",
        "trailing ",
        "colon:name",
        "control\u0001name",
        "e\u0301",
      ]) {
        const invalidFile = { ...first, relativePath: `project-a/${segment}/file.bin` };
        assert.throws(() => validateRuntimeBackupManifest(
          manifestWithFiles(inventory, [invalidFile]),
        ));
      }
      assert.throws(() => validateRuntimeBackupManifest({ ...inventory, unknown: true }), /invalid/);
      assert.throws(() => validateRuntimeBackupManifest({
        ...inventory,
        files: inventory.files.map((file, index) => index === 0 ? { ...file, unknown: true } : file),
      }), /invalid/);
    });

    await scenario("symlink or junction in source fails closed", () => {
      const link = path.join(fixtureProjects, "project-a", "linked-entry");
      const target = path.join(sandbox, "link-target");
      fs.mkdirSync(target);
      try {
        fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) {
          process.stdout.write(`SKIP source link unsupported (${code})\n`);
          return;
        }
        throw error;
      }
      try {
        assert.throws(() => collectRuntimeBackupInventory({ context: fixtureContext }), /link|reparse/);
      } finally {
        fs.rmSync(link, { force: true });
      }
    });

    await scenario("source mutation during hash and unreadable hook propagate", () => {
      const mutable = path.join(fixtureProjects, "project-b", "mutable.bin");
      fs.writeFileSync(mutable, "before");
      let changed = false;
      assert.throws(() => collectRuntimeBackupInventory({
        context: fixtureContext,
        hooks: {
          afterHashFile(absolutePath, relativePath) {
            if (!changed && relativePath.endsWith("mutable.bin")) {
              changed = true;
              fs.appendFileSync(absolutePath, "changed");
            }
          },
        },
      }), /changed during inventory/);
      fs.writeFileSync(mutable, "before");
      assert.throws(() => collectRuntimeBackupInventory({
        context: fixtureContext,
        hooks: {
          beforeHashFile(_absolutePath, relativePath) {
            if (relativePath.endsWith("mutable.bin")) throw new Error("permission denied");
          },
        },
      }), /permission denied/);
      fs.rmSync(mutable);
    });

    const backupRoot = path.join(sandbox, "backup-target");
    let backupDirectory = "";
    await scenario("source partial verified final publish succeeds", () => {
      const result = createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot,
        repositoryRoot: fixtureRepository,
      }, {
        now: () => fixedNow,
        backupId: () => "verified-backup",
      });
      backupDirectory = result.backupDirectory;
      assert.equal(result.verification.valid, true);
      assert.equal(result.manifest.aggregateFingerprint, inventory.aggregateFingerprint);
      assert.equal(fs.existsSync(path.join(backupDirectory, "manifest.json")), true);
      assert.equal(fs.readdirSync(path.join(backupRoot, "backups")).some((name) => name.includes(".partial")), false);
    });

    await scenario("backup target validation and overwrite are fail closed", () => {
      assert.throws(() => createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot: "relative-backup",
        repositoryRoot: fixtureRepository,
      }), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_PATH_INVALID");
      assert.throws(() => createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot: path.join(fixtureRepository, "inside-repository"),
        repositoryRoot: fixtureRepository,
      }), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_TARGET_OVERLAP");
      assert.throws(() => createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot: path.join(fixtureProjects, "inside-source"),
        repositoryRoot: fixtureRepository,
      }), /overlap/);
      assert.throws(() => createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot,
        repositoryRoot: fixtureRepository,
      }, { now: () => fixedNow, backupId: () => "verified-backup" }),
      (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_TARGET_EXISTS");
    });

    await scenario("two processes publish the same backup id without overwrite", async () => {
      const concurrentRoot = path.join(sandbox, "concurrent-backup-target");
      const startAt = Date.now() + 1_000;
      const childArguments = [
        fixtureRepository,
        path.dirname(fixtureProjects),
        concurrentRoot,
        String(startAt),
      ];
      const [first, second] = await Promise.all([
        runConcurrentCreateProcess(childArguments),
        runConcurrentCreateProcess(childArguments),
      ]);
      assert.deepEqual([first, second].sort(), ["CONTENDED", "SUCCESS"]);
      const final = path.join(concurrentRoot, "backups", "concurrent-backup");
      assert.equal(verifyRuntimeBackup(final).valid, true);
      assert.deepEqual(
        fs.readdirSync(path.join(concurrentRoot, "backups"))
          .filter((name) => name.includes("partial") || name.includes("publish.lock")),
        [],
      );
    });

    await scenario("failed or tampered copy never publishes a final backup", () => {
      for (const [id, hook] of [
        ["copy-failure", () => { throw new Error("copy failed"); }],
        ["copy-tamper", (_source: string, destination: string) => fs.appendFileSync(destination, "tamper")],
      ] as const) {
        assert.throws(() => createVerifiedRuntimeBackup({
          context: fixtureContext,
          backupRoot,
          repositoryRoot: fixtureRepository,
        }, { backupId: () => id, now: () => fixedNow, afterCopyFile: hook }));
        assert.equal(fs.existsSync(path.join(backupRoot, "backups", id)), false);
        assert.equal(fs.readdirSync(path.join(backupRoot, "backups")).some((name) => name.includes(id)), false);
      }
    });

    await scenario("destination parent link swap fails and leaves no outside bytes", () => {
      const outside = path.join(sandbox, "link-swap-outside");
      fs.mkdirSync(outside);
      let attempted = false;
      let linked = false;
      assert.throws(() => createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot,
        repositoryRoot: fixtureRepository,
      }, {
        backupId: () => "link-swap-create",
        now: () => fixedNow,
        beforeDestinationWrite(parentPath) {
          if (attempted) return;
          attempted = true;
          const displaced = `${parentPath}.displaced`;
          fs.renameSync(parentPath, displaced);
          try {
            fs.symlinkSync(outside, parentPath, process.platform === "win32" ? "junction" : "dir");
            linked = true;
          } catch {
            // The operation still fails closed; unsupported link creation is reported below.
          }
        },
      }));
      if (!linked) {
        process.stdout.write("SKIP backup destination link swap unsupported\n");
        return;
      }
      assert.equal(attempted, true);
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.equal(fs.existsSync(path.join(backupRoot, "backups", "link-swap-create")), false);
    });

    await scenario("partial directory is never accepted as a valid backup", () => {
      const partial = path.join(backupRoot, "backups", ".manual.partial");
      fs.mkdirSync(partial);
      assert.throws(() => verifyRuntimeBackup(partial), /Partial/);
      fs.rmSync(partial, { recursive: true });
    });

    await scenario("payload layout manifest and digest tampering fail closed", () => {
      for (const mode of [
        "byte",
        "missing",
        "extra",
        "root-extra",
        "payload-extra",
        "unknown-manifest",
        "manifest",
        "digest",
      ] as const) {
        const variant = path.join(sandbox, `tamper-${mode}`);
        fs.cpSync(backupDirectory, variant, { recursive: true });
        const payload = path.join(variant, "payload", "projects");
        const first = inventory.files[0].relativePath.split("/").join(path.sep);
        if (mode === "byte") fs.appendFileSync(path.join(payload, first), "tamper");
        if (mode === "missing") fs.rmSync(path.join(payload, first));
        if (mode === "extra") fs.writeFileSync(path.join(payload, "extra.bin"), "extra");
        if (mode === "root-extra") fs.writeFileSync(path.join(variant, "extra.bin"), "extra");
        if (mode === "payload-extra") fs.writeFileSync(path.join(variant, "payload", "extra.bin"), "extra");
        if (mode === "unknown-manifest") {
          const manifestPath = path.join(variant, "manifest.json");
          const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          const changed = `${JSON.stringify({ ...parsed, unknown: true }, null, 2)}\n`;
          fs.writeFileSync(manifestPath, changed);
          fs.writeFileSync(
            path.join(variant, "manifest.sha256"),
            `${runtimeBackupManifestSha256(changed)}\n`,
          );
        }
        if (mode === "manifest") fs.appendFileSync(path.join(variant, "manifest.json"), " ");
        if (mode === "digest") fs.writeFileSync(path.join(variant, "manifest.sha256"), `${"0".repeat(64)}\n`);
        assert.throws(() => verifyRuntimeBackup(variant));
      }
    });

    await scenario("exact temp restore preserves marker metadata binary and durable files", () => {
      const restoreRoot = emptyDirectory(sandbox, "restore-exact");
      const report = restoreAndVerifyRuntimeBackup({
        backupDirectory,
        restoreRoot,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      });
      assert.equal(report.aggregateFingerprint, inventory.aggregateFingerprint);
      assert.equal(report.markerFiles.length, 1);
      const markerRecord = inventory.files.find((file) => file.classification === "acceptance-marker");
      assert.equal(report.markerFiles[0].sha256, markerRecord?.sha256);
      for (const relative of [
        "project-a/assets/assets.json",
        "project-a/assets/images/image.bin",
        "project-a/production-execution/attempts/attempt-1.json",
      ]) assert.equal(fs.existsSync(path.join(restoreRoot, "projects", ...relative.split("/"))), true);
      const serviceOwned = restoreAndVerifyRuntimeBackup({
        backupDirectory,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      });
      assert.equal(serviceOwned.valid, true);
      assert.equal(fs.existsSync(serviceOwned.restoreRoot), false);
    });

    await scenario("restore missing extra modified and nonempty targets fail closed", () => {
      for (const mode of ["missing", "extra", "modified"] as const) {
        const restoreRoot = emptyDirectory(sandbox, `restore-${mode}`);
        let injected = false;
        assert.throws(() => restoreAndVerifyRuntimeBackup({
          backupDirectory,
          restoreRoot,
          repositoryRoot: fixtureRepository,
          liveProjectsRoot: fixtureProjects,
        }, {
          afterCopyFile(destination) {
            if (injected) return;
            injected = true;
            if (mode === "missing") fs.rmSync(destination);
            if (mode === "modified") fs.appendFileSync(destination, "changed");
            if (mode === "extra") fs.writeFileSync(path.join(path.dirname(destination), "extra.bin"), "extra");
          },
        }));
      }
      const nonempty = emptyDirectory(sandbox, "restore-nonempty");
      fs.writeFileSync(path.join(nonempty, "occupied"), "x");
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        backupDirectory,
        restoreRoot: nonempty,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      }), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        backupDirectory,
        restoreRoot: fixtureProjects,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      }));
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        backupDirectory,
        restoreRoot: repositoryRoot,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      }), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_RESTORE_TARGET_INVALID");
    });

    await scenario("restore destination link swap fails and leaves no outside bytes", () => {
      const outside = path.join(sandbox, "restore-link-swap-outside");
      fs.mkdirSync(outside);
      const restoreRoot = emptyDirectory(sandbox, "restore-link-swap");
      let attempted = false;
      let linked = false;
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        backupDirectory,
        restoreRoot,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: fixtureProjects,
      }, {
        beforeDestinationWrite(parentPath) {
          if (attempted) return;
          attempted = true;
          const displaced = `${parentPath}.displaced`;
          fs.renameSync(parentPath, displaced);
          try {
            fs.symlinkSync(outside, parentPath, process.platform === "win32" ? "junction" : "dir");
            linked = true;
          } catch {
            // The operation still fails closed; unsupported link creation is reported below.
          }
        },
      }));
      if (!linked) {
        process.stdout.write("SKIP restore destination link swap unsupported\n");
        return;
      }
      assert.equal(attempted, true);
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.deepEqual(fs.readdirSync(restoreRoot), []);
    });

    await scenario("project-level backup remains reusable", () => {
      const result = createVerifiedRuntimeBackup({
        context: fixtureContext,
        backupRoot,
        repositoryRoot: fixtureRepository,
        projectSlug: "project-b",
      }, { now: () => fixedNow, backupId: () => "project-b-only" });
      assert.equal(result.manifest.sourceLogicalIdentity, "projects/project-b");
      assert.ok(result.manifest.files.every((file) => file.relativePath.startsWith("project-b/")));
    });

    await scenario("manifest digest is deterministic and production boundary remains closed", () => {
      const serialized = serializeRuntimeBackupManifest(inventory);
      assert.equal(runtimeBackupManifestSha256(serialized), runtimeBackupManifestSha256(serialized));
      const imports = fs.readFileSync(import.meta.filename, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^import\b/.test(line.trim()));
      productionBoundaryCalls += imports.filter((line) =>
        /Orchestrator|WorkerExecution|OpenAI.*Provider|PipelineRunner/.test(line)).length;
      assert.equal(productionBoundaryCalls, 0);
    });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  const afterMarker = sha256(liveMarker);
  const afterTracking = collectRuntimeTrackingInventory(repositoryRoot);
  assert.equal(afterMarker, beforeMarker);
  assert.deepEqual(afterTracking, beforeTracking);
  assert.equal(runtimeDiff(), beforeDiff);
  assert.equal(productionBoundaryCalls, 0);
  process.stdout.write(
    `Sprint 129.25C.1 runtime backup smoke: PASS (${scenarios} scenarios; production-provider-worker-calls=${productionBoundaryCalls})\n`,
  );
}

function createFixture(repository: string, projects: string) {
  const projectA = path.join(projects, "project-a");
  const projectB = path.join(projects, "project-b");
  fs.mkdirSync(path.join(projectA, "assets", "images"), { recursive: true });
  fs.mkdirSync(path.join(projectA, "production-execution", "attempts"), { recursive: true });
  fs.mkdirSync(path.join(projectB, "nested"), { recursive: true });
  fs.writeFileSync(path.join(projectA, "project.json"), JSON.stringify({ slug: "project-a" }));
  fs.writeFileSync(path.join(projectA, "manifest.json"), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(projectA, "pipeline-jobs.json"), "[]");
  fs.writeFileSync(path.join(projectA, "pipeline-history.json"), "[]");
  fs.writeFileSync(path.join(projectA, "ai-usage.json"), "[]");
  fs.writeFileSync(path.join(projectA, "production-acceptance.json"), Buffer.from([0, 1, 2, 3, 255]));
  fs.writeFileSync(path.join(projectA, "assets", "assets.json"), JSON.stringify({ assets: [] }));
  fs.writeFileSync(path.join(projectA, "assets", "images", "image.bin"), Buffer.from([0, 255, 16, 32, 64]));
  fs.writeFileSync(path.join(projectA, "production-execution", "attempts", "attempt-1.json"), "{}");
  fs.writeFileSync(path.join(projectB, "project.json"), JSON.stringify({ slug: "project-b" }));
  fs.writeFileSync(path.join(projectB, "nested", "zero.bin"), Buffer.alloc(0));
  fs.writeFileSync(path.join(projectB, "untracked.json"), "{}");
  assert.ok(repository);
}

function initializeGitFixture(repository: string) {
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["add", "data/projects/project-a", "data/projects/project-b/project.json"], { cwd: repository });
  execFileSync("git", ["-c", "user.name=Atolye Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], { cwd: repository });
}

function emptyDirectory(root: string, name: string) {
  const target = path.join(root, name);
  fs.mkdirSync(target);
  return target;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestWithFiles(
  base: RuntimeBackupManifest,
  inputFiles: RuntimeBackupManifest["files"],
): RuntimeBackupManifest {
  const files = [...inputFiles].sort((left, right) => compareText(left.relativePath, right.relativePath));
  const classifications = emptyClassificationTotals();
  files.forEach((file) => { classifications[file.classification] += 1; });
  const tracked = files.filter((file) => file.git?.tracked).length;
  return {
    ...base,
    aggregateFingerprint: aggregateRuntimeFileRecords(files),
    inventory: {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      projects: new Set(files.map((file) => file.projectSlug).filter(Boolean)).size,
      tracked,
      untracked: files.length - tracked,
      classifications,
    },
    files,
  };
}

async function runConcurrentCreateChild(arguments_: string[]) {
  const [fixtureRepository, runtimeRoot, backupRoot, startAtRaw] = arguments_;
  if (!fixtureRepository || !runtimeRoot || !backupRoot || !startAtRaw) process.exit(2);
  const delay = Math.max(0, Number(startAtRaw) - Date.now());
  await new Promise((resolve) => setTimeout(resolve, delay));
  const context = createRuntimeStorageContext({
    workspaceRoot: fixtureRepository,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    authorityRoot: path.join(runtimeRoot, ".concurrency-authority"),
  });
  try {
    createVerifiedRuntimeBackup({
      context,
      backupRoot,
      repositoryRoot: fixtureRepository,
    }, {
      backupId: () => "concurrent-backup",
      now: () => "2026-07-16T12:00:00.000Z",
    });
    process.stdout.write("SUCCESS\n");
  } catch (error) {
    if (error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_TARGET_EXISTS") {
      process.stdout.write("CONTENDED\n");
      return;
    }
    throw error;
  }
}

function runConcurrentCreateProcess(arguments_: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", import.meta.filename, "--concurrent-create-child", ...arguments_],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Concurrent backup child failed: ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

void main();
