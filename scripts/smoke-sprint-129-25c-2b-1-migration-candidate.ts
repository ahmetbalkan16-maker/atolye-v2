import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  aggregateRuntimeFileRecords,
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import {
  buildRuntimeMigrationCandidateManifest,
  runtimeMigrationCandidateId,
  runtimeMigrationCandidateManifestSha256,
  serializeRuntimeMigrationCandidateManifest,
  validateRuntimeMigrationCandidateManifest,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateError";
import { isUnsupportedNetworkCandidateRoot, planMigrationCandidatePaths } from "../src/lib/runtime/migration/RuntimeMigrationCandidatePaths";
import {
  classifyWindowsDriveTypeEvidence,
  preflightRuntimeMigrationCandidate,
  readWindowsDriveTypeEvidence,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidatePreflight";
import { verifyMigrationCandidate, verifyMigrationCandidateBinding } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import { runtimePortablePathLimits } from "../src/lib/runtime/security/RuntimePathPolicy";

const stamp = "2026-07-16T12:00:00.000Z";
let scenarios = 0;
const platformResults: Array<{ name: string; result: "PASS" | "SKIP_UNSUPPORTED" }> = [];
type MutableCandidate = {
  candidateAggregate: string;
  markerBindings: Array<{ relativePath: string; sha256: string }>;
  durableExecutionBinding: { files: number; bytes: number; aggregateFingerprint: string };
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    classification: string;
    [key: string]: unknown;
  }>;
  capabilitySummary: Record<string, unknown>;
  [key: string]: unknown;
};

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  void name;
}

function expectCode(code: string, run: () => unknown) {
  assert.throws(run, (error: unknown) => error instanceof RuntimeMigrationCandidateError && error.code === code);
}

function writeJsonFile(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function treeSnapshot(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      result.push(`${entry.isDirectory() ? "d" : "f"}:${relative}:${entry.isFile() ? fs.statSync(target).size : 0}`);
      if (entry.isDirectory()) walk(target);
    }
  };
  walk(root);
  return result;
}

function mutateManifest(directory: string, mutate: (value: MutableCandidate) => void) {
  const manifestPath = path.join(directory, "candidate.json");
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as MutableCandidate;
  mutate(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(manifestPath, serialized);
  fs.writeFileSync(path.join(directory, "candidate.sha256"), `${runtimeMigrationCandidateManifestSha256(serialized)}\n`);
}

function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-c2b1-"));
  try {
    const repositoryRoot = path.join(sandbox, "repository");
    const runtimeRoot = path.join(repositoryRoot, "data");
    const projectsRoot = path.join(runtimeRoot, "projects");
    const projectRoot = path.join(projectsRoot, "project-a");
    const authorityRoot = path.join(sandbox, "authority");
    const backupRoot = path.join(sandbox, "backups");
    const backupDirectory = path.join(backupRoot, "backup-1");
    const candidateRoot = path.join(sandbox, "candidates-root");
    const restoreRoot = path.join(sandbox, "restore-verification");
    for (const directory of [projectRoot, authorityRoot, backupRoot, candidateRoot, restoreRoot]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.mkdirSync(path.join(projectRoot, "production-execution", "attempts"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "assets", "images"), { recursive: true });
    writeJsonFile(path.join(projectRoot, "project.json"), { slug: "project-a" });
    writeJsonFile(path.join(projectRoot, "production-acceptance.json"), { schemaVersion: "2", accepted: true });
    writeJsonFile(path.join(projectRoot, "production-execution", "attempts", "attempt-1.json"), { state: "succeeded" });
    fs.writeFileSync(path.join(projectRoot, "assets", "images", "image.bin"), Buffer.from([0, 1, 2, 255]));
    execFileSync("git", ["init"], { cwd: repositoryRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repositoryRoot });
    execFileSync("git", ["add", "data/projects"], { cwd: repositoryRoot });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: repositoryRoot, stdio: "ignore" });
    const context = createRuntimeStorageContext({
      workspaceRoot: repositoryRoot,
      environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
      authorityRoot,
    });
    const backupManifest = collectRuntimeBackupInventory({ context, repositoryRoot, now: () => stamp });
    fs.mkdirSync(path.join(backupDirectory, "payload"), { recursive: true });
    fs.cpSync(projectsRoot, path.join(backupDirectory, "payload", "projects"), { recursive: true });
    const backupSerialized = serializeRuntimeBackupManifest(backupManifest);
    fs.writeFileSync(path.join(backupDirectory, "manifest.json"), backupSerialized, { flag: "wx" });
    fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"), `${runtimeBackupManifestSha256(backupSerialized)}\n`, { flag: "wx" });
    const backup = verifyRuntimeBackup(backupDirectory);
    const markers = backup.manifest.files.filter((file) => file.classification === "acceptance-marker")
      .map((file) => ({ relativePath: file.relativePath, sha256: file.sha256 }));
    const durable = backup.manifest.files.filter((file) => file.classification === "durable-execution");
    const manifest = buildRuntimeMigrationCandidateManifest({
      backupId: "backup-1",
      backup,
      createdAt: stamp,
      sourceRuntimeEvidence: {
        aggregateFingerprint: backup.aggregateFingerprint,
        markerBindings: markers,
        durableExecutionAggregate: aggregateRuntimeFileRecords(durable),
      },
      capabilitySummary: {
        contractVersion: "migration-candidate-capability-v1",
        destinationClass: "test-temp",
        filesystemKind: "test-fixture",
        hostileConcurrentIsolation: false,
        activeProbePerformed: false,
      },
      gitEvidence: {
        headCommit: backup.manifest.sourceHeadCommit,
        worktreeProjectsClean: true,
        authority: "informational-only",
      },
      operationEvidence: { mode: "preflight-contract", mutationPerformed: false, productionCalls: 0 },
    });
    const candidateDirectory = path.join(candidateRoot, "candidates", manifest.candidateId);
    fs.mkdirSync(path.join(candidateDirectory, "payload"), { recursive: true });
    fs.cpSync(path.join(backupDirectory, "payload", "projects"), path.join(candidateDirectory, "payload", "projects"), { recursive: true });
    const serialized = serializeRuntimeMigrationCandidateManifest(manifest);
    fs.writeFileSync(path.join(candidateDirectory, "candidate.json"), serialized, { flag: "wx" });
    fs.writeFileSync(path.join(candidateDirectory, "candidate.sha256"), `${runtimeMigrationCandidateManifestSha256(serialized)}\n`, { flag: "wx" });

    scenario("verified backup required", () => expectCode("BACKUP_REQUIRED", () => preflightRuntimeMigrationCandidate({
      context, repositoryRoot, backupRoot, backupDirectory: "", candidateRoot, restoreVerificationRoot: restoreRoot,
    })));
    scenario("tampered backup rejected", () => {
      const invalid = path.join(backupRoot, "invalid-backup");
      fs.cpSync(backupDirectory, invalid, { recursive: true });
      fs.appendFileSync(path.join(invalid, "manifest.json"), " ");
      expectCode("BACKUP_INVALID", () => preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory: invalid, candidateRoot,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
      }));
    });
    scenario("deterministic candidate ID", () => {
      const input = { sourceBackupManifestSha256: backup.manifestSha256, sourceBackupAggregate: backup.aggregateFingerprint };
      assert.equal(runtimeMigrationCandidateId(input), runtimeMigrationCandidateId(input));
      assert.equal(runtimeMigrationCandidateId(input), manifest.candidateId);
    });
    scenario("canonical manifest", () => {
      assert.equal(JSON.stringify(JSON.parse(serialized), null, 2) + "\n", serialized);
      validateRuntimeMigrationCandidateManifest(JSON.parse(serialized));
    });
    scenario("unknown top-level manifest key rejected", () => {
      const value = JSON.parse(serialized) as MutableCandidate;
      value.unknownTopLevel = true;
      expectCode("CANDIDATE_INVALID", () => validateRuntimeMigrationCandidateManifest(value));
    });
    scenario("unknown nested manifest key rejected", () => {
      const value = JSON.parse(serialized) as MutableCandidate;
      value.capabilitySummary.unknownNested = true;
      expectCode("CANDIDATE_INVALID", () => validateRuntimeMigrationCandidateManifest(value));
    });
    scenario("semantic property order has one canonical serialization and digest", () => {
      const value = JSON.parse(serialized) as Record<string, unknown>;
      const { verificationStatus, ...rest } = value;
      const reordered = { verificationStatus, ...rest };
      const canonical = serializeRuntimeMigrationCandidateManifest(reordered as typeof manifest);
      assert.equal(canonical, serialized);
      assert.equal(
        runtimeMigrationCandidateManifestSha256(canonical),
        runtimeMigrationCandidateManifestSha256(serialized),
      );
    });
    scenario("exact candidate and backup binding", () => {
      assert.equal(verifyMigrationCandidate(candidateDirectory).valid, true);
      assert.equal(verifyMigrationCandidateBinding(candidateDirectory, backupDirectory).valid, true);
    });
    scenario("renamed byte-identical backup does not satisfy binding", () => {
      const renamed = path.join(backupRoot, "renamed-backup");
      fs.cpSync(backupDirectory, renamed, { recursive: true });
      expectCode("BACKUP_INVALID", () => verifyMigrationCandidateBinding(candidateDirectory, renamed));
    });
    scenario("partial backup does not satisfy binding", () => {
      const partial = path.join(backupRoot, "backup-1.partial");
      fs.cpSync(backupDirectory, partial, { recursive: true });
      expectCode("BACKUP_INVALID", () => verifyMigrationCandidateBinding(candidateDirectory, partial));
    });
    scenario("preflight rejects backup outside declared root", () => {
      const outsideRoot = path.join(sandbox, "outside-backups");
      const outside = path.join(outsideRoot, "backup-1");
      fs.mkdirSync(outsideRoot);
      fs.cpSync(backupDirectory, outside, { recursive: true });
      expectCode("BACKUP_INVALID", () => preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory: outside, candidateRoot,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      }));
    });
    scenario("candidate below actual backup directory is rejected", () => {
      const nestedCandidateRoot = path.join(backupDirectory, "candidate-root");
      fs.mkdirSync(nestedCandidateRoot);
      try {
        expectCode("DESTINATION_INVALID", () => preflightRuntimeMigrationCandidate({
          context, repositoryRoot, backupRoot, backupDirectory, candidateRoot: nestedCandidateRoot,
          restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
        }));
      } finally {
        fs.rmdirSync(nestedCandidateRoot);
      }
    });
    scenario("candidate above actual backup directory is rejected", () => {
      expectCode("DESTINATION_INVALID", () => preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory, candidateRoot: sandbox,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      }));
    });
    scenario("backup sibling prefix is not an overlap", () => {
      const sibling = path.join(sandbox, "backups-copy");
      fs.mkdirSync(sibling);
      const report = preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory, candidateRoot: sibling,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      });
      assert.equal(report.status, "preflight-ready");
    });
    scenario("preflight rejects payload materialization beyond the path limit", () => {
      const base = path.join(sandbox, "long-root");
      const baseCandidateLength = path.resolve(base, "candidates", manifest.candidateId).length;
      const padding = Math.max(0, runtimePortablePathLimits.materializedPathUtf16 - 5 - baseCandidateLength);
      const longRoot = path.join(sandbox, `long-root${"x".repeat(padding)}`);
      fs.mkdirSync(longRoot);
      assert.ok(path.resolve(longRoot, "candidates", manifest.candidateId).length <=
        runtimePortablePathLimits.materializedPathUtf16);
      expectCode("PATH_POLICY_VIOLATION", () => preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory, candidateRoot: longRoot,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      }));
    });
    scenario("materialized verifier boundary passes and one character over fails", () => {
      const longest = [...manifest.files].sort((left, right) =>
        right.relativePath.length - left.relativePath.length)[0];
      assert.ok(longest);
      const baseParent = path.join(sandbox, "b");
      const baseCandidate = path.join(baseParent, manifest.candidateId);
      const baseMaximum = Math.max(...manifest.files.map((file) =>
        path.resolve(baseCandidate, "payload", "projects", ...file.relativePath.split("/")).length));
      const padding = runtimePortablePathLimits.materializedPathUtf16 - baseMaximum;
      assert.ok(padding >= 0);
      const boundaryParent = path.join(sandbox, `b${"x".repeat(padding)}`);
      const boundaryCandidate = path.join(boundaryParent, manifest.candidateId);
      fs.mkdirSync(boundaryParent);
      fs.cpSync(candidateDirectory, boundaryCandidate, { recursive: true });
      const boundaryMaximum = Math.max(...manifest.files.map((file) =>
        path.resolve(boundaryCandidate, "payload", "projects", ...file.relativePath.split("/")).length));
      assert.equal(boundaryMaximum, runtimePortablePathLimits.materializedPathUtf16);
      assert.equal(verifyMigrationCandidate(boundaryCandidate).valid, true);

      const overParent = path.join(sandbox, `b${"x".repeat(padding + 1)}`);
      const overCandidate = path.join(overParent, manifest.candidateId);
      fs.mkdirSync(overParent);
      fs.cpSync(candidateDirectory, overCandidate, { recursive: true });
      expectCode("PATH_POLICY_VIOLATION", () => verifyMigrationCandidate(overCandidate));
    });

    const negative = (name: string, mutate: (directory: string) => void, code: string) => scenario(name, () => {
      const directory = path.join(sandbox, "negative", name, manifest.candidateId);
      fs.mkdirSync(path.dirname(directory), { recursive: true });
      fs.cpSync(candidateDirectory, directory, { recursive: true });
      mutate(directory);
      expectCode(code, () => verifyMigrationCandidate(directory));
    });
    negative("digest-tamper", (directory) => fs.writeFileSync(path.join(directory, "candidate.sha256"), `${"0".repeat(64)}\n`), "CANDIDATE_DIGEST_MISMATCH");
    negative("root-extra-entry", (directory) => fs.writeFileSync(path.join(directory, "extra"), "x"), "CANDIDATE_INVALID");
    negative("payload-extra-entry", (directory) => fs.writeFileSync(path.join(directory, "payload", "extra"), "x"), "CANDIDATE_INVALID");
    negative("noncanonical-key-order", (directory) => {
      const manifestPath = path.join(directory, "candidate.json");
      const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      const reordered = { verificationStatus: value.verificationStatus, ...value };
      const noncanonical = `${JSON.stringify(reordered, null, 2)}\n`;
      fs.writeFileSync(manifestPath, noncanonical);
      fs.writeFileSync(path.join(directory, "candidate.sha256"), `${runtimeMigrationCandidateManifestSha256(noncanonical)}\n`);
    }, "CANDIDATE_INVALID");
    negative("missing-file", (directory) => fs.unlinkSync(path.join(directory, "payload", "projects", "project-a", "project.json")), "INVENTORY_MISMATCH");
    negative("extra-file", (directory) => fs.writeFileSync(path.join(directory, "payload", "projects", "project-a", "extra.json"), "{}"), "INVENTORY_MISMATCH");
    negative("modified-file", (directory) => fs.appendFileSync(path.join(directory, "payload", "projects", "project-a", "project.json"), "x"), "INVENTORY_MISMATCH");
    negative("same-size-byte-mutation", (directory) => {
      const file = path.join(directory, "payload", "projects", "project-a", "project.json");
      const bytes = fs.readFileSync(file);
      bytes[0] = bytes[0] === 0x7b ? 0x5b : 0x7b;
      fs.writeFileSync(file, bytes);
    }, "INVENTORY_MISMATCH");
    negative("explicit-size-mismatch", (directory) => {
      const file = path.join(directory, "payload", "projects", "project-a", "project.json");
      const bytes = fs.readFileSync(file);
      fs.writeFileSync(file, bytes.subarray(0, bytes.length - 1));
    }, "INVENTORY_MISMATCH");
    negative("aggregate-mismatch", (directory) => mutateManifest(directory, (value) => { value.candidateAggregate = "0".repeat(64); }), "AGGREGATE_MISMATCH");
    negative("classification-mismatch", (directory) => mutateManifest(directory, (value) => {
      value.files[0].classification = value.files[0].classification === "project-metadata"
        ? "other-runtime"
        : "project-metadata";
    }), "CANDIDATE_INVALID");
    negative("marker-mismatch", (directory) => mutateManifest(directory, (value) => { value.markerBindings[0].sha256 = "0".repeat(64); }), "CRITICAL_STATE_MISMATCH");
    negative("marker-missing", (directory) => mutateManifest(directory, (value) => { value.markerBindings = []; }), "CRITICAL_STATE_MISMATCH");
    negative("marker-extra", (directory) => mutateManifest(directory, (value) => {
      value.markerBindings.push({
        relativePath: "project-a/production-acceptance-extra.json",
        sha256: "0".repeat(64),
      });
      value.markerBindings.sort((left, right) =>
        left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
    }), "CRITICAL_STATE_MISMATCH");
    negative("durable-mismatch", (directory) => mutateManifest(directory, (value) => { value.durableExecutionBinding.files += 1; }), "CRITICAL_STATE_MISMATCH");
    negative("durable-missing", (directory) => mutateManifest(directory, (value) => { value.durableExecutionBinding.files -= 1; }), "CRITICAL_STATE_MISMATCH");
    negative("durable-hash-modified", (directory) => mutateManifest(directory, (value) => {
      value.durableExecutionBinding.aggregateFingerprint = "0".repeat(64);
    }), "CRITICAL_STATE_MISMATCH");
    scenario("case-fold collision", () => {
      const value = JSON.parse(serialized) as MutableCandidate;
      value.files.push({ ...value.files[0], relativePath: value.files[0].relativePath.toUpperCase() });
      value.files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
      expectCode("CANDIDATE_INVALID", () => validateRuntimeMigrationCandidateManifest(value));
    });
    scenario("non-portable path", () => {
      const value = JSON.parse(serialized) as MutableCandidate;
      value.files[0].relativePath = "project-a/con:file.json";
      expectCode("CANDIDATE_INVALID", () => validateRuntimeMigrationCandidateManifest(value));
    });
    negative("extra-empty-directory", (directory) => fs.mkdirSync(path.join(directory, "payload", "projects", "project-a", "empty")), "INVENTORY_MISMATCH");
    scenario("partial candidate rejected", () => {
      const partial = path.join(sandbox, "partial", `${manifest.candidateId}.partial`);
      fs.mkdirSync(path.dirname(partial), { recursive: true });
      fs.cpSync(candidateDirectory, partial, { recursive: true });
      expectCode("CANDIDATE_INVALID", () => verifyMigrationCandidate(partial));
    });
    scenario("protected root destination", () => expectCode("DESTINATION_INVALID", () => planMigrationCandidatePaths({
      candidateId: manifest.candidateId, candidateRoot: repositoryRoot, context, repositoryRoot,
      backupRoot, backupDirectory, restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
    })));
    scenario("backup overlap destination", () => expectCode("DESTINATION_INVALID", () => planMigrationCandidatePaths({
      candidateId: manifest.candidateId, candidateRoot: backupRoot, context, repositoryRoot,
      backupRoot, backupDirectory, restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
    })));
    scenario("protected root ancestor and descendant are rejected", () => {
      expectCode("DESTINATION_INVALID", () => planMigrationCandidatePaths({
        candidateId: manifest.candidateId, candidateRoot: sandbox, context, repositoryRoot,
        backupRoot, backupDirectory, restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
      }));
      const descendant = path.join(repositoryRoot, "candidate-destination");
      fs.mkdirSync(descendant);
      try {
        expectCode("DESTINATION_INVALID", () => planMigrationCandidatePaths({
          candidateId: manifest.candidateId, candidateRoot: descendant, context, repositoryRoot,
          backupRoot, backupDirectory, restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
        }));
      } finally {
        fs.rmdirSync(descendant);
      }
    });
    scenario("protected root sibling prefix is accepted", () => {
      const sibling = path.join(sandbox, "repository-copy");
      fs.mkdirSync(sibling);
      const plan = planMigrationCandidatePaths({
        candidateId: manifest.candidateId, candidateRoot: sibling, context, repositoryRoot,
        backupRoot, backupDirectory, restoreVerificationRoot: restoreRoot, allowTestTempRoot: true,
      });
      assert.equal(plan.candidateRoot, fs.realpathSync(sibling));
    });
    scenario("Windows drive type evidence is fail closed", () => {
      assert.equal(classifyWindowsDriveTypeEvidence("Fixed", "win32-0"), "local-persistent");
      for (const unsupported of [
        "Network", "Removable", "CDRom", "Ram", "NoRootDirectory", "Unknown", "", "invalid", undefined,
      ]) {
        expectCode("CAPABILITY_UNSUPPORTED", () =>
          classifyWindowsDriveTypeEvidence(unsupported, "win32-0"));
      }
    });
    scenario("Windows fixed drive query is read only", () => {
      if (process.platform === "win32") {
        assert.equal(readWindowsDriveTypeEvidence(repositoryRoot), "Fixed");
        platformResults.push({ name: "windows-fixed-drive", result: "PASS" });
      } else {
        platformResults.push({ name: "windows-fixed-drive", result: "SKIP_UNSUPPORTED" });
      }
    });
    scenario("network UNC classifier", () => {
      assert.equal(isUnsupportedNetworkCandidateRoot("\\\\server\\share\\candidate"), true);
      platformResults.push({ name: "network-unc", result: process.platform === "win32" ? "PASS" : "SKIP_UNSUPPORTED" });
    });
    scenario("symlink rejection where supported", () => {
      const directory = path.join(sandbox, "negative", "symlink", manifest.candidateId);
      fs.mkdirSync(path.dirname(directory), { recursive: true });
      fs.cpSync(candidateDirectory, directory, { recursive: true });
      const link = path.join(directory, "payload", "projects", "project-a", "link");
      try {
        fs.symlinkSync(path.join(directory, "payload", "projects", "project-a", "project.json"), link, "file");
        expectCode("UNSUPPORTED_FILE_TYPE", () => verifyMigrationCandidate(directory));
        platformResults.push({ name: "symlink", result: "PASS" });
      } catch (error) {
        if (fs.existsSync(link)) throw error;
        platformResults.push({ name: "symlink", result: "SKIP_UNSUPPORTED" });
      }
    });
    scenario("preflight is read-only", () => {
      const before = treeSnapshot(sandbox);
      const report = preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory, candidateRoot,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      });
      assert.equal(report.cutoverAuthorized, false);
      assert.equal(report.productionCalls, 0);
      assert.equal(report.activeCapabilityProbePerformed, false);
      assert.deepEqual(treeSnapshot(sandbox), before);
    });
    scenario("HEAD drift makes the verified backup stale", () => {
      fs.writeFileSync(path.join(repositoryRoot, "README.md"), "fixture head drift\n", { flag: "wx" });
      execFileSync("git", ["add", "README.md"], { cwd: repositoryRoot });
      execFileSync("git", ["commit", "-m", "head drift"], { cwd: repositoryRoot, stdio: "ignore" });
      expectCode("SOURCE_STALE", () => preflightRuntimeMigrationCandidate({
        context, repositoryRoot, backupRoot, backupDirectory, candidateRoot,
        restoreVerificationRoot: restoreRoot, allowTestTempRoot: true, now: () => stamp,
      }));
    });
    scenario("production boundary source audit", () => {
      const files = [
        "src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts",
        "src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts",
        "src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts",
      ];
      const source = files.map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
      assert.doesNotMatch(source, /ProductionReadinessService|RuntimeMigrationCandidateService|provider|worker|stage.?dispatch|executeProduction|resumeProduction/i);
      assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), files[0]), "utf8"), /writeFile|mkdir|rmSync|rename|copyFile|openSync/i);
    });
    assert.equal(platformResults.some((item) => item.result === "PASS"), true);
    console.log(JSON.stringify({
      sprint: "129.25C.2B.1",
      status: "PASS",
      scenarios,
      platformResults,
      cutoverAuthorized: false,
      productionCalls: 0,
      liveRuntimeWrites: 0,
      candidateCreates: 0,
      backupCreates: 0,
    }));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();
