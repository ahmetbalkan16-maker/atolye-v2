/** Reproducible Stage 15G negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-provenance-audit-"));
const test = "scripts/smoke-ayas-release-provenance.ts";
const copied = new Set<string>();
/** Copies a module and everything it imports by relative path or by the `@/` alias. */
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}

const sbom = "src/lib/ayas/provenance/AyasSbom.ts";
const manifest = "src/lib/ayas/provenance/AyasReleaseProvenance.ts";
const collector = "src/lib/ayas/provenance/AyasReleaseProvenanceCollector.ts";
const cli = "scripts/ayas-release-provenance.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["look-alike-registry-host-accepted", sbom, "entry.resolved.startsWith(AYAS_NPM_REGISTRY_PREFIX))) {", 'entry.resolved.startsWith("https://registry.npmjs.org"))) {'],
  ["one-registry-copy-launders-another", sbom, "else if (!group.entries.every((entry) => typeof entry.resolved", "else if (!group.entries.some((entry) => typeof entry.resolved"],
  ["wrong-length-hash-accepted", sbom, 'if (bytes.length !== { "SHA-512": 64, "SHA-384": 48, "SHA-256": 32, "SHA-1": 20 }[alg]) return null;', "if (false) return null;"],
  ["unreviewed-install-script-not-blocking", sbom, 'if (scriptClass === "UNREVIEWED") add("INSTALL_SCRIPT_UNREVIEWED", "BLOCK"', 'if (scriptClass === "UNREVIEWED") add("INSTALL_SCRIPT_UNREVIEWED", "REVIEW"'],
  ["review-covers-any-version", sbom, 'review.version === group.version ? "REVIEWED" : "REVIEWED_AT_ANOTHER_VERSION"', 'true ? "REVIEWED" : "REVIEWED_AT_ANOTHER_VERSION"'],
  ["development-only-counted-as-shipped", sbom, 'if (entries.some((entry) => !entry.dev && !entry.optional && !entry.devOptional)) return "required";', 'if (entries.some((entry) => !entry.optional && !entry.devOptional)) return "required";'],
  ["nested-copy-ignored", sbom, 'const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;', "const candidate = `node_modules/${name}`;"],
  ["license-list-any-identifier", sbom, "ids.length > 0 && ids.every((id) => PERMISSIVE.has(id))", "ids.length > 0 && ids.some((id) => PERMISSIVE.has(id))"],
  ["missing-required-dependency-ignored", sbom, 'if (ref) set.add(ref); else add("DEPENDENCY_UNRESOLVED", "BLOCK", label,', 'if (ref) set.add(ref); else if (false) add("DEPENDENCY_UNRESOLVED", "BLOCK", label,'],
  ["edited-manifest-accepted", manifest, "sha256(canonicalAyasJson(sealed)) !== manifestDigest)", "false)"],
  ["relabelled-complete-accepted", manifest, "const implied = findAyasProvenanceGaps(body as AyasReleaseProvenanceBody);", "const implied = completeness.gaps;"],
  ["dirty-tree-not-a-gap", manifest, 'if (body.git.treeState !== "CLEAN") gaps.push("GIT_TREE_DIRTY");', 'if (false) gaps.push("GIT_TREE_DIRTY");'],
  ["cached-advisories-called-current", manifest, 'if (!body.advisories.current) gaps.push("ADVISORIES_NOT_CURRENT");', 'if (false) gaps.push("ADVISORIES_NOT_CURRENT");'],
  ["reported-advisories-not-a-gap", manifest, 'if (body.advisories.counts.total > 0) gaps.push("ADVISORIES_REPORTED");', 'if (false) gaps.push("ADVISORIES_REPORTED");'],
  ["mismatched-artifact-not-a-gap", manifest, 'artifact.local === "MISMATCH")) gaps.push("ARTIFACT_IDENTITY_MISMATCH");', 'artifact.local === "NEVER")) gaps.push("ARTIFACT_IDENTITY_MISMATCH");'],
  ["baseline-of-another-commit-accepted", manifest, 'if (baseline.sourceHead !== body.git.head) gaps.push("TEST_BASELINE_NOT_BOUND_TO_HEAD");', 'if (false) gaps.push("TEST_BASELINE_NOT_BOUND_TO_HEAD");'],
  ["failed-baseline-accepted", manifest, 'if (baseline.failed > 0 || !baseline.complete || !["PASS", "PASS_WITH_KNOWN_LIMITATIONS"].includes(baseline.outcome))', "if (baseline.failed > 0)"],
  ["build-of-another-lockfile-accepted", manifest, "body.build.stampedHead !== body.git.head || body.build.stampedLockfileSha256 !== body.lockfile.sha256)", "body.build.stampedHead !== body.git.head)"],
  ["audit-report-not-adding-up-quoted", manifest, "if (info! + low! + moderate! + high! + critical! !== total) return null;", "if (false) return null;"],
  ["graph-of-another-commit-accepted", manifest, 'if (body.graphify.state !== "PRESENT" || body.graphify.builtFromHead !== body.git.head) gaps.push', 'if (body.graphify.state !== "PRESENT") gaps.push'],
  ["dirty-tree-stamp-binds-build", collector, 'if (stamp.treeState === "CLEAN" && HEAD.test(String(stamp.gitHead))', "if (HEAD.test(String(stamp.gitHead))"],
  ["cache-counted-as-build-output", collector, 'if (relative === "" && BUILD_EXCLUDED.has(entry.name)) continue;', "if (false) continue;"],
  ["offline-cache-called-current", collector, 'current: options.advisoryReport.source === "npm-registry"', "current: true"],
  ["line-endings-change-the-lockfile-digest", "src/lib/ayas/provenance/AyasBuildStamp.ts", 'const text = fs.readFileSync(file, "utf8").replace(/\\r\\n/g, "\\n");', 'const text = fs.readFileSync(file, "utf8");'],
  ["dirty-tree-stamped-clean", "src/lib/ayas/provenance/AyasBuildStamp.ts", 'treeState: dirty ? "DIRTY" : "CLEAN"', 'treeState: "CLEAN"'],
  ["malformed-baseline-report-accepted", collector, 'if (typeof report.outcome !== "string" || !HEAD.test(String(report.sourceHead)) || !Array.isArray(report.failed) || typeof report.selectedSuites !== "number") throw', "if (false) throw"],
  ["existing-record-overwritten", cli, '{ flag: "wx" }', "{}"],
  ["verify-ignores-changes", cli, "if (!stored.ok || drift.length) process.exitCode = 1;", "if (!stored.ok) process.exitCode = 1;"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
try {
  // The suite reads this repository's own lockfile and manifest and starts the two operator scripts by path.
  for (const file of [test, cli, "scripts/ayas-build-stamp.ts", "package.json", "package-lock.json", "tsconfig.json"]) copy(file);
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.equal(fs.readFileSync(path.join(temp, file), "utf8"), fs.readFileSync(path.join(repo, file), "utf8"), "the repository source was read, never written");
  console.log(`Stage 15G release provenance mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-provenance-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
