import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findAyasErrorCodeContractGaps, generateAyasErrorCodeContractPatch, checkAyasNovelPatchLimits, findAyasProbeCoverageFindings, findAyasDiagnosticQualityFindings, findAyasWorkflowResilienceFindings, findAyasSelfHealObservabilityFindings, runAyasDiscoveryFindings, AYAS_NOVEL_PATCH_MAX_FILES, AYAS_NOVEL_PATCH_MAX_TOTAL_LINES } from "../src/lib/brain/autonomy/AyasPatchDetectors";

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

console.log(`AYAS patch detectors smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-detectors", scenarios: count }));
