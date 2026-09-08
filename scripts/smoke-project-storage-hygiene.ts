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
 * appears, and locks the one already-documented exception
 * (the image GET route, owned by sub-sprint C.2B.5 — see
 * docs/PROJECT_STORAGE.md and docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md).
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
 * plus its migration / backup tooling, plus the ONE documented pending
 * exception. Adding to this list is a deliberate policy act.
 */
const ALLOWLIST: readonly string[] = [
  "src/lib/runtime/RuntimeStoragePaths.ts",
  "src/lib/storage/FileStorage.ts",
  // C.2B.5 — the image GET route still reads `process.cwd()/data/projects/...`
  // directly (gif/svg have no storage-service inspector yet). Documented,
  // tracked, and NOT allowed to multiply.
  "app/api/assets/images/[slug]/[fileName]/route.ts",
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

  scenario("the one documented pending exception (image GET route) is still the only one", () => {
    // Lock the baseline: exactly the image route, nothing else.
    assert.deepEqual(
      allowlistedHits.sort(),
      ["app/api/assets/images/[slug]/[fileName]/route.ts"],
      "the set of allow-listed physical-root files changed — update ALLOWLIST + docs/PROJECT_STORAGE.md deliberately",
    );
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

  scenario(".gitignore keeps the runtime-local project data + lock rules", () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
    for (const rule of [
      "/data/projects/unknown/",
      "**/.pipeline-jobs.lock/",
      "/data/projects/smoke/",
      "/data/projects/diag-*/",
    ]) {
      assert.ok(gitignore.includes(rule), `.gitignore must keep: ${rule}`);
    }
    assert.ok(
      !/^\/data\/projects\/\*\/?\s*$/m.test(gitignore),
      ".gitignore must NOT blanket-ignore /data/projects/*/ (would hide tracked milestone snapshots)",
    );
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
