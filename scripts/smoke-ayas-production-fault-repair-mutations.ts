/** Stage 15L negative controls: copied modules in TEMP only. A surviving defect fails the audit. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-production-repair-audit-"));
const test = "scripts/smoke-ayas-production-fault-repair.ts";
const moduleFile = "src/lib/ayas/director/AyasProductionFaultRepair.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file); const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
  if (!/\.tsx?$/.test(file)) return;
  const source = fs.readFileSync(path.join(repo, file), "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const mutants: readonly (readonly [string, string, string])[] = [
  ["class changed", 'PROVIDER_RATE_LIMITED: "RATE_LIMIT"', 'PROVIDER_RATE_LIMITED: "TRANSIENT_EXTERNAL"'],
  ["retry delay removed", 'baseSeconds: 60', 'baseSeconds: 0'],
  ["retry delay unbounded", 'maxSeconds: 900', 'maxSeconds: 90000'],
  ["retry attempt off by one", '(stageFact?.attempts ?? 0) + 1', '(stageFact?.attempts ?? 0) + 2'],
  ["deterministic assembly not recognized", 'Object.freeze(["video", "assembly"])', 'Object.freeze(["video"])'],
  ["code hot patch", 'target: decision.route.target, productionHotPatch: false', 'target: decision.route.target, productionHotPatch: true'],
  ["code skips owner promotion", '"proposal", "owner promotion", "resume"', '"proposal", "resume"'],
  ["unknown retried", 'faultClass: "UNKNOWN", action: "FAIL_CLOSED", ownerQuestion: question', 'faultClass: "UNKNOWN", action: "AUTO_REPAIR_PLAN", ownerQuestion: question'],
  ["negative attempt accepted", '!Number.isSafeInteger(stage.attempts) || stage.attempts < 0', '!Number.isSafeInteger(stage.attempts)'],
  ["fractional attempt accepted", '!Number.isSafeInteger(stage.attempts) || stage.attempts < 0', 'stage.attempts < 0'],
  ["dependency table ignored", 'JSON.stringify([...stage.dependsOn].sort()) !== JSON.stringify([...pipelineStageDependencies[stage.stage]].sort())', 'false'],
  ["upload repeated", 'action: "reconcile-publish", state: "OWNER_PUBLISH_PIPELINE_ONLY"', 'action: "upload", state: "OWNER_PUBLISH_PIPELINE_ONLY"'],
  ["publish record assumed", 'facts.publication.publishRecord === "PRESENT" && facts.publication.publishStatus === "publishing"', 'facts.publication.publishStatus === "publishing"'],
  ["unknown publish record ignored", 'facts.publication.publishRecord === "UNREADABLE" || (facts.publication.publishStatus === "publishing" && facts.publication.publishRecord !== "PRESENT")', 'false'],
  ["global hold ignored", 'const held = session.holds.length > 0;', 'const held = false;'],
  ["drift ignored", 'plans.some((plan) => plan.ownerQuestion === "RECONCILE_PIPELINE_STATE")', 'false'],
  ["unknown sibling ignored", 'plans.some((plan) => plan.action === "FAIL_CLOSED")', 'false'],
  ["running sibling ignored", 'facts.stages.some((stage) => stage.status === "running")', 'false'],
  ["publishing while stage resumes", '(publishing && plan.repair !== "RECONCILE_INDETERMINATE_UPLOAD")', 'false'],
  ["unreadable review ignored", 'if (facts.review === "UNREADABLE") return', 'if (false) return'],
  ["unready dependency ignored", 'if (unready.length) return', 'if (false) return'],
  ["over ceiling repaired", 'if (facts.cost.knownUsd > facts.cost.technicalCeilingUsd) return', 'if (false) return'],
  ["fallback bypasses retry budget", 'if (stage.attempts === null || stage.attempts >= facts.retryMaxAttempts) return', 'if (stage.attempts === null) return'],
  ["task loses base head", 'baseHead: route.repositoryHead, objective:', 'baseHead: "2".repeat(40), objective:'],
  ["report grants authority", 'counts, authority: "NONE"', 'counts, authority: "EXECUTE"'],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 120_000 });
try {
  for (const file of [test, "scripts/ayas-production-fault-repair.ts", "tsconfig.json"]) copy(file);
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(run().status, 0, "TEMP baseline must pass");
  const target = path.join(temp, moduleFile); const original = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  for (const [name, before, after] of mutants) {
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`);
    // Equivalent safety mutation: the separate uncertain-record gate removes every repair, including reconciliation.
    if (name === "publish record assumed") { assert.equal(result.status, 0, "redundant admission predicate; uncertain-record gate still refuses"); continue; }
    assert.notEqual(result.status, 0, `${name}: survived`); assert.match(result.stderr, /AssertionError/, `${name}: assertion, not import or syntax error`);
  }
  console.log(`Stage 15L production fault repair mutation audit: PASS (${mutants.length - 1}/${mutants.length} caught; 1 equivalent safety mutation)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-production-repair-audit-")); fs.rmSync(temp, { recursive: true, force: true });
}
