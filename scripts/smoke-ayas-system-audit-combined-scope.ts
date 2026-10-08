/**
 * Stage 17 opt-in combined protected inventory — TEMP attack controls.
 *
 * Covers the protected-scope integration review's verification list for the
 * combined inventory (steps 1–3): root escape, link/junction and hardlink
 * boundaries, root replacement, credential exclusions, a changed coverage
 * manifest, a background write during the audit interval, a forged writer
 * attribution, budgets, and that a complete scope still closes nothing.
 * Old audit graders, fixtures, pins and the 166-suite manifest stay frozen.
 *
 * Everything runs in caller-owned OS-temp roots. No live runtime, authority,
 * repository data, credential body or network is touched.
 *   --case <C..>   run one scenario      --mutations   source mutation controls
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { collectAyasSystemAudit, createLocalAyasAuditCollector, inventoryAyasAuditProtectedRoots, type AyasAuditCollectorDeps } from "../src/lib/ayas/audit/AyasSystemAuditCollector";
import { AYAS_AUDIT_COMBINED_SCOPE, inventoryAyasAuditCombinedScope, type AyasAuditCombinedInventory } from "../src/lib/ayas/audit/AyasSystemAuditCombinedScope";
import { auditGraphFixture, AUDIT_HEAD } from "./fixtures/ayas-system-audit-fixture";

const repo = process.cwd();
const parent = fs.realpathSync.native(os.tmpdir());
const PREFIX = "ayas-audit-combined-";
const args = process.argv.slice(2);
const only = args[0] === "--case" && args.length === 2 ? args[1]! : null;
const mutations = args.length === 1 && args[0] === "--mutations";
if ((args.length && !only && !mutations) || (only && !/^C(?:0[1-9]|1[0-9]|2[0-3])$/.test(only))) throw Error("COMBINED_TEST_ARGUMENT_INVALID");

interface Fixture { readonly base: string; readonly repository: string; readonly runtime: string; readonly authority: string }

function fixture(): Fixture {
  const base = fs.mkdtempSync(path.join(parent, PREFIX));
  const repository = path.join(base, "repo"), runtime = path.join(base, "runtime"), authority = path.join(base, "authority");
  for (const dir of [path.join(repository, "data/brain/memory"), path.join(repository, "data/brain/autonomy"), path.join(runtime, "projects/demo"), authority]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(repository, "data/brain/memory/record.json"), '{"synthetic":true}');
  fs.writeFileSync(path.join(repository, "data/brain/autonomy/approval-inbox.json"), "[]");
  fs.writeFileSync(path.join(runtime, "projects/demo/project.json"), '{"slug":"demo"}');
  fs.writeFileSync(path.join(authority, "authority.json"), '{"generation":1}');
  return { base, repository, runtime, authority };
}

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
const inventory = (f: Fixture, over: Partial<Fixture> = {}, clock?: () => number) => inventoryAyasAuditCombinedScope(roots(f, over), clock);

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
    assert.equal(a.externalRuntimeQualified, true);
    assert.equal(a.scope, AYAS_AUDIT_COMBINED_SCOPE);
    assert.deepEqual(a.incompleteReasons, []);
    assert.equal(a.files, 4);
    assert.deepEqual(a.stores.map((s) => [s.store, s.coveredBy]), [["private-memory", "repository:data/brain"], ["approvals", "repository:data/brain"], ["revenue", "repository:data/brain"], ["production-projects", "runtime"], ["runtime-authority", "authority"]]);
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
    assert.equal(after.complete, true);
    assert.notEqual(before.coverageManifestDigest, after.coverageManifestDigest, "a different root identity is a different manifest");
  });
  await scenario("C14", async (f) => {
    const other = path.join(f.base, "authority-2");
    fs.mkdirSync(other);
    let calls = 0;
    const result = await collectAyasSystemAudit(deps(f, () => (calls++ === 0 ? inventory(f) : inventory(f, { authority: other }))));
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
  });
}

const CONTROLS: readonly (readonly [string, string, string, string, string])[] = [
  ["credential opened", "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts", "if (AYAS_AUDIT_CREDENTIAL_PATH.test(relative)) {", "if (false) {", "C09"],
  ["overlap ignored", "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts", "if (contained(a.target, b.target) || contained(b.target, a.target))", "if (false)", "C07"],
  ["missing root accepted", "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts", 'reasons.add(`${kind}_ROOT_ABSENT`);', "", "C03"],
  ["identity change ignored", "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts", "reasons.add(`ROOT_IDENTITY_CHANGED:${kind}`);\n    } catch", "void 0;\n    } catch", "C21"],
  ["manifest drift completes interval", "src/lib/ayas/audit/AyasSystemAuditCollector.ts", "const manifestStable=before.coverageManifestDigest===after.coverageManifestDigest", "const manifestStable=true", "C14"],
  ["link entry measured", "src/lib/ayas/audit/AyasSystemAuditCombinedScope.ts", "if (!stat.isFile() || stat.nlink !== 1) {", "if (!stat.isFile()) {", "C11"],
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
    for (const [, , , , id] of CONTROLS) assert.equal(run(id).status, 0, `${id} passes unmutated`);
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
