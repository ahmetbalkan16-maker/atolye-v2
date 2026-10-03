/** Stage16.3B negative controls change only a copied TS closure in an owned gitless TEMP directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-fulfillment-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-fulfillment-gate.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const G = "src/lib/ayas/revenue/AyasRevenueFulfillment.ts";
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["authority widened", G, 'status, authority: "NONE", deliversAutonomously: false,', 'status, authority: "EXECUTE", deliversAutonomously: false,', "P01"],
  ["autonomous delivery claimed", G, "deliversAutonomously: false, externalWrite: false,", "deliversAutonomously: true, externalWrite: false,", "P01"],
  ["external write claimed", G, "externalWrite: false, grantsSpendAuthority: false,", "externalWrite: true, grantsSpendAuthority: false,", "P01"],
  ["spend authority widened", G, "grantsSpendAuthority: false,\n", "grantsSpendAuthority: true,\n", "P01"],
  ["ledger entry claimed", G, "createsLedgerEntry: false, realizedLedgerEligible,", "createsLedgerEntry: true, realizedLedgerEligible,", "P01"],
  ["ledger eligible before completion", G, "realizedLedgerEligible = false;", "realizedLedgerEligible = true;", "P01"],
  ["future records accepted", G, ".every(t => t === null || at(t) <= nowMs)", ".every(() => true)", "P37"],
  ["records before acceptance accepted", G, " || !afterAcceptance", "", "P44"],
  ["deadline before acceptance accepted", G, ' || at(o.deadlineAt) <= at(o.acceptedAt)) return result("BLOCKED", "INVALID_ORDER_TIMELINE");', ') return result("BLOCKED", "INVALID_ORDER_TIMELINE");', "P13"],
  ["offer provability not rechecked", G, 'offer.status !== "OWNER_REVIEW_READY" || offer.offer === null || offer.deliveryScenario === null', "offer.offer === null", "P17"],
  ["offer revision not bound", G, "offer.revision !== o.offerRevision || ", "", "P14"],
  ["offer identity not bound", G, "offer.offer.offerId !== o.offerId || ", "", "P15"],
  ["unmapped platform accepted", G, " || !offer.offer.platformMappings.some(m => m.platform === o.platform)", "", "P16"],
  ["more units than offered accepted", G, "t.code === d.code && d.units <= t.units", "t.code === d.code", "P08"],
  ["unoffered deliverable accepted", G, "o.deliverables.some(d => !terms.deliverables.some(t => t.code === d.code && d.units <= t.units)) || ", "", "P09"],
  ["more revisions than offered accepted", G, "o.revisionsAllowed > terms.revisionSupport.maxRevisions || ", "", "P10"],
  ["round beyond budget accepted", G, " || o.round > o.revisionsAllowed", "", "P11"],
  ["faster deadline than offer accepted", G, "at(o.deadlineAt) < at(o.acceptedAt) + terms.deliveryWindowMinutes * 60_000 || ", "", "P12"],
  ["out-of-scope requirement accepted", G, ' || input.requirements.some(r => r.state === "OUT_OF_SCOPE")) return result("BLOCKED", "UNSUPPORTED_PROMISE");', ') return result("BLOCKED", "UNSUPPORTED_PROMISE");', "P06"],
  ["unbound requirement accepted", G, "input.requirements.some(r => !codes.has(r.deliverableCode)) || ", "", "P07"],
  ["artifact for unordered deliverable accepted", G, "!codes.has(a.deliverableCode) || a.round > o.round", "a.round > o.round", "P34"],
  ["artifact from future round accepted", G, "!codes.has(a.deliverableCode) || a.round > o.round", "!codes.has(a.deliverableCode)", "P35"],
  ["receipt for unknown file accepted", G, "\n      || input.qa.some(q => !input.artifacts.some(a => a.artifactDigest === q.artifactDigest && at(a.producedAt) <= at(q.checkedAt)))", "", "P28"],
  ["receipt predating its file accepted", G, " && at(a.producedAt) <= at(q.checkedAt)))) return", "))) return", "P27"],
  ["fulfillment spend accepted", G, "if (input.artifacts.some(a => !evaluateAyasZeroCost(a.costClass).allowed))", "if (false)", "P33"],
  ["earlier-round spend hidden", G, "input.artifacts.some(a => !evaluateAyasZeroCost(a.costClass).allowed)", "current.some(a => !evaluateAyasZeroCost(a.costClass).allowed)", "H08"],
  ["blocked rights only degrade", G, 'if (current.some(a => a.rightsState === "BLOCKED"))', "if (false)", "P31"],
  ["old receipt passes re-produced bytes", G, " && at(q.checkedAt) >= at(a.producedAt));", ");", "P52"],
  ["failed receipt ignored", G, 'receipts(a).some(q => q.state === "FAIL")', "false", "P22"],
  ["unknown rights deliverable", G, 'a.rightsState === "CLEAR" && ', "", "P29"],
  ["rights without evidence deliverable", G, "a.rightsEvidenceDigest !== null && ", "", "P30"],
  ["missing attribution deliverable", G, "(!a.attributionRequired || a.attributionDigest !== null)", "true", "P32"],
  ["failed file still deliverable", G, " && !failed(a)\n", "\n", "P22"],
  ["model opinion passes quality", G, ' && q.sourceClass !== "MODEL_OPINION"', "", "P25"],
  ["unmeasured quality passes", G, 'q.state === "PASS" && ', "", "P24"],
  ["one file covers all units", G, ".length < d.units)", ".length < 1)", "P19"],
  ["manifest depends on record order", G, ".sort((x, y) => x.deliverableCode < y.deliverableCode ? -1 : x.deliverableCode > y.deliverableCode ? 1 : x.artifactDigest < y.artifactDigest ? -1 : x.artifactDigest > y.artifactDigest ? 1 : 0)", ".slice()", "P56"],
  ["manifest not bound to order", G, "orderId: o.orderId, offerRevision: o.offerRevision, round: o.round, items }", "items }", "P56"],
  ["manifest not bound to file size", G, "artifactDigest: a.artifactDigest, bytes: a.bytes, mediaClass", "artifactDigest: a.artifactDigest, mediaClass", "P40"],
  ["handoff before passing files accepted", G, "if (manifestDigest === null || !requirementsComplete)", "if (!requirementsComplete)", "P41"],
  ["handoff before requirements accepted", G, ' || !requirementsComplete) return result("BLOCKED", "HANDOFF_BEFORE_QUALITY_GATE");', ') return result("BLOCKED", "HANDOFF_BEFORE_QUALITY_GATE");', "P42"],
  ["handed-off manifest not compared", G, 'if (h.manifestDigest !== manifestDigest) return result("BLOCKED", "HANDOFF_MANIFEST_MISMATCH");', "", "P39"],
  ["completion before handoff accepted", G, 'if (c.state !== "NOT_OBSERVED" && at(c.observedAt!) < at(h.handedOffAt!)) return result("BLOCKED", "INVALID_ORDER_TIMELINE");', "", "P47"],
  ["late handoff hidden", G, 'at(h.handedOffAt!) <= at(o.deadlineAt) ? "MET_AT_HANDOFF"', 'true ? "MET_AT_HANDOFF"', "P43"],
  ["unobserved completion treated as complete", G, 'return result("AWAITING_OBSERVED_COMPLETION", "OWNER_OR_PLATFORM_COMPLETION_NOT_OBSERVED")', 'return result("COMPLETED_OBSERVED", "OWNER_OR_PLATFORM_COMPLETION_NOT_OBSERVED")', "P38"],
  ["revision budget ignored", G, "o.round < o.revisionsAllowed ?", "true ?", "P50"],
  ["dispute after handoff treated as completion", G, 'return result("OWNER_REVIEW_REQUIRED", c.state === "DISPUTED" ? "ORDER_DISPUTED" : "ORDER_CANCELLED");\n    }', 'return result("COMPLETED_OBSERVED", "ORDER_DISPUTED");\n    }', "P53"],
  ["cancellation before handoff ignored", G, 'if (c.state !== "NOT_OBSERVED") return result("OWNER_REVIEW_REQUIRED"', 'if (false) return result("OWNER_REVIEW_REQUIRED"', "P53"],
  ["completion without handoff accepted", G, 'if (c.state === "ACCEPTED" || c.state === "REVISION_REQUESTED") return result("BLOCKED", "COMPLETION_WITHOUT_HANDOFF");', "", "P48"],
  ["missed deadline ignored", G, 'if (deadline.state === "MISSED") {', "if (false) {", "P21"],
  ["missed deadline never detected", G, 'remaining < 0 ? "MISSED"', 'false ? "MISSED"', "P21"],
  ["deadline risk never flagged", G, 'short.length > 0 && remaining < planned ? "AT_RISK"', 'false ? "AT_RISK"', "P20"],
  ["late complete order loses its manifest", G, "if (manifestDigest !== null && requirementsComplete) deliveryManifest = { digest: manifestDigest, items };", "", "P61"],
  ["late manifest despite open requirements", G, " && requirementsComplete) deliveryManifest", ") deliveryManifest", "P61"],
  ["incomplete requirements ignored", G, 'if (!requirementsComplete) return result("REQUIREMENTS_INCOMPLETE", "OWNER_CLARIFICATION_REQUIRED");', "", "P02"],
  ["deliverable without requirement accepted", G, "o.deliverables.every(d => input.requirements.some(r => r.deliverableCode === d.code)) && ", "", "P05"],
  ["requirement without evidence accepted", G, ' && r.evidenceDigest !== null);', ");", "P04"],
  ["rework not flagged", G, 'if (short.some(d => current.some(a => a.deliverableCode === d.code && failed(a)))) return result("QA_REWORK_REQUIRED", "FAILED_ARTIFACT_NOT_REPLACED");', "", "P22"],
  ["duplicate file in a round accepted", G, "return `${x.round}:${x.artifactDigest}`; })).size !== v.artifacts.length", "return `${x.round}:${x.artifactDigest}`; })).size < 0", "P36"],
  ["model completion source accepted", G, 'member(c.sourceClass, ["PLATFORM_READ", "OWNER_INPUT"])', "true", "P54"],
  ["handoff without evidence accepted", G, "isAyasRevenueTimestamp(h.handedOffAt) && isAyasRevenueDigest(h.evidenceDigest)", "isAyasRevenueTimestamp(h.handedOffAt)", "P54"],
  ["raw directive accepted", G, '!hasExactAyasRevenueKeys(v, ["schemaVersion", "offerInput", "order", "requirements", "artifacts", "qa", "handoff", "completion"])', "false", "P57"],
  ["getter preflight removed", G, "!isAyasRevenueTimestamp(now) || !isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES) || !valid(raw)", "!isAyasRevenueTimestamp(now)", "P58"],
  ["hostile input exception escapes refusal", G, '} catch { return result("BLOCKED", "INVALID_FULFILLMENT_INPUT"); }', '} catch { throw new Error("hostile input escaped"); }', "P58"],
  ["result snapshot not frozen", G, 'return deepFreezeAyasRevenueValue({ schemaVersion: "1", status,', 'return ({ schemaVersion: "1", status,', "P59"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_FULFILLMENT_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
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
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-fulfillment-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
