import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

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
 * THREE classes below now pair with a generator that can safely synthesize
 * patch content without semantic guessing (M19 expands this from the
 * original one):
 *   - `error-code-contract-gap` — a custom `*Error` class's own declared
 *     `code` union is a closed, mechanically-checkable contract: "does
 *     `new SomeError("X", msg).code` equal `"X"`, is it
 *     `instanceof SomeError`/`Error`" needs no knowledge of when or why the
 *     error is thrown in production.
 *   - `error-code-contract-drift` (M19) — a previously-generated contract
 *     test no longer byte-matches what the CURRENT generator template would
 *     produce for its class (source union changed, or the template itself
 *     was fixed, e.g. M19.3's exhaustiveness guard); regenerating it is the
 *     same mechanical, no-guessing operation as the original generation.
 *   - `diagnostic-quality-gap` (M19) — a bare `assert.equal/ok/deepEqual`
 *     call with no failure message; appending the call's own literal source
 *     text as the message is purely mechanical (never invents WHAT is
 *     asserted, only echoes it back as the failure's diagnostic label).
 *
 * The remaining detect-only classes below (`probe-coverage-gap`,
 * `workflow-resilience-gap`, `product-quality-gap`) are real, wired,
 * evidence-producing scanners (multi-domain discovery, per M17 Phase 17)
 * but are deliberately left detect-only: safely synthesizing a *behavioral*
 * fix (calling an arbitrary probe function that may shell out to
 * nvidia-smi/ffprobe, or deciding what an empty `catch {}` under
 * `src/lib/ayas/**` — a REVIEW_REQUIRED domain regardless of content —
 * should actually do) requires semantic understanding of the target's
 * contract, side effects, or intent that a structural scanner cannot safely
 * fabricate. Disclosed, not hidden — the same posture this codebase already
 * takes for other known-open gaps (see M15.1's stale-head disclosure in
 * ATOLYE_CHECKPOINT.md).
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
// Class 1b (generator-backed, M19): error-code-contract-drift
// Class 6 (generator-backed, M19): diagnostic-quality-gap (bare assertions)
// ---------------------------------------------------------------------------

export interface AyasErrorCodeContractGap {
  readonly className: string;
  readonly sourceFile: string;
  readonly modulePath: string;
  readonly codes: readonly string[];
}

const ERROR_CLASS_RE = /export class (\w+) extends Error \{\s*constructor\(readonly code:([\s\S]*?), message: string\)/g;
const CODE_LITERAL_RE = /"([A-Za-z][A-Za-z0-9_]*)"/g;

/** Shared scan of `src/lib/**` for `class XError extends Error { constructor(readonly code: "A" | "B" ..., message: string) }` — every declared class + its current code union, UNFILTERED (unlike `findAyasErrorCodeContractGaps`, this does not exclude classes that already have a generated test — `findAyasErrorCodeContractDrift` needs exactly those). */
function scanAyasErrorClassCodeUnions(repoRoot: string): readonly AyasErrorCodeContractGap[] {
  const libRoot = path.join(repoRoot, "src", "lib");
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
      gaps.push({ className, sourceFile: toPosix(repoRoot, file), modulePath: toModuleImportPath(repoRoot, file), codes });
    }
  }
  return gaps.sort((a, b) => a.className.localeCompare(b.className));
}

/** Scans `src/lib/**` for `class XError extends Error { constructor(readonly code: "A" | "B" ..., message: string) }` and returns every one whose class name never appears as `new ClassName(` anywhere in `scripts/smoke-*.ts` — i.e. the contract has zero direct construction test. Deterministic, read-only, no model call. */
export function findAyasErrorCodeContractGaps(repoRoot: string): readonly AyasErrorCodeContractGap[] {
  const smoke = readSmokeCorpus(repoRoot);
  return scanAyasErrorClassCodeUnions(repoRoot).filter((gap) => !smoke.text.includes(`new ${gap.className}(`));
}

function slug(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** One `import ... from "...";` edge per statement — empirically confirmed 1:1 against Graphify's own `imports_from` AST edges (verified against this repo's real `@sentropic/graphify` install: a 2-import file measures 2, a 9-import file measures 9). Used to self-declare a generator's expected Graphify import count per file instead of relying on an externally hardcoded, per-generator-identity constant that cannot vary per file. */
export function countDeclaredImportStatements(content: string): number {
  return (content.match(/^import\s.+\sfrom\s+["'][^"']+["'];?\s*$/gm) ?? []).length;
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
  /** Self-declared, content-derived expected Graphify `imports_from` edge count per file in `exactFiles` — durable on the frozen artifact, checked verbatim (never re-guessed) at execution time. */
  readonly expectedGraphifyImportCounts: Readonly<Record<string, number>>;
}

/** Pure content builder shared by the create path (`generateAyasErrorCodeContractPatch`) and the drift/regenerate path (`generateAyasErrorCodeContractDriftPatch`) — both must always emit byte-identical content for the same gap, or drift detection (a byte comparison) would never settle. Includes a compile-time exhaustiveness guard (M19.3): if `${gap.className}`'s declared `code` union ever gains a member not present in `CODES`, `tsc --noEmit` fails on this file — the contract can no longer silently go stale. */
function buildAyasErrorCodeContractContent(gap: AyasErrorCodeContractGap, fileSlug: string): string {
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
    "// AYAS M19.3: compile-time exhaustiveness — if a future code is added to",
    `// ${gap.className}'s own declared union but not to CODES above, this line`,
    "// fails `tsc --noEmit` (never silently passes at runtime).",
    `type _AyasExpectedCode = ConstructorParameters<typeof ${gap.className}>[0];`,
    "type _AyasMissingCodes = Exclude<_AyasExpectedCode, (typeof CODES)[number]>;",
    'const _ayasExhaustiveCodesCheck: _AyasMissingCodes extends never ? true : ["AYAS: CODES is missing a declared code — regenerate this smoke test", _AyasMissingCodes] = true;',
    "void _ayasExhaustiveCodesCheck;",
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
  return lines.join("\n");
}

/** Pure content synthesis — no filesystem writes. Builds a smoke test that constructs every declared code and asserts the class's own mechanical contract (`.code`, `.name`, `instanceof`), plus a compile-time exhaustiveness guard. */
export function generateAyasErrorCodeContractPatch(gap: AyasErrorCodeContractGap): AyasGeneratedNovelPatch {
  const fileSlug = slug(gap.className.replace(/Error$/, ""));
  const targetFile = `scripts/smoke-ayas-error-code-contract-${fileSlug}.ts`;
  const content = buildAyasErrorCodeContractContent(gap, fileSlug);
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
    expectedDiffScope: `Bir yeni dosya: ${targetFile} (~${content.split("\n").length} satır, ${gap.codes.length * 4} test senaryosu)`,
    expectedGraphifyImportCounts: { [targetFile]: countDeclaredImportStatements(content) },
  };
}

// ---------------------------------------------------------------------------
// Class 1b (generator-backed, M19): error-code-contract-drift
// ---------------------------------------------------------------------------

export interface AyasErrorCodeContractDrift {
  readonly className: string;
  readonly sourceFile: string;
  readonly modulePath: string;
  readonly codes: readonly string[];
  readonly generatedFile: string;
  readonly currentGeneratedContent: string;
  readonly expectedContent: string;
}

/**
 * Detects a previously-generated `error-code-contract-gap` smoke test that no
 * longer matches what the CURRENT generator template would produce for its
 * class today — either because the source class's own declared `code` union
 * changed since the test was generated (real semantic drift), or because the
 * generator template itself gained a fix (e.g. M19.3's exhaustiveness guard)
 * that never got rolled out to this already-generated file. Both cases are
 * the same underlying problem: "this generated file no longer reflects
 * ground truth" — so both are detected and repaired the same way, by
 * regenerating from current source with the current template.
 */
export function findAyasErrorCodeContractDrift(repoRoot: string): readonly AyasErrorCodeContractDrift[] {
  const drift: AyasErrorCodeContractDrift[] = [];
  for (const gap of scanAyasErrorClassCodeUnions(repoRoot)) {
    const fileSlug = slug(gap.className.replace(/Error$/, ""));
    const targetFile = `scripts/smoke-ayas-error-code-contract-${fileSlug}.ts`;
    const abs = path.join(repoRoot, targetFile);
    let currentGeneratedContent: string;
    try { currentGeneratedContent = fs.readFileSync(abs, "utf8"); } catch { continue; } // no generated file yet — findAyasErrorCodeContractGaps's job, not drift
    const expectedContent = buildAyasErrorCodeContractContent(gap, fileSlug);
    if (currentGeneratedContent === expectedContent) continue; // already matches current source + current template — no drift
    drift.push({ className: gap.className, sourceFile: gap.sourceFile, modulePath: gap.modulePath, codes: gap.codes, generatedFile: targetFile, currentGeneratedContent, expectedContent });
  }
  return drift;
}

/** Pure content synthesis — regenerates a drifted contract test in place (an EDIT, not a create: `expectedHash` binds to the file's real current content). */
export function generateAyasErrorCodeContractDriftPatch(drift: AyasErrorCodeContractDrift): AyasGeneratedNovelPatch {
  const fileSlug = slug(drift.className.replace(/Error$/, ""));
  const beforeHash = crypto.createHash("sha256").update(drift.currentGeneratedContent, "utf8").digest("hex");
  return {
    candidateId: `ayas-drift-${fileSlug}`,
    generatorIdentity: "ayas-detector:error-code-contract-drift-v1",
    exactFiles: [drift.generatedFile],
    replacements: [{ filePath: drift.generatedFile, expectedHash: beforeHash, content: drift.expectedContent, allowCreate: false }],
    validatorScripts: [drift.generatedFile],
    objective: `${drift.className} kod sözleşmesi testini güncel kaynakla yeniden senkronize et`,
    currentProblem: `${drift.generatedFile}, ${drift.sourceFile} içindeki ${drift.className}'ın güncel 'code' union'ını veya güncel üretici şablonunu (ör. M19.3 exhaustiveness guard) yansıtmıyor — dosya, kaynaktan yeniden üretildiğinde farklı içerik veriyor.`,
    selectionReason: `${drift.generatedFile} içeriği, ${drift.sourceFile}'ın şu anki 'code' union'ından ve şu anki üretici şablonundan birebir yeniden üretilerek karşılaştırıldı; içerik eşleşmedi (drift).`,
    expectedUserBenefit: `${drift.className} için üretilmiş test, kaynağın veya şablonun güncel halini doğru yansıtır; sessizce eskimiş bir regresyon testi kalmaz.`,
    expectedBehaviorChange: "Var olan bir test dosyası, aynı üreticinin şu anki şablonuyla yeniden üretilerek değiştirilir; hiçbir üretim/çalışma zamanı davranışı değişmez.",
    unchangedBehavior: `${drift.className}'ın kendisi ve onu kullanan tüm çağıranlar birebir aynı kalır.`,
    riskIfNotDone: `${drift.generatedFile}, artık doğru olmayan veya eksik bir sözleşmeyi doğruluyormuş gibi görünmeye devam eder.`,
    technicalRisk: "Düşük; yalnızca daha önce bu üreticinin ürettiği tek bir test dosyası, aynı şablonla yeniden üretilir.",
    productionImpact: "none",
    rationale: `${drift.generatedFile}, ${drift.sourceFile}'dan ve güncel üretici şablonundan yeniden üretilen içerikle birebir eşleşmiyor.`,
    evidence: [`${drift.sourceFile} — ${drift.className}'ın güncel code union'ı: ${drift.codes.join(", ")}`, `${drift.generatedFile} içeriği, güncel şablonla yeniden üretilen içerikle byte-birebir karşılaştırıldı — eşleşmedi`],
    graphifyEvidence: [`${drift.generatedFile}'in mevcut içeriği ile ${drift.sourceFile}'dan+güncel şablondan yeniden türetilen beklenen içerik arasında yapısal fark tespit edildi (deterministik metin karşılaştırması)`],
    expectedDiffScope: `Var olan 1 dosya yeniden üretilir: ${drift.generatedFile}`,
    expectedGraphifyImportCounts: { [drift.generatedFile]: countDeclaredImportStatements(drift.expectedContent) },
  };
}

// ---------------------------------------------------------------------------
// Class 6 (generator-backed, M19): diagnostic-quality-gap
// ---------------------------------------------------------------------------

export interface AyasBareAssertionGap {
  readonly file: string;
  readonly currentContent: string;
  readonly expectedContent: string;
  readonly fixedCallCount: number;
}

/**
 * Finds every bare `assert.equal`/`assert.ok`/`assert.deepEqual(...)` call
 * via the REAL TypeScript AST (`ts.createSourceFile`), not a regex. A first
 * cut used a `[^)]*`-style regex, matched live against this repo's own
 * corpus, and produced a real bug: `assert.ok(Math.abs(x - y) < 0.4, msg)`
 * has a NESTED call (`Math.abs(...)`) as part of its first argument, and
 * `[^)]*` stops at that INNER closing paren — the "call" it thought it saw
 * was actually just `assert.ok(Math.abs(x - y)`, so appending a message
 * there inserted a bogus 2nd argument into `Math.abs` instead, a real
 * `tsc --noEmit` failure caught by sandbox validation (never applied for
 * real, but confirmed the regex approach cannot be trusted for the real
 * corpus). The AST has no such ambiguity: `node.arguments.length` is exact
 * regardless of how deeply nested the first argument's own expression is,
 * and `node.getEnd()` gives the call's real closing-paren position — this
 * is why this generator parses rather than pattern-matches.
 */
interface AyasBareAssertCallSite { readonly insertAt: number; readonly callText: string }

function findBareAssertCallSites(text: string, fileName: string): readonly AyasBareAssertCallSite[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const sites: AyasBareAssertCallSite[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "assert" &&
      (node.expression.name.text === "equal" || node.expression.name.text === "ok" || node.expression.name.text === "deepEqual")
    ) {
      const requiredArgs = node.expression.name.text === "ok" ? 1 : 2;
      if (node.arguments.length === requiredArgs) {
        const lastArg = node.arguments[node.arguments.length - 1]!;
        sites.push({ insertAt: lastArg.getEnd(), callText: node.getText(sourceFile) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/** Class 6 (generator-backed): a bare `assert.equal(a, b)` / `assert.ok(a)` / `assert.deepEqual(a, b)` call in `scripts/smoke-*.ts` with no failure-message argument — a failure gives no indication of which check failed. The fix is purely mechanical and non-semantic: append the call's own literal source text as its message, verbatim, so a failure at least names the exact expression that failed. Never changes what is asserted, only how a failure is reported. Bounded to files small enough to stay inside blast-radius policy (`AYAS_NOVEL_PATCH_MAX_TOTAL_LINES`) since a replacement is always the whole file. */
export function findAyasBareAssertionGaps(repoRoot: string): readonly AyasBareAssertionGap[] {
  const { files } = readSmokeCorpus(repoRoot);
  const gaps: AyasBareAssertionGap[] = [];
  for (const file of files) {
    let text: string;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    if (text.split("\n").length > AYAS_NOVEL_PATCH_MAX_TOTAL_LINES) continue; // whole-file replacement — stay inside blast-radius policy
    const sites = findBareAssertCallSites(text, file);
    if (sites.length === 0) continue;
    // Insert back-to-front so an earlier insertion never shifts a later site's offset.
    let expectedContent = text;
    for (const site of [...sites].sort((a, b) => b.insertAt - a.insertAt)) {
      expectedContent = `${expectedContent.slice(0, site.insertAt)}, ${JSON.stringify(site.callText)}${expectedContent.slice(site.insertAt)}`;
    }
    gaps.push({ file: toPosix(repoRoot, file), currentContent: text, expectedContent, fixedCallCount: sites.length });
  }
  return gaps;
}

/** Pure content synthesis — an EDIT (not a create): `expectedHash` binds to the target file's real current content. */
export function generateAyasBareAssertionMessagePatch(gap: AyasBareAssertionGap): AyasGeneratedNovelPatch {
  const beforeHash = crypto.createHash("sha256").update(gap.currentContent, "utf8").digest("hex");
  return {
    candidateId: `ayas-diagnostic-${slug(gap.file)}`,
    generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    exactFiles: [gap.file],
    replacements: [{ filePath: gap.file, expectedHash: beforeHash, content: gap.expectedContent, allowCreate: false }],
    validatorScripts: [gap.file],
    objective: `${gap.file} içindeki mesajsız assert çağrılarına teşhis mesajı ekle`,
    currentProblem: `${gap.file} içinde ${gap.fixedCallCount} adet assert.equal/ok/deepEqual çağrısı hiçbir üçüncü (mesaj) argüman taşımıyor — bu çağrılardan biri başarısız olduğunda hangi ifadenin başarısız olduğuna dair hiçbir bilgi verilmiyor.`,
    selectionReason: `${gap.file} kaynağının gerçek TypeScript AST'si ayrıştırılarak, argüman sayısı beklenen mesaj argümanını içermeyen assert.equal/ok/deepEqual çağrıları tespit edildi (yapısal, deterministik AST taraması — bir regex değil).`,
    expectedUserBenefit: "Bu dosyadaki bir regresyon artık hangi tam ifadenin başarısız olduğunu gösteren bir hata mesajıyla raporlanır; hata ayıklama süresi kısalır.",
    expectedBehaviorChange: "Var olan bir test dosyasındaki assert çağrılarına üçüncü argüman olarak kendi kaynak metinleri eklenir; hiçbir assert mantığı veya kontrol akışı değişmez.",
    unchangedBehavior: "Her assert çağrısının ne doğruladığı birebir aynı kalır; yalnızca başarısızlık mesajı eklenir.",
    riskIfNotDone: `${gap.file} içindeki bir regresyon, hangi ifadenin başarısız olduğuna dair hiçbir ipucu olmadan raporlanmaya devam eder.`,
    technicalRisk: "Düşük; yalnızca var olan assert çağrılarına üçüncü (mesaj) argüman eklenir, birinci ve ikinci argümanlar (asıl doğrulama) değişmez.",
    productionImpact: "none",
    rationale: `${gap.file} içinde ${gap.fixedCallCount} mesajsız assert çağrısı yapısal taramayla tespit edildi.`,
    evidence: [`${gap.file} — ${gap.fixedCallCount} adet assert.equal/ok/deepEqual çağrısı, TypeScript AST'sinde beklenen argüman sayısını (mesaj hariç) taşıyor — mesaj argümanı yok`],
    graphifyEvidence: [`${gap.file}'in mesajsız assert çağrıları gerçek TypeScript AST'si ayrıştırılarak tespit edildi; düzeltme yalnızca üçüncü argüman ekler, import grafiği değişmez`],
    expectedDiffScope: `Var olan 1 dosya düzenlenir: ${gap.file} (${gap.fixedCallCount} çağrıya mesaj eklenir, satır sayısı değişmez)`,
    expectedGraphifyImportCounts: { [gap.file]: countDeclaredImportStatements(gap.expectedContent) },
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

// ---------------------------------------------------------------------------
// M19.2/M19.4 — generator-source registry. `AyasNovelPatchDiscovery` (the
// individual PRIORITY_SAFE-proposal lane) loops over this list instead of
// hardcoding one detector, so every generator-backed class gets a
// deterministic evaluation opportunity each tick (never randomized, never
// silently suppressed). The MICRO_SAFE batch lane (`AyasMicroBatchAccumulator`)
// deliberately still draws from `error-code-contract-gap` alone — see
// `AyasMicroClassifier.ts`'s `AYAS_MICRO_ELIGIBLE_GENERATORS` doc comment for
// why the two new M19 generators start life PRIORITY_SAFE (edit-existing-file
// risk tier, not yet hand-reviewed into the fully-unattended micro lane).
// ---------------------------------------------------------------------------

export interface AyasGeneratorSource {
  readonly discoveryClass: string;
  /** Returns already-generated candidates ready for policy/sandbox evaluation, pre-filtered to exclude anything already up to date. Deterministic, read-only, no model call. */
  discover(repoRoot: string): readonly AyasGeneratedNovelPatch[];
}

export const AYAS_GENERATOR_SOURCES: readonly AyasGeneratorSource[] = [
  {
    discoveryClass: "error-code-contract-gap",
    discover(repoRoot) {
      return findAyasErrorCodeContractGaps(repoRoot)
        .map(generateAyasErrorCodeContractPatch)
        .filter((patch) => !fs.existsSync(path.join(repoRoot, patch.exactFiles[0]!)));
    },
  },
  {
    discoveryClass: "error-code-contract-drift",
    discover(repoRoot) {
      return findAyasErrorCodeContractDrift(repoRoot).map(generateAyasErrorCodeContractDriftPatch);
    },
  },
  {
    discoveryClass: "diagnostic-quality-gap",
    discover(repoRoot) {
      return findAyasBareAssertionGaps(repoRoot).map(generateAyasBareAssertionMessagePatch);
    },
  },
];

export type { AyasDaemonCandidate, AyasDaemonObservation };
