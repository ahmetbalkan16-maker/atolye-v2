import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ProductionExecutionGateway } from "../src/lib/production/ProductionExecutionGateway";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { RuntimeMigrationCandidateError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateError";
import {
  runtimeMigrationCandidateId,
  runtimeMigrationCandidateIdentitySha256,
  runtimeMigrationCandidateManifestSha256,
  type RuntimeMigrationCandidateManifest,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateManifest";
import {
  RuntimeMigrationCandidateService,
  type RuntimeMigrationCandidateCreateRequest,
  type RuntimeMigrationCandidateCreateDependencies,
  type RuntimeMigrationCandidateMutationEvent,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateService";
import { verifyMigrationCandidate } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";

const stamp = "2026-07-16T12:00:00.000Z";
let scenarios = 0;
const platformResults: Array<{ name: string; result: "PASS" | "SKIP_UNSUPPORTED" }> = [];
let happyCounters: InstrumentedCounters | undefined;
let reuseCounters: InstrumentedCounters | undefined;

interface Fixture {
  readonly sandbox: string;
  readonly repositoryRoot: string;
  readonly projectRoot: string;
  readonly backupRoot: string;
  readonly backupDirectory: string;
  readonly candidateRoot: string;
  readonly request: RuntimeMigrationCandidateCreateRequest;
  readonly candidateId: string;
  readonly candidateDirectory: string;
}

interface InstrumentedCounters {
  readonly events: Record<RuntimeMigrationCandidateMutationEvent, number>;
  candidateRootMutations: number;
  liveRuntimeWrites: number;
  backupWrites: number;
  productionBoundaryCalls: number;
}

function scenario(name: string, run: () => void) {
  const fixture = createFixture();
  try {
    try {
      runWithFixture(run, fixture);
    } catch (error) {
      throw new Error(`Scenario failed: ${name}`, { cause: error });
    }
    scenarios += 1;
    void name;
  } finally {
    fs.rmSync(fixture.sandbox, { recursive: true, force: true });
  }
}

function runWithFixture(run: () => void, fixture: Fixture) {
  activeFixture = fixture;
  try { run(); } finally { activeFixture = undefined; }
}

let activeFixture: Fixture | undefined;
function current() {
  if (!activeFixture) throw new Error("Fixture is unavailable.");
  return activeFixture;
}

function expectCode(code: string, run: () => unknown) {
  assert.throws(run, (error: unknown) =>
    error instanceof RuntimeMigrationCandidateError && error.code === code);
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function createFixture(): Fixture {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-c2b2-"));
  const repositoryRoot = path.join(sandbox, "repository");
  const runtimeRoot = path.join(repositoryRoot, "data");
  const projectsRoot = path.join(runtimeRoot, "projects");
  const projectRoot = path.join(projectsRoot, "project-a");
  const authorityRoot = path.join(sandbox, "authority");
  const backupRoot = path.join(sandbox, "backup-root");
  const backupDirectory = path.join(backupRoot, "backup-1");
  const candidateRoot = path.join(sandbox, "candidate-root");
  const restoreVerificationRoot = path.join(sandbox, "restore-verification");
  for (const directory of [
    projectRoot, authorityRoot, backupRoot, candidateRoot, restoreVerificationRoot,
  ]) fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "production-execution", "attempts"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "assets", "images"), { recursive: true });
  writeJson(path.join(projectRoot, "project.json"), { slug: "project-a" });
  writeJson(path.join(projectRoot, "production-acceptance.json"), {
    schemaVersion: "2", accepted: true,
  });
  writeJson(path.join(projectRoot, "production-execution", "attempts", "attempt-1.json"), {
    state: "succeeded",
  });
  fs.writeFileSync(path.join(projectRoot, "assets", "images", "image.bin"),
    Buffer.from([0, 1, 2, 255]));
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
  const backupManifest = collectRuntimeBackupInventory({
    context, repositoryRoot, now: () => stamp,
  });
  fs.mkdirSync(path.join(backupDirectory, "payload"), { recursive: true });
  fs.cpSync(projectsRoot, path.join(backupDirectory, "payload", "projects"), { recursive: true });
  const serialized = serializeRuntimeBackupManifest(backupManifest);
  fs.writeFileSync(path.join(backupDirectory, "manifest.json"), serialized, { flag: "wx" });
  fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"),
    `${runtimeBackupManifestSha256(serialized)}\n`, { flag: "wx" });
  const backup = verifyRuntimeBackup(backupDirectory);
  const candidateId = runtimeMigrationCandidateId({
    sourceBackupManifestSha256: backup.manifestSha256,
    sourceBackupAggregate: backup.aggregateFingerprint,
  });
  const request: RuntimeMigrationCandidateCreateRequest = {
    context,
    repositoryRoot,
    backupRoot,
    backupDirectory,
    candidateRoot,
    restoreVerificationRoot,
    confirmCandidateCreation: true,
    allowTestTempRoot: true,
  };
  return {
    sandbox,
    repositoryRoot,
    projectRoot,
    backupRoot,
    backupDirectory,
    candidateRoot,
    request,
    candidateId,
    candidateDirectory: path.join(candidateRoot, "candidates", candidateId),
  };
}

function createCandidate(
  fixture = current(),
  dependencies: RuntimeMigrationCandidateCreateDependencies = {},
) {
  return RuntimeMigrationCandidateService.createVerifiedMigrationCandidate(
    fixture.request,
    {
      now: () => stamp,
      randomId: () => "12345678-1234-1234-1234-123456789abc",
      ...dependencies,
    },
  );
}

function instrumentedCreate(
  fixture = current(),
  dependencies: RuntimeMigrationCandidateCreateDependencies = {},
) {
  const counters = createCounters();
  const result = withProductionBoundarySpy(counters, () =>
    withRootMutationSpy(fixture, counters, () =>
      createCandidate(fixture, {
        ...dependencies,
        observeMutation: (event) => {
          counters.events[event] += 1;
          dependencies.observeMutation?.(event);
        },
      })));
  return { result, counters };
}

function instrumentedFailure(
  fixture: Fixture,
  dependencies: RuntimeMigrationCandidateCreateDependencies,
  verify: (run: () => unknown) => void,
) {
  const counters = createCounters();
  withProductionBoundarySpy(counters, () =>
    withRootMutationSpy(fixture, counters, () => verify(() =>
      createCandidate(fixture, {
        ...dependencies,
        observeMutation: (event) => { counters.events[event] += 1; },
      }))));
  return counters;
}

function expectSafeCode(code: string, secret: string, run: () => unknown) {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  assert.ok(caught instanceof RuntimeMigrationCandidateError);
  assert.equal(caught.code, code);
  const publicError = JSON.stringify(caught);
  assert.equal(publicError.includes(secret), false);
  assert.equal(publicError.includes(os.userInfo().username), false);
  assert.equal(/[A-Za-z]:[\\/]/.test(publicError), false);
  assert.equal(/ENOENT|EACCES|syscall|errno|stack/i.test(publicError), false);
  assert.equal(caught.stack, undefined);
}

function rewriteCandidateManifest(
  fixture: Fixture,
  change: (manifest: RuntimeMigrationCandidateManifest) => void,
) {
  const manifestPath = path.join(fixture.candidateDirectory, "candidate.json");
  const digestPath = path.join(fixture.candidateDirectory, "candidate.sha256");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as
    RuntimeMigrationCandidateManifest;
  change(manifest);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, serialized);
  fs.writeFileSync(digestPath, `${runtimeMigrationCandidateManifestSha256(serialized)}\n`);
}

function createCounters(): InstrumentedCounters {
  return {
    events: {
      "session-begin": 0,
      "partial-create": 0,
      "payload-copy": 0,
      "manifest-write": 0,
      "digest-write": 0,
      "publish-reservation-acquire": 0,
      "final-create": 0,
      "final-publish": 0,
      "partial-cleanup": 0,
      "final-release": 0,
      "publish-reservation-release": 0,
      "session-close": 0,
    },
    candidateRootMutations: 0,
    liveRuntimeWrites: 0,
    backupWrites: 0,
    productionBoundaryCalls: 0,
  };
}

function withProductionBoundarySpy<T>(counters: InstrumentedCounters, run: () => T): T {
  const original = ProductionExecutionGateway.execute;
  ProductionExecutionGateway.execute = (() => {
    counters.productionBoundaryCalls += 1;
    return original();
  }) as typeof ProductionExecutionGateway.execute;
  try {
    return run();
  } finally {
    ProductionExecutionGateway.execute = original;
  }
}

type MutableFs = Record<string, unknown>;

function withRootMutationSpy<T>(fixture: Fixture, counters: InstrumentedCounters, run: () => T): T {
  const mutableFs = fs as unknown as MutableFs;
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  const descriptorRoots = new Map<number, unknown>();
  const classify = (target: unknown) => {
    if (typeof target !== "string") {
      if (typeof target === "number") classify(descriptorRoots.get(target));
      return;
    }
    const absolute = path.resolve(target);
    if (isWithin(fixture.candidateRoot, absolute)) counters.candidateRootMutations += 1;
    if (isWithin(path.dirname(fixture.projectRoot), absolute)) counters.liveRuntimeWrites += 1;
    if (isWithin(fixture.backupRoot, absolute)) counters.backupWrites += 1;
  };
  const wrap = (
    name: string,
    targets: (args: readonly unknown[]) => readonly unknown[],
    after?: (args: readonly unknown[], result: unknown) => void,
  ) => {
    const original = mutableFs[name] as (...args: unknown[]) => unknown;
    originals.set(name, original);
    mutableFs[name] = (...args: unknown[]) => {
      for (const target of targets(args)) classify(target);
      const result = Reflect.apply(original, fs, args);
      after?.(args, result);
      return result;
    };
  };
  wrap("mkdirSync", (args) => [args[0]]);
  wrap("openSync", (args) => isWriteFlag(args[1]) ? [args[0]] : [],
    (args, result) => { if (typeof result === "number") descriptorRoots.set(result, args[0]); });
  wrap("closeSync", () => [], (args) => {
    if (typeof args[0] === "number") descriptorRoots.delete(args[0]);
  });
  wrap("writeFileSync", (args) => [args[0]]);
  wrap("appendFileSync", (args) => [args[0]]);
  wrap("copyFileSync", (args) => [args[1]]);
  wrap("cpSync", (args) => [args[1]]);
  wrap("linkSync", (args) => [args[1]]);
  wrap("symlinkSync", (args) => [args[1]]);
  wrap("renameSync", (args) => [args[0], args[1]]);
  wrap("rmSync", (args) => [args[0]]);
  wrap("unlinkSync", (args) => [args[0]]);
  wrap("chmodSync", (args) => [args[0]]);
  try {
    return run();
  } finally {
    for (const [name, original] of originals) mutableFs[name] = original;
  }
}

function isWithin(root: string, target: string) {
  const relative = path.relative(path.resolve(root), target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isWriteFlag(flag: unknown) {
  return typeof flag === "number"
    ? (flag & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0
    : typeof flag === "string" && /[wax+]/.test(flag);
}

function assertNoMutations(counters: InstrumentedCounters) {
  assert.equal(counters.candidateRootMutations, 0);
  assert.equal(counters.liveRuntimeWrites, 0);
  assert.equal(counters.backupWrites, 0);
  assert.equal(counters.productionBoundaryCalls, 0);
  for (const count of Object.values(counters.events)) assert.equal(count, 0);
}

function snapshot(root: string) {
  const entries: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (entry.isDirectory()) {
        entries.push(`d:${relative}`);
        walk(target);
      } else {
        const bytes = fs.readFileSync(target);
        entries.push(`f:${relative}:${bytes.toString("hex")}`);
      }
    }
  };
  walk(root);
  return entries;
}

scenario("happy path", () => {
  const fixture = current();
  const { result, counters } = instrumentedCreate();
  happyCounters = counters;
  assert.equal(result.candidateReady, true);
  assert.equal(result.candidateCreated, true);
  assert.equal(result.candidateReused, false);
  assert.equal(result.cutoverAuthorized, false);
  assert.equal(result.candidateLocator, `candidates/${fixture.candidateId}`);
  assert.equal(verifyMigrationCandidate(fixture.candidateDirectory).valid, true);
  assert.equal(fs.readdirSync(path.join(fixture.candidateRoot, "candidates")).length, 1);
  const publicJson = JSON.stringify(result);
  for (const secret of [fixture.sandbox, fixture.repositoryRoot, fixture.candidateRoot]) {
    assert.equal(publicJson.includes(secret), false);
  }
  assert.equal(/[A-Za-z]:[\\/]/.test(publicJson), false);
  const backup = verifyRuntimeBackup(fixture.backupDirectory);
  assert.equal(counters.events["session-begin"], 1);
  assert.equal(counters.events["partial-create"], 1);
  assert.equal(counters.events["payload-copy"], backup.manifest.files.length);
  assert.equal(counters.events["manifest-write"], 1);
  assert.equal(counters.events["digest-write"], 1);
  assert.equal(counters.events["publish-reservation-acquire"], 1);
  assert.equal(counters.events["final-create"], 1);
  assert.equal(counters.events["final-publish"], backup.manifest.files.length + 2);
  assert.equal(counters.events["partial-cleanup"], 1);
  assert.equal(counters.events["final-release"], 1);
  assert.equal(counters.events["publish-reservation-release"], 1);
  assert.equal(counters.events["session-close"], 1);
  assert.ok(counters.candidateRootMutations > 0);
  assert.equal(counters.liveRuntimeWrites, 0);
  assert.equal(counters.backupWrites, 0);
  assert.equal(counters.productionBoundaryCalls, 0);
});

scenario("existing valid candidate is write-free reuse", () => {
  const fixture = current();
  const first = createCandidate();
  const before = snapshot(fixture.candidateRoot);
  const { result: second, counters } = instrumentedCreate();
  reuseCounters = counters;
  assert.equal(second.candidateReady, true);
  assert.equal(second.candidateCreated, false);
  assert.equal(second.candidateReused, true);
  assert.equal(second.manifestSha256, first.manifestSha256);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
  assertNoMutations(counters);
});

scenario("same identity with different now is write-free reuse", () => {
  const fixture = current();
  createCandidate();
  const before = snapshot(fixture.candidateRoot);
  const { result, counters } = instrumentedCreate(fixture, {
    now: () => "2030-01-02T03:04:05.000Z",
  });
  assert.equal(result.candidateReused, true);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
  assertNoMutations(counters);
});

scenario("non-identity publication evidence does not block reuse", () => {
  const fixture = current();
  createCandidate();
  const beforeIdentity = runtimeMigrationCandidateIdentitySha256(
    verifyMigrationCandidate(fixture.candidateDirectory).manifest,
  );
  rewriteCandidateManifest(fixture, (manifest) => {
    const mutable = manifest as unknown as {
      createdAt: string;
      gitEvidence: { worktreeProjectsClean: boolean; authority: "informational-only" };
      operationEvidence: {
        mode: "preflight-contract" | "candidate-create";
        mutationPerformed: boolean;
        productionCalls: 0;
      };
    };
    mutable.createdAt = "2031-02-03T04:05:06.000Z";
    mutable.gitEvidence = { worktreeProjectsClean: true, authority: "informational-only" };
    mutable.operationEvidence = {
      mode: "preflight-contract", mutationPerformed: false, productionCalls: 0,
    };
  });
  const changed = verifyMigrationCandidate(fixture.candidateDirectory);
  assert.equal(runtimeMigrationCandidateIdentitySha256(changed.manifest), beforeIdentity);
  const before = snapshot(fixture.candidateRoot);
  const { result, counters } = instrumentedCreate();
  assert.equal(result.candidateReused, true);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
  assertNoMutations(counters);
});

scenario("manifest identity mismatch rejects reuse without mutation", () => {
  const fixture = current();
  createCandidate();
  rewriteCandidateManifest(fixture, (manifest) => {
    (manifest.sourceBackup as { sourceCreatedAt: string }).sourceCreatedAt =
      "2032-03-04T05:06:07.000Z";
  });
  assert.equal(verifyMigrationCandidate(fixture.candidateDirectory).valid, true);
  const before = snapshot(fixture.candidateRoot);
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
});

scenario("policy identity mismatch rejects reuse without mutation", () => {
  const fixture = current();
  createCandidate();
  rewriteCandidateManifest(fixture, (manifest) => {
    (manifest.capabilitySummary as { destinationClass: "local-persistent" | "test-temp" })
      .destinationClass = "local-persistent";
  });
  assert.equal(verifyMigrationCandidate(fixture.candidateDirectory).valid, true);
  const before = snapshot(fixture.candidateRoot);
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
});

scenario("inventory identity mismatch rejects reuse without mutation", () => {
  const fixture = current();
  createCandidate();
  rewriteCandidateManifest(fixture, (manifest) => {
    (manifest.inventory as { bytes: number }).bytes += 1;
  });
  const before = snapshot(fixture.candidateRoot);
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.deepEqual(snapshot(fixture.candidateRoot), before);
});

scenario("public verifier rejects partial candidate", () => {
  const fixture = current();
  createCandidate();
  const partial = path.join(fixture.candidateRoot, "candidates", ".verifier.partial");
  fs.cpSync(fixture.candidateDirectory, partial, { recursive: true });
  expectCode("CANDIDATE_INVALID", () => verifyMigrationCandidate(partial));
});

scenario("existing invalid candidate fails without overwrite", () => {
  const fixture = current();
  fs.mkdirSync(fixture.candidateDirectory, { recursive: true });
  fs.writeFileSync(path.join(fixture.candidateDirectory, "invalid"), "preserve");
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.equal(fs.readFileSync(path.join(fixture.candidateDirectory, "invalid"), "utf8"), "preserve");
});

scenario("backup tamper is write-free", () => {
  const fixture = current();
  fs.appendFileSync(path.join(fixture.backupDirectory, "manifest.json"), " ");
  let caught: unknown;
  try { createCandidate(); } catch (error) { caught = error; }
  assert.ok(caught instanceof RuntimeMigrationCandidateError);
  assert.equal(caught.code, "BACKUP_INVALID");
  const publicError = JSON.stringify(caught);
  assert.equal(publicError.includes(fixture.sandbox), false);
  assert.equal(publicError.includes(os.userInfo().username), false);
  assert.equal(/[A-Za-z]:[\\/]/.test(publicError), false);
  assert.deepEqual(fs.readdirSync(fixture.candidateRoot), []);
});

scenario("raw dependencies now error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-now-secret");
  const counters = instrumentedFailure(fixture, {
    now: () => { throw new Error(`ENOENT ${secret}`); },
  }, (run) => expectSafeCode("CANDIDATE_CREATE_FAILED", secret, run));
  assertNoMutations(counters);
});

scenario("raw preflight error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-preflight-secret");
  const counters = instrumentedFailure(fixture, {
    beforePreflight: () => { throw new Error(`EACCES ${secret}`); },
  }, (run) => expectSafeCode("CANDIDATE_CREATE_FAILED", secret, run));
  assertNoMutations(counters);
});

scenario("raw live inventory scan error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-live-scan-secret");
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.readdirSync;
  let installed = false;
  try {
    const counters = instrumentedFailure(fixture, {
      beforePreflight: () => {
        installed = true;
        mutableFs.readdirSync = ((target: unknown, ...args: unknown[]) => {
          if (typeof target === "string" && isWithin(
            path.dirname(fixture.projectRoot), path.resolve(target),
          )) throw new Error(`ENOENT syscall=readdir ${secret}`);
          return Reflect.apply(original, fs, [target, ...args]);
        });
      },
    }, (run) => expectSafeCode("CANDIDATE_CREATE_FAILED", secret, run));
    assertNoMutations(counters);
  } finally {
    if (installed) mutableFs.readdirSync = original;
  }
});

scenario("raw backup verification error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-backup-secret");
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.readFileSync;
  let installed = false;
  try {
    const counters = instrumentedFailure(fixture, {
      beforeBackupVerification: () => {
        installed = true;
        mutableFs.readFileSync = ((target: unknown, ...args: unknown[]) => {
          if (typeof target === "string" && target.startsWith(fixture.backupDirectory)) {
            throw new Error(`EACCES syscall=read ${secret}`);
          }
          return Reflect.apply(original, fs, [target, ...args]);
        });
      },
    }, (run) => expectSafeCode("BACKUP_INVALID", secret, run));
    assertNoMutations(counters);
  } finally {
    if (installed) mutableFs.readFileSync = original;
  }
});

scenario("raw protected-root error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-protected-root-secret");
  const counters = instrumentedFailure(fixture, {
    beforeProtectedRoots: () => { throw new Error(`EACCES ${secret}`); },
  }, (run) => expectSafeCode("CANDIDATE_CREATE_FAILED", secret, run));
  assertNoMutations(counters);
});

scenario("raw guarded session open error is normalized before mutation", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-session-secret");
  const counters = instrumentedFailure(fixture, {
    beforeSessionOpen: () => { throw new Error(`EACCES syscall=open ${secret}`); },
  }, (run) => expectSafeCode("CANDIDATE_CREATE_FAILED", secret, run));
  assertNoMutations(counters);
});

scenario("raw final freshness error preserves final and recovery code", () => {
  const fixture = current();
  const secret = path.join(fixture.sandbox, "raw-final-freshness-secret");
  const counters = instrumentedFailure(fixture, {
    beforeFinalFreshness: () => { throw new Error(`ENOENT ${secret}`); },
  }, (run) => expectSafeCode("CANDIDATE_RECOVERY_REQUIRED", secret, run));
  assert.ok(counters.candidateRootMutations > 0);
  assert.equal(counters.liveRuntimeWrites, 0);
  assert.equal(counters.backupWrites, 0);
  assert.equal(counters.productionBoundaryCalls, 0);
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
});

scenario("renamed backup binding mismatch rejects reuse", () => {
  const fixture = current();
  createCandidate();
  const renamed = path.join(fixture.backupRoot, "backup-renamed");
  fs.cpSync(fixture.backupDirectory, renamed, { recursive: true });
  const request = { ...fixture.request, backupDirectory: renamed };
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () =>
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate(request, {
      now: () => stamp,
    }));
});

scenario("partial copy failure is cleaned", () => {
  const fixture = current();
  let calls = 0;
  expectCode("CANDIDATE_CREATE_FAILED", () =>
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate(fixture.request, {
      now: () => stamp,
      randomId: () => "12345678-1234-1234-1234-123456789abc",
      afterCopyFile: () => { calls += 1; throw new Error("injected-copy-failure"); },
    }));
  assert.equal(calls, 1);
  assert.deepEqual(fs.readdirSync(path.join(fixture.candidateRoot, "candidates")), []);
});

scenario("publish failure preserves final for recovery", () => {
  const fixture = current();
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () =>
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate(fixture.request, {
      now: () => stamp,
      randomId: () => "12345678-1234-1234-1234-123456789abc",
      beforePublishFile: () => { throw new Error("injected-publish-failure"); },
    }));
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
});

scenario("source freshness failure preserves unready final", () => {
  const fixture = current();
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () =>
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate(fixture.request, {
      now: () => stamp,
      randomId: () => "12345678-1234-1234-1234-123456789abc",
      afterFinalPublish: () => {
        fs.appendFileSync(path.join(fixture.projectRoot, "project.json"), " ");
      },
    }));
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
});

scenario("stale session lock requires recovery", () => {
  const fixture = current();
  const lock = path.join(fixture.candidateRoot,
    ".runtime-mutation-migration-candidate-create.lock");
  fs.writeFileSync(lock, "foreign\n", { flag: "wx" });
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.equal(fs.readFileSync(lock, "utf8"), "foreign\n");
  assert.equal(fs.existsSync(fixture.candidateDirectory), false);
});

scenario("valid final with stale state is not silently reused", () => {
  const fixture = current();
  createCandidate();
  const before = snapshot(fixture.candidateDirectory);
  const lock = path.join(fixture.candidateRoot,
    ".runtime-mutation-migration-candidate-create.lock");
  fs.writeFileSync(lock, "foreign\n", { flag: "wx" });
  expectCode("CANDIDATE_RECOVERY_REQUIRED", createCandidate);
  assert.deepEqual(snapshot(fixture.candidateDirectory), before);
  assert.equal(fs.existsSync(lock), true);
});

scenario("partial ownership mismatch preserves foreign replacement", () => {
  const fixture = current();
  let replacement = "";
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
    afterCopyFile: () => { throw new Error("injected-copy-failure"); },
    beforePartialCleanup: () => {
      if (replacement) return;
      const candidates = path.join(fixture.candidateRoot, "candidates");
      const partialName = fs.readdirSync(candidates).find((name) => name.endsWith(".partial"));
      assert.ok(partialName);
      const partial = path.join(candidates, partialName);
      fs.renameSync(partial, `${partial}.owned-away`);
      fs.mkdirSync(partial);
      replacement = path.join(partial, "foreign");
      fs.writeFileSync(replacement, "preserve");
    },
  }));
  assert.equal(fs.readFileSync(replacement, "utf8"), "preserve");
});

scenario("partial cleanup failure requires recovery", () => {
  const fixture = current();
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.rmSync;
  let installed = false;
  try {
    expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
      afterCopyFile: () => { throw new Error("injected-copy-failure"); },
      beforePartialCleanup: () => {
        if (installed) return;
        installed = true;
        mutableFs.rmSync = ((target: unknown, ...args: unknown[]) => {
          if (typeof target === "string" && target.endsWith(".partial")) {
            throw new Error("injected-cleanup-failure");
          }
          return Reflect.apply(original, fs, [target, ...args]);
        });
      },
    }));
  } finally {
    mutableFs.rmSync = original;
  }
  assert.equal(fs.readdirSync(path.join(fixture.candidateRoot, "candidates"))
    .some((name) => name.endsWith(".partial")), true);
});

scenario("orphan-suspect mutation cleanup requires recovery", () => {
  const fixture = current();
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.rmSync;
  let installed = false;
  try {
    expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
      afterCopyFile: () => {
        if (!installed) {
          installed = true;
          mutableFs.rmSync = (() => { throw new Error("injected-orphan-suspect"); });
        }
        throw new Error("injected-copy-failure");
      },
      beforePartialCleanup: () => { mutableFs.rmSync = original; },
    }));
  } finally {
    mutableFs.rmSync = original;
  }
  assert.deepEqual(fs.readdirSync(path.join(fixture.candidateRoot, "candidates")), []);
});

scenario("reservation ownership mismatch requires recovery", () => {
  const fixture = current();
  const reservation = path.join(fixture.candidateRoot, "candidates",
    `.${fixture.candidateId}.publish.lock`);
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
    afterFinalPublish: () => {
      fs.unlinkSync(reservation);
      fs.writeFileSync(reservation, "foreign\n", { flag: "wx" });
    },
  }));
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
  assert.equal(fs.readFileSync(reservation, "utf8"), "foreign\n");
});

scenario("reservation release failure requires recovery", () => {
  const fixture = current();
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.rmSync;
  let installed = false;
  try {
    expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
      beforeReservationRelease: () => {
        if (installed) return;
        installed = true;
        mutableFs.rmSync = ((target: unknown, ...args: unknown[]) => {
          if (typeof target === "string" && target.endsWith(".publish.lock")) {
            throw new Error("injected-release-failure");
          }
          return Reflect.apply(original, fs, [target, ...args]);
        });
      },
    }));
  } finally {
    mutableFs.rmSync = original;
  }
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
});

scenario("session close failure requires recovery", () => {
  const fixture = current();
  const mutableFs = fs as unknown as MutableFs;
  const original = fs.rmSync;
  let installed = false;
  try {
    expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
      beforeSessionClose: () => {
        if (installed) return;
        installed = true;
        mutableFs.rmSync = ((target: unknown, ...args: unknown[]) => {
          if (typeof target === "string" &&
            target.endsWith(".runtime-mutation-migration-candidate-create.lock")) {
            throw new Error("injected-close-failure");
          }
          return Reflect.apply(original, fs, [target, ...args]);
        });
      },
    }));
  } finally {
    mutableFs.rmSync = original;
  }
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
});

scenario("final candidate tamper requires recovery and is preserved", () => {
  const fixture = current();
  expectCode("CANDIDATE_RECOVERY_REQUIRED", () => createCandidate(fixture, {
    afterFinalPublish: (candidateDirectory) => {
      fs.appendFileSync(path.join(candidateDirectory, "candidate.json"), " ");
    },
  }));
  assert.equal(fs.existsSync(fixture.candidateDirectory), true);
});

scenario("source symlink tamper is rejected", () => {
  const fixture = current();
  const source = path.join(fixture.backupDirectory, "payload", "projects", "project-a", "project.json");
  const target = path.join(fixture.sandbox, "outside.json");
  fs.writeFileSync(target, fs.readFileSync(source));
  fs.unlinkSync(source);
  try {
    fs.symlinkSync(target, source, "file");
    expectCode("BACKUP_INVALID", createCandidate);
    platformResults.push({ name: "symlink", result: "PASS" });
  } catch (error) {
    if (fs.existsSync(source)) throw error;
    platformResults.push({ name: "symlink", result: "SKIP_UNSUPPORTED" });
  }
});

scenario("junction tamper is rejected where supported", () => {
  const fixture = current();
  const project = path.join(fixture.backupDirectory, "payload", "projects", "project-a");
  const target = path.join(fixture.sandbox, "junction-target");
  const link = path.join(project, "junction");
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expectCode("BACKUP_INVALID", createCandidate);
    platformResults.push({ name: "junction", result: "PASS" });
  } catch (error) {
    if (fs.existsSync(link)) throw error;
    platformResults.push({ name: "junction", result: "SKIP_UNSUPPORTED" });
  }
});

scenario("confirmation is mandatory and write-free", () => {
  const fixture = current();
  expectCode("INVALID_ARGUMENT", () =>
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate({
      ...fixture.request,
      confirmCandidateCreation: false as true,
    }));
  assert.deepEqual(fs.readdirSync(fixture.candidateRoot), []);
});

scenario("published candidate remains non-cutover authority", () => {
  const result = createCandidate();
  assert.equal(result.verification.cutoverAuthorized, false);
  assert.equal(result.cutoverAuthorized, false);
  assert.equal("candidateReady" in result, true);
});

assert.ok(happyCounters);
assert.ok(reuseCounters);
console.log(JSON.stringify({
  sprint: "129.25C.2B.2",
  status: "PASS",
  scenarios,
  platformResults,
  platformEvidenceGap: platformResults.some((result) => result.result === "SKIP_UNSUPPORTED"),
  cutoverAuthorized: false,
  instrumentedCounters: {
    happyPath: happyCounters,
    validReuse: reuseCounters,
  },
}));
