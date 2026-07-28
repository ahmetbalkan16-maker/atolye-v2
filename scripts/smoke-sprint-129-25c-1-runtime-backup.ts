import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { GuardedRuntimeFilesystem } from "../src/lib/runtime/security/GuardedRuntimeFilesystem";
import { runtimeProtectedRootsFromContext } from "../src/lib/runtime/security/RuntimeProtectedRoots";
import {
  aggregateRuntimeFileRecords,
  emptyClassificationTotals,
  runtimeBackupManifestSha256,
  runtimeBackupFormatVersionV1,
  runtimeBackupFormatVersionV2,
  runtimeBackupManifestSchemaVersionV1,
  runtimeBackupManifestSchemaVersionV2,
  serializeRuntimeBackupManifest,
  validateRuntimeBackupManifest,
  type RuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import {
  assertRuntimeBackupMaterializedPath,
  runtimeBackupPathLimits,
  runtimeBackupPathPolicyVersion,
  runtimeBackupPortableCollisionKey,
  validateRuntimeBackupMutationRelativePath,
  validateRuntimeBackupRelativePath,
} from "../src/lib/runtime/backup/RuntimeBackupPathPolicy";
import {
  collectRuntimeBackupInventory,
  type RuntimeBackupInventoryOptions,
} from "../src/lib/runtime/backup/RuntimeBackupInventory";
import {
  createVerifiedRuntimeBackup,
  portableVerifyRuntimeBackup,
  restoreAndVerifyRuntimeBackup,
  RuntimeBackupError,
  type RuntimeBackupCreateDependencies,
  type RuntimeBackupCreateRequest,
  type RuntimeBackupRestoreRequest,
} from "../src/lib/runtime/backup/RuntimeBackupService";
import {
  bootstrapTestRuntimeBackupStorageAuthority,
} from "../src/lib/runtime/backup/RuntimeBackupAuthority";
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
  if (process.argv[2] === "--source-drift-child") {
    await runSourceDriftChild(process.argv.slice(3));
    return;
  }
  const beforeMarker = sha256(liveMarker);
  const beforeTracking = collectRuntimeTrackingInventory(repositoryRoot);
  const beforeDiff = runtimeDiff();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-backup-smoke-"));
  try {
    const fixtureRepository = path.join(sandbox, "fixture-repository");
    const fixtureProjects = path.join(fixtureRepository, "data", "projects");
    const fixtureAuthorityRoot = path.join(sandbox, "authority");
    const fixtureContext = createRuntimeStorageContext({
      workspaceRoot: fixtureRepository,
      environment: { ATOLYE_RUNTIME_ROOT: path.join(fixtureRepository, "data") },
      authorityRoot: fixtureAuthorityRoot,
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
    const backupRoot = path.join(sandbox, "backup-target");
    const fixtureAuthority = bootstrapTestRuntimeBackupStorageAuthority(
      fixtureContext,
      backupRoot,
    );

    await scenario("runtime authority persists across restart and relocation and differs independently", () => {
      const restarted = createRuntimeStorageContext({
        workspaceRoot: fixtureRepository,
        environment: { ATOLYE_RUNTIME_ROOT: path.join(fixtureRepository, "data") },
        authorityRoot: fixtureAuthorityRoot,
      });
      const restartedAuthority = bootstrapTestRuntimeBackupStorageAuthority(
        restarted,
        backupRoot,
      );
      assert.equal(restartedAuthority.runtimeAuthorityId, fixtureAuthority.runtimeAuthorityId);

      const relocatedRuntime = path.join(sandbox, "relocated-runtime");
      fs.mkdirSync(path.join(relocatedRuntime, "projects"), { recursive: true });
      const relocated = createRuntimeStorageContext({
        workspaceRoot: fixtureRepository,
        environment: { ATOLYE_RUNTIME_ROOT: relocatedRuntime },
        authorityRoot: fixtureAuthorityRoot,
      });
      const relocatedAuthority = bootstrapTestRuntimeBackupStorageAuthority(
        relocated,
        path.join(sandbox, "relocated-backups"),
      );
      assert.equal(relocatedAuthority.runtimeAuthorityId, fixtureAuthority.runtimeAuthorityId);

      const independentContext = createRuntimeStorageContext({
        workspaceRoot: fixtureRepository,
        environment: { ATOLYE_RUNTIME_ROOT: relocatedRuntime },
        authorityRoot: path.join(sandbox, "independent-authority"),
      });
      const independent = bootstrapTestRuntimeBackupStorageAuthority(
        independentContext,
        path.join(sandbox, "independent-backups"),
      );
      assert.notEqual(independent.runtimeAuthorityId, fixtureAuthority.runtimeAuthorityId);
    });

    await scenario("malformed authority marker fails closed", () => {
      const malformedRoot = path.join(sandbox, "malformed-authority");
      fs.mkdirSync(malformedRoot);
      fs.writeFileSync(path.join(malformedRoot, "runtime-backup-authority-v1.json"), "{}\n");
      const malformedContext = createRuntimeStorageContext({
        workspaceRoot: fixtureRepository,
        environment: { ATOLYE_RUNTIME_ROOT: path.join(fixtureRepository, "data") },
        authorityRoot: malformedRoot,
      });
      assert.throws(() => bootstrapTestRuntimeBackupStorageAuthority(
        malformedContext,
        path.join(sandbox, "malformed-backups"),
      ), /authority/i);
      assert.equal(
        fs.readFileSync(path.join(malformedRoot, "runtime-backup-authority-v1.json"), "utf8"),
        "{}\n",
      );
    });

    await scenario("v2 backup path policy enforces exact UTF-16 UTF-8 and portable boundaries", () => {
      assert.equal(runtimeBackupPathPolicyVersion, "runtime-backup-relative-path-v2");
      assert.equal(runtimeBackupPathLimits.relativePathUtf16, 220);
      assert.equal(runtimeBackupPathLimits.relativePathUtf8, 300);
      const exactUtf16 = `${"s".repeat(100)}/${"m".repeat(22)}/${"f".repeat(96)}`;
      assert.equal(exactUtf16.length, 220);
      validateRuntimeBackupRelativePath(exactUtf16);
      const materializedExactUtf16 = `payload/projects/${exactUtf16}`;
      assert.equal(materializedExactUtf16.length, 237);
      validateRuntimeBackupMutationRelativePath(materializedExactUtf16);
      assert.throws(() => validateRuntimeBackupRelativePath(
        `${"s".repeat(100)}/${"m".repeat(23)}/${"f".repeat(96)}`,
      ));
      const exactUtf8 = `${"s".repeat(100)}/aa${"😀".repeat(13)}/${"😀".repeat(36)}`;
      assert.equal(Buffer.byteLength(exactUtf8, "utf8"), 300);
      validateRuntimeBackupRelativePath(exactUtf8);
      const materializedExactUtf8 = `payload/projects/${exactUtf8}`;
      assert.equal(Buffer.byteLength(materializedExactUtf8, "utf8"), 317);
      validateRuntimeBackupMutationRelativePath(materializedExactUtf8);
      assert.throws(() => validateRuntimeBackupRelativePath(
        `${"s".repeat(100)}/aaa${"😀".repeat(13)}/${"😀".repeat(36)}`,
      ));
      validateRuntimeBackupRelativePath(`slug/${"m".repeat(120)}/file`);
      assert.throws(() => validateRuntimeBackupRelativePath(`slug/${"m".repeat(121)}/file`));
      validateRuntimeBackupRelativePath(`${"s".repeat(100)}/file`);
      assert.throws(() => validateRuntimeBackupRelativePath(`${"s".repeat(101)}/file`));
      validateRuntimeBackupRelativePath(`slug/${"f".repeat(96)}`);
      assert.throws(() => validateRuntimeBackupRelativePath(`slug/${"f".repeat(97)}`));
      for (const invalid of [
        "../escape",
        "/absolute",
        "C:/absolute",
        "mixed\\separator",
        "slug//file",
        "slug/control\u0001file",
        "slug/e\u0301.json",
        "slug/CON/file",
        "slug/trailing./file",
        "slug/trailing /file",
      ]) assert.throws(() => validateRuntimeBackupRelativePath(invalid));
      assert.equal(
        runtimeBackupPortableCollisionKey("slug/File.json"),
        runtimeBackupPortableCollisionKey("slug/file.json"),
      );
      assert.equal(
        runtimeBackupPortableCollisionKey("slug/straße.json"),
        runtimeBackupPortableCollisionKey("slug/STRASSE.json"),
      );
      const first = inventory.files[0];
      assert.throws(() => validateRuntimeBackupManifest(manifestWithFiles(inventory, [
        { ...first, relativePath: "project-a/straße.json" },
        { ...first, relativePath: "project-a/STRASSE.json" },
      ])), /collision/);
    });

    await scenario("manifest v1 remains old-policy-bound and v2 identity is explicit", () => {
      const v1 = asV1Manifest(inventory);
      const v1Bytes = serializeRuntimeBackupManifest(v1);
      validateRuntimeBackupManifest(v1);
      assert.equal(serializeRuntimeBackupManifest(v1), v1Bytes);
      assert.equal("pathPolicyVersion" in v1, false);
      assert.equal(serializeRuntimeBackupManifest(v1).includes("pathPolicyVersion"), false);
      assert.equal(inventory.schemaVersion, runtimeBackupManifestSchemaVersionV2);
      assert.equal(inventory.backupFormatVersion, runtimeBackupFormatVersionV2);
      assert.equal(inventory.pathPolicyVersion, runtimeBackupPathPolicyVersion);
      const legacyOverLimit = `slug/${"a".repeat(120)}/${"b".repeat(55)}`;
      assert.equal(legacyOverLimit.length, 181);
      assert.throws(() => validateRuntimeBackupRelativePath(
        legacyOverLimit,
        "runtime-backup-relative-path-v1",
      ));
      validateRuntimeBackupRelativePath(legacyOverLimit);
      assert.throws(() => validateRuntimeBackupManifest({
        ...inventory,
        pathPolicyVersion: "runtime-backup-relative-path-v3",
      }));
      assert.throws(() => validateRuntimeBackupManifest({
        ...inventory,
        schemaVersion: runtimeBackupManifestSchemaVersionV1,
      }));
      assert.throws(() => validateRuntimeBackupManifest({
        ...inventory,
        backupFormatVersion: runtimeBackupFormatVersionV1,
      }));
      assert.throws(() => validateRuntimeBackupManifest({
        ...v1,
        pathPolicyVersion: runtimeBackupPathPolicyVersion,
      }));
    });

    await scenario("public inventory cannot select, downgrade, or expose a raw verifier scan", async () => {
      type PublicInventoryAcceptsPolicy =
        "pathPolicyVersion" extends keyof RuntimeBackupInventoryOptions ? true : false;
      const publicInventoryAcceptsPolicy: PublicInventoryAcceptsPolicy = false;
      assert.equal(publicInventoryAcceptsPolicy, false);
      const attemptedDowngrade = collectRuntimeBackupInventory({
        context: fixtureContext,
        repositoryRoot: fixtureRepository,
        now: () => fixedNow,
        pathPolicyVersion: "runtime-backup-relative-path-v1",
      } as RuntimeBackupInventoryOptions & { readonly pathPolicyVersion: string });
      assert.equal(attemptedDowngrade.schemaVersion, runtimeBackupManifestSchemaVersionV2);
      assert.equal(attemptedDowngrade.backupFormatVersion, runtimeBackupFormatVersionV2);
      assert.equal(attemptedDowngrade.pathPolicyVersion, runtimeBackupPathPolicyVersion);
      const inventoryExports = await import(
        "../src/lib/runtime/backup/RuntimeBackupInventory"
      ) as Record<string, unknown>;
      assert.equal(
        "collectRuntimeBackupTreeForManifestVerification" in inventoryExports,
        false,
      );
      assert.equal("assertRuntimeBackupTreeMatchesManifest" in inventoryExports, true);
    });

    await scenario("v2 materialization budget accepts 259 and rejects 260 UTF-16", () => {
      const relative = "slug/file.json";
      const rootPrefix = path.parse(sandbox).root;
      const exactRootLength = runtimeBackupPathLimits.materializedPathUtf16 -
        1 - relative.split("/").join(path.sep).length;
      const exactRoot = path.join(
        rootPrefix,
        "r".repeat(exactRootLength - rootPrefix.length),
      );
      assert.equal(assertRuntimeBackupMaterializedPath(exactRoot, relative).length, 259);
      assert.throws(() => assertRuntimeBackupMaterializedPath(`${exactRoot}x`, relative));
    });

    await scenario("source exports no general create facade or scoped mutation handle", async () => {
      type PublicGuardedHasScopedEntry =
        "beginScopedMutation" extends keyof GuardedRuntimeFilesystem ? true : false;
      const publicGuardedHasScopedEntry: PublicGuardedHasScopedEntry = false;
      assert.equal(publicGuardedHasScopedEntry, false);
      const spoofRoot = path.join(sandbox, "scoped-spoof-root");
      const restoreVerificationRoot = path.join(sandbox, "scoped-spoof-restore");
      fs.mkdirSync(spoofRoot);
      const guarded = new GuardedRuntimeFilesystem(runtimeProtectedRootsFromContext({
        context: fixtureContext,
        repositoryRoot: fixtureRepository,
        backupRoot: spoofRoot,
        restoreVerificationRoot,
      }));
      assert.equal("beginScopedMutation" in guarded, false);
      const guardedExports = await import(
        "../src/lib/runtime/security/GuardedRuntimeMutationSession"
      ) as Record<string, unknown>;
      for (const forbidden of [
        "beginAuthorizedRuntimeBackupMutation",
        "internalRuntimeBackupCreateMutationAuthority",
        "internalRuntimeBackupRestoreMutationAuthority",
        "RuntimeBackupMutationAuthority",
        "beginScopedMutation",
        "openRuntimeBackupCreateGuardedOperation",
        "openRuntimeBackupRestoreGuardedOperation",
        "openLegacyRuntimeBackupRestoreGuardedOperation",
        "RuntimeBackupCreateGuardedOperation",
        "RuntimeBackupRestoreGuardedOperation",
      ]) assert.equal(forbidden in guardedExports, false, forbidden);
      assert.deepEqual(fs.readdirSync(spoofRoot), []);
      const session = guarded.beginMutation({
        writableRoot: spoofRoot,
        writableRole: "backup",
        operation: "runtime-backup-create",
      });
      const arbitraryLogicalPath = `${"s".repeat(100)}/${"m".repeat(12)}/${"f".repeat(96)}`;
      const overGlobalMutation = `payload/projects/${arbitraryLogicalPath}`;
      assert.equal(arbitraryLogicalPath.length, 210);
      assert.equal(overGlobalMutation.length, 227);
      assert.throws(() => session.createOwnedDirectory(overGlobalMutation));
      assert.equal(fs.existsSync(path.join(spoofRoot, ...overGlobalMutation.split("/"))), false);
      assert.equal(session.close(), "completed");
      assert.deepEqual(fs.readdirSync(spoofRoot), []);
      assert.deepEqual(runtimeMutationResidues(spoofRoot), []);
    });

    await scenario("forged publication inputs are absent and failed atomic create has zero residue", () => {
      type AcceptsManifest = "manifest" extends keyof RuntimeBackupCreateDependencies
        ? true : false;
      type AcceptsDigest = "digest" extends keyof RuntimeBackupCreateDependencies
        ? true : false;
      type AcceptsFiles = "files" extends keyof RuntimeBackupCreateDependencies
        ? true : false;
      type AcceptsCreatedAt = "createdAt" extends keyof RuntimeBackupCreateDependencies
        ? true : false;
      const acceptsManifest: AcceptsManifest = false;
      const acceptsDigest: AcceptsDigest = false;
      const acceptsFiles: AcceptsFiles = false;
      const acceptsCreatedAt: AcceptsCreatedAt = false;
      assert.deepEqual(
        [acceptsManifest, acceptsDigest, acceptsFiles, acceptsCreatedAt],
        [false, false, false, false],
      );

      for (const [name, value] of [
        ["manifest", {}],
        ["digest", "0".repeat(64)],
        ["files", [{ relativePath: "forged.bin" }]],
        ["serializedManifest", "{}\n"],
        ["partialRelative", ".p-deadbeef"],
      ] as const) {
        const forgedRoot = path.join(sandbox, `forged-${name}-root`);
        assert.throws(() => createVerifiedRuntimeBackup({
          authority: fixtureAuthority,
        }, {
          backupId: `forged-${name}`,
          [name]: value,
        } as RuntimeBackupCreateDependencies & Record<string, unknown>),
        (error) => error instanceof RuntimeBackupError &&
          error.code === "RUNTIME_BACKUP_PATH_INVALID");
        assert.equal(fs.existsSync(forgedRoot), false);
      }

      const zeroResidueRoot = path.join(sandbox, "atomic-zero-residue-root");
      const zeroResidueAuthority = bootstrapTestRuntimeBackupStorageAuthority(
        fixtureContext,
        zeroResidueRoot,
      );
      let injected = false;
      assert.equal(fs.existsSync(zeroResidueRoot), false);
      assert.throws(() => withCopyFileInterceptor((original, source, destination, mode) => {
        if (!injected && insidePath(fixtureProjects, String(source))) {
          injected = true;
          throw new Error("atomic-copy-failure");
        }
        original(source, destination, mode);
      }, () => createVerifiedRuntimeBackup({
        authority: zeroResidueAuthority,
      }, {
        backupId: "zero-residue",
      })));
      assert.equal(injected, true);
      assert.equal(fs.existsSync(zeroResidueRoot), false);
    });

    await scenario("strict DTO rejects proxy accessor prototype symbol and exotic objects before mutation", () => {
      const dtoRoot = path.join(sandbox, "strict-dto-backups");
      const dtoAuthority = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, dtoRoot);
      const validRequest = { authority: dtoAuthority };
      for (const [name, value] of strictDtoVariants({ backupId: "dto-backup" }, "backupId")) {
        assert.throws(
          () => createVerifiedRuntimeBackup(validRequest, value as RuntimeBackupCreateDependencies),
          (error) => error instanceof RuntimeBackupError &&
            error.code === "RUNTIME_BACKUP_PATH_INVALID",
          name,
        );
        assert.equal(fs.existsSync(dtoRoot), false, name);
      }
      for (const [name, value] of strictDtoVariants(validRequest, "authority")) {
        assert.throws(
          () => createVerifiedRuntimeBackup(value as RuntimeBackupCreateRequest),
          (error) => error instanceof RuntimeBackupError &&
            error.code === "RUNTIME_BACKUP_PATH_INVALID",
          name,
        );
        assert.equal(fs.existsSync(dtoRoot), false, name);
      }
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

    let backupDirectory = "";
    await scenario("source partial verified final publish succeeds", () => {
      const result = createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
      }, {
        backupId: "verified-backup",
      });
      backupDirectory = result.backupDirectory;
      assert.deepEqual(Object.keys(result).sort(), [
        "backupDirectory",
        "backupId",
        "manifest",
        "verification",
      ]);
      assert.equal(result.verification.valid, true);
      assert.equal(result.manifest.schemaVersion, "3");
      assert.equal(result.manifest.backupFormatVersion, "runtime-backup-v3");
      assert.equal(
        result.manifest.sourceRuntimeAuthority?.runtimeAuthorityId,
        fixtureAuthority.runtimeAuthorityId,
      );
      assert.equal(result.manifest.sourceRuntimeAuthority?.projectIdentity, "projects");
      assert.equal(result.manifest.aggregateFingerprint, inventory.aggregateFingerprint);
      assert.equal(fs.existsSync(path.join(backupDirectory, "manifest.json")), true);
      assert.equal(fs.readdirSync(path.join(backupRoot, "backups")).some((name) => name.includes(".partial")), false);
      assert.deepEqual(runtimeMutationResidues(backupRoot), []);
    });

    await scenario("strict DTO rejects exotic same-authority restore requests", () => {
      const valid = { authority: fixtureAuthority, backupId: "verified-backup" };
      for (const [name, value] of strictDtoVariants(valid, "backupId")) {
        assert.throws(
          () => restoreAndVerifyRuntimeBackup(value as RuntimeBackupRestoreRequest),
          (error) => error instanceof RuntimeBackupError &&
            error.code === "RUNTIME_BACKUP_PATH_INVALID",
          name,
        );
      }
      for (const [name, value] of strictDtoVariants({ allowPartial: false }, "allowPartial")) {
        assert.throws(
          () => verifyRuntimeBackup(
            backupDirectory,
            value as { readonly allowPartial?: boolean },
          ),
          /verification request is invalid/,
          name,
        );
      }
      assert.deepEqual(runtimeMutationResidues(backupRoot), []);
    });

    await scenario("same-authority restore binds runtime and project while portable verification stays unbound", () => {
      const runtimeB = path.join(sandbox, "runtime-b");
      fs.mkdirSync(path.join(runtimeB, "projects", "foreign"), { recursive: true });
      fs.writeFileSync(path.join(runtimeB, "projects", "foreign", "payload.bin"), "FOREIGN-BYTES");
      const contextB = createRuntimeStorageContext({
        workspaceRoot: fixtureRepository,
        environment: { ATOLYE_RUNTIME_ROOT: runtimeB },
        authorityRoot: path.join(sandbox, "authority-b"),
      });
      const rootB = path.join(sandbox, "backup-b");
      const authorityB = bootstrapTestRuntimeBackupStorageAuthority(contextB, rootB);
      const copiedB = path.join(rootB, "backups", "foreign-copy");
      fs.mkdirSync(path.dirname(copiedB), { recursive: true });
      fs.cpSync(backupDirectory, copiedB, { recursive: true });
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        authority: authorityB,
        backupId: "foreign-copy",
      }), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_AUTHORITY_MISMATCH");
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "verified-backup",
        projectSlug: "project-a",
      }), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_AUTHORITY_MISMATCH");
      const portable = portableVerifyRuntimeBackup({
        authority: authorityB,
        backupDirectory,
      });
      assert.equal(portable.valid, true);
      assert.equal(portable.currentRuntimeBound, false);
      assert.equal(portable.sourceRuntimeAuthorityId, fixtureAuthority.runtimeAuthorityId);
      assert.equal(fs.existsSync(portable.restoreRoot), false);
      assert.equal(fs.existsSync(path.join(runtimeB, "projects", "project-a")), false);
    });

    await scenario("existing v1 backup verifies and restores under the legacy 180/240 contract", () => {
      const legacyBackup = path.join(sandbox, "legacy-v1-backup");
      fs.cpSync(backupDirectory, legacyBackup, { recursive: true });
      const legacyManifest = asV1Manifest(inventory);
      const serialized = serializeRuntimeBackupManifest(legacyManifest);
      fs.writeFileSync(path.join(legacyBackup, "manifest.json"), serialized);
      fs.writeFileSync(
        path.join(legacyBackup, "manifest.sha256"),
        `${runtimeBackupManifestSha256(serialized)}\n`,
      );
      const verified = verifyRuntimeBackup(legacyBackup);
      assert.equal(fs.readFileSync(path.join(legacyBackup, "manifest.json"), "utf8"), serialized);
      assert.equal(verified.manifest.schemaVersion, "1");
      assert.equal(verified.manifest.pathPolicyVersion, undefined);
      const restored = portableVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupDirectory: legacyBackup,
      });
      assert.equal(restored.aggregateFingerprint, inventory.aggregateFingerprint);
      assert.equal(fs.readFileSync(path.join(legacyBackup, "manifest.json"), "utf8"), serialized);
      const trustedLegacy = path.join(backupRoot, "backups", "legacy-v1-authority");
      fs.cpSync(legacyBackup, trustedLegacy, { recursive: true });
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "legacy-v1-authority",
      }), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_AUTHORITY_UNAVAILABLE");

      const v2Backup = path.join(backupRoot, "backups", "legacy-v2-authority");
      fs.cpSync(backupDirectory, v2Backup, { recursive: true });
      const v2Serialized = serializeRuntimeBackupManifest(inventory);
      fs.writeFileSync(path.join(v2Backup, "manifest.json"), v2Serialized);
      fs.writeFileSync(
        path.join(v2Backup, "manifest.sha256"),
        `${runtimeBackupManifestSha256(v2Serialized)}\n`,
      );
      assert.equal(portableVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupDirectory: v2Backup,
      }).sourceSchemaVersion, runtimeBackupManifestSchemaVersionV2);
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "legacy-v2-authority",
      }), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_AUTHORITY_UNAVAILABLE");
    });

    await scenario("backup target validation and overwrite are fail closed", () => {
      assert.throws(() => createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
        backupRoot: "relative-backup",
      } as unknown as RuntimeBackupCreateRequest), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_PATH_INVALID");
      assert.throws(() => createVerifiedRuntimeBackup({
        authority: { ...fixtureAuthority },
      } as unknown as RuntimeBackupCreateRequest), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_PATH_INVALID");
      assert.throws(() => createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
        backupDirectory: path.join(fixtureRepository, "inside-repository"),
      } as unknown as RuntimeBackupCreateRequest), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_PATH_INVALID");
      assert.throws(() => createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
        manifest: {},
      } as unknown as RuntimeBackupCreateRequest), (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_PATH_INVALID");
      assert.throws(() => createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
      }, { backupId: "verified-backup" }),
      (error) => error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_TARGET_EXISTS");
    });

    await scenario("two processes with different markers publish one same-id winner without overwrite", async () => {
      const concurrentRoot = path.join(sandbox, "concurrent-backup-target");
      const concurrentAuthorityRoot = path.join(sandbox, "concurrent-authority");
      const runtimeA = path.join(fixtureRepository, "concurrent-runtime-a");
      const runtimeB = path.join(fixtureRepository, "concurrent-runtime-b");
      for (const [root, marker] of [[runtimeA, "MARKER-A"], [runtimeB, "MARKER-B"]] as const) {
        fs.mkdirSync(path.join(root, "projects", "race"), { recursive: true });
        fs.writeFileSync(path.join(root, "projects", "race", "marker.txt"), marker);
      }
      const startAt = Date.now() + 1_000;
      const [first, second] = await Promise.all([
        runConcurrentCreateProcess([
          fixtureRepository, runtimeA, concurrentRoot, String(startAt), concurrentAuthorityRoot, "A",
        ]),
        runConcurrentCreateProcess([
          fixtureRepository, runtimeB, concurrentRoot, String(startAt), concurrentAuthorityRoot, "B",
        ]),
      ]);
      assert.equal([first, second].filter((value) => value.startsWith("SUCCESS:")).length, 1);
      assert.equal([first, second].filter((value) => value.startsWith("CONTENDED:")).length, 1);
      const final = path.join(concurrentRoot, "backups", "concurrent-backup");
      assert.equal(verifyRuntimeBackup(final).valid, true);
      const winner = [first, second].find((value) => value.startsWith("SUCCESS:"))?.slice(-1);
      assert.equal(
        fs.readFileSync(path.join(final, "payload", "projects", "race", "marker.txt"), "utf8"),
        winner === "A" ? "MARKER-A" : "MARKER-B",
      );
      assert.deepEqual(
        fs.readdirSync(path.join(concurrentRoot, "backups"))
          .filter((name) => name.includes("partial") || name.includes("publish.lock")),
        [],
      );
      assert.deepEqual(runtimeMutationResidues(concurrentRoot), []);
    });

    await scenario("failed or tampered copy never publishes a final backup", () => {
      for (const id of ["copy-failure", "copy-tamper", "source-mutation"] as const) {
        let injected = false;
        let mutatedSource = "";
        let originalSourceBytes: Buffer | undefined;
        try {
          assert.throws(() => withCopyFileInterceptor((original, source, destination, mode) => {
            if (!injected && insidePath(fixtureProjects, String(source))) {
              injected = true;
              if (id === "copy-failure") throw new Error("copy failed");
              original(source, destination, mode);
              if (id === "copy-tamper") fs.appendFileSync(destination, "tamper");
              if (id === "source-mutation") {
                mutatedSource = String(source);
                originalSourceBytes = fs.readFileSync(mutatedSource);
                fs.appendFileSync(mutatedSource, "source-changed");
              }
              return;
            }
            original(source, destination, mode);
          }, () => createVerifiedRuntimeBackup({
            authority: fixtureAuthority,
          }, { backupId: id })));
        } finally {
          if (mutatedSource && originalSourceBytes) {
            fs.writeFileSync(mutatedSource, originalSourceBytes);
          }
        }
        assert.equal(injected, true);
        assert.equal(fs.existsSync(path.join(backupRoot, "backups", id)), false);
        assert.equal(fs.readdirSync(path.join(backupRoot, "backups")).some((name) => name.includes(id)), false);
        assert.deepEqual(runtimeMutationResidues(backupRoot), []);
      }
    });

    await scenario("destination parent link swap fails and leaves no outside bytes", () => {
      const outside = path.join(sandbox, "link-swap-outside");
      fs.mkdirSync(outside);
      let attempted = false;
      let linked = false;
      assert.throws(() => withCopyFileInterceptor((original, source, destination, mode) => {
        if (!attempted && insidePath(fixtureProjects, String(source))) {
          if (attempted) return;
          attempted = true;
          const parentPath = path.dirname(String(destination));
          const displaced = `${parentPath}.displaced`;
          fs.renameSync(parentPath, displaced);
          try {
            fs.symlinkSync(outside, parentPath, process.platform === "win32" ? "junction" : "dir");
            linked = true;
          } catch {
            // The operation still fails closed; unsupported link creation is reported below.
          }
        }
        original(source, destination, mode);
      }, () => createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
      }, {
        backupId: "link-swap-create",
      })));
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
      const report = restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "verified-backup",
      });
      assert.equal(report.aggregateFingerprint, inventory.aggregateFingerprint);
      assert.equal(report.markerFiles.length, 1);
      const markerRecord = inventory.files.find((file) => file.classification === "acceptance-marker");
      assert.equal(report.markerFiles[0].sha256, markerRecord?.sha256);
      const serviceOwned = restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "verified-backup",
      });
      assert.equal(serviceOwned.valid, true);
      assert.equal(fs.existsSync(serviceOwned.restoreRoot), false);
    });

    await scenario("restore missing extra modified and nonempty targets fail closed", () => {
      for (const mode of ["missing", "extra", "modified"] as const) {
        let injected = false;
        assert.throws(() => withCopyFileInterceptor((original, source, destination, copyMode) => {
          original(source, destination, copyMode);
          if (!injected && insidePath(backupDirectory, String(source))) {
            injected = true;
            if (mode === "missing") fs.rmSync(destination);
            if (mode === "modified") fs.appendFileSync(destination, "changed");
            if (mode === "extra") {
              fs.writeFileSync(path.join(path.dirname(String(destination)), "extra.bin"), "extra");
            }
          }
        }, () => restoreAndVerifyRuntimeBackup({
          authority: fixtureAuthority,
          backupId: "verified-backup",
        })));
        assert.equal(injected, true);
      }
      assert.throws(() => restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "verified-backup",
        restoreRoot: fixtureProjects,
      } as unknown as RuntimeBackupRestoreRequest), (error) => error instanceof RuntimeBackupError &&
        error.code === "RUNTIME_BACKUP_PATH_INVALID");
    });

    await scenario("restore destination link swap fails and leaves no outside bytes", () => {
      const outside = path.join(sandbox, "restore-link-swap-outside");
      fs.mkdirSync(outside);
      let attempted = false;
      let linked = false;
      assert.throws(() => withCopyFileInterceptor((original, source, destination, copyMode) => {
        if (!attempted && insidePath(backupDirectory, String(source))) {
          attempted = true;
          const parentPath = path.dirname(String(destination));
          const displaced = `${parentPath}.displaced`;
          fs.renameSync(parentPath, displaced);
          try {
            fs.symlinkSync(outside, parentPath, process.platform === "win32" ? "junction" : "dir");
            linked = true;
          } catch {
            // The operation still fails closed; unsupported link creation is reported below.
          }
        }
        original(source, destination, copyMode);
      }, () => restoreAndVerifyRuntimeBackup({
        authority: fixtureAuthority,
        backupId: "verified-backup",
      })));
      if (!linked) {
        process.stdout.write("SKIP restore destination link swap unsupported\n");
        return;
      }
      assert.equal(attempted, true);
      assert.deepEqual(fs.readdirSync(outside), []);
    });

    await scenario("post-publication cleanup faults remove operation-owned final and all residues", () => {
      for (const mode of ["publish-lock", "session-lock", "partial", "final-cleanup"] as const) {
        const cleanupRoot = path.join(sandbox, `cleanup-${mode}-root`);
        const cleanupAuthority = bootstrapTestRuntimeBackupStorageAuthority(
          fixtureContext,
          cleanupRoot,
        );
        let injected = false;
        let primaryFailure = false;
        assert.throws(() => withRmSyncInterceptor((original, target, options) => {
          const name = path.basename(String(target));
          if (mode === "final-cleanup" && !primaryFailure &&
            name === ".cleanup-fault.publish.lock") {
            primaryFailure = true;
            throw Object.assign(new Error("injected-primary-publish-lock"), { code: "EIO" });
          }
          const matches = mode === "publish-lock"
            ? name === ".cleanup-fault.publish.lock"
            : mode === "session-lock"
              ? name === ".runtime-mutation-runtime-backup-create.lock"
              : mode === "partial"
                ? name.startsWith(".p-")
                : primaryFailure && name === "cleanup-fault";
          if (!injected && matches) {
            injected = true;
            throw Object.assign(new Error(`injected-${mode}`), { code: "EIO" });
          }
          original(target, options);
        }, () => createVerifiedRuntimeBackup({
          authority: cleanupAuthority,
        }, { backupId: "cleanup-fault" })),
        (error) => error instanceof RuntimeBackupError &&
          error.code === "RUNTIME_BACKUP_CLEANUP_REQUIRED");
        assert.equal(injected, true, mode);
        assert.equal(fs.existsSync(path.join(cleanupRoot, "backups", "cleanup-fault")), false);
        assert.deepEqual(runtimeMutationResidues(cleanupRoot), []);
        assert.equal(fs.existsSync(cleanupRoot), false);
      }
    });

    await scenario("manifest and digest write faults fail before publication with zero residue", () => {
      for (const name of ["manifest.json", "manifest.sha256"] as const) {
        const writeRoot = path.join(sandbox, `write-fault-${name.replace(".", "-")}`);
        const writeAuthority = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, writeRoot);
        let injected = false;
        assert.throws(() => withWriteFileSyncInterceptor((original, target, data, options) => {
          if (!injected && path.basename(String(target)) === name &&
            path.basename(path.dirname(String(target))).startsWith(".p-")) {
            injected = true;
            throw Object.assign(new Error(`injected-${name}`), { code: "EIO" });
          }
          original(target, data, options as never);
        }, () => createVerifiedRuntimeBackup({ authority: writeAuthority }, {
          backupId: `write-${name === "manifest.json" ? "manifest" : "digest"}`,
        })));
        assert.equal(injected, true);
        assert.equal(fs.existsSync(writeRoot), false);
        assert.deepEqual(runtimeMutationResidues(writeRoot), []);
      }
    });

    await scenario("transient operation-created container cleanup failure retries to zero residue", () => {
      const containerRoot = path.join(sandbox, "container-cleanup-root");
      const containerAuthority = bootstrapTestRuntimeBackupStorageAuthority(
        fixtureContext,
        containerRoot,
      );
      let copyFailed = false;
      let cleanupFailed = false;
      assert.throws(() => withRmdirSyncInterceptor((original, target, options) => {
        if (!cleanupFailed && path.resolve(String(target)) ===
          path.resolve(containerRoot, "backups")) {
          cleanupFailed = true;
          throw Object.assign(new Error("injected-container-cleanup"), { code: "EIO" });
        }
        original(target, options);
      }, () => withCopyFileInterceptor((original, source, destination, mode) => {
        if (!copyFailed && insidePath(fixtureProjects, String(source))) {
          copyFailed = true;
          throw new Error("injected-copy-for-container-cleanup");
        }
        original(source, destination, mode);
      }, () => createVerifiedRuntimeBackup({ authority: containerAuthority }, {
        backupId: "container-cleanup",
      }))));
      assert.equal(copyFailed, true);
      assert.equal(cleanupFailed, true);
      assert.equal(fs.existsSync(containerRoot), false);
    });

    await scenario("post-publication standalone verification failure removes owned final", () => {
      const verifyRoot = path.join(sandbox, "post-verify-root");
      const verifyAuthority = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, verifyRoot);
      const final = path.join(verifyRoot, "backups", "post-verify-fault");
      let injected = false;
      assert.throws(() => withReadFileSyncInterceptor((original, target, options) => {
        if (!injected && path.resolve(String(target)) === path.resolve(final, "manifest.json")) {
          injected = true;
          fs.writeFileSync(path.join(final, "unexpected.bin"), "tamper");
        }
        return original(target, options as never);
      }, () => createVerifiedRuntimeBackup({
        authority: verifyAuthority,
      }, { backupId: "post-verify-fault" })));
      assert.equal(injected, true);
      assert.equal(fs.existsSync(final), false);
      assert.deepEqual(runtimeMutationResidues(verifyRoot), []);
      assert.equal(fs.existsSync(verifyRoot), false);
    });

    await scenario("controlled child-process barrier source drift blocks publication with zero residue", () => {
      const source = path.join(fixtureProjects, "project-b", "barrier.bin");
      const originalBytes = Buffer.from("BARRIER-BEFORE");
      fs.writeFileSync(source, originalBytes);
      const barrier = path.join(sandbox, "source-drift.barrier");
      const acknowledgement = path.join(sandbox, "source-drift.ack");
      const driftRoot = path.join(sandbox, "source-drift-backups");
      const driftAuthority = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, driftRoot);
      const child = spawn(
        process.execPath,
        ["--import", "tsx", import.meta.filename, "--source-drift-child", barrier, acknowledgement, source],
        { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
      );
      let injected = false;
      try {
        assert.throws(() => withCopyFileInterceptor((original, from, destination, mode) => {
          if (!injected && String(from) === source) {
            injected = true;
            fs.writeFileSync(barrier, "go");
            waitForFile(acknowledgement, 10_000);
          }
          original(from, destination, mode);
        }, () => createVerifiedRuntimeBackup({
          authority: driftAuthority,
        }, { backupId: "barrier-drift" })));
        assert.equal(injected, true);
        assert.equal(fs.existsSync(path.join(driftRoot, "backups", "barrier-drift")), false);
        assert.deepEqual(runtimeMutationResidues(driftRoot), []);
      } finally {
        if (!child.killed) child.kill();
        fs.writeFileSync(source, originalBytes);
        fs.rmSync(source);
      }
    });

    await scenario("restore cleanup faults remove materialized tree lock and container", () => {
      for (const mode of ["restore-tree", "restore-session-lock"] as const) {
        const restoreBase = path.join(os.tmpdir(), ".arv3");
        fs.rmSync(restoreBase, { recursive: true, force: true });
        let injected = false;
        assert.throws(() => withRmSyncInterceptor((original, target, options) => {
          const name = path.basename(String(target));
          const matches = mode === "restore-tree"
            ? /^r-[a-f0-9]{8}$/.test(name)
            : name === ".runtime-mutation-runtime-restore-verify.lock";
          if (!injected && matches) {
            injected = true;
            throw Object.assign(new Error(`injected-${mode}`), { code: "EIO" });
          }
          original(target, options);
        }, () => restoreAndVerifyRuntimeBackup({
          authority: fixtureAuthority,
          backupId: "verified-backup",
        })), (error) => error instanceof RuntimeBackupError &&
          error.code === "RUNTIME_BACKUP_CLEANUP_REQUIRED");
        assert.equal(injected, true, mode);
        assert.equal(fs.existsSync(restoreBase), false, mode);
      }
    });

    await scenario("exact 190-character production shape inventories creates verifies and restores", () => {
      const productionShapeSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
      const fileName = `animation-${"a".repeat(64)}.json`;
      const relativePath = `${productionShapeSlug}/assets/animations/${fileName}`;
      assert.equal(productionShapeSlug.length, 92);
      assert.equal(fileName.length, 79);
      assert.equal(relativePath.length, 190);
      validateRuntimeBackupRelativePath(relativePath);
      const projectRoot = path.join(fixtureProjects, productionShapeSlug);
      const sourceFile = path.join(projectRoot, "assets", "animations", fileName);
      const bytes = Buffer.from("legacy-production-shape-byte-exact\u0000\u00ff", "latin1");
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
      const shortRoot = allocateBackupRootForPartialLength(relativePath, 259);
      const shortAuthority = bootstrapTestRuntimeBackupStorageAuthority(
        fixtureContext,
        shortRoot,
      );
      try {
        fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
        fs.writeFileSync(sourceFile, bytes);
        const before = collectRuntimeBackupInventory({
          context: fixtureContext,
          projectSlug: productionShapeSlug,
          repositoryRoot: fixtureRepository,
          now: () => fixedNow,
        });
        assert.equal(before.inventory.files, 1);
        assert.equal(before.files[0].relativePath, relativePath);
        assert.equal(before.files[0].sizeBytes, bytes.length);
        assert.equal(before.files[0].sha256, expectedSha256);
        let exactBoundaryWriteObserved = false;
        const created = withCopyFileInterceptor((original, source, destination, mode) => {
          if (String(source) === sourceFile) {
            assert.equal(String(destination).length, 259);
            exactBoundaryWriteObserved = true;
          }
          original(source, destination, mode);
        }, () => createVerifiedRuntimeBackup({
          authority: shortAuthority,
          projectSlug: productionShapeSlug,
        }, {
          backupId: "b",
        }));
        assert.equal(exactBoundaryWriteObserved, true);
        assert.equal(created.manifest.aggregateFingerprint, before.aggregateFingerprint);
        assert.equal(created.verification.aggregateFingerprint, before.aggregateFingerprint);
        const verified = verifyRuntimeBackup(created.backupDirectory);
        assert.equal(verified.manifest.pathPolicyVersion, runtimeBackupPathPolicyVersion);
        const copiedFile = path.join(
          created.backupDirectory,
          "payload",
          "projects",
          ...relativePath.split("/"),
        );
        assert.equal(fs.statSync(copiedFile).size, bytes.length);
        assert.equal(sha256(copiedFile), expectedSha256);
        let restoreCopyVerified = false;
        const restored = withCopyFileInterceptor((original, source, destination, mode) => {
          original(source, destination, mode);
          if (String(source) === copiedFile) {
            assert.equal(fs.statSync(destination).size, bytes.length);
            assert.equal(sha256(String(destination)), expectedSha256);
            restoreCopyVerified = true;
          }
        }, () => restoreAndVerifyRuntimeBackup({
          authority: shortAuthority,
          backupId: "b",
          projectSlug: productionShapeSlug,
        }));
        assert.equal(restoreCopyVerified, true);
        assert.equal(restored.aggregateFingerprint, before.aggregateFingerprint);
        assert.equal(fs.existsSync(restored.restoreRoot), false);
        assert.deepEqual(runtimeMutationResidues(shortRoot), []);
        const boundaryPlusOneRoot = allocateBackupRootForPartialLength(relativePath, 260);
        const boundaryPlusOneAuthority = bootstrapTestRuntimeBackupStorageAuthority(
          fixtureContext,
          boundaryPlusOneRoot,
        );
        try {
          assert.equal(fs.existsSync(boundaryPlusOneRoot), false);
          assert.throws(() => createVerifiedRuntimeBackup({
            authority: boundaryPlusOneAuthority,
            projectSlug: productionShapeSlug,
          }, { backupId: "b" }),
          (error) => error instanceof RuntimeBackupError &&
            error.code === "RUNTIME_BACKUP_PATH_INVALID");
          assert.equal(fs.existsSync(boundaryPlusOneRoot), false);
        } finally {
          fs.rmSync(boundaryPlusOneRoot, { recursive: true, force: true });
        }

        const legacyLongBackup = allocateBackupRootForPartialLength(relativePath, 259);
        try {
          fs.cpSync(created.backupDirectory, legacyLongBackup, { recursive: true });
          const manifestPath = path.join(legacyLongBackup, "manifest.json");
          const legacyManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as
            Record<string, unknown>;
          legacyManifest.schemaVersion = runtimeBackupManifestSchemaVersionV1;
          legacyManifest.backupFormatVersion = runtimeBackupFormatVersionV1;
          delete legacyManifest.pathPolicyVersion;
          delete legacyManifest.sourceRuntimeAuthority;
          const legacySerialized = `${JSON.stringify(legacyManifest, null, 2)}\n`;
          fs.writeFileSync(manifestPath, legacySerialized);
          fs.writeFileSync(
            path.join(legacyLongBackup, "manifest.sha256"),
            `${runtimeBackupManifestSha256(legacySerialized)}\n`,
          );
          const rejectsLegacyLongPath = (error: unknown) =>
            error instanceof Error && error.message === "Runtime backup file record is invalid.";
          assert.throws(() => verifyRuntimeBackup(legacyLongBackup), rejectsLegacyLongPath);
          assert.throws(() => portableVerifyRuntimeBackup({
            authority: fixtureAuthority,
            backupDirectory: legacyLongBackup,
          }), rejectsLegacyLongPath);
        } finally {
          fs.rmSync(legacyLongBackup, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(shortRoot, { recursive: true, force: true });
      }
    });

    await scenario("project-level backup remains reusable", () => {
      const result = createVerifiedRuntimeBackup({
        authority: fixtureAuthority,
        projectSlug: "project-b",
      }, { backupId: "project-b-only" });
      assert.equal(result.manifest.sourceLogicalIdentity, "projects/project-b");
      assert.ok(result.manifest.files.every((file) => file.relativePath.startsWith("project-b/")));
    });

    await scenario("independent exact 259 public chain passes and 260 rejects before mutation", () => {
      const slug = "boundary-independent";
      const relativePath = `${slug}/x.bin`;
      const source = path.join(fixtureProjects, slug, "x.bin");
      const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, bytes);
      const root259 = allocateNestedBackupRootForPartialLength(relativePath, 259);
      const root260 = allocateNestedBackupRootForPartialLength(relativePath, 260);
      try {
        const authority259 = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, root259);
        let observed = false;
        const created = withCopyFileInterceptor((original, from, destination, mode) => {
          if (String(from) === source) {
            assert.equal(String(destination).length, 259);
            observed = true;
          }
          original(from, destination, mode);
        }, () => createVerifiedRuntimeBackup({
          authority: authority259,
          projectSlug: slug,
        }, { backupId: "i" }));
        assert.equal(observed, true);
        const verified = verifyRuntimeBackup(created.backupDirectory);
        assert.equal(verified.files, 1);
        assert.equal(verified.bytes, bytes.length);
        assert.equal(sha256(path.join(
          created.backupDirectory,
          "payload",
          "projects",
          slug,
          "x.bin",
        )), createHash("sha256").update(bytes).digest("hex"));
        assert.equal(restoreAndVerifyRuntimeBackup({
          authority: authority259,
          backupId: "i",
          projectSlug: slug,
        }).aggregateFingerprint, verified.aggregateFingerprint);

        const authority260 = bootstrapTestRuntimeBackupStorageAuthority(fixtureContext, root260);
        assert.throws(() => createVerifiedRuntimeBackup({
          authority: authority260,
          projectSlug: slug,
        }, { backupId: "i" }), (error) => error instanceof RuntimeBackupError &&
          error.code === "RUNTIME_BACKUP_PATH_INVALID");
        assert.equal(fs.existsSync(root260), false);
        assert.deepEqual(runtimeMutationResidues(root260), []);
      } finally {
        fs.rmSync(path.join(fixtureProjects, slug), { recursive: true, force: true });
        fs.rmSync(root259, { recursive: true, force: true });
        fs.rmSync(root260, { recursive: true, force: true });
      }
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

function allocateBackupRootForPartialLength(
  longestRelativePath: string,
  targetMaterializedLength: number,
) {
  const partialSuffixLength =
    1 + ".p-00000000".length +
    1 + "payload".length +
    1 + "projects".length +
    1 + longestRelativePath.length;
  const requiredRootLength = targetMaterializedLength - partialSuffixLength;
  const candidates = [os.tmpdir(), path.parse(os.tmpdir()).root];
  for (const parent of candidates) {
    const segmentLength = requiredRootLength - path.resolve(parent).length - 1;
    if (segmentLength < 1 || segmentLength > 120) continue;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const randomPrefix = randomBytes(16).toString("hex").slice(0, segmentLength);
      const name = randomPrefix.padEnd(segmentLength, "b");
      const target = path.join(parent, name);
      const longestTarget = path.join(
        target,
        ".p-00000000",
        "payload",
        "projects",
        ...longestRelativePath.split("/"),
      );
      if (
        longestTarget.length === targetMaterializedLength &&
        !fs.existsSync(target)
      ) return target;
    }
  }
  throw new Error("Unable to allocate an exact-boundary runtime backup fixture root.");
}

function allocateNestedBackupRootForPartialLength(
  longestRelativePath: string,
  targetMaterializedLength: number,
) {
  const partialSuffixLength =
    1 + ".p-00000000".length +
    1 + "payload".length +
    1 + "projects".length +
    1 + longestRelativePath.length;
  const requiredRootLength = targetMaterializedLength - partialSuffixLength;
  const root = path.resolve(os.tmpdir());
  let remaining = requiredRootLength - root.length;
  const segments: string[] = [];
  let index = 0;
  while (remaining > 0) {
    const separator = segments.length === 0 && root.endsWith(path.sep) ? 0 : 1;
    const length = Math.min(100, remaining - separator);
    if (length <= 0) throw new Error("Unable to allocate nested boundary root.");
    segments.push(`${String.fromCharCode(97 + index)}${"b".repeat(length - 1)}`);
    remaining -= separator + length;
    index += 1;
  }
  const target = path.join(root, ...segments);
  const materialized = path.join(
    target,
    ".p-00000000",
    "payload",
    "projects",
    ...longestRelativePath.split("/"),
  );
  assert.equal(materialized.length, targetMaterializedLength);
  if (fs.existsSync(target)) throw new Error("Boundary root already exists.");
  return target;
}

function runtimeMutationResidues(root: string) {
  if (!fs.existsSync(root)) return [];
  const residues: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (
        entry.name.startsWith(".p-") ||
        entry.name.includes("publish.lock") ||
        entry.name.startsWith(".runtime-mutation-")
      ) residues.push(path.relative(root, absolute));
      if (entry.isDirectory()) visit(absolute);
    }
  };
  visit(root);
  return residues.sort();
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

function strictDtoVariants(
  valid: Record<string, unknown>,
  expectedKey: string,
): readonly (readonly [string, unknown])[] {
  const inherited = Object.assign(Object.create({ manifest: {} }), valid);
  const inheritedExpected = Object.assign(Object.create({
    [expectedKey]: valid[expectedKey],
  }), Object.fromEntries(Object.entries(valid).filter(([key]) => key !== expectedKey)));
  const symbol = { ...valid } as Record<PropertyKey, unknown>;
  symbol[Symbol("hidden")] = true;
  const getter = { ...valid };
  Object.defineProperty(getter, "hidden", { enumerable: true, get: () => true });
  const setter = { ...valid };
  Object.defineProperty(setter, "hidden", { enumerable: true, set: () => undefined });
  const accessorExpected = { ...valid };
  Object.defineProperty(accessorExpected, expectedKey, {
    enumerable: true,
    get: () => valid[expectedKey],
  });
  const nonEnumerable = { ...valid };
  Object.defineProperty(nonEnumerable, "hidden", { enumerable: false, value: true });
  const classInstance = Object.assign(new (class StrictDtoClass {})(), valid);
  const nullPrototype = Object.assign(Object.create(null), valid);
  const array = Object.assign([], valid);
  const callable = Object.assign(() => undefined, valid);
  const boxed = Object.assign(new String("boxed"), valid);
  return [
    ["inherited property", inherited],
    ["inherited expected property", inheritedExpected],
    ["symbol key", symbol],
    ["getter", getter],
    ["setter", setter],
    ["expected accessor", accessorExpected],
    ["proxy", new Proxy({ ...valid }, {})],
    ["class instance", classInstance],
    ["null prototype", nullPrototype],
    ["array", array],
    ["function", callable],
    ["boxed primitive", boxed],
    ["non-enumerable excess", nonEnumerable],
  ];
}

type CopyFileSync = typeof fs.copyFileSync;
type RmSync = typeof fs.rmSync;
type ReadFileSync = typeof fs.readFileSync;
type WriteFileSync = typeof fs.writeFileSync;
type RmdirSync = typeof fs.rmdirSync;

function withCopyFileInterceptor<T>(
  interceptor: (
    original: CopyFileSync,
    source: fs.PathLike,
    destination: fs.PathLike,
    mode?: number,
  ) => void,
  run: () => T,
): T {
  const original = fs.copyFileSync;
  fs.copyFileSync = ((source, destination, mode) => {
    interceptor(original, source, destination, mode);
  }) as CopyFileSync;
  try {
    return run();
  } finally {
    fs.copyFileSync = original;
  }
}

function withRmSyncInterceptor<T>(
  interceptor: (original: RmSync, target: fs.PathLike, options?: fs.RmDirOptions) => void,
  run: () => T,
): T {
  const original = fs.rmSync;
  fs.rmSync = ((target, options) => {
    interceptor(original, target, options);
  }) as RmSync;
  try {
    return run();
  } finally {
    fs.rmSync = original;
  }
}

function withReadFileSyncInterceptor<T>(
  interceptor: (
    original: ReadFileSync,
    target: fs.PathOrFileDescriptor,
    options?: Parameters<ReadFileSync>[1],
  ) => ReturnType<ReadFileSync>,
  run: () => T,
): T {
  const original = fs.readFileSync;
  fs.readFileSync = ((target, options) => interceptor(
    original,
    target,
    options,
  )) as ReadFileSync;
  try {
    return run();
  } finally {
    fs.readFileSync = original;
  }
}

function withWriteFileSyncInterceptor<T>(
  interceptor: (
    original: WriteFileSync,
    target: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    options?: Parameters<WriteFileSync>[2],
  ) => void,
  run: () => T,
): T {
  const original = fs.writeFileSync;
  fs.writeFileSync = ((target, data, options) => interceptor(
    original,
    target,
    data,
    options,
  )) as WriteFileSync;
  try {
    return run();
  } finally {
    fs.writeFileSync = original;
  }
}

function withRmdirSyncInterceptor<T>(
  interceptor: (
    original: RmdirSync,
    target: fs.PathLike,
    options?: Parameters<RmdirSync>[1],
  ) => void,
  run: () => T,
): T {
  const original = fs.rmdirSync;
  fs.rmdirSync = ((target, options) => interceptor(original, target, options)) as RmdirSync;
  try {
    return run();
  } finally {
    fs.rmdirSync = original;
  }
}

function insidePath(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function asV1Manifest(manifest: RuntimeBackupManifest): RuntimeBackupManifest {
  const legacy = { ...manifest } as Record<string, unknown>;
  delete legacy.pathPolicyVersion;
  legacy.schemaVersion = runtimeBackupManifestSchemaVersionV1;
  legacy.backupFormatVersion = runtimeBackupFormatVersionV1;
  return legacy as unknown as RuntimeBackupManifest;
}

async function runConcurrentCreateChild(arguments_: string[]) {
  const [fixtureRepository, runtimeRoot, backupRoot, startAtRaw, authorityRoot, marker] = arguments_;
  if (!fixtureRepository || !runtimeRoot || !backupRoot || !startAtRaw || !authorityRoot || !marker) {
    process.exit(2);
  }
  const delay = Math.max(0, Number(startAtRaw) - Date.now());
  await new Promise((resolve) => setTimeout(resolve, delay));
  const context = createRuntimeStorageContext({
    workspaceRoot: fixtureRepository,
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    authorityRoot,
  });
  const authority = bootstrapTestRuntimeBackupStorageAuthority(context, backupRoot);
  try {
    createVerifiedRuntimeBackup({
      authority,
    }, {
      backupId: "concurrent-backup",
    });
    process.stdout.write(`SUCCESS:${marker}\n`);
  } catch (error) {
    if (error instanceof RuntimeBackupError && error.code === "RUNTIME_BACKUP_TARGET_EXISTS") {
      process.stdout.write(`CONTENDED:${marker}\n`);
      return;
    }
    throw error;
  }
}

async function runSourceDriftChild(arguments_: string[]) {
  const [barrier, acknowledgement, source] = arguments_;
  if (!barrier || !acknowledgement || !source) process.exit(2);
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(barrier)) {
    if (Date.now() > deadline) process.exit(3);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  fs.appendFileSync(source, "-CHANGED-BY-CHILD");
  fs.writeFileSync(acknowledgement, "done");
}

function waitForFile(target: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(target)) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for source-drift barrier.");
    Atomics.wait(signal, 0, 0, 5);
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
