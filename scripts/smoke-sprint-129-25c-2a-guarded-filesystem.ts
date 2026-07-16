import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createVerifiedRuntimeBackup,
  restoreAndVerifyRuntimeBackup,
} from "../src/lib/runtime/backup/RuntimeBackupService";
import { GuardedRuntimeFilesystem } from "../src/lib/runtime/security/GuardedRuntimeFilesystem";
import { GuardedRuntimeMutationSession } from "../src/lib/runtime/security/GuardedRuntimeMutationSession";
import { RuntimeMutationError } from "../src/lib/runtime/security/RuntimeMutationError";
import {
  assertNoRuntimePathCollisions,
  assertRuntimeMaterializedPath,
  runtimePortablePathLimits,
  runtimePortablePathPolicyVersion,
  validateMutationRelativePath,
  validateRuntimeLogicalPath,
} from "../src/lib/runtime/security/RuntimePathPolicy";
import { probeRuntimePathCapabilities } from "../src/lib/runtime/security/RuntimePathCapabilityProbe";
import {
  RuntimeProtectedRoots,
  runtimeProtectedRootsFromContext,
} from "../src/lib/runtime/security/RuntimeProtectedRoots";

const repositoryRoot = process.cwd();
let scenarios = 0;
let skippedUnsupported = 0;

async function scenario(name: string, run: () => void | Promise<void>) {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  if (process.argv[2] === "--reservation-child") {
    await reservationChild(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "--publish-child") {
    await publishChild(process.argv.slice(3));
    return;
  }
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-c2a-smoke-"));
  try {
    const fixtureRepository = path.join(sandbox, "repository");
    const runtimeRoot = path.join(fixtureRepository, "data");
    const projectsRoot = path.join(runtimeRoot, "projects");
    const authorityRoot = path.join(sandbox, "authority");
    const backupRoot = path.join(sandbox, "backup-target");
    const restoreVerificationRoot = path.join(sandbox, "restore-verification");
    fs.mkdirSync(fixtureRepository);
    fs.mkdirSync(path.join(projectsRoot, "project-a", "nested"), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, "project-a", "project.json"), "{}\n");
    fs.writeFileSync(path.join(projectsRoot, "project-a", "nested", "zero.bin"), Buffer.alloc(0));
    initializeGitFixture(fixtureRepository);
    const context = createRuntimeStorageContext({
      workspaceRoot: fixtureRepository,
      environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
      authorityRoot,
    });

    await scenario("protected roots reject overlap prefix collision and reparse roots", () => {
      const roots = runtimeProtectedRootsFromContext({
        context,
        repositoryRoot: fixtureRepository,
        backupRoot,
        restoreVerificationRoot,
      });
      assert.equal(roots.entries.length, 7);
      assert.equal(roots.assertWritableRoot(backupRoot, "backup"), path.resolve(backupRoot));
      for (const role of roots.entries.map((entry) => entry.role)) {
        assert.throws(() => new RuntimeProtectedRoots(
          roots.entries.filter((entry) => entry.role !== role),
        ));
      }
      const insideRepository = new RuntimeProtectedRoots(completeProtectedInputs(
        path.join(fixtureRepository, "backup"),
        { repository: fixtureRepository },
      ));
      assert.throws(
        () => insideRepository.assertWritableRoot(path.join(fixtureRepository, "backup"), "backup"),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_PROTECTED_ROOT_OVERLAP",
      );
      const prefixSibling = path.join(sandbox, "repository-copy");
      const siblingRoots = new RuntimeProtectedRoots(completeProtectedInputs(
        prefixSibling,
        { repository: fixtureRepository },
      ));
      assert.equal(siblingRoots.assertWritableRoot(prefixSibling, "backup"), path.resolve(prefixSibling));
      const outside = path.join(sandbox, "reparse-outside");
      const linked = path.join(sandbox, "reparse-root");
      fs.mkdirSync(outside);
      try {
        fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => new RuntimeProtectedRoots(completeProtectedInputs(linked)));
      } catch (error) {
        if (!isPermissionOrUnsupported(error)) throw error;
        recordUnsupportedSkip("protected-root reparse creation unsupported");
      }
    });

    await scenario("windows portable path policy enforces names normalization and collisions", () => {
      assert.equal(runtimePortablePathPolicyVersion, "windows-portable-path-v1");
      validateRuntimeLogicalPath(`slug/${"a".repeat(runtimePortablePathLimits.segmentUtf16)}/file.json`);
      assert.throws(() => validateRuntimeLogicalPath(
        `slug/${"a".repeat(runtimePortablePathLimits.segmentUtf16 + 1)}/file.json`,
      ));
      const exactLogical = `slug/${"a".repeat(120)}/${"b".repeat(54)}`;
      assert.equal(exactLogical.length, runtimePortablePathLimits.logicalPathUtf16);
      validateRuntimeLogicalPath(exactLogical);
      assert.throws(() => validateRuntimeLogicalPath(`${exactLogical}x`));
      for (const invalid of [
        "slug/CON",
        "slug/COM¹.txt",
        "slug/COM²",
        "slug/COM³.json",
        "slug/LPT¹",
        "slug/LPT².txt",
        "slug/LPT³",
        "slug/name.",
        "slug/name ",
        "slug/na:me",
        "slug/..",
        "slug/na\u0001me",
        "slug/e\u0301.json",
      ]) assert.throws(() => validateRuntimeLogicalPath(invalid));
      validateRuntimeLogicalPath(`slug/${"😀".repeat(36)}`);
      assert.throws(() => validateRuntimeLogicalPath(`slug/${"😀".repeat(37)}`));
      validateRuntimeLogicalPath(`${"😀".repeat(37)}/file`);
      assert.throws(() => validateRuntimeLogicalPath(`${"😀".repeat(38)}/file`));
      for (const invalid of [
        "C:/escape",
        "//server/share",
        "mixed\\separator",
        "../escape",
        "slug/COM¹.txt",
      ]) assert.throws(() => validateMutationRelativePath(invalid, sandbox));
      validateMutationRelativePath(`${"s".repeat(runtimePortablePathLimits.projectSlugUtf16)}/file`, sandbox);
      assert.throws(() => validateMutationRelativePath(
        `${"s".repeat(runtimePortablePathLimits.projectSlugUtf16 + 1)}/file`,
        sandbox,
      ));
      validateMutationRelativePath(`slug/${"f".repeat(runtimePortablePathLimits.fileNameUtf16)}`, sandbox);
      assert.throws(() => validateMutationRelativePath(
        `slug/${"f".repeat(runtimePortablePathLimits.fileNameUtf16 + 1)}`,
        sandbox,
      ));
      validateMutationRelativePath(`slug/${"😀".repeat(36)}`, sandbox);
      assert.throws(() => validateMutationRelativePath(`slug/${"😀".repeat(37)}`, sandbox));
      const exactMutation = `slug/${"a".repeat(120)}/${"b".repeat(94)}`;
      assert.equal(exactMutation.length, runtimePortablePathLimits.mutationRelativeUtf16);
      validateMutationRelativePath(exactMutation);
      assert.throws(() => validateMutationRelativePath(`${exactMutation}b`));
      assert.throws(() => assertNoRuntimePathCollisions([
        "slug/File.json",
        "slug/file.json",
      ]));
      const relative = "slug/file.json";
      const exactRootLength = runtimePortablePathLimits.materializedPathUtf16 -
        1 - relative.split("/").join(path.sep).length;
      const rootPrefix = path.parse(sandbox).root;
      const exactRoot = path.join(rootPrefix, "r".repeat(exactRootLength - rootPrefix.length));
      assert.equal(assertRuntimeMaterializedPath(exactRoot, relative).length, 240);
      assert.throws(() => assertRuntimeMaterializedPath(`${exactRoot}x`, relative));
    });

    await scenario("capability probe is temp-owned and reports the explicit threat boundary", () => {
      const capabilityRoot = path.join(sandbox, "capability-root");
      fs.mkdirSync(capabilityRoot);
      const before = fs.readdirSync(capabilityRoot);
      const report = probeRuntimePathCapabilities(capabilityRoot);
      assert.equal(report.supportsExclusiveCreate, true);
      assert.equal(report.supportsExclusivePublish, true);
      assert.equal(report.hostileConcurrentIsolation, false);
      assert.equal(report.cleanupVerified, true);
      assert.equal(report.probeSideEffects, "owned-temporary-only");
      assert.ok(typeof report.supportsHardLinks === "boolean");
      assert.ok(report.filesystemKind.length > 0);
      assert.deepEqual(fs.readdirSync(capabilityRoot), before);
      process.stdout.write(`CAPABILITY ${JSON.stringify(report)}\n`);
    });

    await scenario("exclusive publish behavior has one child winner and preserves bytes", async () => {
      const root = path.join(sandbox, "publish-race");
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, "source"), "published-bytes");
      const startAt = String(Date.now() + 750);
      const results = await Promise.all([
        runChild("--publish-child", root, startAt),
        runChild("--publish-child", root, startAt),
      ]);
      assert.deepEqual(results.sort(), ["CONTENDED", "SUCCESS"]);
      assert.equal(fs.readFileSync(path.join(root, "destination"), "utf8"), "published-bytes");
    });

    await scenario("session construction cannot bypass the guarded public entrypoint", () => {
      const bypassRoot = path.join(sandbox, "constructor-bypass");
      assert.throws(
        () => Reflect.construct(GuardedRuntimeMutationSession, [
          undefined,
          bypassRoot,
          "constructor-bypass",
          Object.freeze({}),
        ]),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_PATH_INVALID",
      );
      assert.equal(fs.existsSync(bypassRoot), false);

      const firstRoot = path.join(sandbox, "scope-independent-a");
      const secondRoot = path.join(sandbox, "scope-independent-b");
      const first = guardedForRoot(firstRoot).beginMutation({
        writableRoot: firstRoot,
        writableRole: "backup",
        operation: "scope-a",
      });
      const otherScope = guardedForRoot(firstRoot).beginMutation({
        writableRoot: firstRoot,
        writableRole: "backup",
        operation: "scope-b",
      });
      const otherRoot = guardedForRoot(secondRoot).beginMutation({
        writableRoot: secondRoot,
        writableRole: "backup",
        operation: "scope-a",
      });
      assert.equal(first.close(), "completed");
      assert.equal(otherScope.close(), "completed");
      assert.equal(otherRoot.close(), "completed");
    });

    await scenario("guarded mutation is exclusive and closes its reservation", () => {
      const root = path.join(sandbox, "guarded-exclusive");
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "exclusive-smoke",
      });
      const owned = session.createOwnedDirectory("owned");
      owned.writeFileExclusive("nested/value.bin", Buffer.from([0, 255]));
      assert.throws(() => owned.writeFileExclusive("nested/COM¹.txt", "invalid"));
      assert.throws(() => owned.writeFileExclusive("nested/e\u0301.txt", "invalid"));
      assert.throws(
        () => owned.writeFileExclusive("nested/value.bin", "overwrite"),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_TARGET_EXISTS",
      );
      assert.deepEqual(fs.readFileSync(path.join(root, "owned", "nested", "value.bin")), Buffer.from([0, 255]));
      owned.releaseOwnership();
      assert.equal(session.close(), "completed");
      assert.deepEqual(
        fs.readdirSync(root).filter((name) => name.startsWith(".runtime-mutation-")),
        [],
      );
    });

    await scenario("public mutation rejects registered and existing case-fold collisions", () => {
      const root = path.join(sandbox, "case-collision");
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "case-collision",
      });
      const owned = session.createOwnedDirectory("owned");
      owned.writeFileExclusive("File.json", "first");
      assert.throws(
        () => owned.writeFileExclusive("file.json", "second"),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_PATH_INVALID",
      );
      fs.writeFileSync(path.join(owned.absolutePath, "Existing.json"), "existing");
      assert.throws(
        () => owned.writeFileExclusive("existing.json", "replacement"),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_PATH_INVALID",
      );
      assert.deepEqual(
        fs.readdirSync(owned.absolutePath).sort(),
        ["Existing.json", "File.json"],
      );
      assert.equal(owned.cleanup(), "completed");
      assert.equal(session.close(), "completed");
    });

    await scenario("public mutation enforces materialized path boundary", () => {
      const root = path.join(sandbox, "materialized-boundary");
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "materialized-boundary",
      });
      const owned = session.createOwnedDirectory("owned");
      const relativeLength = runtimePortablePathLimits.materializedPathUtf16 -
        owned.absolutePath.length - 1;
      const lastLength = 95;
      const firstLength = relativeLength - lastLength - 1;
      assert.ok(firstLength > 0 && firstLength <= runtimePortablePathLimits.projectSlugUtf16);
      const exact = `${"a".repeat(firstLength)}/${"b".repeat(lastLength)}`;
      assert.equal(path.resolve(owned.absolutePath, ...exact.split("/")).length, 240);
      owned.writeFileExclusive(exact, "boundary");
      assert.throws(
        () => owned.writeFileExclusive(`${exact}b`, "boundary-plus-one"),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_PATH_INVALID",
      );
      assert.equal(owned.cleanup(), "completed");
      assert.equal(session.close(), "completed");
    });

    await scenario("cleanup requires the original directory identity", () => {
      const root = path.join(sandbox, "cleanup-replacement");
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "cleanup-replacement",
      });
      const owned = session.createOwnedDirectory("owned");
      fs.renameSync(path.join(root, "owned"), path.join(root, "displaced"));
      fs.mkdirSync(path.join(root, "owned"));
      fs.writeFileSync(path.join(root, "owned", "valid-data"), "keep");
      assert.equal(owned.cleanup(), "ownership-mismatch");
      assert.equal(fs.readFileSync(path.join(root, "owned", "valid-data"), "utf8"), "keep");
      assert.equal(session.close(), "ownership-mismatch");
    });

    await scenario("cleanup requires the session ownership token", () => {
      const root = path.join(sandbox, "cleanup-token");
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "cleanup-token",
      });
      const owned = session.createOwnedDirectory("owned");
      const token = fs.readdirSync(root).find((name) => name.startsWith(".runtime-mutation-"));
      assert.ok(token);
      fs.writeFileSync(path.join(root, token), "replacement-token\n");
      assert.equal(owned.cleanup(), "ownership-mismatch");
      assert.equal(fs.existsSync(path.join(root, "owned")), true);
    });

    await scenario("deterministic parent link swap fails and removes transient outside file", () => {
      const root = path.join(sandbox, "guarded-link-swap");
      const outside = path.join(sandbox, "guarded-link-swap-outside");
      fs.mkdirSync(outside);
      const session = guardedForRoot(root).beginMutation({
        writableRoot: root,
        writableRole: "backup",
        operation: "link-swap",
      });
      const owned = session.createOwnedDirectory("owned");
      owned.ensureDirectory("nested");
      let linked = false;
      assert.throws(() => owned.writeFileExclusive("nested/value", "value", {
        beforeWrite(parent) {
          fs.renameSync(parent, `${parent}.displaced`);
          try {
            fs.symlinkSync(outside, parent, process.platform === "win32" ? "junction" : "dir");
            linked = true;
          } catch {
            // Unsupported link creation still leaves the operation fail-closed.
          }
        },
      }));
      if (!linked) recordUnsupportedSkip("guarded link-swap creation unsupported");
      else assert.deepEqual(fs.readdirSync(outside), []);
    });

    await scenario("real child processes contend at direct session begin", async () => {
      const root = path.join(sandbox, "concurrent-reservation");
      fs.mkdirSync(root);
      const startAt = String(Date.now() + 750);
      const [first, second] = await Promise.all([
        runChild("--reservation-child", root, startAt),
        runChild("--reservation-child", root, startAt),
      ]);
      assert.deepEqual([first, second].sort(), ["CONTENDED", "SUCCESS"]);
      assert.deepEqual(fs.readdirSync(root), []);
    });

    await scenario("reservation registry handles open close double release and replacement", () => {
      const openRoot = path.join(sandbox, "open-reservation");
      const openSession = guardedForRoot(openRoot).beginMutation({
        writableRoot: openRoot,
        writableRole: "backup",
        operation: "open-reservation",
      });
      const open = openSession.acquireExclusiveReservation("open.lock");
      assert.equal(openSession.close(), "open-reservation");
      assert.equal(open.release(), "not-required");
      assert.equal(openSession.close(), "not-required");
      assert.deepEqual(fs.readdirSync(openRoot), []);

      const replacementRoot = path.join(sandbox, "reservation-replacement");
      const replacementSession = guardedForRoot(replacementRoot).beginMutation({
        writableRoot: replacementRoot,
        writableRole: "backup",
        operation: "reservation-replacement",
      });
      const reservation = replacementSession.acquireExclusiveReservation("replace.lock");
      fs.renameSync(path.join(replacementRoot, "replace.lock"), path.join(replacementRoot, "displaced.lock"));
      fs.writeFileSync(path.join(replacementRoot, "replace.lock"), "replacement");
      assert.equal(reservation.release(), "ownership-mismatch");
      assert.equal(replacementSession.close(), "ownership-mismatch");
      assert.equal(fs.readFileSync(path.join(replacementRoot, "replace.lock"), "utf8"), "replacement");
    });

    await scenario("backup create and restore verify use the guarded foundation", () => {
      const result = createVerifiedRuntimeBackup({
        context,
        backupRoot,
        repositoryRoot: fixtureRepository,
      }, {
        backupId: () => "c2a-backup",
        now: () => "2026-07-16T12:00:00.000Z",
      });
      const restoreRoot = path.join(sandbox, "restore-explicit");
      fs.mkdirSync(restoreRoot);
      const report = restoreAndVerifyRuntimeBackup({
        context,
        backupDirectory: result.backupDirectory,
        restoreRoot,
        repositoryRoot: fixtureRepository,
        liveProjectsRoot: projectsRoot,
      });
      assert.equal(report.valid, true);
      assert.equal(report.aggregateFingerprint, result.manifest.aggregateFingerprint);
      assert.equal(fs.existsSync(path.join(restoreRoot, "projects", "project-a", "project.json")), true);
      assert.deepEqual(
        fs.readdirSync(restoreRoot).filter((name) => name.startsWith(".runtime-mutation-")),
        [],
      );
    });

    await scenario("mutation errors normalize platform and hook failures safely", () => {
      const secretPath = path.join(sandbox, "secret-value");
      for (const code of ["EPERM", "EACCES", "EIO", "ENOSPC"]) {
        const root = path.join(sandbox, `error-${code.toLowerCase()}`);
        const session = guardedForRoot(root).beginMutation({
          writableRoot: root,
          writableRole: "backup",
          operation: `error-${code.toLowerCase()}`,
        });
        const owned = session.createOwnedDirectory("owned");
        const raw = Object.assign(new Error(`${code} ${secretPath}`), { code });
        assert.throws(
          () => owned.writeFileExclusive("value", "value", { beforeWrite: () => { throw raw; } }),
          (error) => error instanceof RuntimeMutationError &&
            error.code === "RUNTIME_MUTATION_FAILED" &&
            error.message.includes(secretPath) === false &&
            error.cause === raw &&
            JSON.stringify(error).includes(secretPath) === false,
        );
        assert.equal(owned.cleanup(), "completed");
        assert.equal(session.close(), "completed");
      }
      const cleanupRoot = path.join(sandbox, "error-cleanup-status");
      const cleanupSession = guardedForRoot(cleanupRoot).beginMutation({
        writableRoot: cleanupRoot,
        writableRole: "backup",
        operation: "error-cleanup-status",
      });
      const cleanupOwned = cleanupSession.createOwnedDirectory("owned");
      const hookError = new Error(`hook ${secretPath}`);
      assert.throws(
        () => cleanupOwned.writeFileExclusive("value", "value", { afterWrite: () => { throw hookError; } }),
        (error) => error instanceof RuntimeMutationError &&
          error.code === "RUNTIME_MUTATION_FAILED" &&
          error.cleanupStatus === "completed" &&
          error.cause === hookError,
      );
      assert.equal(fs.existsSync(path.join(cleanupOwned.absolutePath, "value")), false);
      assert.equal(cleanupOwned.cleanup(), "completed");
      assert.equal(cleanupSession.close(), "completed");
    });

    await scenario("session lock preserves first cause and close cleanup metadata", () => {
      const root = path.join(sandbox, "lock-error-contract");
      const lockPath = path.join(root, ".runtime-mutation-lock-error.lock");
      const writeError = Object.assign(new Error(`write ${lockPath}`), { code: "EIO" });
      const closeError = Object.assign(new Error(`close ${lockPath}`), { code: "EIO" });
      const cleanupError = Object.assign(new Error(`cleanup ${lockPath}`), { code: "EACCES" });
      const originalOpen = fs.openSync;
      const originalWrite = fs.writeFileSync;
      const originalClose = fs.closeSync;
      const originalRemove = fs.rmSync;
      let lockDescriptor: number | undefined;
      Reflect.set(fs, "openSync", (...args: unknown[]) => {
        const descriptor = Reflect.apply(originalOpen, fs, args) as number;
        if (String(args[0]) === lockPath) lockDescriptor = descriptor;
        return descriptor;
      });
      Reflect.set(fs, "writeFileSync", (...args: unknown[]) => {
        if (args[0] === lockDescriptor) throw writeError;
        return Reflect.apply(originalWrite, fs, args);
      });
      Reflect.set(fs, "closeSync", (...args: unknown[]) => {
        if (args[0] === lockDescriptor) throw closeError;
        return Reflect.apply(originalClose, fs, args);
      });
      Reflect.set(fs, "rmSync", (...args: unknown[]) => {
        if (String(args[0]) === lockPath) throw cleanupError;
        return Reflect.apply(originalRemove, fs, args);
      });
      try {
        assert.throws(
          () => guardedForRoot(root).beginMutation({
            writableRoot: root,
            writableRole: "backup",
            operation: "lock-error",
          }),
          (error) => error instanceof RuntimeMutationError &&
            error.code === "RUNTIME_MUTATION_FAILED" &&
            error.cause === writeError &&
            error.closeStatus === "failed" &&
            error.cleanupStatus === "orphan-suspect" &&
            JSON.stringify(error).includes(lockPath) === false,
        );
      } finally {
        Reflect.set(fs, "openSync", originalOpen);
        Reflect.set(fs, "writeFileSync", originalWrite);
        Reflect.set(fs, "closeSync", originalClose);
        Reflect.set(fs, "rmSync", originalRemove);
        if (lockDescriptor !== undefined) originalClose(lockDescriptor);
        originalRemove(root, { recursive: true, force: true });
      }
    });
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  process.stdout.write(
    `Sprint 129.25C.2A guarded filesystem smoke: PASS (${scenarios} scenarios; skippedUnsupported=${skippedUnsupported}; hostileConcurrentIsolation=false)\n`,
  );
}

function guardedForRoot(root: string) {
  return new GuardedRuntimeFilesystem(
    new RuntimeProtectedRoots(completeProtectedInputs(root)),
  );
}

function completeProtectedInputs(
  backup: string,
  overrides: Partial<Record<"repository" | "runtime" | "live-projects" | "machine" | "authority" | "restore-verification", string>> = {},
) {
  const base = `${backup}-protected`;
  const runtime = overrides.runtime ?? `${base}-runtime`;
  return [
    { role: "repository" as const, path: overrides.repository ?? `${base}-repository` },
    { role: "runtime" as const, path: runtime },
    { role: "live-projects" as const, path: overrides["live-projects"] ?? path.join(runtime, "projects") },
    { role: "machine" as const, path: overrides.machine ?? `${base}-machine` },
    { role: "authority" as const, path: overrides.authority ?? `${base}-authority` },
    { role: "backup" as const, path: backup },
    { role: "restore-verification" as const, path: overrides["restore-verification"] ?? `${base}-restore` },
  ];
}

function initializeGitFixture(repository: string) {
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["add", "data/projects"], { cwd: repository });
  execFileSync(
    "git",
    ["-c", "user.name=Atolye Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"],
    { cwd: repository },
  );
}

async function reservationChild(arguments_: string[]) {
  const [root, startAtRaw] = arguments_;
  if (!root || !startAtRaw) process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(startAtRaw) - Date.now())));
  try {
    const session = guardedForRoot(root).beginMutation({
      writableRoot: root,
      writableRole: "backup",
      operation: "reservation-child",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(session.close(), "completed");
    process.stdout.write("SUCCESS\n");
  } catch (error) {
    if (error instanceof RuntimeMutationError && error.code === "RUNTIME_MUTATION_TARGET_EXISTS") {
      process.stdout.write("CONTENDED\n");
      return;
    }
    throw error;
  }
}

async function publishChild(arguments_: string[]) {
  const [root, startAtRaw] = arguments_;
  if (!root || !startAtRaw) process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(startAtRaw) - Date.now())));
  try {
    fs.copyFileSync(
      path.join(root, "source"),
      path.join(root, "destination"),
      fs.constants.COPYFILE_EXCL,
    );
    process.stdout.write("SUCCESS\n");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
      process.stdout.write("CONTENDED\n");
      return;
    }
    throw error;
  }
}

function runChild(mode: "--reservation-child" | "--publish-child", root: string, startAt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", import.meta.filename, mode, root, startAt],
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
      if (code !== 0) reject(new Error(`Reservation child failed: ${stderr.trim()}`));
      else resolve(stdout.trim());
    });
  });
}

function recordUnsupportedSkip(reason: string) {
  skippedUnsupported += 1;
  process.stdout.write(`SKIP-UNSUPPORTED ${reason}\n`);
}

function isPermissionOrUnsupported(error: unknown) {
  return error instanceof Error && "code" in error &&
    ["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(
      (error as NodeJS.ErrnoException).code ?? "",
    );
}

void main();
