import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import type { AyasPatchArtifactReplacement } from "./AyasPatchArtifact";

/**
 * M17 — deterministic, structural discovery of novel (not hand-embedded)
 * self-improvement candidates. Every detector here reads real source under
 * `repoRoot` and reports findings backed by concrete evidence (a file path,
 * a line, a literal); none of them call a model, none of them guess at
 * runtime behavior, and none of them write anything. A detector that finds
 * nothing returns nothing — "no worthwhile improvement found" is a normal,
 * expected result on most ticks.
 *
 * Only ONE class below (`error-code-contract-gap`) currently pairs with a
 * generator that can safely synthesize new patch content without semantic
 * guessing: a custom `*Error` class's own declared `code` union is a closed,
 * mechanically-checkable contract — "does `new SomeError("X", msg).code`
 * equal `"X"`, is it `instanceof SomeError`/`Error`" needs no knowledge of
 * when or why the error is thrown in production. The other four classes
 * below are real, wired, evidence-producing scanners (multi-domain
 * discovery, per M17 Phase 17) but are deliberately detect-only for this
 * sprint: safely synthesizing a *behavioral* test (triggering a specific
 * empty-catch branch, or asserting the right thing about an untested probe
 * function) requires semantic understanding of the target's contract that a
 * structural scanner cannot safely fabricate. Disclosed, not hidden — the
 * same posture this codebase already takes for other known-open gaps (see
 * M15.1's stale-head disclosure in ATOLYE_CHECKPOINT.md).
 */

function listTsFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") listTsFiles(full, out); }
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function toModuleImportPath(repoRoot: string, absFile: string): string {
  const rel = path.relative(repoRoot, absFile).replace(/\\/g, "/").replace(/\.ts$/, "");
  return `../${rel}`;
}

function toPosix(repoRoot: string, absFile: string): string {
  return path.relative(repoRoot, absFile).replace(/\\/g, "/");
}

function readSmokeCorpus(repoRoot: string): { readonly files: readonly string[]; readonly text: string } {
  const scriptsDir = path.join(repoRoot, "scripts");
  let entries: string[] = [];
  try { entries = fs.readdirSync(scriptsDir).filter((f) => f.startsWith("smoke-") && f.endsWith(".ts")); } catch { entries = []; }
  const files = entries.map((f) => path.join(scriptsDir, f));
  const text = files.map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
  return { files, text };
}

// ---------------------------------------------------------------------------
// Class 1 (generator-backed): error-code-contract-gap
// ---------------------------------------------------------------------------

export interface AyasErrorCodeContractGap {
  readonly className: string;
  readonly sourceFile: string;
  readonly modulePath: string;
  readonly codes: readonly string[];
}

const ERROR_CLASS_RE = /export class (\w+) extends Error \{\s*constructor\(readonly code:([\s\S]*?), message: string\)/g;
const CODE_LITERAL_RE = /"([A-Za-z][A-Za-z0-9_]*)"/g;

/** Scans `src/lib/**` for `class XError extends Error { constructor(readonly code: "A" | "B" ..., message: string) }` and returns every one whose class name never appears as `new ClassName(` anywhere in `scripts/smoke-*.ts` — i.e. the contract has zero direct construction test. Deterministic, read-only, no model call. */
export function findAyasErrorCodeContractGaps(repoRoot: string): readonly AyasErrorCodeContractGap[] {
  const libRoot = path.join(repoRoot, "src", "lib");
  const smoke = readSmokeCorpus(repoRoot);
  const gaps: AyasErrorCodeContractGap[] = [];
  for (const file of listTsFiles(libRoot)) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    ERROR_CLASS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ERROR_CLASS_RE.exec(text))) {
      const className = match[1]!;
      const union = match[2]!;
      const codes = [...union.matchAll(CODE_LITERAL_RE)].map((m) => m[1]!);
      if (codes.length === 0) continue;
      const constructedInTests = smoke.text.includes(`new ${className}(`);
      if (constructedInTests) continue;
      gaps.push({ className, sourceFile: toPosix(repoRoot, file), modulePath: toModuleImportPath(repoRoot, file), codes });
    }
  }
  return gaps.sort((a, b) => a.className.localeCompare(b.className));
}

function slug(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface AyasGeneratedNovelPatch {
  readonly candidateId: string;
  readonly generatorIdentity: string;
  readonly exactFiles: readonly string[];
  readonly replacements: readonly AyasPatchArtifactReplacement[];
  readonly validatorScripts: readonly string[];
  readonly objective: string;
  readonly currentProblem: string;
  readonly selectionReason: string;
  readonly expectedUserBenefit: string;
  readonly expectedBehaviorChange: string;
  readonly unchangedBehavior: string;
  readonly riskIfNotDone: string;
  readonly technicalRisk: string;
  readonly productionImpact: string;
  readonly rationale: string;
  readonly evidence: readonly string[];
  readonly graphifyEvidence: readonly string[];
  readonly expectedDiffScope: string;
}

/** Pure content synthesis — no filesystem writes. Builds a smoke test that constructs every declared code and asserts the class's own mechanical contract (`.code`, `.name`, `instanceof`). */
export function generateAyasErrorCodeContractPatch(gap: AyasErrorCodeContractGap): AyasGeneratedNovelPatch {
  const fileSlug = slug(gap.className.replace(/Error$/, ""));
  const targetFile = `scripts/smoke-ayas-error-code-contract-${fileSlug}.ts`;
  const lines: string[] = [
    'import assert from "node:assert/strict";',
    `import { ${gap.className} } from "${gap.modulePath}";`,
    "",
    "/**",
    ` * ${gap.className}'s own declared `+"`code`"+` union (${gap.sourceFile}) had zero direct`,
    " * construction coverage in any scripts/smoke-*.ts file — no test ever",
    " * asserted that constructing this error with a given code actually",
    " * carries that exact code, name, and Error/subclass identity. A typo in",
    " * `this.code = code` or `this.name = \"...\"` (or a dropped code from the",
    " * union) would pass every existing test silently.",
    " */",
    `const CODES = [${gap.codes.map((c) => `"${c}"`).join(", ")}] as const;`,
    "",
    "for (const code of CODES) {",
    `  const error = new ${gap.className}(code, \`test message for \${code}\`);`,
    '  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);',
    `  assert.equal(error.name, "${gap.className}", "error.name must equal the class name");`,
    "  assert.ok(error instanceof Error, \"must be a real Error instance\");",
    `  assert.ok(error instanceof ${gap.className}, "must be an instance of its own class");`,
    "}",
    "",
    `console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-${fileSlug}", scenarios: CODES.length * 4 }));`,
    "",
  ];
  const content = lines.join("\n");
  return {
    candidateId: `ayas-novel-${fileSlug}`,
    generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    exactFiles: [targetFile],
    replacements: [{ filePath: targetFile, expectedHash: null, content, allowCreate: true }],
    validatorScripts: [targetFile],
    objective: `${gap.className} kod sözleşmesini test kapsamına al`,
    currentProblem: `${gap.sourceFile} içindeki ${gap.className} sınıfının kendi 'code' union'ı (${gap.codes.join(", ")}) hiçbir scripts/smoke-*.ts dosyasında doğrudan inşa edilip (new ${gap.className}(...)) code/name/instanceof sözleşmesi doğrulanmıyor.`,
    selectionReason: `Kaynak kodu doğrudan okunarak (${gap.sourceFile}) 'constructor(readonly code: ...)' union'ı görüldü; scripts/ genelinde grep ile 'new ${gap.className}(' hiçbir smoke dosyasında bulunmadığı doğrulandı.`,
    expectedUserBenefit: `${gap.className}'ın code/name alanlarını bozan bir regresyon (typo, eksik union değeri, yanlış this.name) artık bir regresyon testiyle yakalanır.`,
    expectedBehaviorChange: "Yeni bir smoke test dosyası eklenir; mevcut hiçbir üretim/çalışma zamanı davranışı değişmez.",
    unchangedBehavior: `${gap.className}'ın kendisi ve onu kullanan tüm çağıranlar birebir aynı kalır.`,
    riskIfNotDone: `${gap.className}'ın code/name sözleşmesini bozan bir regresyon fark edilmeden production'a girebilir.`,
    technicalRisk: "Düşük; yalnızca yeni, izole bir test dosyası eklenir, mevcut hiçbir dosya değişmez.",
    productionImpact: "none",
    rationale: `${gap.sourceFile} içindeki ${gap.className}'ın code union'ı hiçbir smoke testinde doğrudan inşa edilerek doğrulanmıyor.`,
    evidence: [`${gap.sourceFile} — export class ${gap.className} extends Error { constructor(readonly code: ${gap.codes.join(" | ")}, message: string) }`, `grep: 'new ${gap.className}(' scripts/smoke-*.ts içinde hiç bulunmuyor`],
    graphifyEvidence: [`${gap.className} has zero direct-construction test coverage for its own declared code union, confirmed via structural scan of src/lib/** and grep across scripts/smoke-*.ts`],
    expectedDiffScope: `Bir yeni dosya: ${targetFile} (~${lines.length} satır, ${gap.codes.length * 4} test senaryosu)`,
  };
}

// ---------------------------------------------------------------------------
// Detect-only classes (2-5): real scanners, no generator registered yet.
// ---------------------------------------------------------------------------

export interface AyasDiscoveryFinding {
  readonly detectorClass: string;
  readonly summary: string;
  readonly evidence: readonly string[];
}

/** Class 2 — observability/probe gaps: exported functions under the SAFE `src/lib/brain/probe/` domain whose name never appears in any smoke test. */
export function findAyasProbeCoverageFindings(repoRoot: string): readonly AyasDiscoveryFinding[] {
  const probeRoot = path.join(repoRoot, "src", "lib", "brain", "probe");
  const smoke = readSmokeCorpus(repoRoot);
  const findings: AyasDiscoveryFinding[] = [];
  for (const file of listTsFiles(probeRoot)) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const m of text.matchAll(/export function (\w+)\(/g)) {
      const name = m[1]!;
      if (!smoke.text.includes(name)) findings.push({ detectorClass: "probe-coverage-gap", summary: `${name} (${toPosix(repoRoot, file)}) is never referenced in any smoke test`, evidence: [toPosix(repoRoot, file)] });
    }
  }
  return findings;
}

/** Class 3 — diagnostic quality gaps: bare `assert.equal(a, b)`/`assert.ok(a)` calls in scripts/smoke-*.ts with no message argument. */
export function findAyasDiagnosticQualityFindings(repoRoot: string): readonly AyasDiscoveryFinding[] {
  const smoke = readSmokeCorpus(repoRoot);
  const findings: AyasDiscoveryFinding[] = [];
  for (const file of smoke.files) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const bare = text.match(/assert\.(?:equal|ok|deepEqual)\([^)]*\)/g)?.filter((call) => (call.match(/,/g)?.length ?? 0) < 2 && !call.includes("`")) ?? [];
    if (bare.length > 0) findings.push({ detectorClass: "diagnostic-quality-gap", summary: `${bare.length} bare assertion(s) with no failure message in ${toPosix(repoRoot, file)}`, evidence: [toPosix(repoRoot, file)] });
  }
  return findings;
}

/** Class 4 — workflow resilience gaps: empty `catch {}` blocks under `src/lib/ayas/**`. */
export function findAyasWorkflowResilienceFindings(repoRoot: string): readonly AyasDiscoveryFinding[] {
  const ayasRoot = path.join(repoRoot, "src", "lib", "ayas");
  const findings: AyasDiscoveryFinding[] = [];
  for (const file of listTsFiles(ayasRoot)) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const count = (text.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\/\*[^*]*\*\/\s*\}|catch\s*\{\s*\}/g) ?? []).length;
    if (count > 0) findings.push({ detectorClass: "workflow-resilience-gap", summary: `${count} empty catch block(s) in ${toPosix(repoRoot, file)}`, evidence: [toPosix(repoRoot, file)] });
  }
  return findings;
}

/** Class 5 — low-risk read-only product quality gaps: exported functions under the SAFE `src/lib/brain/selfheal/` observability subtree whose name never appears in any smoke test. */
export function findAyasSelfHealObservabilityFindings(repoRoot: string): readonly AyasDiscoveryFinding[] {
  const root = path.join(repoRoot, "src", "lib", "brain", "selfheal");
  const smoke = readSmokeCorpus(repoRoot);
  const findings: AyasDiscoveryFinding[] = [];
  for (const file of listTsFiles(root)) {
    if (/BrainPatchSafety|BrainSelfHealLimits|BrainUntrustedInput|BrainSelfHealGuards/.test(file)) continue; // FORBIDDEN/kernel files excluded even from evidence-only scanning
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const m of text.matchAll(/export function (\w+)\(/g)) {
      const name = m[1]!;
      if (!smoke.text.includes(name)) findings.push({ detectorClass: "product-quality-gap", summary: `${name} (${toPosix(repoRoot, file)}) is never referenced in any smoke test`, evidence: [toPosix(repoRoot, file)] });
    }
  }
  return findings;
}

export function runAyasDiscoveryFindings(repoRoot: string): readonly AyasDiscoveryFinding[] {
  return [
    ...findAyasProbeCoverageFindings(repoRoot),
    ...findAyasDiagnosticQualityFindings(repoRoot),
    ...findAyasWorkflowResilienceFindings(repoRoot),
    ...findAyasSelfHealObservabilityFindings(repoRoot),
  ];
}

// ---------------------------------------------------------------------------
// Server-owned blast-radius policy (M17 Phase 5) — never configurable from
// proposal text or client input.
// ---------------------------------------------------------------------------

export const AYAS_NOVEL_PATCH_MAX_FILES = 2;
export const AYAS_NOVEL_PATCH_MAX_TOTAL_LINES = 400;
export const AYAS_NOVEL_PATCH_MAX_FILE_CHARS = 20_000;

export interface AyasNovelPatchLimitViolation { readonly rule: string; readonly detail: string; }

/** Pure, deterministic policy check — domain safety (`classifyPatchSet`) plus size/blast-radius bounds. Returns violations; an empty array means the patch is admissible for sandbox drafting. Never itself touches disk. */
export function checkAyasNovelPatchLimits(replacements: readonly AyasPatchArtifactReplacement[]): readonly AyasNovelPatchLimitViolation[] {
  const violations: AyasNovelPatchLimitViolation[] = [];
  const exactFiles = replacements.map((r) => r.filePath);
  const safety = classifyPatchSet(exactFiles);
  if (safety.level !== "SAFE") violations.push({ rule: "domain-allowlist", detail: safety.summary });
  if (replacements.length === 0) violations.push({ rule: "file-count", detail: "no files" });
  if (replacements.length > AYAS_NOVEL_PATCH_MAX_FILES) violations.push({ rule: "file-count", detail: `${replacements.length} files exceeds max ${AYAS_NOVEL_PATCH_MAX_FILES}` });
  let totalLines = 0;
  for (const r of replacements) {
    if (r.content.includes("\0")) violations.push({ rule: "binary-content", detail: `${r.filePath} contains a null byte` });
    if (r.content.length > AYAS_NOVEL_PATCH_MAX_FILE_CHARS) violations.push({ rule: "file-size", detail: `${r.filePath} exceeds ${AYAS_NOVEL_PATCH_MAX_FILE_CHARS} chars` });
    totalLines += r.content.split("\n").length;
  }
  if (totalLines > AYAS_NOVEL_PATCH_MAX_TOTAL_LINES) violations.push({ rule: "total-lines", detail: `${totalLines} total lines exceeds max ${AYAS_NOVEL_PATCH_MAX_TOTAL_LINES}` });
  return violations;
}

export type { AyasDaemonCandidate, AyasDaemonObservation };
