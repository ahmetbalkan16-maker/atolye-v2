import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findAyasErrorCodeContractGaps, generateAyasErrorCodeContractPatch, checkAyasNovelPatchLimits, findAyasProbeCoverageFindings,
  findAyasDiagnosticQualityFindings, findAyasWorkflowResilienceFindings, findAyasSelfHealObservabilityFindings, runAyasDiscoveryFindings,
  AYAS_NOVEL_PATCH_MAX_FILES, AYAS_NOVEL_PATCH_MAX_TOTAL_LINES, countDeclaredImportStatements, findAyasErrorCodeContractDrift,
  generateAyasErrorCodeContractDriftPatch, findAyasBareAssertionGaps, generateAyasBareAssertionMessagePatch, AYAS_GENERATOR_SOURCES,
} from "../src/lib/brain/autonomy/AyasPatchDetectors";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-detectors-fixture-"));
  fs.mkdirSync(path.join(root, "src", "lib", "widget"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "lib", "brain", "probe"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "lib", "brain", "selfheal"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "lib", "ayas", "inner"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  return root;
}

scenario("findAyasErrorCodeContractGaps finds a single-line code union with zero smoke construction coverage", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "WIDGET_BROKEN" | "WIDGET_MISSING", message: string) {\n    super(message);\n    this.name = "WidgetError";\n  }\n}\n', "utf8");
  const gaps = findAyasErrorCodeContractGaps(root);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.className, "WidgetError");
  assert.deepEqual(gaps[0]!.codes, ["WIDGET_BROKEN", "WIDGET_MISSING"]);
});

scenario("findAyasErrorCodeContractGaps finds a multi-line (piped) code union", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code:\n    | "WIDGET_A"\n    | "WIDGET_B"\n    | "WIDGET_C", message: string) {\n    super(message);\n  }\n}\n', "utf8");
  const gaps = findAyasErrorCodeContractGaps(root);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0]!.codes, ["WIDGET_A", "WIDGET_B", "WIDGET_C"]);
});

scenario("findAyasErrorCodeContractGaps excludes a class already directly constructed in a smoke test", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "WIDGET_BROKEN", message: string) { super(message); }\n}\n', "utf8");
  fs.writeFileSync(path.join(root, "scripts", "smoke-widget.ts"), 'import { WidgetError } from "../src/lib/widget/WidgetError";\nnew WidgetError("WIDGET_BROKEN", "x");\n', "utf8");
  assert.equal(findAyasErrorCodeContractGaps(root).length, 0);
});

scenario("findAyasErrorCodeContractGaps ignores a class with no declared code union", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "PlainError.ts"), 'export class PlainError extends Error {\n  constructor(message: string) { super(message); }\n}\n', "utf8");
  assert.equal(findAyasErrorCodeContractGaps(root).length, 0);
});

scenario("findAyasErrorCodeContractGaps is sorted deterministically by class name", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "ZError.ts"), 'export class ZError extends Error {\n  constructor(readonly code: "Z", message: string) { super(message); }\n}\n', "utf8");
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "AError.ts"), 'export class AError extends Error {\n  constructor(readonly code: "A", message: string) { super(message); }\n}\n', "utf8");
  const gaps = findAyasErrorCodeContractGaps(root);
  assert.deepEqual(gaps.map((g) => g.className), ["AError", "ZError"]);
});

scenario("generateAyasErrorCodeContractPatch is pure and deterministic — same gap, same content, twice", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "WIDGET_BROKEN", message: string) { super(message); }\n}\n', "utf8");
  const gaps = findAyasErrorCodeContractGaps(root);
  const p1 = generateAyasErrorCodeContractPatch(gaps[0]!);
  const p2 = generateAyasErrorCodeContractPatch(gaps[0]!);
  assert.deepEqual(p1, p2);
  assert.equal(p1.exactFiles.length, 1);
  assert.ok(p1.exactFiles[0]!.startsWith("scripts/smoke-ayas-error-code-contract-"));
  assert.ok(p1.replacements[0]!.content.includes('new WidgetError(code'));
  assert.ok(p1.replacements[0]!.content.includes("WIDGET_BROKEN"));
});

scenario("generateAyasErrorCodeContractPatch's generated content actually asserts every declared code", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "A" | "B" | "C", message: string) { super(message); }\n}\n', "utf8");
  const patch = generateAyasErrorCodeContractPatch(findAyasErrorCodeContractGaps(root)[0]!);
  for (const code of ["A", "B", "C"]) assert.ok(patch.replacements[0]!.content.includes(`"${code}"`));
});

scenario("checkAyasNovelPatchLimits admits a small, SAFE-domain new test file", () => {
  const violations = checkAyasNovelPatchLimits([{ filePath: "scripts/smoke-fixture.ts", expectedHash: null, content: "console.log(1);\n", allowCreate: true }]);
  assert.deepEqual(violations, []);
});

scenario("checkAyasNovelPatchLimits rejects a target outside the SAFE domain (e.g. execution control plane)", () => {
  const violations = checkAyasNovelPatchLimits([{ filePath: "src/lib/ayas/execution/AyasExecutionGateStore.ts", expectedHash: "somehash", content: "x", allowCreate: false }]);
  assert.ok(violations.some((v) => v.rule === "domain-allowlist"));
});

scenario(`checkAyasNovelPatchLimits rejects more than ${AYAS_NOVEL_PATCH_MAX_FILES} files`, () => {
  const replacements = Array.from({ length: AYAS_NOVEL_PATCH_MAX_FILES + 1 }, (_, i) => ({ filePath: `scripts/smoke-fixture-${i}.ts`, expectedHash: null, content: "x", allowCreate: true }));
  const violations = checkAyasNovelPatchLimits(replacements);
  assert.ok(violations.some((v) => v.rule === "file-count"));
});

scenario("checkAyasNovelPatchLimits rejects a total line count over the server-owned bound", () => {
  const content = `${"line\n".repeat(AYAS_NOVEL_PATCH_MAX_TOTAL_LINES + 10)}`;
  const violations = checkAyasNovelPatchLimits([{ filePath: "scripts/smoke-fixture.ts", expectedHash: null, content, allowCreate: true }]);
  assert.ok(violations.some((v) => v.rule === "total-lines"));
});

scenario("checkAyasNovelPatchLimits rejects content containing a null byte (binary guard)", () => {
  const violations = checkAyasNovelPatchLimits([{ filePath: "scripts/smoke-fixture.ts", expectedHash: null, content: "abc\0def", allowCreate: true }]);
  assert.ok(violations.some((v) => v.rule === "binary-content"));
});

scenario("checkAyasNovelPatchLimits rejects an empty replacement set", () => {
  assert.ok(checkAyasNovelPatchLimits([]).some((v) => v.rule === "file-count"));
});

scenario("findAyasProbeCoverageFindings reports an exported probe function never referenced in any smoke test", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "brain", "probe", "SomeProbe.ts"), "export function readSomeProbeSignal() { return 1; }\n", "utf8");
  const findings = findAyasProbeCoverageFindings(root);
  assert.ok(findings.some((f) => f.summary.includes("readSomeProbeSignal")));
});

scenario("findAyasProbeCoverageFindings does not report a probe function that IS referenced in a smoke test", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "brain", "probe", "SomeProbe.ts"), "export function readSomeProbeSignal() { return 1; }\n", "utf8");
  fs.writeFileSync(path.join(root, "scripts", "smoke-probe.ts"), "readSomeProbeSignal();\n", "utf8");
  assert.equal(findAyasProbeCoverageFindings(root).length, 0);
});

scenario("findAyasDiagnosticQualityFindings reports bare assert calls with no failure message", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-bare.ts"), "assert.equal(1, 1);\nassert.ok(true);\n", "utf8");
  const findings = findAyasDiagnosticQualityFindings(root);
  assert.ok(findings.length >= 1);
});

scenario("findAyasDiagnosticQualityFindings does not flag assertions that already carry a message", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-messaged.ts"), 'assert.equal(1, 1, "one must equal one");\n', "utf8");
  assert.equal(findAyasDiagnosticQualityFindings(root).length, 0);
});

scenario("findAyasWorkflowResilienceFindings reports an empty catch block under src/lib/ayas/**", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "ayas", "inner", "Swallow.ts"), "try { doSomething(); } catch {}\n", "utf8");
  const findings = findAyasWorkflowResilienceFindings(root);
  assert.ok(findings.length >= 1);
});

scenario("findAyasSelfHealObservabilityFindings excludes the safety-kernel files even from evidence-only scanning", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "brain", "selfheal", "BrainPatchSafety.ts"), "export function shouldNeverBeScanned() { return 1; }\n", "utf8");
  const findings = findAyasSelfHealObservabilityFindings(root);
  assert.equal(findings.some((f) => f.summary.includes("shouldNeverBeScanned")), false);
});

scenario("findAyasSelfHealObservabilityFindings reports an uncovered function outside the excluded kernel files", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "brain", "selfheal", "ObservabilityView.ts"), "export function summarizeSelfHealState() { return 1; }\n", "utf8");
  const findings = findAyasSelfHealObservabilityFindings(root);
  assert.ok(findings.some((f) => f.summary.includes("summarizeSelfHealState")));
});

scenario("runAyasDiscoveryFindings aggregates all four detect-only classes and never throws on an empty fixture", () => {
  const root = fixtureRoot();
  const findings = runAyasDiscoveryFindings(root);
  assert.equal(findings.length, 0);
});

scenario("a detector never throws for a directory that does not exist (fail closed to empty, not a crash)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-detectors-empty-"));
  assert.deepEqual(findAyasErrorCodeContractGaps(root), []);
  assert.deepEqual(runAyasDiscoveryFindings(root), []);
});

// ---------------------------------------------------------------------------
// M19 — countDeclaredImportStatements
// ---------------------------------------------------------------------------

scenario("countDeclaredImportStatements counts one edge per import statement, regardless of how many named symbols it destructures", () => {
  const content = [
    'import assert from "node:assert/strict";',
    'import { a, b, c } from "./module";',
    "",
    "assert.ok(a && b && c);",
    "",
  ].join("\n");
  assert.equal(countDeclaredImportStatements(content), 2);
});

scenario("countDeclaredImportStatements returns 0 for content with no import statements", () => {
  assert.equal(countDeclaredImportStatements("console.log(1);\n"), 0);
});

scenario("generateAyasErrorCodeContractPatch's own declared expectedGraphifyImportCounts matches its own countDeclaredImportStatements", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  const patch = generateAyasErrorCodeContractPatch(findAyasErrorCodeContractGaps(root)[0]!);
  const file = patch.exactFiles[0]!;
  assert.equal(patch.expectedGraphifyImportCounts[file], countDeclaredImportStatements(patch.replacements[0]!.content));
  assert.equal(patch.expectedGraphifyImportCounts[file], 2, "node:assert/strict + the one target-class import");
});

// ---------------------------------------------------------------------------
// M19 — error-code-contract-drift (Class 1b)
// ---------------------------------------------------------------------------

scenario("findAyasErrorCodeContractDrift finds nothing for a class with no generated file yet (that's findAyasErrorCodeContractGaps's job)", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  assert.deepEqual(findAyasErrorCodeContractDrift(root), []);
});

scenario("findAyasErrorCodeContractDrift finds nothing when the generated file already byte-matches the current template", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  const gap = findAyasErrorCodeContractGaps(root)[0]!;
  const patch = generateAyasErrorCodeContractPatch(gap);
  fs.writeFileSync(path.join(root, patch.exactFiles[0]!), patch.replacements[0]!.content, "utf8");
  assert.deepEqual(findAyasErrorCodeContractDrift(root), []);
});

scenario("findAyasErrorCodeContractDrift detects a stale generated file (source gained a code the generated file never covered)", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  const gap = findAyasErrorCodeContractGaps(root)[0]!;
  const patch = generateAyasErrorCodeContractPatch(gap);
  fs.writeFileSync(path.join(root, patch.exactFiles[0]!), patch.replacements[0]!.content, "utf8");
  // Source evolves: a second code is added to the union, but the generated file is never regenerated.
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X" | "Y", message: string) { super(message); }\n}\n', "utf8");
  const drift = findAyasErrorCodeContractDrift(root);
  assert.equal(drift.length, 1);
  assert.equal(drift[0]!.className, "WidgetError");
  assert.deepEqual(drift[0]!.codes, ["X", "Y"]);
});

scenario("generateAyasErrorCodeContractDriftPatch produces an EDIT (allowCreate: false) bound to the existing file's real current hash", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  const gap = findAyasErrorCodeContractGaps(root)[0]!;
  const patch = generateAyasErrorCodeContractPatch(gap);
  fs.writeFileSync(path.join(root, patch.exactFiles[0]!), patch.replacements[0]!.content, "utf8");
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X" | "Y", message: string) { super(message); }\n}\n', "utf8");
  const drift = findAyasErrorCodeContractDrift(root)[0]!;
  const driftPatch = generateAyasErrorCodeContractDriftPatch(drift);
  assert.equal(driftPatch.replacements[0]!.allowCreate, false);
  assert.notEqual(driftPatch.replacements[0]!.expectedHash, null);
  assert.ok(driftPatch.replacements[0]!.content.includes('"Y"'));
  assert.equal(driftPatch.generatorIdentity, "ayas-detector:error-code-contract-drift-v1");
});

// ---------------------------------------------------------------------------
// M19 — diagnostic-quality-gap generator (Class 6)
// ---------------------------------------------------------------------------

scenario("findAyasBareAssertionGaps flags a bare assert.equal(a, b) with no message", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-bare.ts"), "assert.equal(1, 1);\n", "utf8");
  const gaps = findAyasBareAssertionGaps(root);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.fixedCallCount, 1);
});

scenario("findAyasBareAssertionGaps does NOT flag assert.ok(cond, \"message\") as bare — a 2-argument assert.ok already has a message (the exact bug this generator must avoid)", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-messaged-ok.ts"), 'assert.ok(condition, "condition must hold");\n', "utf8");
  assert.deepEqual(findAyasBareAssertionGaps(root), []);
});

scenario("findAyasBareAssertionGaps DOES flag a genuinely bare assert.ok(cond) — one argument, no message", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-bare-ok.ts"), "assert.ok(condition);\n", "utf8");
  const gaps = findAyasBareAssertionGaps(root);
  assert.equal(gaps.length, 1);
});

scenario("findAyasBareAssertionGaps does not flag assert.equal(a, b, \"message\") — 3 arguments already has a message", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "scripts", "smoke-messaged-equal.ts"), 'assert.equal(1, 1, "one equals one");\n', "utf8");
  assert.deepEqual(findAyasBareAssertionGaps(root), []);
});

scenario("findAyasBareAssertionGaps skips a file whose line count already exceeds the blast-radius bound (whole-file replacement)", () => {
  const root = fixtureRoot();
  const content = `${"// padding\n".repeat(AYAS_NOVEL_PATCH_MAX_TOTAL_LINES + 5)}assert.equal(1, 1);\n`;
  fs.writeFileSync(path.join(root, "scripts", "smoke-too-big.ts"), content, "utf8");
  assert.deepEqual(findAyasBareAssertionGaps(root), []);
});

scenario("generateAyasBareAssertionMessagePatch appends the call's own literal source as its message, changes nothing else, and never adds a line", () => {
  const root = fixtureRoot();
  const original = 'assert.equal(error.code, code);\nassert.ok(flag);\n';
  fs.writeFileSync(path.join(root, "scripts", "smoke-bare2.ts"), original, "utf8");
  const gap = findAyasBareAssertionGaps(root)[0]!;
  const patch = generateAyasBareAssertionMessagePatch(gap);
  assert.equal(patch.replacements[0]!.allowCreate, false);
  assert.notEqual(patch.replacements[0]!.expectedHash, null);
  assert.equal(patch.replacements[0]!.content.split("\n").length, original.split("\n").length, "an in-place message append must never change the file's line count");
  assert.ok(patch.replacements[0]!.content.includes('assert.equal(error.code, code, "assert.equal(error.code, code)")'));
  assert.ok(patch.replacements[0]!.content.includes('assert.ok(flag, "assert.ok(flag)")'));
  // Re-scanning the GENERATED content itself must find no remaining bare calls — the fix is idempotent/complete.
  fs.writeFileSync(path.join(root, "scripts", "smoke-bare2.ts"), patch.replacements[0]!.content, "utf8");
  assert.deepEqual(findAyasBareAssertionGaps(root), []);
});

// ---------------------------------------------------------------------------
// M19.2/M19.4 — generator-source registry
// ---------------------------------------------------------------------------

scenario("AYAS_GENERATOR_SOURCES registers exactly the three M19 generator-backed classes, in a fixed (non-random) order", () => {
  assert.deepEqual(AYAS_GENERATOR_SOURCES.map((s) => s.discoveryClass), ["error-code-contract-gap", "error-code-contract-drift", "diagnostic-quality-gap"]);
});

scenario("every AYAS_GENERATOR_SOURCES entry's discover() is a pure function of repoRoot — same fixture, same result, twice", () => {
  const root = fixtureRoot();
  fs.writeFileSync(path.join(root, "src", "lib", "widget", "WidgetError.ts"), 'export class WidgetError extends Error {\n  constructor(readonly code: "X", message: string) { super(message); }\n}\n', "utf8");
  for (const source of AYAS_GENERATOR_SOURCES) {
    assert.deepEqual(source.discover(root), source.discover(root));
  }
});

console.log(`AYAS patch detectors smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-detectors", scenarios: count }));
