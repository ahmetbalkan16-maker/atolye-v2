/**
 * Graphify health root-selection smoke — `scripts/graphify-health-readonly.ts`.
 *
 * Runs the REAL health script as a child process (same tsx loader) against temp
 * fixtures, varying only the environment, and asserts the root is never chosen
 * silently:
 *  - `ATOLYE_RUNTIME_ROOT` unset → legacy in-repo fallback is labelled
 *    ATOLYE_RUNTIME_ROOT_NOT_SET / LEGACY_REPOSITORY / NOT_LIVE_RUNTIME and the
 *    verdict is WITHHELD (never a live INCONSISTENT), even though the same
 *    legacy scan WOULD be "inconsistent"; with no `data/projects` at all (a
 *    self-heal worktree) it stays NOT_LIVE_RUNTIME / exit 0;
 *  - explicit external live root → normal verdict (consistent-with-notes), and a
 *    genuinely broken live root still reports INCONSISTENT;
 *  - invalid root (missing / relative / no `projects/`) → INVALID_RUNTIME_ROOT,
 *    exit 1, no verdict (a missing root used to scan as 0 folders "consistent");
 *  - explicit legacy / explicit workspace roots → NOT_LIVE_RUNTIME;
 *  - every fixture is byte-identical afterwards (the script is read-only).
 *
 * Temp dirs only; never reads or writes the real runtime, authority or
 * `data/projects`. Run: npx tsx scripts/smoke-graphify-health-root.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "graphify-health-readonly.ts");

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UUID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function project(projectsRoot: string, folder: string, id: string, slug: string) {
  const dir = path.join(projectsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id, slug, status: "draft" }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ steps: {} }));
}

function fingerprint(root: string): string {
  const h = crypto.createHash("sha256");
  const stack = [root];
  const files: string[] = [];
  while (stack.length) {
    const d = stack.pop()!;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        files.push(`${p}/`);
        stack.push(p);
      } else files.push(p);
    }
  }
  for (const f of files.sort()) {
    h.update(path.relative(root, f));
    if (!f.endsWith("/")) h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

interface HealthRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly json: Record<string, unknown>;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-health-root-"));
const workspace = path.join(tmp, "ws");
const legacyProjects = path.join(workspace, "data", "projects");
const liveRoot = path.join(tmp, "live");
const brokenRoot = path.join(tmp, "broken");
const emptyRoot = path.join(tmp, "no-projects-dir");
const workspaceRoot = path.join(workspace, "rt");
const bareWorkspace = path.join(tmp, "bare-ws");
const authorityRoot = path.join(tmp, "authority");

// Legacy in-repo root: slug-named folders (id !== folder) + an in-repo record
// that resolves nowhere → as an AUTHORITATIVE root this scans "inconsistent".
project(legacyProjects, "hunlarin-dogusu", UUID_A, "hunlarin-dogusu");
project(legacyProjects, "attila", UUID_B, "attila");
fs.writeFileSync(path.join(legacyProjects, "ghost-record.json"), JSON.stringify({ id: "ghost-record" }));

// Live external root: one UUID project, one legacy slug-ID folder, one orphan.
project(path.join(liveRoot, "projects"), UUID_A, UUID_A, "alpha");
project(path.join(liveRoot, "projects"), "hunlarin-dogusu", UUID_B, "hunlarin-dogusu");
fs.mkdirSync(path.join(liveRoot, "projects", UUID_C), { recursive: true });
fs.writeFileSync(path.join(liveRoot, "projects", UUID_C, "ai-usage.json"), "[]");

// Genuinely broken live root: two projects share a slug → one is unreachable by slug.
project(path.join(brokenRoot, "projects"), UUID_C, UUID_C, "dup-slug");
project(path.join(brokenRoot, "projects"), UUID_D, UUID_D, "dup-slug");

fs.mkdirSync(emptyRoot, { recursive: true });
fs.mkdirSync(bareWorkspace, { recursive: true });
project(path.join(workspaceRoot, "projects"), UUID_A, UUID_A, "alpha");
fs.mkdirSync(authorityRoot, { recursive: true });

const fixtureBefore = fingerprint(tmp);

function runHealth(runtimeRoot: string | undefined, workspaceDir = workspace): HealthRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ATOLYE_RUNTIME_ROOT;
  env.ATOLYE_RUNTIME_AUTHORITY_ROOT = authorityRoot;
  env.ATOLYE_WORKSPACE_ROOT = workspaceDir;
  if (runtimeRoot !== undefined) env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  const out = spawnSync(process.execPath, [...process.execArgv, SCRIPT], {
    cwd: REPO,
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const jsonLine = out.stdout.split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  assert.ok(jsonLine, `no JSON verdict line (exit ${out.status}):\n${out.stdout}\n${out.stderr}`);
  return { code: out.status, stdout: out.stdout, json: JSON.parse(jsonLine) as Record<string, unknown> };
}

try {
  scenario("env unset → legacy fallback is explicit, verdict withheld, never live INCONSISTENT", () => {
    const r = runHealth(undefined);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "NOT_LIVE_RUNTIME");
    assert.equal(r.json.verdict, null);
    assert.equal(r.json.liveRuntime, false);
    assert.equal(r.json.rootStatus, "ATOLYE_RUNTIME_ROOT_NOT_SET");
    assert.equal(r.json.rootClassification, "LEGACY_REPOSITORY");
    assert.deepEqual(r.json.diagnostics, ["ATOLYE_RUNTIME_ROOT_NOT_SET", "LEGACY_REPOSITORY", "NOT_LIVE_RUNTIME"]);
    assert.equal(path.resolve(String(r.json.projectsRoot)), path.resolve(legacyProjects));
    // The underlying legacy scan IS "inconsistent" — the old script reported exactly
    // this as the live verdict. It must now be quarantined under nonLiveScanVerdict.
    assert.equal(r.json.nonLiveScanVerdict, "inconsistent");
    assert.equal(r.json.idMismatches, 2);
    assert.doesNotMatch(r.stdout, /Graphify consistency verdict: INCONSISTENT/);
    assert.match(r.stdout, /Graphify consistency verdict: WITHHELD \(ATOLYE_RUNTIME_ROOT_NOT_SET, LEGACY_REPOSITORY, NOT_LIVE_RUNTIME\)/);
    assert.match(r.stdout, /ATOLYE_RUNTIME_ROOT is not set/);
  });

  scenario("env unset in a checkout with no data/projects (self-heal worktree) → NOT_LIVE_RUNTIME, exit 0", () => {
    // `scripts/selfheal.ts` runs this script in a fresh git worktree (data/projects
    // is gitignored) and treats exit 0 as PASS — the fallback must not become exit 1.
    const r = runHealth(undefined, bareWorkspace);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "NOT_LIVE_RUNTIME");
    assert.equal(r.json.rootStatus, "ATOLYE_RUNTIME_ROOT_NOT_SET");
    assert.equal(r.json.projectsRootExists, false);
    assert.equal(r.json.verdict, null);
    assert.equal(r.json.folders, 0);
  });

  scenario("explicit external live root → real verdict with live counts", () => {
    const r = runHealth(liveRoot);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "OK");
    assert.equal(r.json.verdict, "consistent-with-notes");
    assert.equal(r.json.nonLiveScanVerdict, null);
    assert.equal(r.json.liveRuntime, true);
    assert.equal(r.json.rootStatus, "LIVE_RUNTIME");
    assert.deepEqual(r.json.diagnostics, []);
    assert.equal(r.json.folders, 3);
    assert.equal(r.json.orphans, 1);
    assert.equal(r.json.idMismatches, 1);
    assert.equal(r.json.unresolvableProjects, 0);
    assert.doesNotMatch(r.stdout, /NOT_LIVE_RUNTIME/);
  });

  scenario("explicit live root that is genuinely broken → INCONSISTENT is still reported", () => {
    const r = runHealth(brokenRoot);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "INCONSISTENT");
    assert.equal(r.json.verdict, "inconsistent");
    assert.equal(r.json.liveRuntime, true);
    assert.equal(r.json.unresolvableProjects, 1);
  });

  scenario("invalid root: missing path → INVALID_RUNTIME_ROOT, exit 1, no verdict (was silently 'consistent')", () => {
    // The resolver accepts a not-yet-existing root under an existing parent; only
    // the script's own projects-root guard stops a 0-folder "consistent" verdict.
    const r = runHealth(path.join(tmp, "does-not-exist"));
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.json.status, "INVALID_RUNTIME_ROOT");
    assert.equal(r.json.verdict, null);
    assert.equal(r.json.reason, "PROJECTS_ROOT_MISSING");
    assert.doesNotMatch(r.stdout, /--- Runtime projects ---/);
  });

  scenario("invalid root: relative path → INVALID_RUNTIME_ROOT, exit 1", () => {
    const r = runHealth("relative/runtime");
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.json.status, "INVALID_RUNTIME_ROOT");
    assert.equal(r.json.reason, "RUNTIME_STORAGE_CONFIGURATION_INVALID");
  });

  scenario("invalid root: existing dir without projects/ → PROJECTS_ROOT_MISSING", () => {
    const r = runHealth(emptyRoot);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.json.status, "INVALID_RUNTIME_ROOT");
    assert.equal(r.json.reason, "PROJECTS_ROOT_MISSING");
    assert.equal(r.json.verdict, null);
  });

  scenario("explicit legacy root → LEGACY_REPOSITORY / NOT_LIVE_RUNTIME", () => {
    const r = runHealth(path.join(workspace, "data"));
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "NOT_LIVE_RUNTIME");
    assert.equal(r.json.rootStatus, "EXPLICIT_LEGACY_ROOT");
    assert.equal(r.json.rootClassification, "LEGACY_REPOSITORY");
    assert.equal(r.json.verdict, null);
    assert.equal(r.json.nonLiveScanVerdict, "inconsistent");
  });

  scenario("explicit workspace-internal root → NOT_LIVE_RUNTIME", () => {
    const r = runHealth(workspaceRoot);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.status, "NOT_LIVE_RUNTIME");
    assert.equal(r.json.rootStatus, "EXPLICIT_WORKSPACE_ROOT");
    assert.deepEqual(r.json.diagnostics, ["EXPLICIT_WORKSPACE_ROOT", "NOT_LIVE_RUNTIME"]);
  });

  scenario("every fixture byte-identical after all runs (read-only)", () => {
    assert.equal(fingerprint(tmp), fixtureBefore);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`Graphify health root selection: PASS (${count} scenarios)`);
