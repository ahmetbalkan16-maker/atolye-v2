/**
 * F17-B — the genesis authority transition compares source and target by
 * **logical project identity** (`sourceProjectIdentities`), not physical folder
 * name, so a slug-layout `<repo>/data/projects` source validates against a
 * `projectId`-layout migration target (the v3 backup path policy, C.2B.8 PR2,
 * remaps `<slug>/…` → `<projectId>/…`).
 *
 *   F17-A  slug source + projectId target → validate PASS
 *   F17-B  same identity, different physical folder name → PASS
 *   F17-C  a source folder with no identity map entry → TRANSITION_SOURCE_IDENTITY_MISSING
 *   F17-D  an unknown target projectId folder → TRANSITION_TARGET_IDENTITY_UNKNOWN
 *   F17-E  a duplicate project identity → TRANSITION_INPUT_INVALID
 *   F17-F  a canonical file SHA changes on the target → TRANSITION_TARGET_CONTENT_MISMATCH
 *   F17-G  an extra file on the target → TRANSITION_TARGET_CONTENT_MISMATCH
 *   F17-H  a missing file on the target → TRANSITION_TARGET_CONTENT_MISMATCH
 *   F17-I  a `.partial` change on either side → digest unchanged (F16-A preserved)
 *   F17-J  a `.pipeline-jobs.*` change on either side → digest unchanged
 *   F17-K  a symlink under the target tree → TRANSITION_CONTENT_UNSAFE
 *   F17-L  a candidate-supplied identity map ≠ the frozen one → TRANSITION_IDENTITY_BINDING_MISMATCH
 *   F17-M  backward compat — no identity map → structural (folder-name) comparison unchanged
 *   F17-N  real 17-project source → real projectId target (read-only, or SKIP)
 *
 * Run: npx tsx scripts/smoke-f17-authority-identity-mapped-validation.ts
 * Real `data/projects/**` and `.env.local` are never mutated.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { verifyRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupVerifier";
import { verifyMigrationCandidate } from "../src/lib/runtime/migration/RuntimeMigrationCandidateVerifier";
import {
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  runtimeAuthorityProjectsContentDigest,
} from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import {
  beginGenesisTransition,
  confirmQuiescence,
  prepareTransition,
  validateTarget,
} from "../src/lib/runtime/security/RuntimeAuthorityTransitionCoordinator";

const NOW = "2026-09-09T00:00:00.000Z";
const GEN = "gen-f17";
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "f17-"));
let seq = 0;
let count = 0;
const notes: string[] = [];

function scenario(name: string, run: () => void) {
  try { run(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
  catch (e) { console.error(`SCENARIO FAILED [${name}]:`, e); throw e; }
}
const errCode = (code: string) => (e: unknown) =>
  e instanceof RuntimeAuthorityTransitionError && e.code === code;

function w(p: string, v: string) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, v); }
const idFor = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-00000000000${n}`.slice(0, 36);

interface Fixture {
  base: string; workspaceRoot: string; authorityRoot: string; externalRoot: string;
  sourceProjects: string; targetProjects: string;
  identities: { projectId: string; projectSlug: string }[];
  legacyCtx: () => ReturnType<typeof createRuntimeStorageContext>;
  externalCtx: () => ReturnType<typeof createRuntimeStorageContext>;
  store: () => RuntimeAuthorityTransitionStore;
}

/** slug-layout source + projectId-layout target with byte-identical per-project content. */
function build(tag: string, projects: string[]): Fixture {
  seq += 1;
  const base = path.join(SANDBOX, `${tag}-${seq}`);
  const workspaceRoot = path.join(base, "repo");
  const authorityRoot = path.join(base, "authority");
  const externalRoot = path.join(base, "external");
  const sourceProjects = path.join(workspaceRoot, "data", "projects");
  const targetProjects = path.join(externalRoot, "projects");
  fs.mkdirSync(authorityRoot, { recursive: true });
  fs.mkdirSync(targetProjects, { recursive: true });

  const identities = projects.map((slug, i) => ({ projectId: idFor(i + 1), projectSlug: slug }));
  for (const { projectId, projectSlug } of identities) {
    for (const [rel, body] of [
      ["project.json", `{"slug":"${projectSlug}","id":"${projectId}"}\n`],
      ["production-execution/attempts/pipeline-attempt-" + "a".repeat(64) + "-v1.json", `{"state":"succeeded","p":"${projectSlug}"}\n`],
      ["production-execution/idempotency/pipeline-record-" + "b".repeat(64) + "-v1.json", `{"state":"settled"}\n`],
    ] as const) {
      w(path.join(sourceProjects, projectSlug, rel), body);
      w(path.join(targetProjects, projectId, rel), body);
    }
    // F16-A transients — SOURCE ONLY (the real migration excludes them)
    w(path.join(sourceProjects, projectSlug, "production-execution/audio-compensation-recovery/.audio-journal-staging/x.json.abcd1234-1.partial"), "staging");
    w(path.join(sourceProjects, projectSlug, ".pipeline-jobs.lock/owner.json"), `{"pid":1}\n`);
  }
  // a top-level file, identical on both sides
  w(path.join(sourceProjects, "orphan-top-level.json"), `{"x":1}\n`);
  w(path.join(targetProjects, "orphan-top-level.json"), `{"x":1}\n`);

  return {
    base, workspaceRoot, authorityRoot, externalRoot, sourceProjects, targetProjects, identities,
    legacyCtx: () => createRuntimeStorageContext({ environment: {}, workspaceRoot, authorityRoot }),
    externalCtx: () => createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: externalRoot }, workspaceRoot, authorityRoot }),
    store: () => new RuntimeAuthorityTransitionStore({ authorityRoot, now: () => NOW }),
  };
}

function slugs(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-zA-Z0-9-_]+$/.test(e.name)).map((e) => e.name).sort();
}

/** genesis begin → quiesce → prepare(identity) ; returns { store, tid } left at "prepared". */
function toPrepared(fx: Fixture, tid: string, opts: { identities?: { projectId: string; projectSlug: string }[] } = {}) {
  const store = fx.store();
  beginGenesisTransition({
    store, transitionId: tid, legacySourceContext: fx.legacyCtx(),
    authorityGeneration: GEN, targetContext: fx.externalCtx(),
  });
  confirmQuiescence({ store, transitionId: tid, workerLifecycleState: "stopped", durableRecovery: "clean" });
  prepareTransition({
    store, transitionId: tid,
    sourceProjectSlugs: slugs(fx.sourceProjects),
    sourceProjectsRoot: fx.sourceProjects,
    projectIdentities: opts.identities ?? fx.identities,
  });
  return { store, tid };
}
function doValidate(fx: Fixture, store: RuntimeAuthorityTransitionStore, tid: string, identities?: { projectId: string; projectSlug: string }[]) {
  return validateTarget({
    store, transitionId: tid, targetContext: fx.externalCtx(), targetAuthorityGeneration: GEN,
    targetProjectSlugs: slugs(fx.targetProjects), targetProjectsRoot: fx.targetProjects,
    ...(identities ? { projectIdentities: identities } : {}),
  });
}

/* ==================================================================== A/B */

scenario("F17-A/B: slug source + projectId target, same identities → validate PASS", () => {
  const fx = build("ab", ["proj-alpha", "proj-beta", "proj-gamma"]);
  const { store, tid } = toPrepared(fx, "f17-ab-0001");
  const frozen = store.readTransition(tid)!.sourceFreeze!;
  assert.equal(frozen.projectIdentities?.length, 3);
  assert.ok(frozen.logicalContentDigest && frozen.logicalFileCount);
  const rec = doValidate(fx, store, tid, fx.identities);
  assert.equal(rec.state, "target-validated");
  assert.equal(rec.targetValidation?.byteExact, true);
  notes.push(`A/B: 3 projects, logical digest ${frozen.logicalContentDigest!.slice(0, 16)}… / ${frozen.logicalFileCount} files → PASS`);
});

/* ==================================================================== C */

scenario("F17-C: a source folder with no identity entry → TRANSITION_SOURCE_IDENTITY_MISSING", () => {
  const fx = build("c", ["proj-a", "proj-b"]);
  w(path.join(fx.sourceProjects, "proj-orphan", "project.json"), `{"slug":"proj-orphan"}\n`);
  const store = fx.store();
  beginGenesisTransition({ store, transitionId: "f17-c-0001", legacySourceContext: fx.legacyCtx(), authorityGeneration: GEN, targetContext: fx.externalCtx() });
  confirmQuiescence({ store, transitionId: "f17-c-0001", workerLifecycleState: "stopped", durableRecovery: "clean" });
  assert.throws(() => prepareTransition({
    store, transitionId: "f17-c-0001", sourceProjectSlugs: slugs(fx.sourceProjects),
    sourceProjectsRoot: fx.sourceProjects, projectIdentities: fx.identities,
  }), errCode("TRANSITION_SOURCE_IDENTITY_MISSING"));
});

/* ==================================================================== D */

scenario("F17-D: an unknown target projectId folder → TRANSITION_TARGET_IDENTITY_UNKNOWN", () => {
  const fx = build("d", ["proj-a", "proj-b"]);
  const { store, tid } = toPrepared(fx, "f17-d-0001");
  w(path.join(fx.targetProjects, "deadbeef-0000-4000-8000-000000000099", "project.json"), `{"x":1}\n`);
  assert.throws(() => doValidate(fx, store, tid, fx.identities), errCode("TRANSITION_TARGET_IDENTITY_UNKNOWN"));
});

/* ==================================================================== E */

scenario("F17-E: duplicate project identity → TRANSITION_INPUT_INVALID", () => {
  const fx = build("e", ["proj-a", "proj-b"]);
  const store = fx.store();
  beginGenesisTransition({ store, transitionId: "f17-e-0001", legacySourceContext: fx.legacyCtx(), authorityGeneration: GEN, targetContext: fx.externalCtx() });
  confirmQuiescence({ store, transitionId: "f17-e-0001", workerLifecycleState: "stopped", durableRecovery: "clean" });
  const dup = [...fx.identities, { projectId: fx.identities[0].projectId, projectSlug: "proj-c" }];
  assert.throws(() => prepareTransition({
    store, transitionId: "f17-e-0001", sourceProjectSlugs: slugs(fx.sourceProjects),
    sourceProjectsRoot: fx.sourceProjects, projectIdentities: dup,
  }), errCode("TRANSITION_INPUT_INVALID"));
});

/* ==================================================================== F/G/H */

for (const [tag, mutate, label] of [
  ["f", (fx: Fixture) => fs.appendFileSync(path.join(fx.targetProjects, fx.identities[0].projectId, "project.json"), " "), "changed SHA"],
  ["g", (fx: Fixture) => w(path.join(fx.targetProjects, fx.identities[0].projectId, "extra.json"), "{}"), "extra file"],
  ["h", (fx: Fixture) => fs.rmSync(path.join(fx.targetProjects, fx.identities[0].projectId, "project.json")), "missing file"],
] as const) {
  scenario(`F17-${tag.toUpperCase()}: target ${label} → TRANSITION_TARGET_CONTENT_MISMATCH`, () => {
    const fx = build(tag, ["proj-a", "proj-b"]);
    const { store, tid } = toPrepared(fx, `f17-${tag}-0001`);
    mutate(fx);
    assert.throws(() => doValidate(fx, store, tid, fx.identities), errCode("TRANSITION_TARGET_CONTENT_MISMATCH"));
  });
}

/* ==================================================================== I/J */

scenario("F17-I/J: .partial and .pipeline-jobs.* changes never change the authority digest", () => {
  const fx = build("ij", ["proj-a"]);
  const before = runtimeAuthorityProjectsContentDigest(fx.sourceProjects);
  fs.appendFileSync(path.join(fx.sourceProjects, "proj-a", "production-execution/audio-compensation-recovery/.audio-journal-staging/x.json.abcd1234-1.partial"), " MUT");
  w(path.join(fx.sourceProjects, "proj-a", "production-execution/audio-compensation-cleanup/.audio-journal-staging/y.json.ffff0000-2.partial"), "new");
  w(path.join(fx.sourceProjects, "proj-a", ".pipeline-jobs.identity-xyz", "z"), "id");
  assert.equal(runtimeAuthorityProjectsContentDigest(fx.sourceProjects).contentDigest, before.contentDigest);
  // and still PASS end to end
  const { store, tid } = toPrepared(fx, "f17-ij-0001");
  assert.equal(doValidate(fx, store, tid, fx.identities).state, "target-validated");
});

/* ==================================================================== K */

scenario("F17-K: a symlink under the target tree → TRANSITION_CONTENT_UNSAFE (exclusion never bypasses security)", () => {
  const fx = build("k", ["proj-a", "proj-b"]);
  const { store, tid } = toPrepared(fx, "f17-k-0001");
  const link = path.join(fx.targetProjects, fx.identities[0].projectId, "production-execution", "audio-compensation-recovery", ".audio-journal-staging", "evil.json.aaaa0000-1.partial");
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(fx.targetProjects, "orphan-top-level.json"), link, "file");
  } catch { notes.push("F17-K: symlink creation unsupported — SKIP"); return; }
  assert.throws(() => doValidate(fx, store, tid, fx.identities), errCode("TRANSITION_CONTENT_UNSAFE"));
});

/* ==================================================================== L */

scenario("F17-L: candidate-supplied identity map ≠ frozen → TRANSITION_IDENTITY_BINDING_MISMATCH", () => {
  const fx = build("l", ["proj-a", "proj-b"]);
  const { store, tid } = toPrepared(fx, "f17-l-0001");
  const tampered = fx.identities.map((e, i) => i === 0 ? { projectId: e.projectId, projectSlug: "proj-renamed" } : e);
  assert.throws(() => doValidate(fx, store, tid, tampered), errCode("TRANSITION_IDENTITY_BINDING_MISMATCH"));
});

/* ==================================================================== M */

scenario("F17-M: no identity map → structural folder-name comparison is unchanged (pre-F17-B)", () => {
  const fx = build("m", ["proj-a", "proj-b"]);
  // materialize a STRUCTURAL copy (slug folders on the target too)
  fs.rmSync(fx.targetProjects, { recursive: true, force: true });
  fs.cpSync(fx.sourceProjects, fx.targetProjects, { recursive: true });
  const store = fx.store();
  beginGenesisTransition({ store, transitionId: "f17-m-0001", legacySourceContext: fx.legacyCtx(), authorityGeneration: GEN, targetContext: fx.externalCtx() });
  confirmQuiescence({ store, transitionId: "f17-m-0001", workerLifecycleState: "stopped", durableRecovery: "clean" });
  prepareTransition({ store, transitionId: "f17-m-0001", sourceProjectSlugs: slugs(fx.sourceProjects), sourceProjectsRoot: fx.sourceProjects });
  const frozen = store.readTransition("f17-m-0001")!.sourceFreeze!;
  assert.equal(frozen.projectIdentities, undefined, "no identity map frozen");
  assert.ok(frozen.contentDigest, "raw content digest frozen");
  const rec = validateTarget({
    store, transitionId: "f17-m-0001", targetContext: fx.externalCtx(), targetAuthorityGeneration: GEN,
    targetProjectSlugs: slugs(fx.targetProjects), targetProjectsRoot: fx.targetProjects,
  });
  assert.equal(rec.state, "target-validated");
  assert.equal(rec.targetValidation?.byteExact, true);
});

/* ==================================================================== N */

scenario("F17-N: real 17-project slug source → real projectId target (read-only, or SKIP)", () => {
  const BACKUP = "D:\\AtolyeBackup\\backups\\b-0d971133190c";
  const CAND = "D:\\AtolyeCandidate\\candidates\\c-d3743b64c5830509cc380b58";
  const TARGET = "D:\\AtolyeRuntime\\projects";
  const sourceProjects = createRuntimeStorageContext().projectsRoot;
  if (!fs.existsSync(CAND) || !fs.existsSync(TARGET)) { notes.push("F17-N: SKIP — D:\\AtolyeCandidate / D:\\AtolyeRuntime not present"); return; }

  const backup = verifyRuntimeBackup(BACKUP);
  const cand = verifyMigrationCandidate(CAND).manifest;
  const identities = (cand.sourceBackup.sourceProjectIdentities ?? []).map((e) => ({ projectId: e.projectId, projectSlug: e.projectSlug }));
  assert.equal(identities.length, 17);
  assert.equal(cand.sourceBackup.manifestSha256, backup.manifestSha256, "candidate ↔ backup binding");

  const slugToId = new Map(identities.map((e) => [e.projectSlug, e.projectId]));
  const sourceLogical = runtimeAuthorityProjectsContentDigest(sourceProjects, {
    remapProjectFolder: (folder) => slugToId.get(folder) ?? folder,
  });
  const targetRaw = runtimeAuthorityProjectsContentDigest(TARGET);
  notes.push(`F17-N: source logical ${sourceLogical.fileCount}f ${sourceLogical.contentDigest} ; target ${targetRaw.fileCount}f ${targetRaw.contentDigest} ; match=${sourceLogical.contentDigest === targetRaw.contentDigest}`);
  assert.equal(targetRaw.contentDigest, sourceLogical.contentDigest, "F17-B: real source (identity-mapped) == real target");
  assert.equal(targetRaw.fileCount, sourceLogical.fileCount);

  // every source project folder maps; every target folder is a known projectId
  const knownIds = new Set(identities.map((e) => e.projectId));
  for (const folder of slugs(sourceProjects)) assert.ok(slugToId.has(folder), `source folder "${folder}" mapped`);
  for (const folder of slugs(TARGET)) assert.ok(knownIds.has(folder), `target folder "${folder}" is a known projectId`);
});

console.log(JSON.stringify({ suite: "f17-authority-identity-mapped-validation", status: "PASS", scenarios: count, notes }));
console.log(`F17 authority identity-mapped validation: PASS (${count} scenarios)`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
