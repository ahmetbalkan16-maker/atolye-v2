/** Stage16.3 negative controls change only a copied TS closure in an owned gitless TEMP directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-free-first-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-free-first-validation.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const V = "src/lib/ayas/revenue/AyasRevenueValidation.ts", O = "src/lib/ayas/revenue/AyasRevenueOpportunity.ts", S = "src/lib/ayas/revenue/AyasRevenueScenarioEconomics.ts";
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["authority widened", V, 'status, authority: "NONE", grantsActionAuthority: false', 'status, authority: "EXECUTE", grantsActionAuthority: true', "P01"],
  ["spend authority widened", V, "grantsSpendAuthority: false,", "grantsSpendAuthority: true,", "P01"],
  ["claimed ledger signal certified", V, "realizedLedgerVerified: false", "realizedLedgerVerified: true", "P32"],
  ["opportunity authority accepted", O, 'v.authority === "NONE"', "true", "P52"],
  ["opportunity and evidence ID schemas diverge", V, "isAyasRevenueExternalId(v.opportunityId)", "isAyasRevenueNeutralCode(v.opportunityId)", "P61"],
  ["price equality compares property order", V, "(price === null) !== (scenarioPrice === null) || price?.valueMinor !== scenarioPrice?.valueMinor || price?.currency !== scenarioPrice?.currency", "JSON.stringify(price) !== JSON.stringify(scenarioPrice)", "P53"],
  ["actual price mismatch ignored", V, "return result(\"BLOCKED\", \"PRICE_SCENARIO_MISMATCH\");", "{}", "P66"],
  ["future opportunity accepted", V, 'if (Date.parse(o.observedAt) > Date.parse(now))', "if (false)", "P45"],
  ["paid evidence accepted", V, "if (!evaluateAyasZeroCost(e.costClass).allowed)", "if (false)", "P15"],
  ["paid prerequisite accepted", V, "!evaluateAyasZeroCost(p.costClass).allowed || ", "", "P11"],
  ["model opinion proves market", V, "e.sourceClass !== sourceForKind[e.kind] || ", "", "P03"],
  ["scope no longer checked", V, "e.opportunityId !== o.opportunityId || (e.platform !== o.platform && !localScope) || e.targetMarketCode !== o.targetMarketCode", "false", "P42"],
  ["freshness no longer checked", V, "Date.parse(e.observedAt) > Date.parse(now) || Date.parse(now) > limit", "false", "P24"],
  ["platform freshness ceiling dropped", V, "Math.min(AYAS_REVENUE_VALIDATION_MAX_AGE_DAYS[o.offerType], AYAS_REVENUE_VALIDATION_PLATFORM_MAX_AGE_DAYS[o.platform])", "AYAS_REVENUE_VALIDATION_MAX_AGE_DAYS[o.offerType]", "P63"],
  ["weak demand confidence accepted", V, " || e.confidence < 0.6", "", "P27"],
  ["weak capability confidence accepted", V, "e.confidence >= 0.8", "e.confidence >= 0.6", "P08"],
  ["separate missing capability ignored", V, '&& !current.some(e => e.kind === "LOCAL_CAPABILITY" && e.capabilityKey === key && e.facts.some(f => f === "CAPABILITY_MISSING" || f === "CAPABILITY_DEGRADED"))', "", "P07"],
  ["separate unproven deliverable ignored", V, '!has("LOCAL_DELIVERABLE_PROOF", "DELIVERABLE_NOT_PROVEN")', "true", "P10"],
  ["separate rights uncertainty ignored", V, ' && !has("LOCAL_DELIVERABLE_PROOF", "RIGHTS_UNCERTAIN")', "", "P39"],
  ["unproven rights misreported clear", V, 'rights: rightsClear ? "CLEAR" : input.rights.state === "BLOCKED" ? "BLOCKED" : input.rights.state === "UNCERTAIN" || has("LOCAL_DELIVERABLE_PROOF", "RIGHTS_UNCERTAIN") ? "UNCERTAIN" : "UNPROVEN"', 'rights: rightsClear ? "CLEAR" : input.rights.state', "P38"],
  ["contradictory competition accepted", V, ' && !has("PUBLIC_COMPETITION_SIGNAL", "COMPETITION_NOT_OBSERVED")', "", "P58"],
  ["contradictory differentiation accepted", V, ' && !has("PUBLIC_COMPETITION_SIGNAL", "DIFFERENTIATION_NOT_PROVEN")', "", "P58"],
  ["mirrors count as independent demand", V, 'root(`reference:${e.referenceDigest}`)', 'root(`evidence:${e.evidenceDigest}`)', "P23"],
  ["one source proves demand", V, "if (demandCount < 2)", "if (demandCount < 1)", "P21"],
  ["negative provenance demand ignored", V, "g.positive && !g.negative", "g.positive", "P65"],
  ["orphan prerequisite digest accepted", V, "p.state === \"READY\" && !proofForPrerequisite(p)", 'p.state === "READY" && p.evidenceDigest === null', "P59"],
  ["unknown fee becomes zero", S, "const costs = [input.platformFee, input.paymentProcessingFee, input.deliveryCost], currency = known[0]?.amount?.currency;", 'const costs = [input.platformFee, input.paymentProcessingFee, input.deliveryCost].map(v => v.amount === null ? {label: "ASSUMED", amount: {valueMinor: 0, currency: known[0]?.amount?.currency}, evidenceDigest: null} : v), currency = known[0]?.amount?.currency;', "P17"],
  ["assumed fee without basis proves pilot", V, "q.label !== \"UNKNOWN\" && q.evidenceDigest !== null\n      && current.some(e => e.evidenceDigest === q.evidenceDigest && e.kind === \"PLATFORM_READ_ONLY_SIGNAL\" && e.facts.includes(\"FEE_SCHEDULE_OBSERVED\"))", 'q.label !== "UNKNOWN"', "P20"],
  ["hypothetical price labelled observed", S, ' && v.price.label !== "OBSERVED"', "", "P55"],
  ["hypothetical contribution called realized", S, "hypothetical: true, realized: false, input", "hypothetical: true, realized: true, input", "P01"],
  ["hypothetical contribution labelled observed", S, 'contribution = { label: "ASSUMED"', 'contribution = { label: "OBSERVED"', "P01"],
  ["negative hypothetical economics allowed", V, 'if (scenario.contribution.amount !== null && scenario.contribution.amount.valueMinor < 0)', "if (false)", "P35"],
  ["unknown delivery scenario allowed", V, ' || scenario.state === "UNKNOWN"', "", "H09"],
  ["mixed currencies silently pooled", S, "if (new Set(known.map(v => v.amount!.currency)).size > 1)", "if (false)", "P46"],
  ["negative money accepted", O, " && (v.valueMinor as number) >= 0", "", "P47"],
  ["unknown currency accepted", O, "(AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(v.currency)", 'typeof v.currency === "string"', "P66"],
  ["getter preflight removed", V, '!isAyasRevenueTimestamp(now) || !valid(raw)', "!isAyasRevenueTimestamp(now)", "P49"],
  ["hostile input exception escapes refusal", V, '} catch { return result("BLOCKED", "INVALID_INPUT"); }', '} catch { throw new Error("hostile input escaped"); }', "P50"],
  ["raw directive accepted", V, '!hasExactAyasRevenueKeys(v, ["schemaVersion", "opportunity", "scenario", "capabilities", "prerequisites", "rights", "securityBlockers", "evidence"])', "false", "P48"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_FREE_FIRST_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
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
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-free-first-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
