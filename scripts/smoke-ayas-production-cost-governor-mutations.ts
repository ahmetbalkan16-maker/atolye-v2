/** Reproducible Stage 15K negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-cost-governor-audit-"));
const test = "scripts/smoke-ayas-production-cost-governor.ts";
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

const governor = "src/lib/production/ProductionCostGovernor.ts";
const ledger = "src/lib/production/ProductionCostReservationLedger.ts";
const store = "src/lib/production/ProductionCostReservationStore.ts";
const cli = "scripts/run-production-cost-governor.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["unpriced-spend-read-as-zero", governor, 'if (input.remainingPricing !== "KNOWN" || input.observedPricing !== "KNOWN") return report("BLOCK", "UNKNOWN_PRICING", null, 0);', 'if (input.remainingPricing !== "KNOWN") return report("BLOCK", "UNKNOWN_PRICING", null, 0);'],
  ["unpriced-estimate-read-as-zero", governor, 'if (input.remainingPricing !== "KNOWN" || input.observedPricing !== "KNOWN") return report("BLOCK", "UNKNOWN_PRICING", null, 0);', 'if (input.observedPricing !== "KNOWN") return report("BLOCK", "UNKNOWN_PRICING", null, 0);'],
  ["above-the-ceiling-continues", governor, 'if (estimatedTotalUsd > policy.technicalCeilingUsd) return report("BLOCK", "ABOVE_TECHNICAL_CEILING", null, 0);', 'if (false) return report("BLOCK", "ABOVE_TECHNICAL_CEILING", null, 0);'],
  ["paid-run-on-the-target-without-an-approval", governor, "? Math.min(input.approvedProjectCapUsd, policy.technicalCeilingUsd) : null;", "? Math.min(input.approvedProjectCapUsd, policy.technicalCeilingUsd) : (valid ? policy.preferredTargetUsd : null);"],
  ["approval-above-the-ceiling-honoured", governor, "? Math.min(input.approvedProjectCapUsd, policy.technicalCeilingUsd) : null;", "? input.approvedProjectCapUsd : null;"],
  ["above-the-approved-cap-continues", governor, 'if (estimatedTotalUsd > effectiveCapUsd) return report("PAUSE_ASK_OWNER", "ABOVE_APPROVED_CAP",', 'if (false) return report("PAUSE_ASK_OWNER", "ABOVE_APPROVED_CAP",'],
  ["question-asks-for-the-estimate-not-the-ceiling", governor, "Current cap ${usd(effectiveCapUsd)}. Authorize this project up to ${usd(policy.technicalCeilingUsd)}?", "Current cap ${usd(effectiveCapUsd)}. Authorize this project up to ${usd(estimatedTotalUsd)}?"],
  ["spend-so-far-ignored", governor, "const estimatedTotalUsd = valid ? round(input.observedUsd + remainingUsd) : 0;", "const estimatedTotalUsd = valid ? remainingUsd : 0;"],
  ["undeclared-allowance-continues", governor, 'if (allowance.totalUsd === null) return report("PAUSE_ASK_OWNER", "ALLOWANCE_NOT_DECLARED",', 'if (false) return report("PAUSE_ASK_OWNER", "ALLOWANCE_NOT_DECLARED",'],
  ["oversubscribed-allowance-continues", governor, 'if (round(allowance.committedUsd + effectiveCapUsd) > allowance.totalUsd) return report("BLOCK", "ALLOWANCE_OVERSUBSCRIBED", null, 0);', 'if (false) return report("BLOCK", "ALLOWANCE_OVERSUBSCRIBED", null, 0);'],
  ["oversubscription-checked-on-the-estimate", governor, "if (round(allowance.committedUsd + effectiveCapUsd) > allowance.totalUsd) return", "if (round(allowance.committedUsd + estimatedTotalUsd) > allowance.totalUsd) return"],
  ["estimate-reserved-instead-of-the-cap", governor, 'return report("CONTINUE", "WITHIN_APPROVED_CAP", null, effectiveCapUsd);', 'return report("CONTINUE", "WITHIN_APPROVED_CAP", null, estimatedTotalUsd);'],
  ["untrusted-numbers-accepted", governor, 'if (!valid) return report("BLOCK", "INPUT_INVALID", null, 0);', 'if (false) return report("BLOCK", "INPUT_INVALID", null, 0);'],
  ["no-retry-reserve", governor, "const retryReserveUsd = valid ? round(Math.max(0, ...input.components.map((component) => component.estimatedUsd))) : 0;", "const retryReserveUsd = 0;"],
  ["alternative-offered-for-a-free-component", governor, "return alternative && component.estimatedUsd > 0 && component.provider !== alternative.alternative ?", "return alternative && component.provider !== alternative.alternative ?"],
  ["unpriced-component-read-as-priced", governor, 'const known = estimate.status === "known" && estimate.breakdown.unknownComponents.length === 0;', 'const known = estimate.status === "known";'],
  ["paid-call-without-a-reservation-goes-out", governor, 'if (input.reservedCapUsd === null) return { decision: "PAUSE_BEFORE_BILLABLE_CALL", reason: "NOTHING_RESERVED", projectedUsd };', 'if (false) return { decision: "PAUSE_BEFORE_BILLABLE_CALL", reason: "NOTHING_RESERVED", projectedUsd };'],
  ["call-past-the-reserved-cap-goes-out", governor, "return projectedUsd > input.reservedCapUsd ? {", "return projectedUsd > Number.POSITIVE_INFINITY ? {"],
  ["unpriced-next-call-goes-out", governor, 'if (input.observedPricing !== "KNOWN" || input.nextCallPricing !== "KNOWN") return { decision: "BLOCK", reason: "UNKNOWN_PRICING", projectedUsd };', 'if (input.observedPricing !== "KNOWN") return { decision: "BLOCK", reason: "UNKNOWN_PRICING", projectedUsd };'],
  ["two-active-reservations-for-one-project", ledger, " || [...active.values()].some((item) => item.projectId === event.projectId)) { problems.push(where); continue; }", ") { problems.push(where); continue; }"],
  ["closed-reservation-id-reused", ledger, "active.has(event.reservationId) || closed.has(event.reservationId) ||", "active.has(event.reservationId) ||"],
  ["zero-cap-reserved", ledger, "!money(event.capUsd) || event.capUsd === 0 || active.has(", "!money(event.capUsd) || active.has("],
  ["overrun-not-named", ledger, "if (event.actualUsd > reservation.capUsd) overruns.push(reservation.reservationId);", "if (false) overruns.push(reservation.reservationId);"],
  ["settled-spend-not-counted", ledger, "round(allowanceUsd - summary.settledUsd - summary.reservedUsd - request.capUsd);", "round(allowanceUsd - summary.reservedUsd - request.capUsd);"],
  ["active-caps-not-counted", ledger, "round(allowanceUsd - summary.settledUsd - summary.reservedUsd - request.capUsd);", "round(allowanceUsd - summary.settledUsd - request.capUsd);"],
  ["oversubscription-admitted", ledger, 'return remainingAfterUsd < 0 ? { ok: false, reason: "ALLOWANCE_OVERSUBSCRIBED" }', 'return remainingAfterUsd < -1e9 ? { ok: false, reason: "ALLOWANCE_OVERSUBSCRIBED" }'],
  ["untrusted-ledger-admits", ledger, 'if (summary.problems.length > 0) return { ok: false, reason: "LEDGER_UNTRUSTED" };', 'if (false) return { ok: false, reason: "LEDGER_UNTRUSTED" };'],
  ["undeclared-allowance-admits", ledger, 'if (!money(allowanceUsd)) return { ok: false, reason: "ALLOWANCE_NOT_DECLARED" };', 'if (false) return { ok: false, reason: "ALLOWANCE_NOT_DECLARED" };'],
  ["sequence-gap-not-named", store, "if (Number(FILE.exec(name)![1]) !== index + 1) { storeProblems.push(`SEQUENCE_GAP:${name}`); break; }", "if (false) { storeProblems.push(`SEQUENCE_GAP:${name}`); break; }"],
  ["stray-file-ignored", store, "if (!FILE.test(name) && !name.startsWith(IN_FLIGHT)) storeProblems.push(", "if (false) storeProblems.push("],
  ["damaged-record-skipped", store, "} catch { storeProblems.push(`RECORD_UNREADABLE:${name}`); break; }", "} catch { continue; }"],
  ["position-taken-twice", store, 'fs.linkSync(temp, path.join(dir, `${String(seq).padStart(6, "0")}.json`));', 'fs.copyFileSync(temp, path.join(dir, `${String(seq).padStart(6, "0")}.json`));'],
  ["loser-of-a-race-gives-up", store, 'if ((error as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, reason: "STORE_WRITE_FAILED" };', 'return { ok: false, reason: "STORE_WRITE_FAILED" };'],
  ["unknown-flag-accepted", cli, '    else throw new Error("COST_GOVERNOR_ARGUMENTS_INVALID");', "    else i++;"],
  ["negative-amount-accepted", cli, "if (!/^\\d+(?:\\.\\d+)?$/.test(text) || !Number.isFinite(value) || value > 1000) throw", "if (!Number.isFinite(value) || value > 1000) throw"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
try {
  // The suite reads the master order and starts the operator script by path.
  for (const file of [test, cli, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md", "package.json", "tsconfig.json"]) copy(file);
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
  console.log(`Stage 15K production cost governor mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-cost-governor-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
