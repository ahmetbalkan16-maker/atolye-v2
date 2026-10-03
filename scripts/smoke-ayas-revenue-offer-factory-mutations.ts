/** Stage16.3A negative controls change only a copied TS closure in an owned gitless TEMP directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-offer-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-offer-factory.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const F = "src/lib/ayas/revenue/AyasRevenueOfferFactory.ts", D = "src/lib/ayas/revenue/AyasRevenueDigest.ts";
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["authority widened", F, 'authority: "NONE", sellableAutonomously: false,', 'authority: "EXECUTE", sellableAutonomously: false,', "P01"],
  ["offer sellable autonomously", F, "sellableAutonomously: false, externalWrite: false,", "sellableAutonomously: true, externalWrite: false,", "P01"],
  ["external write claimed", F, "externalWrite: false, grantsSpendAuthority: false,", "externalWrite: true, grantsSpendAuthority: false,", "P01"],
  ["spend authority widened", F, "grantsSpendAuthority: false,\n", "grantsSpendAuthority: true,\n", "P01"],
  ["delivery slot claimed reserved", F, "reservedCapacity: false };", "reservedCapacity: true };", "P01"],
  ["delivery scenario labelled observed", F, 'deliveryScenario = { label: "ASSUMED"', 'deliveryScenario = { label: "OBSERVED"', "P01"],
  ["blocked validation ignored", F, 'if (validation.status === "BLOCKED" || validation.status === "DO_NOT_PURSUE")', "if (false)", "P03"],
  ["negative economics ignored", F, ' || validation.status === "DO_NOT_PURSUE"', "", "P42"],
  ["weak validation status accepted", F, '!["PILOT_CANDIDATE", "OWNER_REVIEW_REQUIRED"].includes(validation.status) || ', "", "P55"],
  ["unproven rights dimension accepted", F, ' || validation.dimensions.rights !== "CLEAR"', "", "P53"],
  ["unproven deliverable dimension accepted", F, ' || validation.dimensions.deliverableReadiness !== "PROVEN"', "", "P54"],
  ["opportunity scope ignored", F, "input.offer.opportunityId !== o.opportunityId || ", "", "P40"],
  ["value proposition scope ignored", F, "input.offer.valuePropositionCode !== o.hypothesis.valuePropositionCode || ", "", "P40"],
  ["future offer accepted", F, " || Date.parse(input.offer.createdAt) > Date.parse(now)", "", "P40"],
  ["capability outside opportunity accepted", F, "\n      || input.offer.deliverables.some(d => !o.capabilityKeys.includes(d.capabilityKey))", "", "P52"],
  ["any fulfillment blocker ignored", F, 'if (input.fulfillmentProofs.some(p => !evaluateAyasZeroCost(p.costClass).allowed || p.qualityState === "FAIL" || p.rightsState === "BLOCKED"))', "if (false)", "P06"],
  ["paid fulfillment accepted", F, "p => !evaluateAyasZeroCost(p.costClass).allowed || ", "p => ", "P13"],
  ["blocked sample rights accepted", F, ' || p.rightsState === "BLOCKED"))', "))", "P11"],
  ["offer class can borrow proof", F, "p.offerClass === o.deliverableClass && ", "", "P47"],
  ["deliverable class can borrow proof", F, "p.deliverableClass === d.deliverableClass && p.capabilityKey === d.capabilityKey", "p.capabilityKey === d.capabilityKey", "P07"],
  ["capability can borrow proof", F, "p.deliverableClass === d.deliverableClass && p.capabilityKey === d.capabilityKey", "p.deliverableClass === d.deliverableClass", "P08"],
  ["model opinion proves fulfillment", F, 'p.sourceClass !== "MODEL_OPINION" && ', "", "P14"],
  ["unmeasured quality accepted", F, 'p.qualityState === "PASS" && ', "", "P05"],
  ["unknown sample rights accepted", F, 'p.rightsState === "CLEAR" && ', "", "P10"],
  ["missing attribution accepted", F, "(!p.attributionRequired || p.attributionDigest !== null)", "true", "P12"],
  ["sample freshness ignored", F, "currentProof(p.observedAt, p.freshUntil, now) && ", "", "P15"],
  ["future measurement accepted", F, "Date.parse(observed) <= Date.parse(now)\n", "true\n", "P16"],
  ["declared expiry outlives age ceiling", F, "Math.min(Date.parse(expires), Date.parse(observed) + AYAS_REVENUE_OFFER_PROOF_MAX_AGE_DAYS * 86_400_000)", "Date.parse(expires)", "P15"],
  ["capability proof binding dropped", F, " && c.proofDigest === p.capabilityProofDigest", "", "P20"],
  ["unaccepted deliverable evidence used", F, "validation!.acceptedEvidenceDigests.includes(p.deliverableEvidenceDigest) && ", "", "P56"],
  ["unaccepted rights evidence used", F, " && validation!.acceptedEvidenceDigests.includes(p.rightsEvidenceDigest)", "", "P56"],
  ["deliverable evidence artifact binding dropped", F, "e.evidenceDigest === p.deliverableEvidenceDigest && e.referenceDigest === p.artifactDigest", "e.evidenceDigest === p.deliverableEvidenceDigest", "P57"],
  ["rights evidence artifact binding dropped", F, "e.evidenceDigest === p.rightsEvidenceDigest && e.referenceDigest === p.artifactDigest", "e.evidenceDigest === p.rightsEvidenceDigest", "P57"],
  ["deliverable evidence capability binding dropped", F, '(e.capabilityKey === null || e.capabilityKey === d.capabilityKey) && e.facts.includes("DELIVERABLE_PROVEN")', 'e.facts.includes("DELIVERABLE_PROVEN")', "P51"],
  ["rights evidence capability binding dropped", F, '(e.capabilityKey === null || e.capabilityKey === d.capabilityKey) && e.facts.includes("RIGHTS_CLEAR")', 'e.facts.includes("RIGHTS_CLEAR")', "P51"],
  ["deliverable fact not required", F, 'e.facts.includes("DELIVERABLE_PROVEN") && e.confidence >= 0.8)', "e.confidence >= 0.8)", "P57"],
  ["weak deliverable confidence accepted", F, 'e.facts.includes("DELIVERABLE_PROVEN") && e.confidence >= 0.8)', 'e.facts.includes("DELIVERABLE_PROVEN"))', "P57"],
  ["rights fact not required", F, '&& e.facts.includes("RIGHTS_CLEAR"))', "&& true)", "P57"],
  ["model-described portfolio accepted", F, 'a.sourceClass === "LOCAL_ARTIFACT" && ', "", "P17"],
  ["portfolio artifact binding dropped", F, "a.artifactDigest === p.artifactDigest && ", "", "P09"],
  ["portfolio sample identity dropped", F, "a.portfolioId === p.portfolioId && ", "", "P58"],
  ["portfolio deliverable binding dropped", F, " && a.deliverableClass === d.deliverableClass && a.capabilityKey === d.capabilityKey", "", "P58"],
  ["bundle coverage uses one deliverable", F, "p.measuredUnits >= groupUnitsWithRevisions", "p.measuredUnits >= unitsWithRevisions", "P29"],
  ["throughput extrapolated beyond sample", F, "p.measuredUnits >= groupUnitsWithRevisions", "p.measuredUnits > 0", "P28"],
  ["fastest contradictory sample chosen", F, "workMinutes += Math.max(...covering", "workMinutes += Math.min(...covering", "P59"],
  ["time buffer dropped", F, " * AYAS_REVENUE_OFFER_TIME_BUFFER", "", "P01"],
  ["partial minutes rounded down", F, "Math.ceil(p.measuredMinutes", "Math.floor(p.measuredMinutes", "P43"],
  ["support time omitted", F, "let workMinutes = input.offer.revisionSupport.supportMinutes;", "let workMinutes = 0;", "P01"],
  ["revision time omitted", F, "const unitsWithRevisions = d.units * (1 + input.offer.revisionSupport.maxRevisions);", "const unitsWithRevisions = d.units;", "P01"],
  ["capacity freshness ignored", F, " || !currentProof(capacity.observedAt, now, now)", "", "P24"],
  ["capacity window mismatch accepted", F, "capacity.windowMinutes !== input.offer.deliveryWindowMinutes || ", "", "P26"],
  ["capacity beyond time horizon accepted", F, "capacity.maxWorkMinutes > capacity.windowMinutes || ", "", "P27"],
  ["existing workload ignored", F, "capacity.committedWorkMinutes + workMinutes > capacity.maxWorkMinutes || ", "", "P25"],
  ["external operation mapped", F, "m.operation === AYAS_REVENUE_OFFER_DRAFT_OPERATION[m.platform]", 'typeof m.operation === "string"', "P35"],
  ["unbounded revisions accepted", F, "integer(r.maxRevisions, 0, 10)", "integer(r.maxRevisions, 0, 1000)", "P30"],
  ["zero deliverable units accepted", F, "integer(d.units, 1, 100)", "integer(d.units, 0, 100)", "P31"],
  ["zero measured units accepted", F, "integer(v.measuredUnits, 1, 10_000)", "integer(v.measuredUnits, 0, 10_000)", "P50"],
  ["duplicated portfolio bytes accepted", F, " || new Set(v.portfolio.map(p => (p as { artifactDigest: string }).artifactDigest)).size !== v.portfolio.length", "", "H10"],
  ["raw directive accepted", F, '!hasExactAyasRevenueKeys(v, ["schemaVersion", "offer", "validationInput", "fulfillmentProofs", "portfolio", "capacity"])', "false", "P34"],
  ["getter preflight removed", F, '!isAyasRevenueTimestamp(now) || !isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES) || !valid(raw)', "!isAyasRevenueTimestamp(now)", "P37"],
  ["hostile input exception escapes refusal", F, '} catch { return result("BLOCKED", "INVALID_OFFER_INPUT"); }', '} catch { throw new Error("hostile input escaped"); }', "P38"],
  ["revision omits commercial terms", F, "revision = digestAyasRevenueData(input);", "revision = digestAyasRevenueData(input.validationInput);", "P45"],
  ["result snapshot not frozen", F, 'return deepFreezeAyasRevenueValue({ schemaVersion: "1", status,', 'return ({ schemaVersion: "1", status,', "P45"],
  ["revision depends on property order", D, "update(canonicalAyasJson(copied))", "update(JSON.stringify(copied))", "P44"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_OFFER_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
try {
  copy(test); for (const f of ["tsconfig.json", "package.json", ".gitignore"]) copy(f);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.signal, null); assert.equal(baseline.status, 0, `${baseline.stdout}${baseline.stderr}`.slice(0, 8000));
  const caught: string[] = [];
  for (const [name, file, before, after, id] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.ok(original.includes(before), `${name}: exact mutation must exist`);
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(id); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null, `${name}: timeout`); assert.notEqual(r.status, 0, `${name}: survived`);
    assert.doesNotMatch(r.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: loader/runtime failure`);
    assert.match(r.stderr, /AssertionError|ERR_ASSERTION/, `${name}: not a captured assertion: ${r.stderr.slice(0, 600)}`); caught.push(name);
  }
  console.log(JSON.stringify({ status: "PASS", baseline: JSON.parse(baseline.stdout), negativeControls: { total: mutants.length, caught, equivalents: [] }, noLiveIO: true }, null, 2));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-offer-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
