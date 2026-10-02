/** Stage 15P negative controls. One exact change at a time, only in a TEMP copy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-source-evidence-audit-")); const link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-source-evidence.ts"; const core = "src/lib/ayas/trust/AyasSourceEvidence.ts"; const bridge = "src/lib/ayas/trust/AyasSourceEvidenceIntegration.ts";
const store = "src/lib/brain/autonomy/AyasExternalResearchStore.ts"; const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!; const base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["a graph digest is not checked", core, "return value.digest === hash({", "return true || value.digest === hash({"],
  ["duplicate source identities pass", core, " || sources.has(source.id)", ""],
  ["duplicate claim identities pass", core, " || claims.has(claim.id)", ""],
  ["a missing graph source passes", core, "!sources.has(link.sourceId)", "false"],
  ["a missing graph claim passes", core, "!claims.has(link.claimId)", "false"],
  ["a source binding covers a different reference", core, "candidate.reference === source.reference", "true"],
  ["a source binding covers every use", core, "candidate.uses.includes(use)", "true"],
  ["an API document can support history", core, "!policy.kinds.includes(source.kind)", "false"],
  ["a model summary is direct evidence", core, "link.extraction !== \"DIRECT_SOURCE\"", "false"],
  ["a contradiction is ignored", core, "const conflict = evidence.some(link => link.relation === \"CONTRADICTS\");", "const conflict = false;"],
  ["restrictive usage cannot stop other positive evidence", core, "conflict || restricted || directive ?", "conflict || directive ?"],
  ["external directives can be supported", core, "const directive = detectAyasResearchInstructionSignals(claim.text).some(signal => signal !== \"PATH_REFERENCE\");", "const directive = false;"],
  ["a future check counts as fresh", core, "if (age < 0)", "if (false)"],
  ["a stale source counts as current", core, "age > policy.maxCheckAgeDays * 86_400_000", "false"],
  ["a future publication counts", core, "source.publishedAt !== null && Date.parse(source.publishedAt) > nowMs", "false"],
  ["unknown usage counts as reviewed", core, "source.usage !== \"REVIEWED_FOR_USE\"", "false"],
  ["the reviewer never reviewed usage", core, " || !binding?.usageReviewed", ""],
  ["history needs only one publisher", core, "maxCheckAgeDays: 365, independentRequired: 2", "maxCheckAgeDays: 365, independentRequired: 1"],
  ["fake publisher labels split one URL publisher", core, "describeAyasTechnologySource(source.reference)?.independenceKey ?? binding!.publisher", "binding!.publisher"],
  ["an empty graph is supported", core, "if (!selected.length) return { ...unavailable(\"UNMEASURED\", \"NO_CLAIMS_FOR_USE\")", "if (!selected.length) return { ...unavailable(\"SUPPORTED_FOR_USE\", \"NO_CLAIMS_FOR_USE\")"],
  ["oversized evidence lists pass", core, "list(value.evidence, 2000)", "list(value.evidence, 2001)"],
  ["metadata grants execution", core, "mayExecute: false as const", "mayExecute: true as never"],
  ["a substituted finding snapshot passes", bridge, " || graph.digest !== buildAyasFindingSourceEvidence(finding).digest", ""],
  ["the store trusts the caller's saved verdict", store, "sourceTrust: assessAyasFindingSourceTrust(", "sourceTrust: (input as unknown as { sourceTrust?: AyasSourceTrustReport }).sourceTrust ?? assessAyasFindingSourceTrust("],
  ["model-derived metadata calls itself direct", bridge, "extraction: finding.researchMode === \"DEEP\" ? \"MODEL_SUMMARY\" : \"UNDECLARED\"", "extraction: \"DIRECT_SOURCE\""],
  ["the source-trust kernel may rewrite itself", "src/lib/brain/selfheal/BrainPatchSafety.ts", "p.toLowerCase().startsWith(\"src/lib/ayas/trust/\")", "false"],
  ["the source-trust grader may rewrite itself", "src/lib/brain/selfheal/BrainPatchSafety.ts", "  \"scripts/smoke-ayas-source-evidence.ts\",\n", ""],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 40_000, maxBuffer: 1_000_000 });
try {
  copy(test); copy("scripts/ayas-source-evidence.ts"); copy("tsconfig.json");
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: must fail an oracle assertion: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15P source evidence mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-source-evidence-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
