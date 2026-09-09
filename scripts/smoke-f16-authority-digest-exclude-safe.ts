/**
 * F16-A — `runtimeAuthorityProjectsContentDigest` is `.partial` / `.pipeline-jobs.*`
 * EXCLUDE-SAFE, matching `collectRuntimeBackupInventory`.
 *
 * Sprint 204's real migration reached the genesis authority transition and would
 * have failed `authority:validate` with `TRANSITION_TARGET_CONTENT_MISMATCH`:
 * `authority:prepare` froze `runtimeAuthorityProjectsContentDigest(<repo>/data/projects)`
 * over 2399 files (incl. 27 abandoned `.audio-journal-staging/*.partial` + 1 stale
 * `.pipeline-jobs.lock/owner.json`), while the correctly-migrated target — built
 * from a backup that excludes those — has 2371. F16-A moves the F12/F5 exclusion
 * that already lives in `collectRuntimeBackupInventory` into the shared
 * `isRuntimeTransientExcludedRelativePath` predicate used by BOTH.
 *
 *   A  a tree with 27 `.partial` + 1 `.pipeline-jobs.lock/owner.json` → digest ignores them
 *   B  a normal runtime file changing → digest changes
 *   C  an excluded file changing / being added / removed → digest UNCHANGED
 *   D  prepare(source-with-transients) vs validate(target-without) → no spurious mismatch
 *   E  symlink / junction / non-regular file → still rejected (TRANSITION_CONTENT_UNSAFE)
 *   F  the two digests agree on the exclusion set (inventory vs authority digest)
 *
 * Run: npx tsx scripts/smoke-f16-authority-digest-exclude-safe.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { collectRuntimeBackupInventory } from "../src/lib/runtime/backup/RuntimeBackupInventory";
import { runtimeAuthorityProjectsContentDigest } from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import { isRuntimeTransientExcludedRelativePath } from "../src/lib/runtime/RuntimeTransientArtifactPolicy";

let count = 0;
const notes: string[] = [];
function scenario(name: string, run: () => void) {
  try { run(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
  catch (e) { console.error(`SCENARIO FAILED [${name}]:`, e); throw e; }
}

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "f16-"));
let seq = 0;
function w(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
}

/** A `projects/` tree with real durable records + the 28-shaped transient set. */
function buildProjects(tag: string): string {
  seq += 1;
  const root = path.join(SANDBOX, `${tag}-${seq}`, "projects");
  const p = path.join(root, "i-stanbul-un-fethi-1453");
  w(path.join(p, "project.json"), { slug: "i-stanbul-un-fethi-1453" });
  w(path.join(p, "production-acceptance.json"), { schemaVersion: "2", accepted: true });
  w(path.join(p, "production-execution", "attempts", "pipeline-attempt-" + "a".repeat(64) + "-v1.json"), { state: "succeeded" });
  w(path.join(p, "production-execution", "idempotency", "pipeline-record-" + "b".repeat(64) + "-v1.json"), { state: "settled" });
  w(path.join(p, "production-execution", "indexes", "lookup-" + "c".repeat(64) + ".json"), { schemaVersion: "1", reservations: [], idempotencyKeys: [], requestIds: [] });
  // 27 abandoned atomic-write staging partials (F12 layout, both dirs)
  for (let i = 0; i < 14; i += 1) {
    w(path.join(p, "production-execution", "audio-compensation-cleanup", ".audio-journal-staging",
      `retirement-audio-comp-${i}.json.${"d".repeat(8)}-${i}.partial`), "partial-cleanup-" + i);
  }
  for (let i = 0; i < 13; i += 1) {
    w(path.join(p, "production-execution", "audio-compensation-recovery", ".audio-journal-staging",
      `audio-comp-${i}.json.${"e".repeat(8)}-${i}.partial`), "partial-recovery-" + i);
  }
  // 1 stale PipelineJobMutationLock process-local mutex
  w(path.join(root, "suleymaniye-camii-2c5b8cdc", "project.json"), { slug: "suleymaniye" });
  w(path.join(root, "suleymaniye-camii-2c5b8cdc", ".pipeline-jobs.lock", "owner.json"), { pid: 1234, host: "x" });
  return root;
}

function relFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) { out.push("SYMLINK:" + path.relative(root, f).split(path.sep).join("/")); continue; }
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) out.push(path.relative(root, f).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out;
}

/* ------------------------------------------------------------------ A/C/F --- */

scenario("A: digest ignores 27 .partial + 1 .pipeline-jobs.lock/owner.json", () => {
  const root = buildProjects("a");
  const all = relFiles(root);
  const transient = all.filter(isRuntimeTransientExcludedRelativePath);
  const durable = all.filter((r) => !isRuntimeTransientExcludedRelativePath(r));
  assert.equal(transient.length, 28, `expected 28 transient, got ${transient.length}: ${JSON.stringify(transient)}`);
  assert.ok(transient.some((r) => r.endsWith("/.pipeline-jobs.lock/owner.json")), "pipeline-jobs lock excluded");
  assert.equal(transient.filter((r) => r.endsWith(".partial")).length, 27, "27 partials excluded");

  const digest = runtimeAuthorityProjectsContentDigest(root);
  assert.equal(digest.fileCount, durable.length, `digest fileCount ${digest.fileCount} must equal durable ${durable.length}`);
  notes.push(`A: ${all.length} files, ${transient.length} transient excluded, digest fileCount ${digest.fileCount}`);
});

scenario("F: authority digest and backup inventory exclude the SAME set", () => {
  const root = buildProjects("f");
  const ctx = createRuntimeStorageContext({
    workspaceRoot: path.dirname(path.dirname(root)),
    environment: { ATOLYE_RUNTIME_ROOT: path.dirname(root) },
    authorityRoot: path.join(SANDBOX, `auth-${seq}`),
  });
  fs.mkdirSync(ctx.authorityRoot, { recursive: true });
  const inv = collectRuntimeBackupInventory({ context: ctx, now: () => "2026-09-09T00:00:00.000Z" });
  const digest = runtimeAuthorityProjectsContentDigest(root);
  // inventory relativePath is projectId-remapped; compare COUNTS, and that the
  // transient names never appear in either output.
  assert.equal(digest.fileCount, inv.files.length,
    `authority digest fileCount ${digest.fileCount} != inventory ${inv.files.length}`);
  const invJson = JSON.stringify(inv.files);
  assert.equal(/\.partial"/.test(invJson), false, "inventory has no .partial");
  assert.equal(/\.pipeline-jobs\./.test(invJson), false, "inventory has no .pipeline-jobs.");
  notes.push(`F: authority digest ${digest.fileCount} == inventory ${inv.files.length} files`);
});

scenario("C: changing / adding / removing an excluded file does NOT change the digest", () => {
  const root = buildProjects("c");
  const before = runtimeAuthorityProjectsContentDigest(root);

  // mutate an existing .partial
  const partial = relFiles(root).find((r) => r.endsWith(".partial"))!;
  fs.appendFileSync(path.join(root, ...partial.split("/")), " MUTATED");
  assert.equal(runtimeAuthorityProjectsContentDigest(root).contentDigest, before.contentDigest, "mutating a .partial must not change the digest");

  // add a brand-new .partial + a new .pipeline-jobs.* entry
  w(path.join(root, "i-stanbul-un-fethi-1453", "production-execution", "audio-compensation-recovery", ".audio-journal-staging", "audio-comp-new.json.ffffffff-9.partial"), "new");
  w(path.join(root, "suleymaniye-camii-2c5b8cdc", ".pipeline-jobs.identity-abc", "x"), "id");
  assert.equal(runtimeAuthorityProjectsContentDigest(root).contentDigest, before.contentDigest, "adding excluded files must not change the digest");

  // remove one
  fs.rmSync(path.join(root, ...partial.split("/")));
  assert.equal(runtimeAuthorityProjectsContentDigest(root).contentDigest, before.contentDigest, "removing a .partial must not change the digest");
  assert.equal(runtimeAuthorityProjectsContentDigest(root).fileCount, before.fileCount, "fileCount stable");
});

/* -------------------------------------------------------------------- B --- */

scenario("B: changing a normal runtime file DOES change the digest", () => {
  const root = buildProjects("b");
  const before = runtimeAuthorityProjectsContentDigest(root);
  const normal = path.join(root, "i-stanbul-un-fethi-1453", "production-execution", "attempts", "pipeline-attempt-" + "a".repeat(64) + "-v1.json");
  fs.appendFileSync(normal, " ");
  const after = runtimeAuthorityProjectsContentDigest(root);
  assert.notEqual(after.contentDigest, before.contentDigest, "a durable record change MUST change the digest");
  assert.equal(after.fileCount, before.fileCount);
});

/* -------------------------------------------------------------------- D --- */

scenario("D: prepare(source with transients) vs validate(target without) → digests match", () => {
  const source = buildProjects("d-src");
  // build the "migrated target": every non-transient file, byte-for-byte, and
  // NONE of the transients — exactly what backup→candidate→consume produces.
  const target = path.join(SANDBOX, `d-tgt-${seq}`, "projects");
  for (const rel of relFiles(source)) {
    if (isRuntimeTransientExcludedRelativePath(rel)) continue;
    const src = path.join(source, ...rel.split("/"));
    const dst = path.join(target, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  const sourceFreeze = runtimeAuthorityProjectsContentDigest(source);   // what authority:prepare freezes
  const targetCheck = runtimeAuthorityProjectsContentDigest(target);     // what authority:validate computes
  assert.equal(targetCheck.contentDigest, sourceFreeze.contentDigest, "F16: no spurious TRANSITION_TARGET_CONTENT_MISMATCH");
  assert.equal(targetCheck.fileCount, sourceFreeze.fileCount);
  notes.push(`D: prepare freeze == validate check (${sourceFreeze.fileCount} files, digest ${sourceFreeze.contentDigest.slice(0, 16)}…)`);
});

/* -------------------------------------------------------------------- E --- */

scenario("E: symlink / non-regular file security is unchanged (rejected)", () => {
  const root = buildProjects("e");
  const link = path.join(root, "i-stanbul-un-fethi-1453", "production-execution", "attempts", "evil.json");
  let created = false;
  try {
    fs.symlinkSync(path.join(root, "i-stanbul-un-fethi-1453", "project.json"), link, "file");
    created = true;
  } catch { notes.push("E: symlink creation unsupported on this platform — SKIP"); }
  if (created) {
    assert.throws(
      () => runtimeAuthorityProjectsContentDigest(root),
      (e: unknown) => (e as { code?: string })?.code === "TRANSITION_CONTENT_UNSAFE",
      "a symlink under the projects tree must still throw TRANSITION_CONTENT_UNSAFE",
    );
    fs.rmSync(link);
  }
  // a symlink NAMED like an excluded path is still rejected (exclusion never bypasses the symlink gate)
  const evilPartial = path.join(root, "i-stanbul-un-fethi-1453", "production-execution", "audio-compensation-recovery", ".audio-journal-staging", "audio-comp-evil.json.aaaaaaaa-1.partial");
  fs.rmSync(evilPartial, { force: true });
  let created2 = false;
  try { fs.symlinkSync(path.join(root, "i-stanbul-un-fethi-1453", "project.json"), evilPartial, "file"); created2 = true; }
  catch { /* platform */ }
  if (created2) {
    assert.throws(
      () => runtimeAuthorityProjectsContentDigest(root),
      (e: unknown) => (e as { code?: string })?.code === "TRANSITION_CONTENT_UNSAFE",
      "a symlink whose name matches an excluded pattern must STILL be rejected",
    );
  }
});

/* ------------------------------------------------------------- real data --- */

scenario("real-data: F16-A drops the 28 transients from the real source digest (or SKIP)", () => {
  const repoProjects = createRuntimeStorageContext().projectsRoot;
  if (!fs.existsSync(repoProjects)) { notes.push("real-data: SKIP — repo data/projects not present"); return; }
  const src = runtimeAuthorityProjectsContentDigest(repoProjects);
  // fs walk of the same tree (excluding the authority-generation marker)
  let fsFiles = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(f);
      else if (e.isFile() && e.name !== ".runtime-authority-generation.json") fsFiles += 1;
    }
  };
  walk(repoProjects);
  const excluded = fsFiles - src.fileCount;
  notes.push(`real-data: fs ${fsFiles} files ; F16-A digest fileCount ${src.fileCount} ; excluded ${excluded} ; digest ${src.contentDigest}`);
  // post-Sprint-204 the real tree has exactly the 27 .partial + 1 .pipeline-jobs.lock/owner.json
  assert.equal(excluded, 28, `F16-A must exclude exactly the 28 transients (fs ${fsFiles} - digest ${src.fileCount})`);

  // F17 note: source (slug folders) and the Sprint-204 target (projectId folders)
  // still differ structurally — that is a SEPARATE blocker, not F16-A.
  const target = "D:\\AtolyeRuntime\\projects";
  if (fs.existsSync(target)) {
    const tgt = runtimeAuthorityProjectsContentDigest(target);
    notes.push(`F17: source digest ${src.fileCount}f ${src.contentDigest.slice(0, 16)}… vs target ${tgt.fileCount}f ${tgt.contentDigest.slice(0, 16)}… — layouts differ (slug vs projectId); equalFileCount=${src.fileCount === tgt.fileCount} digestMatch=${src.contentDigest === tgt.contentDigest}`);
  }
});

console.log(JSON.stringify({ suite: "f16-authority-digest-exclude-safe", status: "PASS", scenarios: count, notes }));
console.log(`F16 authority digest EXCLUDE-SAFE: PASS (${count} scenarios)`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
