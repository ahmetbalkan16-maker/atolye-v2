/** Stage 15G — SBOM and release provenance. Fixture lockfiles and TEMP repositories only; no install, no network, nothing written to this repository. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { AYAS_REVIEWED_INSTALL_SCRIPTS, ayasIntegrityHashes, ayasNpmPurl, buildAyasSbom, type AyasNpmLockPackage } from "../src/lib/ayas/provenance/AyasSbom";
import {
  canonicalAyasJson, compareAyasReleaseProvenance, findAyasProvenanceGaps, sealAyasReleaseProvenance, summarizeAyasNpmAuditReport, verifyAyasReleaseProvenance,
  type AyasReleaseProvenanceBody,
} from "../src/lib/ayas/provenance/AyasReleaseProvenance";
import { AYAS_BUILD_STAMP_FILE, buildAyasBuildStamp } from "../src/lib/ayas/provenance/AyasBuildStamp";
import { AYAS_EVAL_MANIFEST_FILE, collectAyasReleaseProvenance, digestAyasBuildOutput } from "../src/lib/ayas/provenance/AyasReleaseProvenanceCollector";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const sha256 = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const integrity = (seed: string) => `sha512-${crypto.createHash("sha512").update(seed).digest("base64")}`;
const registry = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
const pkg = (name: string, version: string, over: AyasNpmLockPackage = {}): AyasNpmLockPackage => ({ version, resolved: registry(name, version), integrity: integrity(`${name}@${version}`), license: "MIT", ...over });
const lock = (packages: Record<string, AyasNpmLockPackage>, root: AyasNpmLockPackage = {}) => ({ name: "fixture-app", version: "1.2.3", lockfileVersion: 3, packages: { "": { name: "fixture-app", version: "1.2.3", ...root }, ...packages } });
const build = (packages: Record<string, AyasNpmLockPackage>, root: AyasNpmLockPackage = {}) => buildAyasSbom({ lockfile: lock(packages, root), lockfileDigest: "a".repeat(64) });
const codes = (result: ReturnType<typeof build>) => result.findings.map((finding) => finding.code).sort();
const component = (result: ReturnType<typeof build>, ref: string) => result.sbom.components.find((item) => item["bom-ref"] === ref)!;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-provenance-"));
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
}
/** A small Git repository with a lockfile, an eval manifest and, optionally, a build directory. */
function fixtureRepository(name: string): string {
  const root = path.join(temp, name);
  fs.mkdirSync(path.join(root, path.dirname(AYAS_EVAL_MANIFEST_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture-app", version: "1.2.3" }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "package-lock.json"), `${JSON.stringify(lock({ "node_modules/left": pkg("left", "1.0.0") }, { dependencies: { left: "^1.0.0" } }), null, 2)}\n`);
  fs.writeFileSync(path.join(root, AYAS_EVAL_MANIFEST_FILE), `${JSON.stringify({ version: "fixture-v1", suites: [{ id: "a" }, { id: "b" }] })}\n`);
  fs.writeFileSync(path.join(root, ".gitignore"), ".next/\nreports/\n");
  git(root, "init", "--quiet"); git(root, "add", "--all"); git(root, "commit", "--quiet", "--message", "fixture");
  return root;
}
function writeBuild(root: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) { const file = path.join(root, ".next", name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
}
const cleanBody = (over: Partial<AyasReleaseProvenanceBody> = {}): AyasReleaseProvenanceBody => {
  const head = "1".repeat(40); const lockDigest = "2".repeat(64);
  const sbom = build({ "node_modules/left": pkg("left", "1.0.0") }, { dependencies: { left: "^1.0.0" } });
  return {
    schemaVersion: "1", generatedAt: "2026-10-02T00:00:00.000Z", subject: { name: "fixture-app", version: "1.2.3" },
    git: { head, branch: "main", treeState: "CLEAN", dirtyPaths: 0 },
    lockfile: { file: "package-lock.json", sha256: lockDigest, lockfileVersion: 3, packageJsonSha256: "3".repeat(64) },
    sbom: { format: "CycloneDX", specVersion: "1.5", serialNumber: sbom.sbom.serialNumber, sha256: "4".repeat(64), summary: sbom.summary, blockingFindings: [] },
    advisories: { state: "REPORT", source: "npm-registry", current: true, reportSha256: "5".repeat(64), reportedAt: "2026-10-02T00:00:00.000Z", counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    artifacts: { lifecycle: [{ id: "llm.fixture", kind: "llm", role: "local-text", state: "PINNED", admission: "OWNER_SELECTED", identity: { type: "ollama-digest", tag: "fixture:1", digest: "6".repeat(64) }, local: "MATCH" }], localVerification: "DONE", localCodingManifest: { state: "ABSENT" } },
    graphify: { state: "PRESENT", builtFromHead: head, lastAnalyzedHead: head, structural: "CURRENT", semantic: "CURRENT", nodes: 10, links: 20, anomalies: 0, incompleteCodeFiles: 0, graphSha256: "7".repeat(64) },
    testMatrix: { manifestVersion: "fixture-v1", manifestDigest: "8".repeat(64), suites: 2, baseline: { state: "PRESENT", sha256: "9".repeat(64), outcome: "PASS", sourceHead: head, suites: 2, failed: 0, complete: true } },
    build: { state: "PRESENT", buildId: "build1", sha256: "b".repeat(64), files: 3, bytes: 30, stampedHead: head, stampedLockfileSha256: lockDigest },
    signature: { state: "UNSIGNED", note: "offline hash manifest" },
    ...over,
  };
};

async function main() {
  try {
    await scenario("component — exact version, registry tarball, integrity as a SHA-512 hash, license, purl", () => {
      const result = build({ "node_modules/@scope/pkg": pkg("@scope/pkg", "2.0.1", { license: "Apache-2.0" }), "node_modules/left": pkg("left", "1.0.0") }, { dependencies: { "@scope/pkg": "^2.0.0", left: "^1.0.0" } });
      assert.deepEqual(result.findings, []);
      assert.equal(ayasNpmPurl("@scope/pkg", "2.0.1"), "pkg:npm/%40scope/pkg@2.0.1");
      const scoped = component(result, "pkg:npm/%40scope/pkg@2.0.1");
      assert.deepEqual([scoped.type, scoped.group, scoped.name, scoped.version, scoped.scope, scoped.purl], ["library", "@scope", "pkg", "2.0.1", "required", "pkg:npm/%40scope/pkg@2.0.1"]);
      assert.deepEqual(scoped.hashes, [{ alg: "SHA-512", content: crypto.createHash("sha512").update("@scope/pkg@2.0.1").digest("hex") }]);
      assert.deepEqual(scoped.licenses, [{ license: { id: "Apache-2.0" } }]);
      assert.deepEqual(scoped.externalReferences, [{ type: "distribution", url: registry("@scope/pkg", "2.0.1") }]);
      assert.deepEqual([result.sbom.bomFormat, result.sbom.specVersion, result.sbom.version], ["CycloneDX", "1.5", 1]);
      assert.match(result.sbom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.deepEqual(result.sbom.metadata.component, { type: "application", "bom-ref": "pkg:npm/fixture-app@1.2.3", name: "fixture-app", version: "1.2.3", purl: "pkg:npm/fixture-app@1.2.3" });
      assert.equal(result.sbom.metadata.timestamp, undefined, "no clock value unless the caller gives one");
      assert.deepEqual(result.summary.byScope, { required: 2, optional: 0, excluded: 0 });
    });

    await scenario("scope — shipped anywhere wins over optional, which wins over development; one component per package and version", () => {
      const result = build({
        "node_modules/both": pkg("both", "1.0.0", { dev: true }),
        "node_modules/a/node_modules/both": pkg("both", "1.0.0"),
        "node_modules/a": pkg("a", "1.0.0", { dependencies: { both: "1.0.0" } }),
        "node_modules/devonly": pkg("devonly", "1.0.0", { dev: true }),
        "node_modules/opt": pkg("opt", "1.0.0", { optional: true }),
        "node_modules/devopt": pkg("devopt", "1.0.0", { dev: true, optional: true }),
        "node_modules/either": pkg("either", "1.0.0", { devOptional: true }),
      }, { dependencies: { a: "1.0.0" }, devDependencies: { devonly: "1.0.0", both: "1.0.0" }, optionalDependencies: { opt: "1.0.0" } });
      assert.deepEqual(result.findings, []);
      assert.equal(result.summary.lockEntries, 7); assert.equal(result.summary.components, 6);
      const scope = (ref: string) => component(result, ref).scope;
      assert.deepEqual([scope("pkg:npm/both@1.0.0"), scope("pkg:npm/a@1.0.0"), scope("pkg:npm/devonly@1.0.0"), scope("pkg:npm/opt@1.0.0"), scope("pkg:npm/devopt@1.0.0"), scope("pkg:npm/either@1.0.0")],
        ["required", "required", "excluded", "optional", "excluded", "optional"]);
      assert.deepEqual(component(result, "pkg:npm/both@1.0.0").properties, [{ name: "ayas:npm:development", value: "false" }, { name: "ayas:npm:installScript", value: "NONE" }, { name: "ayas:npm:lockPaths", value: "2" }]);
      assert.equal(component(result, "pkg:npm/devonly@1.0.0").properties![0]!.value, "true");
    });

    await scenario("dependency edges — resolved the way npm does: the package's own node_modules first, then each parent's", () => {
      const result = build({
        "node_modules/a": pkg("a", "1.0.0", { dependencies: { shared: "^2.0.0", leaf: "^1.0.0" }, optionalDependencies: { "not-installed": "^1.0.0" }, peerDependencies: { "peer-absent": "*" } }),
        "node_modules/a/node_modules/shared": pkg("shared", "2.0.0"),
        "node_modules/shared": pkg("shared", "1.0.0"),
        "node_modules/leaf": pkg("leaf", "1.0.0", { dependencies: { shared: "^1.0.0" } }),
        "node_modules/tool": pkg("tool", "1.0.0", { dev: true }),
      }, { dependencies: { a: "^1.0.0", shared: "^1.0.0" }, devDependencies: { tool: "^1.0.0" } });
      assert.deepEqual(result.findings, [], "an optional or peer dependency that is not installed is not a finding");
      const edges = Object.fromEntries(result.sbom.dependencies.map((item) => [item.ref, item.dependsOn]));
      assert.deepEqual(edges["pkg:npm/fixture-app@1.2.3"], ["pkg:npm/a@1.0.0", "pkg:npm/shared@1.0.0", "pkg:npm/tool@1.0.0"]);
      assert.deepEqual(edges["pkg:npm/a@1.0.0"], ["pkg:npm/leaf@1.0.0", "pkg:npm/shared@2.0.0"], "a gets its own nested copy");
      assert.deepEqual(edges["pkg:npm/leaf@1.0.0"], ["pkg:npm/shared@1.0.0"], "leaf gets the top-level copy");
      const missing = build({ "node_modules/a": pkg("a", "1.0.0", { dependencies: { gone: "^1.0.0" } }) }, { dependencies: { a: "^1.0.0" } });
      assert.deepEqual(codes(missing), ["DEPENDENCY_UNRESOLVED"]); assert.equal(missing.findings[0]!.severity, "BLOCK");
    });

    await scenario("findings — the lockfile cannot vouch for a tarball without an integrity hash or from outside the registry", () => {
      assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0", { integrity: "" }) })), ["INTEGRITY_MISSING"]);
      for (const bad of ["sha512-not base64!", "md5-aGVsbG8=", `sha512-${Buffer.from("short").toString("base64")}`, "sha512", `${integrity("x")} sha999-AAAA`]) {
        assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0", { integrity: bad }) })), ["INTEGRITY_UNSUPPORTED"], bad);
        assert.equal(ayasIntegrityHashes(bad), null, bad);
      }
      assert.deepEqual(ayasIntegrityHashes(`sha1-${crypto.createHash("sha1").update("x").digest("base64")} ${integrity("x")}`)!.map((hash) => hash.alg), ["SHA-1", "SHA-512"]);
      assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0", { integrity: integrity("one") }), "node_modules/b/node_modules/a": pkg("a", "1.0.0", { integrity: integrity("two") }) })), ["INTEGRITY_CONFLICT"]);
      assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0", { resolved: "" }) })), ["RESOLVED_MISSING"]);
      for (const resolved of ["git+ssh://git@github.com/someone/a.git#abcdef", "file:../a", "https://registry.npmjs.org.evil.example/a/-/a-1.0.0.tgz", "http://registry.npmjs.org/a/-/a-1.0.0.tgz"]) {
        assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0", { resolved }) })), ["RESOLVED_NOT_NPM_REGISTRY"], resolved);
      }
      // One registry copy does not launder another copy of the same version that came from elsewhere.
      assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "1.0.0"), "node_modules/b/node_modules/a": pkg("a", "1.0.0", { resolved: "file:../a" }) })), ["RESOLVED_NOT_NPM_REGISTRY"]);
      assert.ok(codes(build({ "node_modules/a": { link: true, resolved: "../a" } as AyasNpmLockPackage })).includes("LINKED_OR_BUNDLED_PACKAGE"));
      assert.ok(codes(build({ "node_modules/a": pkg("a", "1.0.0", { inBundle: true }) })).includes("LINKED_OR_BUNDLED_PACKAGE"));
      assert.deepEqual(codes(build({ "node_modules/a": pkg("a", "", {}) })), ["VERSION_MISSING"]);
      assert.deepEqual(codes(build({ "node_modules/Bad Name": pkg("x", "1.0.0") })), ["PACKAGE_NAME_INVALID"]);
      for (const finding of build({ "node_modules/a": pkg("a", "1.0.0", { integrity: "", resolved: "file:../a" }) }).findings) assert.equal(finding.severity, "BLOCK");
      assert.deepEqual(codes(buildAyasSbom({ lockfile: { ...lock({}), lockfileVersion: 1 }, lockfileDigest: "a".repeat(64) })), ["LOCKFILE_VERSION_UNSUPPORTED"]);
      for (const lockfile of [null, "text", [], { lockfileVersion: 3 }]) assert.ok(codes(buildAyasSbom({ lockfile, lockfileDigest: "a".repeat(64) })).includes("LOCKFILE_INVALID"));
    });

    await scenario("bundled dependencies — vouched by the bundling tarball's registry identity, or BLOCK", () => {
      const inside = (over: AyasNpmLockPackage = {}): AyasNpmLockPackage => ({ version: "1.0.0", inBundle: true, dev: true, optional: true, license: "MIT", ...over });
      const bundler = (over: AyasNpmLockPackage = {}, bundles: boolean | readonly string[] = ["inner"]): AyasNpmLockPackage =>
        pkg("bundler", "2.0.0", { dev: true, bundleDependencies: bundles, dependencies: { inner: "^1.0.0" }, ...over });
      // A parent the lockfile fully vouches (registry tarball, SHA-512) covers the packages bundled inside it: the
      // child is disclosed for review and on the parent's component, and is never a component in its own right.
      const covered = build({ "node_modules/bundler": bundler(), "node_modules/bundler/node_modules/inner": inside() }, { devDependencies: { bundler: "^2.0.0" } });
      assert.deepEqual(covered.findings, [{ code: "LINKED_OR_BUNDLED_PACKAGE", severity: "REVIEW", subject: "node_modules/bundler/node_modules/inner", detail: "bundled inside pkg:npm/bundler@2.0.0; covered by that tarball's registry integrity" }]);
      assert.deepEqual(covered.sbom.components.map((item) => item["bom-ref"]), ["pkg:npm/bundler@2.0.0"], "no standalone component for a bundled package");
      assert.deepEqual(component(covered, "pkg:npm/bundler@2.0.0").properties![3], { name: "ayas:npm:bundles", value: "inner@1.0.0" });
      assert.equal(covered.summary.blockingFindings, 0); assert.equal(covered.summary.reviewFindings, 1);
      assert.equal(covered.summary.components, 1); assert.equal(covered.summary.lockEntries, 2);
      const edges = Object.fromEntries(covered.sbom.dependencies.map((item) => [item.ref, item.dependsOn]));
      assert.deepEqual(edges["pkg:npm/bundler@2.0.0"], [], "the bundle's own dependencies do not dangle");
      // `bundleDependencies: true` covers without an explicit list; two bundled children are both disclosed.
      const trueListed = build({ "node_modules/bundler": bundler({}, true), "node_modules/bundler/node_modules/inner": inside(), "node_modules/bundler/node_modules/more": inside({ version: "2.0.0" }) }, {});
      assert.equal(trueListed.summary.blockingFindings, 0);
      assert.deepEqual(component(trueListed, "pkg:npm/bundler@2.0.0").properties![3], { name: "ayas:npm:bundles", value: "inner@1.0.0, more@2.0.0" });
      // Anything else keeps every BLOCK: no parent in the lockfile, a parent that is itself bundled, a parent that
      // does not declare the bundle, a parent from outside the registry, a parent without a usable hash, a bundled
      // package that declares an install-time script, and a bundled package with no exact version.
      const bare = (packages: Record<string, AyasNpmLockPackage>) => codes(build(packages));
      assert.deepEqual(bare({ "node_modules/stray/node_modules/inner": inside() }), ["INTEGRITY_MISSING", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler({ inBundle: true }), "node_modules/bundler/node_modules/inner": inside() }), ["INTEGRITY_MISSING", "LINKED_OR_BUNDLED_PACKAGE", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler({}, false), "node_modules/bundler/node_modules/inner": inside() }), ["INTEGRITY_MISSING", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler({ resolved: "file:../bundler" }), "node_modules/bundler/node_modules/inner": inside() }), ["INTEGRITY_MISSING", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING", "RESOLVED_NOT_NPM_REGISTRY"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler({ integrity: "sha512-not base64!" }), "node_modules/bundler/node_modules/inner": inside() }), ["INTEGRITY_MISSING", "INTEGRITY_UNSUPPORTED", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler(), "node_modules/bundler/node_modules/inner": inside({ hasInstallScript: true }) }), ["INSTALL_SCRIPT_UNREVIEWED", "INTEGRITY_MISSING", "LINKED_OR_BUNDLED_PACKAGE", "RESOLVED_MISSING"]);
      assert.deepEqual(bare({ "node_modules/bundler": bundler(), "node_modules/bundler/node_modules/inner": inside({ version: "" }) }), ["DEPENDENCY_UNRESOLVED", "LINKED_OR_BUNDLED_PACKAGE", "VERSION_MISSING"]);
    });

    await scenario("install-time scripts — reviewed at this exact version, reviewed at another, or never reviewed", () => {
      const esbuild = AYAS_REVIEWED_INSTALL_SCRIPTS.find((item) => item.name === "esbuild")!;
      const result = build({
        "node_modules/esbuild": pkg("esbuild", esbuild.version, { hasInstallScript: true, dev: true }),
        "node_modules/protobufjs": pkg("protobufjs", "9.9.9", { hasInstallScript: true }),
        "node_modules/surprise": pkg("surprise", "1.0.0", { hasInstallScript: true }),
        "node_modules/quiet": pkg("quiet", "1.0.0"),
      });
      assert.deepEqual(result.summary.installScripts.map((item) => [item.component, item.class, item.scope]), [[`esbuild@${esbuild.version}`, "REVIEWED", "excluded"], ["protobufjs@9.9.9", "REVIEWED_AT_ANOTHER_VERSION", "required"], ["surprise@1.0.0", "UNREVIEWED", "required"]]);
      assert.deepEqual(codes(result), ["INSTALL_SCRIPT_UNREVIEWED", "INSTALL_SCRIPT_VERSION_CHANGED"]);
      assert.equal(result.summary.blockingFindings, 2);
      assert.equal(component(result, "pkg:npm/quiet@1.0.0").properties![1]!.value, "NONE");
      assert.equal(component(result, "pkg:npm/surprise@1.0.0").properties![1]!.value, "UNREVIEWED");
    });

    await scenario("licenses — reported as written; anything not on the permissive list is listed for the owner, nothing is judged", () => {
      const result = build({
        "node_modules/a": pkg("a", "1.0.0", { license: "MIT OR Apache-2.0" }),
        "node_modules/b": pkg("b", "1.0.0", { license: "Apache-2.0 AND LGPL-3.0-or-later" }),
        "node_modules/c": pkg("c", "1.0.0", { license: "(MIT OR CC0-1.0)" }),
        "node_modules/d": pkg("d", "1.0.0", { license: "MPL-2.0" }),
        "node_modules/e": pkg("e", "1.0.0", { license: { type: "ISC", url: "https://example.invalid" } }),
        "node_modules/f": pkg("f", "1.0.0", { license: [{ type: "MIT" }, { type: "BSD-3-Clause" }] }),
        "node_modules/g": pkg("g", "1.0.0", { license: undefined }),
        "node_modules/h": pkg("h", "1.0.0", { license: "SEE LICENSE IN LICENSE.txt" }),
      });
      assert.deepEqual(component(result, "pkg:npm/a@1.0.0").licenses, [{ expression: "MIT OR Apache-2.0" }]);
      assert.deepEqual(component(result, "pkg:npm/d@1.0.0").licenses, [{ license: { id: "MPL-2.0" } }]);
      assert.deepEqual(component(result, "pkg:npm/e@1.0.0").licenses, [{ license: { id: "ISC" } }]);
      assert.deepEqual(component(result, "pkg:npm/f@1.0.0").licenses, [{ expression: "MIT OR BSD-3-Clause" }]);
      assert.deepEqual(component(result, "pkg:npm/h@1.0.0").licenses, [{ license: { name: "SEE LICENSE IN LICENSE.txt" } }]);
      assert.equal(component(result, "pkg:npm/g@1.0.0").licenses, undefined);
      assert.deepEqual(result.findings.map((finding) => [finding.code, finding.severity, finding.subject]), [["LICENSE_MISSING", "REVIEW", "g@1.0.0"]]);
      assert.deepEqual(result.summary.licensesForOwnerReview.map((item) => item.component), ["b@1.0.0", "d@1.0.0", "h@1.0.0"]);
      assert.equal(result.summary.blockingFindings, 0); assert.equal(result.summary.reviewFindings, 1);
    });

    await scenario("reproducible — the same lockfile gives the same bytes whatever order its entries are in; a changed version gives a new serial number", () => {
      const packages = { "node_modules/a": pkg("a", "1.0.0", { dependencies: { b: "1.0.0" } }), "node_modules/b": pkg("b", "1.0.0"), "node_modules/c": pkg("c", "3.0.0", { dev: true }) };
      const forward = build(packages, { dependencies: { a: "1.0.0" } });
      const reversed = build(Object.fromEntries(Object.entries(packages).reverse()), { dependencies: { a: "1.0.0" } });
      assert.equal(JSON.stringify(forward.sbom), JSON.stringify(reversed.sbom));
      assert.equal(JSON.stringify(forward.summary), JSON.stringify(reversed.summary));
      const bumped = build({ ...packages, "node_modules/b": pkg("b", "1.0.1") }, { dependencies: { a: "1.0.0" } });
      assert.notEqual(bumped.sbom.serialNumber, forward.sbom.serialNumber);
      const stamped = buildAyasSbom({ lockfile: lock(packages), lockfileDigest: "a".repeat(64), generatedAt: "2026-10-02T00:00:00.000Z" });
      assert.equal(stamped.sbom.metadata.timestamp, "2026-10-02T00:00:00.000Z");
    });

    await scenario("this repository's lockfile — every component pinned to a registry tarball with a SHA-512 hash; no blocking finding", () => {
      const text = fs.readFileSync(path.join(repo, "package-lock.json"), "utf8").replace(/\r\n/g, "\n");
      const result = buildAyasSbom({ lockfile: JSON.parse(text), lockfileDigest: sha256(text) });
      assert.deepEqual(result.findings.filter((finding) => finding.severity === "BLOCK"), []);
      assert.ok(result.summary.components > 500 && result.summary.components <= result.summary.lockEntries);
      for (const item of result.sbom.components) {
        assert.ok(item.hashes?.some((hash) => hash.alg === "SHA-512" && /^[a-f0-9]{128}$/.test(hash.content)), item["bom-ref"]);
        assert.ok(item.externalReferences?.[0]?.url.startsWith("https://registry.npmjs.org/"), item["bom-ref"]);
        assert.ok(item.licenses?.length === 1, item["bom-ref"]);
      }
      assert.equal(new Set(result.sbom.components.map((item) => item["bom-ref"])).size, result.sbom.components.length, "bom-refs are unique");
      const refs = new Set([result.sbom.metadata.component["bom-ref"], ...result.sbom.components.map((item) => item["bom-ref"])]);
      for (const edge of result.sbom.dependencies) { assert.ok(refs.has(edge.ref)); for (const target of edge.dependsOn) assert.ok(refs.has(target), `${edge.ref} -> ${target}`); }
      // Every install-time script in the lockfile is one the Stage 9 audit recorded, at the version it recorded.
      assert.deepEqual(result.summary.installScripts.map((item) => item.class), result.summary.installScripts.map(() => "REVIEWED"));
      assert.deepEqual(result.summary.installScripts.map((item) => item.component).sort(), AYAS_REVIEWED_INSTALL_SCRIPTS.map((item) => `${item.name}@${item.version}`).sort());
      const direct = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
      assert.equal(result.sbom.dependencies.find((edge) => edge.ref === result.sbom.metadata.component["bom-ref"])!.dependsOn.length, Object.keys({ ...direct.dependencies, ...direct.devDependencies }).length);
    });

    await scenario("manifest seal — intact as sealed; any edit breaks it; an edit that re-hashes itself is still refused", () => {
      const sealed = sealAyasReleaseProvenance(cleanBody());
      assert.deepEqual(sealed.completeness, { status: "COMPLETE", gaps: [] });
      assert.equal(verifyAyasReleaseProvenance(sealed).ok, true);
      assert.equal(verifyAyasReleaseProvenance(JSON.parse(JSON.stringify(sealed))).ok, true, "survives a round trip through a file");
      const edited = { ...sealed, git: { ...sealed.git, head: "f".repeat(40) } };
      assert.deepEqual(verifyAyasReleaseProvenance(edited), { ok: false, problems: ["MANIFEST_DIGEST_MISMATCH", "COMPLETENESS_NOT_IMPLIED_BY_FACTS"] });
      // A dirty tree relabelled COMPLETE, with the digest recomputed over the lie.
      const dirty = sealAyasReleaseProvenance(cleanBody({ git: { head: "1".repeat(40), branch: "main", treeState: "DIRTY", dirtyPaths: 2 } }));
      assert.deepEqual(dirty.completeness, { status: "INCOMPLETE", gaps: ["GIT_TREE_DIRTY"] });
      const { manifestDigest: _digest, ...rest } = dirty; void _digest;
      const forgedBody = { ...rest, completeness: { status: "COMPLETE" as const, gaps: [] } };
      const forged = { ...forgedBody, manifestDigest: sha256(canonicalAyasJson(forgedBody)) };
      assert.deepEqual(verifyAyasReleaseProvenance(forged), { ok: false, problems: ["COMPLETENESS_NOT_IMPLIED_BY_FACTS"] });
      for (const bad of [null, [], "text", { ...sealed, schemaVersion: "2" }, { ...sealed, git: { ...sealed.git, head: "main" } }, { ...sealed, lockfile: { ...sealed.lockfile, sha256: "short" } }, { ...sealed, completeness: undefined }]) assert.equal(verifyAyasReleaseProvenance(bad).ok, false);
      assert.equal(canonicalAyasJson({ b: 1, a: [{ d: 1, c: 2 }] }), canonicalAyasJson({ a: [{ c: 2, d: 1 }], b: 1 }));
      assert.equal(canonicalAyasJson({ a: undefined, b: 1 }), '{"b":1}');
    });

    await scenario("gaps — each thing that was not read, not bound or not clean is named; being unsigned is a fact, not a gap", () => {
      const head = "1".repeat(40);
      const gapOf = (over: Partial<AyasReleaseProvenanceBody>) => findAyasProvenanceGaps(cleanBody(over));
      assert.deepEqual(gapOf({}), []);
      assert.deepEqual(gapOf({ git: { head, branch: null, treeState: "DIRTY", dirtyPaths: 1 } }), ["GIT_TREE_DIRTY"]);
      const blocked = build({ "node_modules/a": pkg("a", "1.0.0", { integrity: "" }) });
      assert.deepEqual(gapOf({ sbom: { ...cleanBody().sbom, summary: blocked.summary, blockingFindings: blocked.findings } }), ["SBOM_BLOCKING_FINDINGS"]);
      assert.deepEqual(gapOf({ advisories: { state: "NOT_CHECKED", reason: "not asked" } }), ["ADVISORIES_NOT_CHECKED"]);
      const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
      assert.deepEqual(gapOf({ advisories: { state: "REPORT", source: "npm-offline-cache", current: false, reportSha256: "5".repeat(64), reportedAt: null, counts: zero } }), ["ADVISORIES_NOT_CURRENT"], "a cached zero is not a current zero");
      assert.deepEqual(gapOf({ advisories: { state: "REPORT", source: "npm-registry", current: true, reportSha256: "5".repeat(64), reportedAt: null, counts: { ...zero, high: 2, total: 2 } } }), ["ADVISORIES_REPORTED"]);
      assert.deepEqual(gapOf({ artifacts: { ...cleanBody().artifacts, localVerification: "NOT_DONE" } }), ["ARTIFACTS_NOT_VERIFIED_LOCALLY"]);
      assert.deepEqual(gapOf({ artifacts: { ...cleanBody().artifacts, lifecycle: [{ ...cleanBody().artifacts.lifecycle[0]!, local: "MISMATCH" }] } }), ["ARTIFACT_IDENTITY_MISMATCH"]);
      assert.deepEqual(gapOf({ artifacts: { ...cleanBody().artifacts, lifecycle: [{ ...cleanBody().artifacts.lifecycle[0]!, local: "ABSENT" }] } }), [], "an artifact that is simply not on this machine is not a mismatch");
      const graph = cleanBody().graphify as Extract<AyasReleaseProvenanceBody["graphify"], { state: "PRESENT" }>;
      assert.deepEqual(gapOf({ graphify: { state: "ABSENT" } }), ["GRAPHIFY_NOT_BUILT_FROM_HEAD"]);
      assert.deepEqual(gapOf({ graphify: { ...graph, builtFromHead: "2".repeat(40) } }), ["GRAPHIFY_NOT_BUILT_FROM_HEAD"]);
      assert.deepEqual(gapOf({ graphify: { ...graph, structural: "PARTIAL" } }), ["GRAPHIFY_STRUCTURE_INCOMPLETE"]);
      assert.deepEqual(gapOf({ graphify: { ...graph, anomalies: 1 } }), ["GRAPHIFY_STRUCTURE_INCOMPLETE"]);
      const baseline = cleanBody().testMatrix.baseline as Extract<AyasReleaseProvenanceBody["testMatrix"]["baseline"], { state: "PRESENT" }>;
      const matrix = cleanBody().testMatrix;
      assert.deepEqual(gapOf({ testMatrix: { ...matrix, baseline: { state: "ABSENT" } } }), ["TEST_BASELINE_ABSENT"]);
      assert.deepEqual(gapOf({ testMatrix: { ...matrix, baseline: { ...baseline, sourceHead: "2".repeat(40) } } }), ["TEST_BASELINE_NOT_BOUND_TO_HEAD"]);
      for (const failing of [{ failed: 1 }, { complete: false }, { outcome: "FAIL" }, { outcome: "RESOURCE_ABORT" }, { outcome: "INCOMPLETE_TIMEOUT" }]) assert.deepEqual(gapOf({ testMatrix: { ...matrix, baseline: { ...baseline, ...failing } } }), ["TEST_BASELINE_FAILED"], JSON.stringify(failing));
      assert.deepEqual(gapOf({ testMatrix: { ...matrix, baseline: { ...baseline, outcome: "PASS_WITH_KNOWN_LIMITATIONS" } } }), []);
      const built = cleanBody().build as Extract<AyasReleaseProvenanceBody["build"], { state: "PRESENT" }>;
      assert.deepEqual(gapOf({ build: { state: "ABSENT" } }), ["BUILD_ABSENT"]);
      assert.deepEqual(gapOf({ build: { ...built, stampedHead: null, stampedLockfileSha256: null } }), ["BUILD_NOT_BOUND_TO_HEAD"]);
      assert.deepEqual(gapOf({ build: { ...built, stampedHead: "2".repeat(40) } }), ["BUILD_NOT_BOUND_TO_HEAD"]);
      assert.deepEqual(gapOf({ build: { ...built, stampedLockfileSha256: "c".repeat(64) } }), ["BUILD_NOT_BOUND_TO_HEAD"], "built from this commit but another lockfile");
      assert.equal(cleanBody().signature.state, "UNSIGNED");
    });

    await scenario("advisory report — counts are quoted only from a report that adds up", () => {
      const report = (vulnerabilities: unknown) => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities } });
      assert.deepEqual(summarizeAyasNpmAuditReport(report({ info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 })), { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 });
      for (const bad of [null, {}, report(undefined), report({ info: 0, low: 0, moderate: 0, high: 0, critical: 0 }), report({ info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 0 }),
        report({ info: 0, low: -1, moderate: 0, high: 0, critical: 0, total: -1 }), report({ info: "0", low: 0, moderate: 0, high: 0, critical: 0, total: 0 }), report({ info: 0.5, low: 0, moderate: 0, high: 0, critical: 0, total: 0.5 })]) {
        assert.equal(summarizeAyasNpmAuditReport(bad), null, JSON.stringify(bad));
      }
    });

    await scenario("drift — a stored manifest compared with the facts now names exactly what changed", () => {
      const recorded = cleanBody();
      assert.deepEqual(compareAyasReleaseProvenance(recorded, cleanBody({ generatedAt: "2027-01-01T00:00:00.000Z" })), [], "the time it was generated is not a difference");
      const graph = recorded.graphify as Extract<AyasReleaseProvenanceBody["graphify"], { state: "PRESENT" }>;
      const cases: [Partial<AyasReleaseProvenanceBody>, string[]][] = [
        [{ git: { ...recorded.git, head: "2".repeat(40) } }, ["GIT_HEAD"]],
        [{ git: { ...recorded.git, treeState: "DIRTY", dirtyPaths: 1 } }, ["TREE_STATE"]],
        [{ lockfile: { ...recorded.lockfile, sha256: "c".repeat(64) } }, ["LOCKFILE"]],
        [{ lockfile: { ...recorded.lockfile, packageJsonSha256: "c".repeat(64) } }, ["PACKAGE_JSON"]],
        [{ sbom: { ...recorded.sbom, sha256: "c".repeat(64) } }, ["SBOM"]],
        [{ advisories: { state: "NOT_CHECKED", reason: "x" } }, ["ADVISORIES"]],
        [{ artifacts: { ...recorded.artifacts, lifecycle: [{ ...recorded.artifacts.lifecycle[0]!, identity: { type: "ollama-digest", tag: "fixture:1", digest: "d".repeat(64) } }] } }, ["ARTIFACTS"]],
        [{ graphify: { ...graph, nodes: 11 } }, ["GRAPHIFY"]],
        [{ testMatrix: { ...recorded.testMatrix, manifestDigest: "c".repeat(64) } }, ["TEST_MATRIX"]],
        [{ testMatrix: { ...recorded.testMatrix, baseline: { state: "ABSENT" } } }, ["TEST_BASELINE"]],
        [{ build: { state: "ABSENT" } }, ["BUILD"]],
      ];
      for (const [over, expected] of cases) assert.deepEqual(compareAyasReleaseProvenance(recorded, cleanBody(over)), expected, expected.join());
    });

    await scenario("build digest — every file's path and bytes, in path order; caches, traces and links are not build output", () => {
      const root = fixtureRepository("digest");
      writeBuild(root, { BUILD_ID: "build-one\n", "server/app.js": "console.log(1)\n", "static/chunk.js": "export {}\n", "cache/webpack.pack": "noise", "trace": "noise", "diagnostics/x.json": "{}", [AYAS_BUILD_STAMP_FILE]: "{}" });
      const first = digestAyasBuildOutput(path.join(root, ".next"));
      assert.deepEqual([first.files, first.bytes], [3, "build-one\n".length + "console.log(1)\n".length + "export {}\n".length]);
      fs.writeFileSync(path.join(root, ".next", "cache", "more.pack"), "more noise");
      fs.writeFileSync(path.join(root, ".next", AYAS_BUILD_STAMP_FILE), '{"later":true}');
      assert.deepEqual(digestAyasBuildOutput(path.join(root, ".next")), first, "cache and stamp changes do not change the digest");
      fs.writeFileSync(path.join(root, ".next", "server", "app.js"), "console.log(2)\n");
      assert.notEqual(digestAyasBuildOutput(path.join(root, ".next")).sha256, first.sha256, "one changed byte does");
      fs.writeFileSync(path.join(root, ".next", "server", "app.js"), "console.log(1)\n");
      fs.renameSync(path.join(root, ".next", "static", "chunk.js"), path.join(root, ".next", "static", "other.js"));
      assert.notEqual(digestAyasBuildOutput(path.join(root, ".next")).sha256, first.sha256, "so does a renamed file with the same bytes");
    });

    await scenario("collector — reads a repository into a sealed manifest with nothing machine-specific in it", async () => {
      const root = fixtureRepository("collect");
      const head = git(root, "rev-parse", "HEAD");
      const collected = await collectAyasReleaseProvenance({ repoRoot: root, now: new Date("2026-10-02T03:04:05.000Z"), env: { NODE_ENV: "test" } });
      const { manifest } = collected;
      assert.equal(verifyAyasReleaseProvenance(manifest).ok, true);
      assert.deepEqual([manifest.subject, manifest.git.head, manifest.git.treeState, manifest.git.dirtyPaths, manifest.generatedAt], [{ name: "fixture-app", version: "1.2.3" }, head, "CLEAN", 0, "2026-10-02T03:04:05.000Z"]);
      assert.equal(manifest.lockfile.sha256, sha256(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")));
      assert.equal(manifest.sbom.sha256, sha256(collected.sbomText));
      assert.equal(JSON.parse(collected.sbomText).components.length, 1);
      assert.deepEqual([manifest.testMatrix.manifestVersion, manifest.testMatrix.suites, manifest.testMatrix.baseline.state], ["fixture-v1", 2, "ABSENT"]);
      assert.deepEqual([manifest.advisories.state, manifest.graphify.state, manifest.build.state, manifest.artifacts.localVerification, manifest.signature.state], ["NOT_CHECKED", "ABSENT", "ABSENT", "NOT_DONE", "UNSIGNED"]);
      assert.deepEqual(manifest.completeness, { status: "INCOMPLETE", gaps: ["ADVISORIES_NOT_CHECKED", "ARTIFACTS_NOT_VERIFIED_LOCALLY", "GRAPHIFY_NOT_BUILT_FROM_HEAD", "TEST_BASELINE_ABSENT", "BUILD_ABSENT"] });
      assert.ok(manifest.artifacts.lifecycle.length >= 15 && manifest.artifacts.lifecycle.every((item) => item.local === null));
      const text = JSON.stringify(manifest);
      for (const forbidden of [root, root.replace(/\\/g, "/"), root.replace(/\\/g, "\\\\"), os.tmpdir(), os.homedir(), os.userInfo().username, repo]) assert.ok(!text.includes(forbidden), `the manifest must not hold ${forbidden}`);
      // CRLF checkout of the same lockfile: the same digest.
      fs.writeFileSync(path.join(root, "package-lock.json"), fs.readFileSync(path.join(root, "package-lock.json"), "utf8").replace(/\n/g, "\r\n"));
      const crlf = await collectAyasReleaseProvenance({ repoRoot: root, now: new Date("2026-10-02T03:04:05.000Z"), env: { NODE_ENV: "test" } });
      assert.equal(crlf.manifest.lockfile.sha256, manifest.lockfile.sha256); assert.equal(crlf.manifest.sbom.sha256, manifest.sbom.sha256);
    });

    await scenario("collector — a baseline, an advisory report and a stamped build are bound to this commit or reported as not bound", async () => {
      const root = fixtureRepository("bound");
      const head = git(root, "rev-parse", "HEAD");
      const lockDigest = sha256(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
      fs.mkdirSync(path.join(root, "reports"));
      const baseline = (sourceHead: string) => { fs.writeFileSync(path.join(root, "reports", "baseline.json"), JSON.stringify({ outcome: "PASS", sourceHead, selectedSuites: 2, failed: [], completeDeclaredBaseline: true })); };
      fs.writeFileSync(path.join(root, "reports", "audit.json"), JSON.stringify({ auditReportVersion: 2, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } }));
      const collect = (source: "npm-offline-cache" | "npm-registry") => collectAyasReleaseProvenance({ repoRoot: root, now: new Date(), env: { NODE_ENV: "test" }, baselineReportFile: "reports/baseline.json", advisoryReport: { file: "reports/audit.json", source } });

      baseline(head);
      writeBuild(root, { BUILD_ID: "b1\n", "server/app.js": "x" });
      fs.writeFileSync(path.join(root, ".next", AYAS_BUILD_STAMP_FILE), JSON.stringify(buildAyasBuildStamp(root, new Date())));
      const bound = (await collect("npm-registry")).manifest;
      assert.deepEqual(bound.completeness.gaps, ["ARTIFACTS_NOT_VERIFIED_LOCALLY", "GRAPHIFY_NOT_BUILT_FROM_HEAD"]);
      assert.deepEqual(bound.build.state === "PRESENT" && [bound.build.buildId, bound.build.stampedHead, bound.build.stampedLockfileSha256, bound.build.files], ["b1", head, lockDigest, 2]);
      assert.deepEqual(bound.advisories.state === "REPORT" && [bound.advisories.source, bound.advisories.current, bound.advisories.counts.total, bound.advisories.reportSha256], ["npm-registry", true, 0, sha256(fs.readFileSync(path.join(root, "reports", "audit.json")))]);

      assert.ok((await collect("npm-offline-cache")).manifest.completeness.gaps.includes("ADVISORIES_NOT_CURRENT"));
      baseline("2".repeat(40));
      assert.ok((await collect("npm-registry")).manifest.completeness.gaps.includes("TEST_BASELINE_NOT_BOUND_TO_HEAD"));
      baseline(head);
      // A stamp written from a dirty tree, a stamp for another commit, a malformed stamp and no stamp: all unbound.
      for (const stamp of [{ ...buildAyasBuildStamp(root, new Date())!, treeState: "DIRTY" }, { ...buildAyasBuildStamp(root, new Date())!, gitHead: "2".repeat(40) }, "not json", null]) {
        const file = path.join(root, ".next", AYAS_BUILD_STAMP_FILE);
        if (stamp === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, typeof stamp === "string" ? stamp : JSON.stringify(stamp));
        assert.ok((await collect("npm-registry")).manifest.completeness.gaps.includes("BUILD_NOT_BOUND_TO_HEAD"), JSON.stringify(stamp));
      }
      for (const [file, text] of [["reports/audit.json", "{}"], ["reports/audit.json", "not json"], ["reports/baseline.json", JSON.stringify({ outcome: "PASS", sourceHead: "HEAD", selectedSuites: 2, failed: [] })]] as const) {
        const before = fs.readFileSync(path.join(root, file), "utf8");
        fs.writeFileSync(path.join(root, file), text);
        await assert.rejects(() => collect("npm-registry"), /AYAS_PROVENANCE_(?:ADVISORY|BASELINE)_REPORT_INVALID/);
        fs.writeFileSync(path.join(root, file), before);
      }
    });

    await scenario("build stamp — the commit, the lockfile and whether the tree was clean; nothing when Git cannot be read", () => {
      const root = fixtureRepository("stamp");
      const clean = buildAyasBuildStamp(root, new Date("2026-10-02T00:00:00.000Z"))!;
      assert.deepEqual(clean, { schemaVersion: "1", gitHead: git(root, "rev-parse", "HEAD"), treeState: "CLEAN", lockfileSha256: sha256(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")), stampedAt: "2026-10-02T00:00:00.000Z" });
      fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture-app", version: "1.2.4" })}\n`);
      assert.equal(buildAyasBuildStamp(root, new Date())!.treeState, "DIRTY");
      const outside = fs.mkdtempSync(path.join(temp, "no-git-"));
      assert.equal(buildAyasBuildStamp(outside, new Date()), null);
      // The script itself: stamps a build, and never fails a build that has nothing to stamp.
      const script = path.join(repo, "scripts", "ayas-build-stamp.ts");
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const run = (cwd: string) => spawnSync(process.execPath, [tsx, script], { cwd, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      const nothing = run(root); assert.equal(nothing.status, 0); assert.match(nothing.stdout, /no build output/);
      writeBuild(root, { BUILD_ID: "b1\n" });
      const stamped = run(root); assert.equal(stamped.status, 0);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".next", AYAS_BUILD_STAMP_FILE), "utf8")).treeState, "DIRTY");
      writeBuild(outside, { BUILD_ID: "b1\n" });
      const unreadable = run(outside); assert.equal(unreadable.status, 0); assert.match(unreadable.stdout, /unstamped/);
      assert.ok(!fs.existsSync(path.join(outside, ".next", AYAS_BUILD_STAMP_FILE)));
    });

    await scenario("operator script — prints by default and writes nothing; --out writes new files only; --verify names what changed", () => {
      const root = fixtureRepository("cli");
      const script = path.join(repo, "scripts", "ayas-release-provenance.ts");
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const run = (...args: string[]) => spawnSync(process.execPath, [tsx, script, ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, NODE_ENV: "test" } });
      const before = git(root, "status", "--porcelain=v1");
      const printed = run();
      assert.equal(printed.status, 0, printed.stderr); assert.match(printed.stdout, /completeness INCOMPLETE/); assert.match(printed.stdout, /advisories {3}NOT_CHECKED/);
      assert.equal(git(root, "status", "--porcelain=v1"), before, "nothing written");
      const written = run("--out", "reports/release");
      assert.equal(written.status, 0, written.stderr);
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "reports", "release", "RELEASE_PROVENANCE.json"), "utf8"));
      assert.equal(verifyAyasReleaseProvenance(manifest).ok, true);
      assert.equal(sha256(fs.readFileSync(path.join(root, "reports", "release", "SBOM.cdx.json"))), manifest.sbom.sha256, "the manifest's SBOM digest is the digest of the file beside it");
      const again = run("--out", "reports/release");
      assert.equal(again.status, 1, "an existing record is not overwritten"); assert.match(again.stderr, /EEXIST/);
      const same = run("--verify", "reports/release/RELEASE_PROVENANCE.json", "--json");
      assert.equal(same.status, 0, same.stderr); assert.deepEqual(JSON.parse(same.stdout).changedSince, []); assert.equal(JSON.parse(same.stdout).seal, "INTACT");
      fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture-app", version: "1.2.4" })}\n`);
      const changed = run("--verify", "reports/release/RELEASE_PROVENANCE.json", "--json");
      assert.equal(changed.status, 1); assert.deepEqual(JSON.parse(changed.stdout).changedSince, ["TREE_STATE", "PACKAGE_JSON"]);
      fs.writeFileSync(path.join(root, "reports", "release", "RELEASE_PROVENANCE.json"), JSON.stringify({ ...manifest, git: { ...manifest.git, treeState: "DIRTY" } }));
      const broken = run("--verify", "reports/release/RELEASE_PROVENANCE.json", "--json");
      assert.equal(broken.status, 1); assert.equal(JSON.parse(broken.stdout).seal, "BROKEN");
      for (const args of [["--unknown"], ["--out"], ["--advisory-report", "x.json"], ["--advisory-source", "registry"], ["--advisory-report", "x.json", "--advisory-source", "somewhere"], ["--deep"], ["--out", "a", "--out", "b"]]) {
        const refused = run(...args); assert.equal(refused.status, 1, args.join(" ")); assert.match(refused.stderr, /AYAS_PROVENANCE_ARGUMENTS_INVALID/, args.join(" "));
      }
    });

    await scenario("no upgrade, no install, no network — the provenance code cannot do any of them", () => {
      const stampModule = "src/lib/ayas/provenance/AyasBuildStamp.ts";
      const collectorModule = "src/lib/ayas/provenance/AyasReleaseProvenanceCollector.ts";
      const files = ["src/lib/ayas/provenance/AyasSbom.ts", "src/lib/ayas/provenance/AyasReleaseProvenance.ts", stampModule, collectorModule, "scripts/ayas-release-provenance.ts", "scripts/ayas-build-stamp.ts"];
      const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const file of files) {
        const code = read(file);
        for (const forbidden of [/\bfetch\s*\(/, /node:https?|node:net|node:dns|node:tls/, /["'`]npm["'`]/, /\bnpx\b/, /\bexec\s*\(|\bexecSync\s*\(|\bspawn(?:Sync)?\s*\(/, /shell\s*:\s*true/]) {
          assert.ok(!forbidden.test(code), `${file} must not contain ${forbidden}`);
        }
        // The environment is read in one place only: to find where a pinned artifact lives on this machine. Its values
        // are never written into the manifest (the collector scenario checks the output for machine paths).
        assert.equal(code.split("process.env").length - 1, file === collectorModule ? 1 : 0, `${file}: environment reads`);
        // One process, started in one place: Git, read-only.
        assert.equal(code.split("execFileSync(").length - 1, file === stampModule ? 1 : 0, `${file}: process starts`);
      }
      assert.ok(read(stampModule).includes('execFileSync("git", ["--no-optional-locks"'));
      const gitArguments = [stampModule, collectorModule].flatMap((file) => [...read(file).matchAll(/(?:git|readAyasGit)\(repoRoot, \[([^\]]*)\]/g)].map((match) => match[1]!.split(",")[0]!.trim()));
      assert.deepEqual([...new Set(gitArguments)].sort(), ['"rev-parse"', '"show"', '"status"']);
      // The build hook reaches the stamp module and nothing else of AYAS.
      assert.deepEqual([...fs.readFileSync(path.join(repo, "scripts/ayas-build-stamp.ts"), "utf8").matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]), ["../src/lib/ayas/provenance/AyasBuildStamp"]);
      assert.deepEqual([...fs.readFileSync(path.join(repo, stampModule), "utf8").matchAll(/from "(\.[^"]+)"/g)], []);
      for (const pure of ["src/lib/ayas/provenance/AyasSbom.ts", "src/lib/ayas/provenance/AyasReleaseProvenance.ts"]) {
        const code = fs.readFileSync(path.join(repo, pure), "utf8");
        assert.ok(!/node:fs|node:child_process|node:path|Date\.now|new Date\(/.test(code), `${pure} is pure`);
      }
    });
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-provenance-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Stage 15G release provenance: PASS (${count} scenarios; TEMP only; install/network/production actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
