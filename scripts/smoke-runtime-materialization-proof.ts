/**
 * C.2B.10a — Verified Candidate Consume & Offline Materialization.
 *
 * Builds a real verified backup + verified migration candidate from a small
 * synthetic source tree (git-backed, under an OS temp dir — the repository
 * `data/projects/**` and `.env.local` are never touched), then exercises the
 * consume service: empty-target / no-clobber, per-file SHA-256, byte-exact
 * post-copy digest, manifest / backup / durable binding, protected-root role
 * disjointness, symlink / traversal rejection, crash-and-restart safety, and
 * idempotency.
 *
 * Run: npx tsx scripts/smoke-c2b10a-candidate-consume.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import { runtimeBackupManifestSha256, serializeRuntimeBackupManifest, } from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { runtimeMigrationCandidateDirName, runtimeMigrationCandidateId, type RuntimeMigrationCandidateManifest, } from "../src/lib/runtime/migration/RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateService } from "../src/lib/runtime/migration/RuntimeMigrationCandidateService";
import { verifyMigrationCandidate } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import { RuntimeMigrationCandidateConsumeService, type RuntimeMigrationCandidateConsumeInput, } from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeService";
import { writeRuntimeAuthorityGenerationMarker, runtimeAuthorityGenerationMarkerFileName as markerName } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";
const STAMP = "2026-07-16T12:00:00.000Z";
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "authority-consume-"));
let fixtureSeq = 0;
interface Fixture {
    readonly base: string;
    readonly repositoryRoot: string;
    readonly liveProjectsRoot: string;
    readonly backupDirectory: string;
    readonly candidateRoot: string;
    readonly candidateId: string;
    readonly candidateDirectory: string;
    readonly candidateManifest: RuntimeMigrationCandidateManifest;
    readonly fileCount: number;
    readonly byteCount: number;
}
/** A real verified backup + verified candidate from a synthetic source tree. */
function buildFixture(_name: string): Fixture {
    fixtureSeq += 1;
    const base = path.join(SANDBOX, `f${fixtureSeq}`);
    const repositoryRoot = path.join(base, "r");
    const runtimeRoot = path.join(repositoryRoot, "data");
    const liveProjectsRoot = path.join(runtimeRoot, "projects");
    const authorityRoot = path.join(base, "a");
    const backupRoot = path.join(base, "bk");
    const backupDirectory = path.join(backupRoot, "b1");
    const candidateRoot = path.join(base, "cr");
    const restoreVerificationRoot = path.join(base, "rv");
    for (const d of [liveProjectsRoot, authorityRoot, backupRoot, candidateRoot, restoreVerificationRoot]) {
        fs.mkdirSync(d, { recursive: true });
    }
    const projA = path.join(liveProjectsRoot, "alpha");
    const projB = path.join(liveProjectsRoot, "beta");
    fs.mkdirSync(path.join(projA, "production-execution"), { recursive: true });
    fs.mkdirSync(path.join(projA, "assets"), { recursive: true });
    fs.mkdirSync(path.join(projB, "production-execution"), { recursive: true });
    const w = (p: string, v: unknown) => fs.writeFileSync(p, typeof v === "string" ? v : `${JSON.stringify(v)}\n`);
    w(path.join(projA, "project.json"), { slug: "alpha" });
    w(path.join(projA, "manifest.json"), { version: 1, nonce: `${_name}-${fixtureSeq}` });
    w(path.join(projA, "production-acceptance.json"), { schemaVersion: "2", accepted: true });
    w(path.join(projA, "production-execution", "a.json"), { state: "succeeded" });
    fs.writeFileSync(path.join(projA, "assets", "img.bin"), Buffer.from([0, 1, 2, 3, 255]));
    w(path.join(projB, "project.json"), { slug: "beta" });
    w(path.join(projB, markerName), "nested name is project data");
    w(path.join(projB, "manifest.json"), { version: 1 });
    w(path.join(projB, "production-execution", "a.json"), { state: "failed" });
    execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repositoryRoot });
    execFileSync("git", ["add", "data/projects"], { cwd: repositoryRoot });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repositoryRoot });
    const context = createRuntimeStorageContext({
        workspaceRoot: repositoryRoot,
        environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
        authorityRoot,
    });
    writeRuntimeAuthorityGenerationMarker({ context, authorityGeneration: "fixture-generation" });
    execFileSync("git", ["add", "data/projects"], { cwd: repositoryRoot });
    execFileSync("git", ["commit", "-qm", "marker"], { cwd: repositoryRoot });
    const backupManifest = collectRuntimeBackupInventory({ context, repositoryRoot, now: () => STAMP });
    for (const file of backupManifest.files) {
        const segments = file.relativePath.split("/");
        if (file.projectSlug)
            segments[0] = file.projectSlug;
        const source = path.join(liveProjectsRoot, ...segments);
        const target = path.join(backupDirectory, "payload", "projects", file.relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }
    const serialized = serializeRuntimeBackupManifest(backupManifest);
    fs.writeFileSync(path.join(backupDirectory, "manifest.json"), serialized, { flag: "wx" });
    fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"), `${runtimeBackupManifestSha256(serialized)}\n`, { flag: "wx" });
    const backup = verifyRuntimeBackup(backupDirectory);
    const candidateId = runtimeMigrationCandidateId({
        sourceBackupManifestSha256: backup.manifestSha256,
        sourceBackupAggregate: backup.aggregateFingerprint,
    });
    RuntimeMigrationCandidateService.createVerifiedMigrationCandidate({
        context,
        repositoryRoot,
        backupRoot,
        backupDirectory,
        candidateRoot,
        restoreVerificationRoot,
        confirmCandidateCreation: true,
        allowTestTempRoot: true,
    }, { now: () => STAMP });
    const candidateDirectory = path.join(candidateRoot, "candidates", runtimeMigrationCandidateDirName(candidateId));
    const candidateManifest = verifyMigrationCandidate(candidateDirectory).manifest;
    return {
        base, repositoryRoot, liveProjectsRoot, backupDirectory, candidateRoot,
        candidateId, candidateDirectory, candidateManifest,
        fileCount: candidateManifest.inventory.files,
        byteCount: candidateManifest.inventory.bytes,
    };
}
function baseInput(fx: Fixture, targetRoot: string, consumeId = "consume-happy-01"): RuntimeMigrationCandidateConsumeInput {
    return {
        consumeId,
        candidateId: fx.candidateId,
        candidateDirectory: fx.candidateDirectory,
        relocationTargetRoot: targetRoot,
        liveProjectsRoot: fx.liveProjectsRoot,
        backupDirectory: fx.backupDirectory,
        now: () => STAMP,
        allowTestTempRoot: true,
    };
}
const consume = (i: RuntimeMigrationCandidateConsumeInput, deps = {}) => RuntimeMigrationCandidateConsumeService.consumeVerifiedMigrationCandidate(i, deps);
function freshTarget(fx: Fixture, sub = "target"): string {
    const p = path.join(fx.base, sub);
    fs.mkdirSync(p, { recursive: true });
    return p;
}
import { createHash } from "node:crypto";
import { beginTransition, confirmQuiescence, prepareTransition, validateTarget, publishTransition, quarantineSource } from "../src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator";
import { RuntimeAuthorityTransitionStore } from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import { qualifyRuntimeMaterialization, resolveMaterializedFileIdentity, isMaterializedDirectoryIdentity, isMaterializedAuthorityBinding } from "../src/lib/runtime/security/RuntimeMaterializationProof";
import { readContainedAudioFileDescriptorBound } from "../src/lib/audio/AudioDescriptorBoundVerification";
import { describeRuntimeAuthorityIdentity } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";
async function main() {
    const fx = buildFixture("portability"), targetRoot = freshTarget(fx), sourceContext = createRuntimeStorageContext({ workspaceRoot: fx.repositoryRoot, authorityRoot: path.join(fx.base, "a"), environment: { ATOLYE_RUNTIME_ROOT: path.dirname(fx.liveProjectsRoot) } });
    const targetContext = createRuntimeStorageContext({ workspaceRoot: path.join(fx.base, "target-workspace"), authorityRoot: path.join(fx.base, "target-authority"), environment: { ATOLYE_RUNTIME_ROOT: targetRoot } });
    fs.mkdirSync(targetContext.workspaceRoot, { recursive: true });
    fs.mkdirSync(targetContext.authorityRoot, { recursive: true });
    const id = fx.candidateManifest.sourceBackup.sourceProjectIdentities!.find(e => e.projectSlug === "alpha")!.projectId;
    const sourceFile = path.join(sourceContext.projectsRoot, "alpha/assets/img.bin"), targetFile = path.join(targetContext.projectsRoot, id, "assets/img.bin");
    const bytes = fs.readFileSync(sourceFile), stat = fs.statSync(sourceFile), expected = { device: stat.dev, inode: stat.ino, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const sourceDirectory = path.dirname(sourceFile), targetDirectory = path.dirname(targetFile), dirStat = fs.statSync(sourceDirectory);
    await consume(baseInput(fx, targetRoot));
    assert.throws(() => readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected));
    const store = new RuntimeAuthorityTransitionStore({ authorityRoot: sourceContext.authorityRoot }), generation = "fixture-generation", transitionId = "fixture-materialization-01";
    beginTransition({ store, transitionId, sourceContext, sourceAuthorityGeneration: generation, targetContext, targetAuthorityGeneration: generation });
    confirmQuiescence({ store, transitionId, workerLifecycleState: "stopped", durableRecovery: "clean" });
    prepareTransition({ store, transitionId, sourceProjectsRoot: sourceContext.projectsRoot, sourceProjectSlugs: ["alpha", "beta"], projectIdentities: fx.candidateManifest.sourceBackup.sourceProjectIdentities });
    validateTarget({ store, transitionId, targetContext, targetAuthorityGeneration: generation, targetProjectsRoot: targetContext.projectsRoot, targetProjectSlugs: fx.candidateManifest.sourceBackup.sourceProjectIdentities!.map(e => e.projectId) });
    const anchor = qualifyRuntimeMaterialization({ store, transitionId, sourceContext, targetContext, candidateDirectory: fx.candidateDirectory, backupDirectory: fx.backupDirectory });
    assert.equal(anchor.length, 64);
    assert.throws(() => readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected));
    publishTransition({ store, transitionId, targetContext, targetAuthorityGeneration: generation });
    quarantineSource({ store, transitionId });
    fs.cpSync(sourceContext.authorityRoot, targetContext.authorityRoot, { recursive: true });
    assert.deepEqual(readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected), bytes);
    assert.deepEqual(fs.readFileSync(sourceFile), bytes);
    assert(isMaterializedDirectoryIdentity(targetContext, targetDirectory, { device: dirStat.dev, inode: dirStat.ino }));
    assert(!isMaterializedDirectoryIdentity(targetContext, targetDirectory, { device: dirStat.dev, inode: dirStat.ino + 1 }));
    assert(isMaterializedAuthorityBinding(targetContext, targetFile, describeRuntimeAuthorityIdentity(sourceContext, generation).resolverBindingIdentity));
    assert(!isMaterializedAuthorityBinding(targetContext, targetFile, "a".repeat(64)));
    assert.throws(() => readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, { ...expected, sha256: "a".repeat(64) }));
    const saved = path.join(targetDirectory, "before-swap.bin");
    fs.renameSync(targetFile, saved);
    fs.writeFileSync(targetFile, bytes);
    assert.throws(() => readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected));
    fs.unlinkSync(targetFile);
    fs.renameSync(saved, targetFile);
    fs.writeFileSync(targetFile, Buffer.alloc(bytes.length, 7));
    assert.throws(() => readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected));
    fs.writeFileSync(targetFile, bytes);
    assert.deepEqual(readContainedAudioFileDescriptorBound(targetDirectory, targetFile, targetContext, expected), bytes);
    const proofFile = path.join(targetContext.authorityRoot, "authority-transition-v1/materializations", transitionId + ".json"), proofBytes = fs.readFileSync(proofFile);
    fs.writeFileSync(proofFile, "{}");
    assert.throws(() => resolveMaterializedFileIdentity(targetContext, targetFile, expected));
    fs.writeFileSync(proofFile, proofBytes);
    console.log("PASS materialization: unqualified/unpublished rejected; official byte-exact file+directory+namespace admission; wrong hash/source identity/authority, same-byte inode swap, changed content and proof tamper rejected; original payload unchanged");
}
void main();
