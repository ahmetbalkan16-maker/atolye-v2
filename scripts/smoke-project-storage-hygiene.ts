/**
 * Project storage hygiene guard (Graphify Master Sprint).
 *
 * Deterministic / no browser / $0 / no network. A static-analysis regression
 * gate that keeps project runtime storage flowing through the ONE abstraction
 * (`src/lib/runtime/RuntimeStoragePaths.ts` + `ProjectReader` / `ProjectWriter`
 * / `FileStorage`) instead of a hand-built physical `data/projects/...` path.
 *
 * Why this exists: the runtime storage layer (Sprints 129.25B–C.2B.4) already
 * resolves the logical `data/projects/<slug>/...` prefix to a configurable
 * physical root (`ATOLYE_RUNTIME_ROOT`, else the legacy in-repo default). If a
 * new consumer joins `process.cwd()` / `__dirname` / a module-level root
 * constant with `"data"`, `"projects"` and writes there directly, it silently
 * bypasses containment, the write-authority lease and — once the store is
 * relocated — every read/write from that consumer keeps hitting the old
 * in-repo tree. This guard fails the build the moment a NEW such bypass
 * appears.
 *
 * As of sub-sprint C.2B.5 there is NO pending exception: the image GET route
 * now reads through `ImageStorage` (canonical runtime storage context), the
 * same as the audio/video/thumbnail routes. The allow-list below is the
 * abstraction itself plus its migration/backup tooling — adding to it is a
 * deliberate policy act (see docs/PROJECT_STORAGE.md and
 * docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ helpers --- */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

/**
 * A physical `data/projects` base is built by joining a NON-context root
 * (`process.cwd()`, `__dirname`, a SHOUTY module constant) with `"data"` and
 * `"projects"`, or by resolving such a root against a `data/projects/...`
 * literal. Matches the shape, not a specific consumer.
 */
const PHYSICAL_BASE_PATTERNS: readonly RegExp[] = [
  /path\.(?:join|resolve)\s*\(\s*(?:process\.cwd\(\)|__dirname|[A-Z][A-Z0-9_]{2,})\s*,\s*["'`]data["'`]\s*,\s*["'`]projects["'`]/,
  /(?:process\.cwd\(\)|__dirname|[A-Z][A-Z0-9_]{2,})\s*,\s*["'`]data\/projects/,
  /path\.(?:join|resolve)\s*\(\s*(?:process\.cwd\(\)|__dirname|[A-Z][A-Z0-9_]{2,})\s*,\s*["'`]data["'`][\s\S]{0,80}?["'`]projects["'`]/,
];

/**
 * Files allowed to resolve the physical project root: the abstraction itself,
 * plus its migration / backup tooling. No pending asset-serving exception
 * remains (C.2B.5). Adding to this list is a deliberate policy act.
 */
const ALLOWLIST: readonly string[] = [
  "src/lib/runtime/RuntimeStoragePaths.ts",
  "src/lib/storage/FileStorage.ts",
];

const ALLOWLIST_PREFIXES: readonly string[] = [
  "src/lib/runtime/migration/",
  "src/lib/runtime/backup/",
];

function isAllowlisted(relPath: string): boolean {
  return (
    ALLOWLIST.includes(relPath) ||
    ALLOWLIST_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

/* -------------------------------------------------------------------- scan --- */

function run() {
  const files = [
    ...walk(path.join(REPO_ROOT, "src")),
    ...walk(path.join(REPO_ROOT, "app")),
  ];
  assert.ok(files.length > 300, `expected to scan the whole tree, saw ${files.length}`);

  const offenders: string[] = [];
  const allowlistedHits: string[] = [];

  for (const file of files) {
    const relPath = rel(file);
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const hit = PHYSICAL_BASE_PATTERNS.some((pattern) => pattern.test(code));
    if (!hit) continue;
    if (isAllowlisted(relPath)) allowlistedHits.push(relPath);
    else offenders.push(relPath);
  }

  scenario("no NEW physical data/projects path bypasses the storage abstraction", () => {
    assert.deepEqual(
      offenders,
      [],
      `these files build a physical data/projects path outside the abstraction — route them through ProjectReader / ProjectWriter / FileStorage / RuntimeStoragePaths instead:\n  ${offenders.join("\n  ")}`,
    );
  });

  scenario("no physical-root asset-serving exception remains (C.2B.5 closed)", () => {
    // The abstraction + its migration/backup tooling never join a NON-context
    // root with `data/projects`, so nothing should land in `allowlistedHits`.
    assert.deepEqual(
      allowlistedHits.sort(),
      [],
      "an allow-listed file now builds a physical data/projects path — route it through the abstraction or record the exception deliberately",
    );
  });

  scenario("image GET route serves through ImageStorage, not a physical root", () => {
    const route = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "app/api/assets/images/[slug]/[fileName]/route.ts",
      ),
      "utf8",
    );
    assert.match(
      route,
      /@\/lib\/assets\/storage\/ImageStorage/,
      "the image route must read through ImageStorage",
    );
    assert.match(route, /ImageStorage\.readImage\(/, "must call ImageStorage.readImage");
    const code = stripComments(route);
    assert.ok(!/process\.cwd\(\)/.test(code), "the image route must not touch process.cwd()");
    assert.ok(
      !/["'`]data["'`]\s*,\s*["'`]projects["'`]/.test(code) &&
        !/["'`]data\/projects/.test(code),
      "the image route must not build a physical data/projects path",
    );
  });

  scenario("audio GET route serves through AudioStorage, not a physical root", () => {
    const route = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "app/api/assets/audio/[slug]/[fileName]/route.ts",
      ),
      "utf8",
    );
    assert.match(route, /@\/lib\/assets\/storage\/AudioStorage/, "must read through AudioStorage");
    const code = stripComments(route);
    assert.ok(!/process\.cwd\(\)/.test(code), "the audio route must not touch process.cwd()");
  });

  /* --------------------------- abstraction intact -------------------------- */

  scenario("RuntimeStoragePaths still exports the canonical storage API", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/runtime/RuntimeStoragePaths.ts"),
      "utf8",
    );
    for (const symbol of [
      "runtimeStorageEnvironmentVariable",
      "export function getProjectsRoot",
      "export function getProjectRoot",
      "export function resolveRuntimeStorageContext",
      "export function acquireProjectWriteAuthority",
      "export function assertProjectWriteAuthority",
      "export function assertPathContained",
      "export function resolveRuntimeLogicalPathForWrite",
    ]) {
      assert.ok(source.includes(symbol), `RuntimeStoragePaths must keep exporting: ${symbol}`);
    }
    assert.match(source, /ATOLYE_RUNTIME_ROOT/, "the configurable root env contract must stay");
  });

  scenario("ProjectReader / ProjectWriter resolve through RuntimeStoragePaths, not process.cwd()", () => {
    for (const file of ["src/lib/projects/ProjectReader.ts", "src/lib/projects/ProjectWriter.ts"]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      assert.match(source, /@\/lib\/runtime\/RuntimeStoragePaths/, `${file} must import the abstraction`);
      const code = stripComments(source);
      assert.ok(!/process\.cwd\(\)/.test(code), `${file} must not resolve a root from process.cwd()`);
      assert.ok(
        !PHYSICAL_BASE_PATTERNS.some((p) => p.test(code)),
        `${file} must not build a physical data/projects path`,
      );
    }
  });

  scenario("FileStorage routes the data/projects prefix through the runtime resolver", () => {
    const source = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, "src/lib/storage/FileStorage.ts"), "utf8"),
    );
    assert.match(source, /resolveRuntimeLogicalPath(ForWrite)?/, "FileStorage must use the logical resolver");
    assert.match(source, /startsWith\(["'`]data\/projects\//, "FileStorage keeps the logical prefix router");
    assert.match(source, /acquireProjectWriteAuthority/, "writes under the prefix must take a lease");
  });

  /* -------------------------- path-traversal guard ------------------------ */

  scenario("RuntimeStoragePaths rejects traversal / absolute / unsafe project slugs", () => {
    // Compiled/type-checked separately; here we assert the guard code is present
    // and shaped correctly (a behavioural check lives in the 129.25b suites).
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/runtime/RuntimeStoragePaths.ts"),
      "utf8",
    );
    assert.match(source, /requireProjectSlug/, "slug validation must exist");
    assert.match(source, /\/\^\[a-zA-Z0-9-_\]\+\$\//, "slug must be an allow-list regex");
    assert.match(source, /RUNTIME_STORAGE_PATH_INVALID/, "unsafe paths must fail closed");
    assert.match(source, /isOutsideRelative/, "containment check must reject `..` escapes");
    assert.match(source, /isSymbolicLink\(\)/, "symlink / reparse rejection must stay");
  });

  /* ---------------------- git hygiene rules still in place ---------------- */

  scenario(".gitignore untracks data/projects (C.2B.12) without catching data/brain", () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    // C.2B.12 — data/projects is external-runtime authority data; git stops
    // tracking it (files stay on disk). The rule is exactly `/data/projects/`.
    assert.ok(
      /^\/data\/projects\/\s*$/m.test(gitignore),
      ".gitignore must contain the /data/projects/ rule (C.2B.12)",
    );
    assert.ok(
      gitignore.includes("**/.pipeline-jobs.lock/"),
      ".gitignore must keep the PipelineJobMutationLock mutex-dir rule",
    );
    // The rule must be narrow — no /data/** or /data/* blanket that would also
    // ignore data/brain/README.md or data/brain/README-anything.
    assert.ok(
      !/^\/data\/(\*\*?|)\s*$/m.test(gitignore),
      ".gitignore must NOT blanket-ignore all of /data/",
    );
    assert.ok(
      gitignore.includes("/data/brain/queue/") && !/^\/data\/brain\/\s*$/m.test(gitignore),
      "data/brain must keep its granular rules — README.md stays tracked",
    );
  });

  scenario("M25: every durable self-improvement subtree present on disk has a matching .gitignore rule (repoClean regression guard)", () => {
    // Confirmed live impact, not theoretical: M24 added
    // data/brain/self-improvement/research-novelty/ but missed its .gitignore
    // line, so the first real write there made `git status --porcelain`
    // non-empty — which is exactly what the AYAS observer's own repoClean
    // check reads to decide OBSERVING vs PAUSED_DIRTY_REPO. A future sprint
    // that adds another durable subtree and forgets this same line would
    // silently reproduce the identical self-improvement outage, so this
    // pins the CONTRACT (every subtree present must be covered), not just
    // today's one fixed path — it stays meaningful as the app's own durable
    // state grows.
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    const root = path.join(REPO_ROOT, "data", "brain", "self-improvement");
    if (!fs.existsSync(root)) return; // nothing accumulated yet on this machine — nothing to check
    const subdirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const missing = subdirs.filter((name) => !gitignore.includes(`/data/brain/self-improvement/${name}/`));
    assert.deepEqual(missing, [], `every data/brain/self-improvement/<name>/ subtree on disk must have a matching .gitignore rule - missing: ${missing.join(", ")}`);
  });

  scenario(".gitattributes pins the LF line-ending policy", () => {
    const attrs = fs.readFileSync(path.join(REPO_ROOT, ".gitattributes"), "utf8");
    assert.match(attrs, /\*\s+text=auto\s+eol=lf/, "the LF policy must stay pinned");
  });

  console.log(`Project storage hygiene: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "project-storage-hygiene", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Project storage hygiene FAILED:", error);
  process.exitCode = 1;
}
