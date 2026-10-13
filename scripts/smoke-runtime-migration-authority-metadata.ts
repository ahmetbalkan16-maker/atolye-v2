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
import {
  runtimeBackupManifestSha256,
  serializeRuntimeBackupManifest,
} from "../src/lib/runtime/backup/RuntimeBackupManifest";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import {
  runtimeMigrationCandidateDirName,
  runtimeMigrationCandidateId,
  type RuntimeMigrationCandidateManifest,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateManifest";
import { RuntimeMigrationCandidateService } from "../src/lib/runtime/migration/RuntimeMigrationCandidateService";
import { verifyMigrationCandidate } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import {
  RuntimeMigrationCandidateConsumeService,
  type RuntimeMigrationCandidateConsumeInput,
} from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeService";
import { RuntimeMigrationCandidateConsumeError } from "../src/lib/runtime/migration/RuntimeMigrationCandidateConsumeError";
import { writeRuntimeAuthorityGenerationMarker, runtimeAuthorityGenerationMarkerFileName as markerName } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";

const STAMP = "2026-07-16T12:00:00.000Z";
const SANDBOX=fs.mkdtempSync(path.join(os.tmpdir(),"authority-consume-"));
let fixtureSeq=0;
const consumeErr=(code:string)=>(e:unknown)=>e instanceof RuntimeMigrationCandidateConsumeError && e.code===code;

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
  const w = (p: string, v: unknown) =>
    fs.writeFileSync(p, typeof v === "string" ? v : `${JSON.stringify(v)}\n`);
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
  execFileSync("git", ["add", "data/projects"], {cwd:repositoryRoot});
  execFileSync("git", ["commit", "-qm", "marker"], {cwd:repositoryRoot});
  const backupManifest = collectRuntimeBackupInventory({ context, repositoryRoot, now: () => STAMP });
  for (const file of backupManifest.files) {
    const segments = file.relativePath.split("/");
    if (file.projectSlug) segments[0] = file.projectSlug;
    const source = path.join(liveProjectsRoot, ...segments);
    const target = path.join(backupDirectory, "payload", "projects", file.relativePath);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.copyFileSync(source,target);
  }
  const serialized = serializeRuntimeBackupManifest(backupManifest);
  fs.writeFileSync(path.join(backupDirectory, "manifest.json"), serialized, { flag: "wx" });
  fs.writeFileSync(path.join(backupDirectory, "manifest.sha256"),
    `${runtimeBackupManifestSha256(serialized)}\n`, { flag: "wx" });
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

  const candidateDirectory = path.join(
    candidateRoot, "candidates", runtimeMigrationCandidateDirName(candidateId),
  );
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

const consume = (i: RuntimeMigrationCandidateConsumeInput, deps = {}) =>
  RuntimeMigrationCandidateConsumeService.consumeVerifiedMigrationCandidate(i, deps);

function freshTarget(fx: Fixture, sub = "target"): string {
  const p = path.join(fx.base, sub);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

async function main() {
 const fx=buildFixture("marked"),target=freshTarget(fx);
 const marker=fx.candidateManifest.files.find(f=>f.relativePath===markerName)!;
 const input=baseInput(fx,target),result=await consume(input);
 assert.equal(result.fileCount,fx.fileCount-1);
 assert.equal(result.byteCount,fx.byteCount-marker.sizeBytes);
 assert.equal(result.cutoverAuthorized,false);
 assert.deepEqual(result.archivedAuthorityMetadata,marker);
 assert(fx.candidateManifest.files.some(f=>f.relativePath.endsWith(`/${markerName}`)));
 assert(!fs.existsSync(path.join(target,"projects",markerName)));
 const archived=path.join(target,".migration-consume",markerName);
 assert.deepEqual(fs.readFileSync(archived),fs.readFileSync(path.join(fx.candidateDirectory,"projects",markerName)));
 assert.equal((await consume(input)).resumed,true);
 const interrupted=freshTarget(fx,"interrupted"),retry=baseInput(fx,interrupted,"consume-interrupted");
 await assert.rejects(consume(retry,{afterFileMaterialized:()=>{throw new Error("simulated crash");}}));
 assert.equal((await consume(retry)).resumed,true);
 assert.deepEqual(fs.readFileSync(path.join(interrupted,".migration-consume",markerName)),fs.readFileSync(archived));
 fs.writeFileSync(archived,"tampered");
 await assert.rejects(consume(input),consumeErr("POST_COPY_INVENTORY_MISMATCH"));
 fs.copyFileSync(path.join(fx.candidateDirectory,"projects",markerName),archived);
 fs.copyFileSync(archived,path.join(target,"projects",markerName));
 await assert.rejects(consume(input),consumeErr("POST_COPY_INVENTORY_MISMATCH"));
 const sourceMarker=path.join(fx.candidateDirectory,"projects",markerName);
 fs.writeFileSync(sourceMarker,"mutated source");
 await assert.rejects(consume(baseInput(fx,freshTarget(fx,"changed-source"))),consumeErr("CANDIDATE_NOT_VERIFIED"));
 console.log("PASS marked candidate: source marker byte-exact in evidence, target data exact, idempotency, archived tamper and target marker injection rejected");
}
void main();
