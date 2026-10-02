/** Reproducible Stage 15I negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-director-audit-"));
const test = "scripts/smoke-ayas-production-director.ts";
const copied = new Set<string>();
/** Copies a module and everything it imports by relative path or by the `@/` alias. */
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
  if (!/\.tsx?$/.test(file)) return;
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}

const session = "src/lib/ayas/director/AyasProductionDirectorSession.ts";
const collector = "src/lib/ayas/director/AyasProductionDirectorCollector.ts";
const cli = "scripts/ayas-production-director.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["not-yet-produced-stage-regenerated", session, 'if (stage.status === "completed") {', 'if (stage.status === "completed" || stage.status === "missing") {'],
  ["lost-file-ignored", session, 'if (stage.artifact === "MISSING") return fault("LOCAL_ARTIFACT_MISSING");', 'if (false) return fault("LOCAL_ARTIFACT_MISSING");'],
  ["failure-without-evidence-retried", session, 'if (!error) return fault("UNCLASSIFIED_FAILURE");', 'if (!error) return fault("PROVIDER_TRANSIENT");'],
  ["refused-credential-treated-as-rejected-request", session, "if (status === 401 || status === 403 || ", "if (status === 403 || "],
  ["rejected-request-retried", session, 'if (status !== null && status >= 400 && status <= 499) return fault("PROVIDER_REQUEST_REJECTED");', 'if (status !== null && status >= 400 && status <= 499) return fault("PROVIDER_TRANSIENT");'],
  ["invalid-model-answer-called-a-code-defect", session, 'if (INVALID_OUTPUT_CODES.test(code ?? "")) return fault("MODEL_OUTPUT_INVALID");', 'if (INVALID_OUTPUT_CODES.test(code ?? "")) return fault("INTERNAL_CONTRACT");'],
  ["code-defect-retried", session, 'if (INTERNAL_PHASES.has(error.phase ?? "")) return fault("INTERNAL_CONTRACT");', 'if (INTERNAL_PHASES.has(error.phase ?? "")) return fault("PROVIDER_TRANSIENT");'],
  ["running-stage-taken-over", session, 'if (stage.status === "running") return fault("RUNNING_UNVERIFIED");', 'if (stage.status === "running") return null;'],
  ["paid-provider-counts-as-zero-cost", session, "provider.provider !== null && evaluateAyasZeroCost(provider.costClass).allowed;", "provider.provider !== null;"],
  ["unset-provider-counts-as-zero-cost", session, "provider !== null && provider.provider !== null && evaluateAyasZeroCost", "provider !== null && evaluateAyasZeroCost"],
  ["publication-stage-dispatched", session, 'if (AYAS_DIRECTOR_PUBLICATION_STAGES.includes(stage.stage)) return ownerDecision(stage.stage, "PUBLICATION_IS_OWNER_ONLY"', 'if (false) return ownerDecision(stage.stage, "PUBLICATION_IS_OWNER_ONLY"'],
  ["export-not-a-publication-stage", session, 'Object.freeze(["youtube", "export"]);', 'Object.freeze(["youtube"]);'],
  ["rights-or-quality-gate-passed", session, "if (rightsOrQualityBlocked && ", "if (false && "],
  ["quality-block-ignored", session, '(review.rightsBlocked || review.preAssemblyGate === "BLOCKED")', "(review.rightsBlocked)"],
  ["unpriced-spend-ignored", session, 'if (facts.cost.state === "UNREADABLE" || facts.cost.unknownPricingRecords > 0) return', 'if (facts.cost.state === "UNREADABLE") return'],
  ["unreadable-cost-ignored", session, 'if (facts.cost.state === "UNREADABLE" || facts.cost.unknownPricingRecords > 0) return', "if (facts.cost.unknownPricingRecords > 0) return"],
  ["retry-bound-ignored", session, "if (stage.attempts === null || stage.attempts >= facts.retryMaxAttempts) {", "if (stage.attempts === null) {"],
  ["unrecorded-attempts-retried", session, "if (stage.attempts === null || stage.attempts >= facts.retryMaxAttempts) {", "if (stage.attempts !== null && stage.attempts >= facts.retryMaxAttempts) {"],
  ["hold-ignored-for-a-fault", session, 'if (held) { decisions.push({ stage: stage.stage, kind: "WAIT"', 'if (false) { decisions.push({ stage: stage.stage, kind: "WAIT"'],
  ["hold-ignored-for-the-next-stage", session, 'if (held) decisions.push({ stage: next.stage, kind: "WAIT"', 'if (false) decisions.push({ stage: next.stage, kind: "WAIT"'],
  ["no-owner-request-no-hold", session, 'if (!facts.ownerRequest) holds.push("OWNER_REQUEST_NOT_BOUND");', 'if (false) holds.push("OWNER_REQUEST_NOT_BOUND");'],
  ["unknown-commit-no-hold", session, 'if (!HEAD.test(facts.repositoryHead ?? "")) holds.push("REPOSITORY_HEAD_UNKNOWN");', 'if (false) holds.push("REPOSITORY_HEAD_UNKNOWN");'],
  ["code-defect-no-hold", session, 'if (faults.some((fault) => fault.faultClass === "INTERNAL_CONTRACT")) holds.push("CODE_DEFECT_PENDING_REPAIR");', 'if (false) holds.push("CODE_DEFECT_PENDING_REPAIR");'],
  ["unreadable-project-planned", session, "if (!projectReadable) return { holds, faults, currentStage, decisions };", "if (false) return { holds, faults, currentStage, decisions };"],
  ["pipeline-advanced-past-a-fault", session, "if (faults.length === 0 && next) {", "if (next) {"],
  ["plan-marked-executable", session, 'RESUME_AUTHORIZED_STAGE: { action: "resume-stage", state: "AYAS_WRITE_ACTION_DISABLED", executableByAyas: false },', 'RESUME_AUTHORIZED_STAGE: { action: "resume-stage", state: "AYAS_WRITE_ACTION_DISABLED", executableByAyas: true as false },'],
  ["technical-ceiling-read-as-approval", session, "facts: { approvedProjectCapUsd: request?.approvedProjectCapUsd ?? null, technicalCeilingUsd", "facts: { approvedProjectCapUsd: request?.approvedProjectCapUsd ?? facts.cost.technicalCeilingUsd, technicalCeilingUsd"],
  ["zero-cap-not-an-approval", session, 'state: request?.approvedProjectCapUsd != null ? "BOUND" : "NOT_PROVIDED"', 'state: request?.approvedProjectCapUsd ? "BOUND" : "NOT_PROVIDED"'],
  ["digest-ignores-the-facts", session, "return { ...session, sessionDigest: sha256(canonicalAyasJson(session)) };", "return { ...session, sessionDigest: sha256(session.sessionId) };"],
  ["lasting-read-failure-called-absent", collector, 'as ReadState<unknown>; } catch { return { status: "malformed" }; }', 'as ReadState<unknown>; } catch { return { status: "missing" }; }'],
  ["read-retry-unbounded", collector, "if (attempt >= READ_ATTEMPTS || !TRANSIENT_READ.has(", "if (!TRANSIENT_READ.has("],
  ["permission-failure-retried", collector, 'new Set(["EBUSY", "EAGAIN", "EMFILE", "ENFILE", "EPERM"]);', 'new Set(["EBUSY", "EAGAIN", "EMFILE", "ENFILE", "EPERM", "EACCES"]);'],
  ["unsafe-slug-accepted", collector, 'if (!SLUG.test(slug)) throw new Error("AYAS_DIRECTOR_PROJECT_SLUG_INVALID");', 'if (false) throw new Error("AYAS_DIRECTOR_PROJECT_SLUG_INVALID");'],
  ["unset-provider-read-as-local", collector, "if (domain) provider = resolveProductionProviderName(domain, env);", 'if (domain) provider = raw ?? "mock";'],
  ["unknown-provider-zero-cost", collector, 'COST_CLASS[provider] ?? "unknown-cost" };', 'COST_CLASS[provider] ?? "local-zero-cost" };'],
  ["paid-provider-classed-free", collector, 'openai: "paid", openrouter', 'openai: "local-zero-cost", openrouter'],
  ["cheaper-provider-speaks-for-the-stage", collector, "= costly ?? providers[0] ??", "= providers[providers.length - 1] ??"],
  ["job-evidence-ignored", collector, "errorFacts(job?.errorEvidence ?? entry.errorEvidence, undefined)", "errorFacts(entry.errorEvidence, undefined)"],
  ["job-attempts-ignored", collector, 'typeof job?.attempts === "number" ? job.attempts : typeof entry.attempts?.total', "typeof entry.attempts?.total"],
  ["unpriced-records-counted-as-zero", collector, "unknownPricingRecords: summary.unknownPricingRecordCount, technicalCeilingUsd };", "unknownPricingRecords: 0, technicalCeilingUsd };"],
  ["malformed-usage-log-called-absent", collector, 'if (usage.status === "malformed") cost = { ...cost, state: "UNREADABLE" };', 'if (false) cost = { ...cost, state: "UNREADABLE" };'],
  ["unreadable-review-called-not-made", collector, '} catch { review = "UNREADABLE"; }', "} catch { review = null; }"],
  ["owner-request-with-extra-field-accepted", collector, "Object.keys(request).some((key) => !keys.includes(key)) ||", ""],
  ["negative-cap-accepted", collector, "request.approvedProjectCapUsd >= 0 && ", ""],
  ["unknown-flag-accepted", cli, 'else if (SWITCHES.has(arg)) switches.add(arg);\n    else throw new Error("AYAS_DIRECTOR_ARGUMENTS_INVALID");', "else switches.add(arg);"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
try {
  // The suite reads the two canonical design documents, starts the operator script by path and reads package.json.
  for (const file of [test, cli, "docs/ayas-execution/2026-09-27-master/01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md", "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md", "package.json", "tsconfig.json"]) copy(file);
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.copyFileSync(path.join(repo, file), target);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.ok(fs.readFileSync(path.join(temp, file)).equals(fs.readFileSync(path.join(repo, file))), "the repository source was read, never written");
  console.log(`Stage 15I production director mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-director-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
