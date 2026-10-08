/**
 * Stage 17 opt-in combined protected inventory — TEMP attack controls.
 *
 * Covers the protected-scope integration review's verification list for the
 * combined inventory (steps 1–3): root escape, link/junction and hardlink
 * boundaries, root replacement, credential exclusions, a changed coverage
 * manifest, a background write during the audit interval, a forged writer
 * attribution, budgets, and that a complete scope still closes nothing.
 * F98 (independent budget review, owner policy 2026-10-08) adds: absent
 * required roots and stores are reasons, declared exceptions never complete,
 * a dangling junction root is a link, external roots must be the pair the
 * active published authority names, and maxFiles / total maxBytes boundaries.
 * Old audit graders, fixtures, pins and the 166-suite manifest stay frozen.
 *
 * Everything runs in caller-owned OS-temp roots. No live runtime, authority,
 * repository data, credential body or network is touched. The fixture's
 * authority control plane is written with the production writers into TEMP.
 *   --case <C..>   run one scenario      --mutations   source mutation controls
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { collectAyasSystemAudit, createLocalAyasAuditCollector, inventoryAyasAuditProtectedRoots, type AyasAuditCollectorDeps } from "../src/lib/ayas/audit/AyasSystemAuditCollector";
import { AYAS_AUDIT_COMBINED_BUDGET, AYAS_AUDIT_COMBINED_SCOPE, inventoryAyasAuditCombinedScope, type AyasAuditCombinedInventory, type AyasAuditCombinedOptions } from "../src/lib/ayas/audit/AyasSystemAuditCombinedScope";
import { initialRuntimeAuthorityGeneration } from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { describeRuntimeAuthorityIdentity, writeRuntimeAuthorityGenerationMarker } from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";
import { RuntimeAuthorityTransitionStore } from "../src/lib/runtime/security/RuntimeAuthorityTransition";
import { auditGraphFixture, AUDIT_HEAD } from "./fixtures/ayas-system-audit-fixture";

const repo = process.cwd();
const parent = fs.realpathSync.native(os.tmpdir());
const PREFIX = "ayas-audit-combined-";
const args = process.argv.slice(2);
const only = args[0] === "--case" && args.length === 2 ? args[1]! : null;
const mutations = args.length === 1 && args[0] === "--mutations";
if ((args.length && !only && !mutations) || (only && !/^C(?:0[1-9]|[12][0-9]|3[0-7])$/.test(only))) throw Error("COMBINED_TEST_ARGUMENT_INVALID");

interface Fixture { readonly base: string; readonly repository: string; readonly runtime: string; readonly authority: string }

/** Publishes an active authority for this exact pair and stamps the runtime marker, as a genesis transition would (TEMP only). */
function bindPair(repository: string, runtime: string, authority: string, transitionId = "fixture-genesis-01"): void {
  const context = createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: runtime, ATOLYE_RUNTIME_AUTHORITY_ROOT: authority }, workspaceRoot: repository });
  const identity = describeRuntimeAuthorityIdentity(context, initialRuntimeAuthorityGeneration);
  new RuntimeAuthorityTransitionStore({ authorityRoot: authority }).publishActiveAuthority({
    schemaVersion: "1", transitionSequence: 1, transitionId, authorityGeneration: initialRuntimeAuthorityGeneration,
    authorityIdentity: identity.authorityIdentity, resolverBindingIdentity: identity.resolverBindingIdentity, activatedAt: "2026-10-08T00:00:00.000Z",
  }, null);
  writeRuntimeAuthorityGenerationMarker({ context, authorityGeneration: initialRuntimeAuthorityGeneration, now: "2026-10-08T00:00:00.000Z" });
}

function fixture(): Fixture {
  const base = fs.mkdtempSync(path.join(parent, PREFIX));
  const repository = path.join(base, "repo"), runtime = path.join(base, "runtime"), authority = path.join(base, "authority");
  // Every protected repository root and every required store exists; that is what a full-scope PASS requires.
  for (const dir of ["data/brain/memory", "data/brain/autonomy", "data/brain/revenue", "data/projects", "runtime", "authority", "projects", ".atolye"]) fs.mkdirSync(path.join(repository, dir), { recursive: true });
  for (const dir of [path.join(runtime, "projects/demo"), authority]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(repository, "data/brain/memory/record.json"), '{"synthetic":true}');
  fs.writeFileSync(path.join(repository, "data/brain/autonomy/approval-inbox.json"), "[]");
  fs.writeFileSync(path.join(repository, "data/brain/revenue/ledger.json"), "[]");
  fs.writeFileSync(path.join(runtime, "projects/demo/project.json"), '{"slug":"demo"}');
  fs.writeFileSync(path.join(authority, "authority.json"), '{"generation":1}');
  bindPair(repository, runtime, authority);
  return { base, repository, runtime, authority };
}
/** Files in the full fixture: three repository records, the project and the runtime marker, the authority file and the active record. */
const FIXTURE_FILES = 7;

/** Removes junctions first (never follows them), then the caller-owned TEMP root. */
function cleanup(root: string): void {
  assert.equal(path.dirname(fs.realpathSync.native(root)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(root).startsWith(PREFIX));
  const unlinkLinks = (dir: string): void => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (fs.lstatSync(full).isSymbolicLink()) {
        if (process.platform === "win32") fs.rmdirSync(full); else fs.unlinkSync(full);
      } else if (item.isDirectory()) unlinkLinks(full);
    }
  };
  unlinkLinks(root);
  fs.rmSync(root, { recursive: true, force: true });
}

const link = (target: string, at: string): void => fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
const roots = (f: Fixture, over: Partial<Fixture> = {}) => ({ repository: over.repository ?? f.repository, runtime: over.runtime ?? f.runtime, authority: over.authority ?? f.authority });
const inventory = (f: Fixture, over: Partial<Fixture> = {}, clock?: () => number, options?: AyasAuditCombinedOptions) => inventoryAyasAuditCombinedScope({ ...roots(f, over), configured: { runtime: f.runtime, authority: f.authority } }, clock, options);
const tightened = (f: Fixture, budget: AyasAuditCombinedOptions["budget"]) => inventory(f, {}, undefined, { budget });
const rowOf = (v: AyasAuditCombinedInventory, id: string) => { const row = v.roots.find((item) => item.id === id); assert.ok(row, id); return row; };

function noOpen(file: string, run: () => AyasAuditCombinedInventory): AyasAuditCombinedInventory {
  const open = fs.openSync;
  let attempts = 0;
  fs.openSync = ((...a: Parameters<typeof fs.openSync>) => {
    if (path.resolve(String(a[0])) === path.resolve(file)) { attempts += 1; throw Error("CANARY_MUST_NOT_OPEN"); }
    return open(...a);
  }) as typeof fs.openSync;
  try { const v = run(); assert.equal(attempts, 0); return v; } finally { fs.openSync = open; }
}

function deps(f: Fixture, inventories: () => AyasAuditCombinedInventory): AyasAuditCollectorDeps {
  return {
    repository: () => ({ head: AUDIT_HEAD, branch: "codex/combined-fixture" }),
    clock: () => new Date().toISOString(),
    graph: async () => auditGraphFixture(),
    readSource: () => null,
    inventory: inventories,
    declaredSuites: 166,
  };
}

const rows: { id: string; ok: boolean }[] = [];
async function scenario(id: string, fn: (f: Fixture) => void | Promise<void>): Promise<void> {
  if (only && id !== only) return;
  const f = fixture();
  try { await fn(f); rows.push({ id, ok: true }); }
  catch (error) { rows.push({ id, ok: false }); console.log(JSON.stringify({ status: "FAIL", results: rows })); throw error; }
  finally { cleanup(f.base); }
}

async function baseline(): Promise<void> {
  await scenario("C01", (f) => {
    assert.throws(() => inventoryAyasAuditCombinedScope({ ...roots(f), repository: "relative" }), /AUDIT_ROOT_INVALID/);
    assert.throws(() => inventoryAyasAuditCombinedScope(null as never), /AUDIT_COMBINED_ROOTS_INVALID/);
  });
  await scenario("C02", (f) => {
    const a = inventory(f), b = inventory(f);
    assert.equal(a.complete, true, a.incompleteReasons.join(","));
    assert.equal(a.coverage, "FULL");
    assert.equal(a.externalRuntimeQualified, true);
    assert.equal(a.scope, AYAS_AUDIT_COMBINED_SCOPE);
    assert.deepEqual(a.incompleteReasons, []);
    assert.equal(a.files, FIXTURE_FILES);
    assert.deepEqual(a.stores.map((s) => [s.store, s.coveredBy, s.presence]), [["private-memory", "repository:data/brain", "PRESENT"], ["approvals", "repository:data/brain", "PRESENT"], ["revenue", "repository:data/brain", "PRESENT"], ["production-projects", "runtime", "PRESENT"], ["runtime-authority", "authority", "PRESENT"]]);
    assert.ok(a.roots.every((row) => row.state === "MEASURED" && (row.exception === null || row.exception.applied === false)));
    assert.deepEqual([a.externalBinding.authorityControlPlane, a.externalBinding.configuredRuntime, a.externalBinding.configuredAuthority], ["ACTIVE_MATCH", "MATCH", "MATCH"]);
    assert.match(String(a.externalBinding.bindingDigest), /^[a-f0-9]{64}$/);
    assert.deepEqual([a.budgetId, a.budget], [AYAS_AUDIT_COMBINED_BUDGET.id, AYAS_AUDIT_COMBINED_BUDGET]);
    assert.equal(a.digest, b.digest);
    assert.equal(a.coverageManifestDigest, b.coverageManifestDigest);
    assert.ok(!JSON.stringify(a).includes(f.base), "no absolute path in the inventory");
  });
  await scenario("C03", (f) => {
    const missing = path.join(f.base, "missing-runtime");
    const v = inventory(f, { runtime: missing });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("RUNTIME_ROOT_ABSENT"));
    assert.ok(v.incompleteReasons.includes("STORE_UNCOVERED:production-projects"));
    assert.equal(v.externalBinding.authorityControlPlane, "NOT_EVALUATED");
    assert.ok(v.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
    assert.equal(fs.existsSync(missing), false, "a missing root is never created");
  });
  await scenario("C04", (f) => {
    const v = inventory(f, { authority: "relative/authority" });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("AUTHORITY_ROOT_INVALID"));
  });
  await scenario("C05", (f) => {
    const at = path.join(f.base, "runtime-link");
    link(f.runtime, at);
    const v = inventory(f, { runtime: at });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("RUNTIME_ROOT_INVALID"));
  });
  await scenario("C06", (f) => {
    const ancestor = path.join(f.base, "ancestor-link");
    link(f.base, ancestor);
    const v = inventory(f, { authority: path.join(ancestor, "authority") });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("AUTHORITY_ROOT_INVALID"));
  });
  await scenario("C07", (f) => {
    const inside = path.join(f.repository, "runtime");
    fs.mkdirSync(path.join(inside, "projects"), { recursive: true });
    const v = inventory(f, { runtime: inside });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("ROOT_OVERLAP:repository:runtime|runtime"));
  });
  await scenario("C08", (f) => {
    const nested = path.join(f.runtime, "authority");
    fs.mkdirSync(nested);
    const v = inventory(f, { authority: nested });
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("ROOT_OVERLAP:runtime|authority"));
  });
  await scenario("C09", (f) => {
    const canary = path.join(f.runtime, "projects/demo/.env.production");
    fs.writeFileSync(canary, "synthetic canary");
    const v = noOpen(canary, () => inventory(f));
    assert.equal(v.complete, false);
    assert.equal(v.exclusions.credentialFiles, 1);
    assert.ok(v.incompleteReasons.includes("CREDENTIAL_EXCLUDED:runtime"));
  });
  await scenario("C10", (f) => {
    const canary = path.join(f.authority, "session-token.json");
    fs.writeFileSync(canary, "synthetic canary");
    const v = noOpen(canary, () => inventory(f));
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("CREDENTIAL_EXCLUDED:authority"));
  });
  await scenario("C11", (f) => {
    const file = path.join(f.runtime, "projects/demo/project.json");
    fs.linkSync(file, path.join(f.runtime, "projects/demo/copy.json"));
    const v = inventory(f);
    assert.equal(v.complete, false);
    assert.equal(v.exclusions.linkOrSpecialEntries, 2);
    assert.ok(v.incompleteReasons.includes("LINK_OR_SPECIAL_ENTRY:runtime"));
  });
  await scenario("C12", (f) => {
    const outside = fs.mkdtempSync(path.join(parent, PREFIX));
    try {
      const canary = path.join(outside, "outside.json");
      fs.writeFileSync(canary, "synthetic");
      link(outside, path.join(f.runtime, "projects/escape"));
      const v = noOpen(canary, () => inventory(f));
      assert.equal(v.complete, false);
      assert.ok(v.incompleteReasons.includes("LINK_OR_SPECIAL_ENTRY:runtime"));
    } finally { cleanup(outside); }
  });
  await scenario("C13", (f) => {
    const before = inventory(f);
    const other = path.join(f.base, "authority-2");
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, "authority.json"), '{"generation":1}');
    const after = inventory(f, { authority: other });
    assert.notEqual(before.coverageManifestDigest, after.coverageManifestDigest, "a different root identity is a different manifest");
    // F98: an authority directory the active published authority does not name is never the configured one.
    assert.equal(after.complete, false);
    assert.ok(after.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
  });
  await scenario("C14", async (f) => {
    // Both endpoints are complete and bound, but they measure different roots: only the manifest check can refuse this.
    const runtime2 = path.join(f.base, "runtime-2"), authority2 = path.join(f.base, "authority-2");
    fs.mkdirSync(path.join(runtime2, "projects"), { recursive: true });
    fs.mkdirSync(authority2);
    bindPair(f.repository, runtime2, authority2, "fixture-genesis-02");
    const other = { ...f, runtime: runtime2, authority: authority2 };
    assert.equal(inventory(other).complete, true, inventory(other).incompleteReasons.join(","));
    let calls = 0;
    const result = await collectAyasSystemAudit(deps(f, () => (calls++ === 0 ? inventory(f) : inventory(other))));
    assert.equal(result.input.mutation.complete, false, "a changed coverage manifest never completes the interval");
    assert.ok(result.report.reasons.includes("PROTECTED_SCOPE_INCOMPLETE"));
    assert.equal(result.report.closure, "BLOCKED");
  });
  await scenario("C15", async (f) => {
    let calls = 0;
    const record = path.join(f.repository, "data/brain/memory/record.json");
    const result = await collectAyasSystemAudit(deps(f, () => {
      if (calls++ === 1) fs.writeFileSync(record, '{"synthetic":"background"}');
      return inventory(f);
    }));
    assert.equal(result.input.mutation.complete, true);
    assert.notEqual(result.input.mutation.beforeDigest, result.input.mutation.afterDigest);
    assert.equal(result.input.mutation.attribution, "UNKNOWN");
    assert.ok(result.report.reasons.includes("PROTECTED_CHANGE_UNATTRIBUTED"));
    assert.equal(result.report.closure, "BLOCKED");
  });
  await scenario("C16", async (f) => {
    // A writer claim smuggled into the inventory object is not attribution evidence.
    const forged = () => ({ ...inventory(f), attribution: "BACKGROUND", writerEvidenceDigest: "b".repeat(64) }) as unknown as AyasAuditCombinedInventory;
    let calls = 0;
    const record = path.join(f.runtime, "projects/demo/project.json");
    const result = await collectAyasSystemAudit(deps(f, () => { if (calls++ === 1) fs.writeFileSync(record, '{"slug":"changed"}'); return forged(); }));
    assert.equal(result.input.mutation.attribution, "UNKNOWN");
    assert.equal(result.input.mutation.writerEvidenceDigest, null);
    assert.ok(result.report.reasons.includes("PROTECTED_CHANGE_UNATTRIBUTED"));
  });
  await scenario("C17", async (f) => {
    const result = await collectAyasSystemAudit(deps(f, () => inventory(f)));
    assert.equal(result.input.mutation.complete, true);
    assert.equal(result.input.mutation.beforeDigest, result.input.mutation.afterDigest);
    assert.ok(!result.report.reasons.some((r: string) => r.startsWith("PROTECTED_")), result.report.reasons.join(","));
    assert.notEqual(result.report.closure, "FOUNDATION_CLOSED", "a complete scope closes nothing by itself");
    assert.equal(result.input.coverage.executed, 0);
    assert.ok(result.input.evidence.filter((e) => e.checkId.endsWith("_TEST") || e.checkId.endsWith("_LIVE")).every((e) => e.state === "NOT_RUN"));
    const extra = result as unknown as Record<string, unknown>;
    assert.equal(extra.protectedScope, AYAS_AUDIT_COMBINED_SCOPE);
    assert.equal(extra.protectedCoverageManifestStable, true);
    assert.equal(extra.externalRuntimeQualified, true);
    assert.equal(result.report.grantsAuthority, false);
    // The receipt carries each root, store, the budget, the binding and the reasons, and says attribution is endpoint-only.
    assert.equal(extra.protectedAttributionScope, "ENDPOINT_SNAPSHOTS_ONLY");
    for (const key of ["protectedCombinedBefore", "protectedCombinedAfter"]) {
      const summary = extra[key] as { coverage: string; budget: { id: string; maxFiles: number; maxBytes: number }; externalBinding: { authorityControlPlane: string }; roots: { id: string; state: string; files: number; bytes: number }[]; stores: { store: string; presence: string }[]; incompleteReasons: string[] };
      assert.equal(summary.coverage, "FULL");
      assert.deepEqual([summary.budget.id, summary.budget.maxFiles, summary.budget.maxBytes], [AYAS_AUDIT_COMBINED_BUDGET.id, AYAS_AUDIT_COMBINED_BUDGET.maxFiles, AYAS_AUDIT_COMBINED_BUDGET.maxBytes]);
      assert.equal(summary.externalBinding.authorityControlPlane, "ACTIVE_MATCH");
      assert.equal(summary.roots.length, 8);
      assert.equal(summary.roots.reduce((n, row) => n + row.files, 0), FIXTURE_FILES);
      assert.ok(summary.roots.every((row) => row.state === "MEASURED" && Number.isSafeInteger(row.bytes)));
      assert.deepEqual(summary.stores.map((s) => s.presence), ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT"]);
      assert.deepEqual(summary.incompleteReasons, []);
    }
  });
  await scenario("C18", (f) => {
    const big = path.join(f.runtime, "projects/demo/media.bin");
    const fd = fs.openSync(big, "w");
    try { fs.ftruncateSync(fd, 16 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
    const v = noOpen(big, () => inventory(f));
    assert.equal(v.complete, false);
    assert.equal(v.exclusions.sizeOrByteBudgetFiles, 1);
    assert.ok(v.incompleteReasons.includes("SIZE_OR_BYTE_BUDGET_EXCEEDED"));
  });
  await scenario("C19", (f) => {
    let ticks = 0;
    const v = inventory(f, {}, () => (ticks++ === 0 ? 0 : 400_000));
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("TIME_BUDGET_EXCEEDED"));
  });
  await scenario("C20", (f) => {
    let at = path.join(f.runtime, "projects");
    for (let i = 0; i < 22; i += 1) at = path.join(at, "nested");
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, "deep.json"), "{}");
    const v = inventory(f);
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("FILE_OR_DEPTH_BUDGET_EXCEEDED"));
  });
  await scenario("C21", (f) => {
    // The runtime root is swapped for another directory while it is being walked.
    const readdir = fs.readdirSync;
    let swapped = false;
    fs.readdirSync = ((...a: unknown[]) => {
      const result = (readdir as (...p: unknown[]) => unknown)(...a);
      if (!swapped && path.resolve(String(a[0])) === path.resolve(f.runtime)) {
        swapped = true;
        fs.renameSync(f.runtime, path.join(f.base, "runtime-old"));
        fs.mkdirSync(path.join(f.runtime, "projects"), { recursive: true });
      }
      return result;
    }) as unknown as typeof fs.readdirSync;
    let v: AyasAuditCombinedInventory;
    try { v = inventory(f); } finally { fs.readdirSync = readdir; }
    assert.equal(v.complete, false);
    assert.equal(swapped, true);
    assert.ok(v.incompleteReasons.includes("ROOT_IDENTITY_CHANGED:RUNTIME"), v.incompleteReasons.join(","));
  });
  await scenario("C22", (f) => {
    // The file grows while its own descriptor is being read.
    const file = path.join(f.authority, "authority.json");
    const open = fs.openSync, read = fs.readSync;
    let target = -1, changed = false;
    fs.openSync = ((...a: Parameters<typeof fs.openSync>) => {
      const fd = open(...a);
      if (path.resolve(String(a[0])) === path.resolve(file)) target = fd;
      return fd;
    }) as typeof fs.openSync;
    fs.readSync = ((...a: unknown[]) => {
      const n = (read as (...p: unknown[]) => number)(...a);
      if (!changed && a[0] === target) { changed = true; fs.appendFileSync(file, "x"); }
      return n;
    }) as typeof fs.readSync;
    let v: AyasAuditCombinedInventory;
    try { v = inventory(f); } finally { fs.openSync = open; fs.readSync = read; }
    assert.equal(changed, true);
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.some((r) => r.startsWith("UNREADABLE_OR_CHANGED:")), v.incompleteReasons.join(","));
  });
  await scenario("C23", async (f) => {
    // The default local collector is unchanged: fixed scope, no combined fields.
    const local = inventoryAyasAuditProtectedRoots(f.repository);
    assert.equal(local.scope, "FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED");
    const result = await collectAyasSystemAudit(createLocalAyasAuditCollector(f.repository, { repository: () => ({ head: AUDIT_HEAD, branch: "codex/combined-fixture" }), graph: async () => auditGraphFixture() }));
    const extra = result as unknown as Record<string, unknown>;
    assert.equal(extra.protectedCoverageManifestStable, undefined);
    assert.equal(extra.externalRuntimeQualified, undefined);
    assert.equal(extra.protectedScope, "FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED");
    for (const key of ["protectedCombinedBefore", "protectedCombinedAfter", "protectedAttributionScope"]) assert.equal(extra[key], undefined, key);
  });
  await scenario("C24", async (f) => {
    // F98: an absent REQUIRED repository root is a reason, never coverage.
    fs.rmSync(path.join(f.repository, "data/projects"), { recursive: true });
    const v = inventory(f);
    assert.equal(v.complete, false);
    assert.equal(v.coverage, "INCOMPLETE");
    assert.ok(v.incompleteReasons.includes("ROOT_ABSENT:repository:data/projects"), v.incompleteReasons.join(","));
    assert.deepEqual([rowOf(v, "repository:data/projects").state, rowOf(v, "repository:data/projects").requirement], ["ABSENT", "REQUIRED"]);
    assert.equal(v.externalRuntimeQualified, false);
    const result = await collectAyasSystemAudit(deps(f, () => inventory(f)));
    assert.equal(result.input.mutation.complete, false);
    assert.ok(result.report.reasons.includes("PROTECTED_SCOPE_INCOMPLETE"));
    assert.equal(result.report.closure, "BLOCKED");
  });
  await scenario("C25", async (f) => {
    // F98: a declared exception is recorded with its scope and reason, and still never completes the scope.
    fs.rmSync(path.join(f.repository, ".atolye"), { recursive: true });
    const one = inventory(f);
    assert.equal(one.complete, false);
    assert.equal(one.externalRuntimeQualified, false);
    assert.deepEqual(one.incompleteReasons, ["ROOT_ABSENT_DECLARED_OPTIONAL:repository:.atolye"]);
    assert.equal(one.coverage, "INCOMPLETE_DECLARED_EXCEPTIONS_ONLY");
    const row = rowOf(one, "repository:.atolye");
    assert.deepEqual([row.state, row.requirement, row.exception?.scope, row.exception?.applied], ["ABSENT", "DECLARED_OPTIONAL", "ABSENCE_ONLY", true]);
    assert.ok(String(row.exception?.reason).length > 10);
    for (const dir of ["runtime", "authority", "projects"]) fs.rmSync(path.join(f.repository, dir), { recursive: true });
    const all = inventory(f);
    assert.deepEqual(all.incompleteReasons, ["repository:.atolye", "repository:authority", "repository:projects", "repository:runtime"].map((id) => `ROOT_ABSENT_DECLARED_OPTIONAL:${id}`));
    assert.equal(all.complete, false);
    const result = await collectAyasSystemAudit(deps(f, () => inventory(f)));
    assert.equal(result.input.mutation.complete, false, "declared exceptions are never a full-scope PASS");
    assert.ok(result.report.reasons.includes("PROTECTED_SCOPE_INCOMPLETE"));
    assert.equal(result.report.closure, "BLOCKED");
    assert.equal((result as unknown as Record<string, unknown>).externalRuntimeQualified, false);
  });
  await scenario("C26", (f) => {
    // F98: the runtime/authority exceptions hold only while the external binding is verified.
    fs.rmSync(path.join(f.repository, "runtime"), { recursive: true });
    fs.rmSync(path.join(f.authority, "authority-transition-v1"), { recursive: true });
    const v = inventory(f);
    assert.ok(v.incompleteReasons.includes("ROOT_ABSENT:repository:runtime"), v.incompleteReasons.join(","));
    assert.ok(!v.incompleteReasons.includes("ROOT_ABSENT_DECLARED_OPTIONAL:repository:runtime"));
    assert.equal(rowOf(v, "repository:runtime").exception?.applied, false);
    assert.ok(v.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
    assert.equal(v.coverage, "INCOMPLETE");
  });
  await scenario("C27", (f) => {
    // F98: a required store must exist as a real directory; absence or a link is a reason.
    fs.rmSync(path.join(f.repository, "data/brain/revenue"), { recursive: true });
    const absent = inventory(f);
    assert.equal(absent.complete, false);
    assert.ok(absent.incompleteReasons.includes("STORE_ABSENT:revenue"), absent.incompleteReasons.join(","));
    assert.equal(absent.stores.find((s) => s.store === "revenue")?.presence, "ABSENT");
    const target = fs.mkdtempSync(path.join(f.base, "approvals-elsewhere-"));
    fs.rmSync(path.join(f.repository, "data/brain/autonomy"), { recursive: true });
    link(target, path.join(f.repository, "data/brain/autonomy"));
    const linked = inventory(f);
    assert.ok(linked.incompleteReasons.includes("STORE_INVALID:approvals"), linked.incompleteReasons.join(","));
    assert.equal(linked.stores.find((s) => s.store === "approvals")?.presence, "INVALID");
  });
  await scenario("C28", (f) => {
    // F98: a dangling junction as a protected root is a link, not an absent root.
    const gone = fs.mkdtempSync(path.join(f.base, "gone-"));
    fs.rmSync(path.join(f.repository, ".atolye"), { recursive: true });
    link(gone, path.join(f.repository, ".atolye"));
    fs.rmSync(gone, { recursive: true });
    assert.equal(fs.existsSync(path.join(f.repository, ".atolye")), false, "the junction dangles");
    const v = inventory(f);
    assert.equal(v.complete, false);
    assert.ok(v.incompleteReasons.includes("LINK_OR_SPECIAL_ENTRY:repository:.atolye"), v.incompleteReasons.join(","));
    assert.ok(!v.incompleteReasons.some((r) => r.endsWith(":repository:.atolye") && r.startsWith("ROOT_ABSENT")));
    assert.equal(rowOf(v, "repository:.atolye").state, "INVALID");
  });
  await scenario("C29", (f) => {
    // F98: only the pair the active published authority names is bound; swapped or arbitrary roots are not.
    const swapped = inventory(f, { runtime: f.authority, authority: f.runtime });
    assert.equal(swapped.complete, false);
    assert.equal(swapped.externalBinding.authorityControlPlane, "UNBOUND");
    assert.ok(swapped.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
    const runtime2 = path.join(f.base, "runtime-2"), authority2 = path.join(f.base, "authority-2");
    fs.mkdirSync(path.join(runtime2, "projects"), { recursive: true });
    fs.mkdirSync(authority2);
    const arbitrary = inventory(f, { runtime: runtime2, authority: authority2 });
    assert.equal(arbitrary.externalBinding.authorityControlPlane, "UNBOUND");
    assert.ok(arbitrary.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
    // A second, separately published pair is bound only to itself, never to the fixture's repository roots' pair.
    bindPair(f.repository, runtime2, authority2, "fixture-genesis-02");
    const alternate = inventory(f, { runtime: runtime2, authority: authority2 });
    assert.equal(alternate.externalBinding.authorityControlPlane, "ACTIVE_MATCH");
    assert.equal(alternate.complete, false, "self-published alternate pair is not canonical configuration");
    assert.ok(alternate.incompleteReasons.includes("RUNTIME_ROOT_NOT_CONFIGURED"));
    assert.ok(alternate.incompleteReasons.includes("AUTHORITY_ROOT_NOT_CONFIGURED"));
    assert.equal(inventory(f, { runtime: runtime2 }).externalBinding.authorityControlPlane, "UNBOUND");
  });
  await scenario("C30", (f) => {
    // F98: the active record alone is not enough; the runtime marker must match it.
    fs.rmSync(path.join(f.runtime, "projects/.runtime-authority-generation.json"));
    const v = inventory(f);
    assert.equal(v.externalBinding.authorityControlPlane, "UNBOUND");
    assert.ok(v.incompleteReasons.includes("EXTERNAL_ROOTS_UNBOUND"));
    assert.equal(v.complete, false);
  });
  await scenario("C31", (f) => {
    // F98: when the configured roots are known, the explicit roots must be the same directories.
    const other = path.join(f.base, "other");
    fs.mkdirSync(other);
    const match = inventoryAyasAuditCombinedScope({ ...roots(f), configured: { runtime: f.runtime, authority: f.authority } });
    assert.equal(match.complete, true, match.incompleteReasons.join(","));
    assert.deepEqual([match.externalBinding.configuredRuntime, match.externalBinding.configuredAuthority], ["MATCH", "MATCH"]);
    const mismatch = inventoryAyasAuditCombinedScope({ ...roots(f), configured: { runtime: other, authority: f.authority } });
    assert.equal(mismatch.complete, false);
    assert.equal(mismatch.externalBinding.configuredRuntime, "MISMATCH");
    assert.ok(mismatch.incompleteReasons.includes("RUNTIME_ROOT_NOT_CONFIGURED"));
    const authorityMismatch = inventoryAyasAuditCombinedScope({ ...roots(f), configured: { authority: other } });
    assert.ok(authorityMismatch.incompleteReasons.includes("AUTHORITY_ROOT_NOT_CONFIGURED"));
  });
  await scenario("C32", (f) => {
    // F98 / B4: the file cap is a real boundary; only a tighter budget may be injected.
    const exact = tightened(f, { maxFiles: FIXTURE_FILES });
    assert.equal(exact.complete, true, exact.incompleteReasons.join(","));
    assert.equal(exact.budgetId, `${AYAS_AUDIT_COMBINED_BUDGET.id}+tightened`);
    const below = tightened(f, { maxFiles: FIXTURE_FILES - 1 });
    assert.equal(below.complete, false);
    assert.ok(below.incompleteReasons.includes("FILE_OR_DEPTH_BUDGET_EXCEEDED"));
    assert.ok(below.exclusions.depthOrFileLimitStops >= 1);
    assert.equal(below.files, FIXTURE_FILES - 1);
    assert.throws(() => tightened(f, { maxFiles: AYAS_AUDIT_COMBINED_BUDGET.maxFiles + 1 }), /AUDIT_BUDGET_INVALID/);
    assert.throws(() => tightened(f, { maxBytes: -1 }), /AUDIT_BUDGET_INVALID/);
    assert.throws(() => tightened(f, { unknownLimit: 1 } as never), /AUDIT_BUDGET_INVALID/);
  });
  await scenario("C33", (f) => {
    // F98 / B4: the total byte cap is a real boundary with its own reason.
    const total = inventory(f).bytesHashed;
    assert.ok(total > 0);
    const exact = tightened(f, { maxBytes: total });
    assert.equal(exact.complete, true, exact.incompleteReasons.join(","));
    assert.equal(exact.bytesHashed, total);
    const below = tightened(f, { maxBytes: total - 1 });
    assert.equal(below.complete, false);
    assert.ok(below.incompleteReasons.includes("SIZE_OR_BYTE_BUDGET_EXCEEDED"), below.incompleteReasons.join(","));
    assert.equal(below.exclusions.sizeOrByteBudgetFiles, 1);
    assert.ok(below.bytesHashed < total);
  });
  await scenario("C34", (f) => {
    for (const configured of [undefined, {}, { runtime: f.runtime }, { authority: f.authority }, { runtime: "", authority: "" }]) {
      const result = inventoryAyasAuditCombinedScope({ ...roots(f), configured });
      assert.equal(result.complete, false, "an audited self-published pair cannot replace operator configuration");
      assert.notEqual(result.coverage, "FULL");
      assert.ok(result.incompleteReasons.includes("RUNTIME_ROOT_NOT_CONFIGURED") || result.incompleteReasons.includes("AUTHORITY_ROOT_NOT_CONFIGURED"));
    }
  });
  await scenario("C35", (f) => {
    const alias = path.join(f.base, "configured-alias");
    link(f.base, alias);
    const result = inventoryAyasAuditCombinedScope({ ...roots(f), configured: { runtime: path.join(alias, "runtime"), authority: f.authority } });
    assert.equal(result.complete, false);
    assert.equal(result.externalBinding.configuredRuntime, "MISMATCH", "configured ancestor junction must be refused");
    assert.ok(result.incompleteReasons.includes("RUNTIME_ROOT_NOT_CONFIGURED"));
  });
  await scenario("C36", (f) => {
    const dir = path.join(f.authority, "authority-transition-v1/transitions");
    fs.mkdirSync(dir);
    const secret = path.join(dir, "secret-canary-123.json");
    fs.writeFileSync(secret, "{}");
    const originalRead = fs.readFileSync;
    let attempts = 0;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (path.resolve(String(args[0])) === path.resolve(secret)) { attempts += 1; throw Error("CANARY_MUST_NOT_READ"); }
      return originalRead(...args);
    }) as typeof fs.readFileSync;
    try {
      const v = noOpen(secret, () => inventory(f));
      assert.equal(attempts, 0, "no generic production reader can read credential-named transition bodies");
      assert.equal(v.complete, false);
      assert.equal(v.externalBinding.authorityControlPlane, "UNBOUND");
      assert.equal(v.exclusions.credentialFiles, 1);
    } finally { fs.readFileSync = originalRead; }
  });
  await scenario("C37", (f) => {
    const active = path.join(f.authority, "authority-transition-v1/active-authority.json");
    fs.linkSync(active, path.join(f.base, "hardlink-active.json"));
    const v = noOpen(active, () => inventory(f));
    assert.equal(v.complete, false);
    assert.equal(v.externalBinding.authorityControlPlane, "UNBOUND");
  });
}

const SCOPE = "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts";
const CONTROLS: readonly (readonly [string, string, string, string, string])[] = [
  ["credential transition opened during binding", SCOPE, 'const names = fs.readdirSync(directory).sort();', 'const names = fs.readdirSync(directory).sort(); for (const name of names) fs.readFileSync(path.join(directory, name), "utf8");', "C36"],
  ["missing canonical runtime accepted", SCOPE, 'externalBinding.configuredRuntime !== "MATCH"', 'externalBinding.configuredRuntime === "MISMATCH"', "C34"],
  ["missing canonical authority accepted", SCOPE, 'externalBinding.configuredAuthority !== "MATCH"', 'externalBinding.configuredAuthority === "MISMATCH"', "C34"],
  ["configured ancestor junction accepted", SCOPE, "validateSafeAncestorChain(value);\n    const configured", "const configured", "C35"],
  ["credential opened", SCOPE, "if (AYAS_AUDIT_CREDENTIAL_PATH.test(relative)) {", "if (false) {", "C09"],
  ["overlap ignored", SCOPE, "if (contained(a.target, b.target) || contained(b.target, a.target))", "if (false)", "C07"],
  ["missing root accepted", SCOPE, 'reasons.add(`${kind}_ROOT_ABSENT`);', "", "C03"],
  ["identity change ignored", SCOPE, ") reasons.add(`ROOT_IDENTITY_CHANGED:${kind}`);", ") void 0;", "C21"],
  ["manifest drift completes interval", "src/lib/ayas/audit/AyasSystemAuditCollector.ts", "const manifestStable=before.coverageManifestDigest===after.coverageManifestDigest", "const manifestStable=true", "C14"],
  ["link entry measured", SCOPE, "if (!stat.isFile() || stat.nlink !== 1) {", "if (!stat.isFile()) {", "C11"],
  ["absent required root accepted", SCOPE, "reasons.add(applied ? `ROOT_ABSENT_DECLARED_OPTIONAL:${root.id}` : `ROOT_ABSENT:${root.id}`);", "void applied;", "C24"],
  ["declared exception completes", SCOPE, "const complete = reasons.size === 0;", 'const complete = [...reasons].every((reason) => reason.startsWith("ROOT_ABSENT_DECLARED_OPTIONAL:"));', "C25"],
  ["exception applied without binding", SCOPE, '(exception.requires === null || (externalBinding.authorityControlPlane === "ACTIVE_MATCH" && externalBinding.configuredRuntime === "MATCH" && externalBinding.configuredAuthority === "MATCH"))', "true", "C26"],
  ["absent store accepted", SCOPE, "reasons.add(`STORE_ABSENT:${store}`);", "void 0;", "C27"],
  ["dangling link read as absent", SCOPE, "const entry = entryOrNull(root.target);", "const entry = fs.existsSync(root.target) ? fs.lstatSync(root.target) : null;", "C28"],
  ["external binding ignored", SCOPE, 'reasons.add("EXTERNAL_ROOTS_UNBOUND");', "void 0;", "C29"],
  ["marker not required", SCOPE, 'const marker = read(runtime, "projects/.runtime-authority-generation.json", 16 * 1024);', 'const marker = { ...expected, writtenAt: "2026-10-08T00:00:00Z" };', "C30"],
  ["configured mismatch ignored", SCOPE, 'reasons.add("RUNTIME_ROOT_NOT_CONFIGURED");', "void 0;", "C31"],
  ["file cap removed", SCOPE, "if (depth > budget.maxDepth || files >= budget.maxFiles) {", "if (depth > budget.maxDepth) {", "C32"],
  ["budget loosening accepted", SCOPE, " || value > reviewed[key])", ")", "C32"],
  ["byte cap removed", SCOPE, " || total + stat.size > budget.maxBytes) {", ") {", "C33"],
];

async function main(): Promise<void> {
  await baseline();
  if (!mutations) {
    console.log(JSON.stringify({ status: "PASS", primary: rows.length, fixture: "TEMP_ONLY_NO_LIVE_RUNTIME_AUTHORITY_OR_CREDENTIAL_BODY", results: rows }));
    return;
  }
  const temp = fs.mkdtempSync(path.join(parent, PREFIX));
  const copied = new Set<string>();
  const copy = (file: string): void => {
    if (copied.has(file)) return;
    copied.add(file);
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, file), target);
    if (!/\.tsx?$/.test(file)) return;
    for (const m of fs.readFileSync(target, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
      const dep = m[1]!;
      const base = dep.startsWith("@/") ? path.join(repo, "src", dep.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), dep);
      const found = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, path.join(base, "index.ts")].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (found) copy(path.relative(repo, found).replace(/\\/g, "/"));
    }
  };
  try {
    copy("scripts/smoke-ayas-system-audit-combined-scope.ts");
    copy("tsconfig.json");
    copy("package.json");
    link(path.join(repo, "node_modules"), path.join(temp, "node_modules"));
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[k]) env[k] = process.env[k];
    const run = (caseId: string) => spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "scripts/smoke-ayas-system-audit-combined-scope.ts", "--case", caseId], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 3e6 });
    for (const id of new Set(CONTROLS.map((control) => control[4]))) assert.equal(run(id).status, 0, `${id} passes unmutated`);
    for (const [name, file, before, after, id] of CONTROLS) {
      const target = path.join(temp, file), original = fs.readFileSync(target, "utf8");
      assert.equal(original.split(before).length - 1, 1, `${name}: mutation anchor`);
      let r: ReturnType<typeof run>;
      try { fs.writeFileSync(target, original.replace(before, () => after)); r = run(id); } finally { fs.writeFileSync(target, original); }
      assert.equal(r.status, 1, `${name}: not caught`);
      assert.match(r.stderr, /AssertionError|ERR_ASSERTION/, name);
      assert.doesNotMatch(r.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, name);
    }
    console.log(JSON.stringify({ status: "PASS", primary: rows.length, sourceMutationsCaught: CONTROLS.length, scope: "GITLESS_TEMP_ASSERTION_CAUGHT_NO_AUTHORITY" }));
  } finally {
    cleanup(temp);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
