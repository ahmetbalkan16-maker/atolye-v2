/** Stage 16.1 negative controls: mutate only a copied source closure in an owned gitless TEMP root. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-spend-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-spend-policy.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file);
  const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = m[1]!, base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const SPEND = "src/lib/ayas/revenue/AyasRevenueSpendPolicy.ts", SAFETY = "src/lib/brain/selfheal/BrainPatchSafety.ts";
/** Each change weakens a real contract; the named scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, string, number?])[] = [
  ["upfront budget raised", SPEND, "export const AYAS_REVENUE_UPFRONT_BUDGET_USD = 0 as const;", "export const AYAS_REVENUE_UPFRONT_BUDGET_USD = 5 as const;", "P01"],
  ["autonomous spend budget environment-derived", SPEND, "export const AYAS_REVENUE_AUTONOMOUS_SPEND_USD = 0 as const;", "export const AYAS_REVENUE_AUTONOMOUS_SPEND_USD = (Number(process.env.AYAS_REVENUE_AUTONOMOUS_SPEND_USD) || 0) as 0;", "P01"],
  ["local drafts at public cost accepted", SPEND, "if (effect === \"LOCAL_DRAFT\" && intent.costClass !== \"local-zero-cost\") return deny(\"INVALID_MONEY_INTENT\", false);", "", "P05"],
  ["positive spend reported as a plain commitment", SPEND, "valueMinor > AYAS_REVENUE_UPFRONT_BUDGET_USD", "false", "P06"],
  ["missing amount treated as known", SPEND, "if (intent.amount === null) return deny(\"UNKNOWN_COST_DENIED\", true);", "if (intent.amount === null) return deny(\"MONETARY_COMMITMENT_DENIED\", true);", "P07"],
  ["zero-amount commitments allowed", SPEND, ": deny(\"MONETARY_COMMITMENT_DENIED\", true);\n  }", ": allow(\"ZERO_COST_OPERATION\");\n  }", "P08"],
  ["subscriptions not monetary", SPEND, "Object.freeze([\"ACTIVE_FEE_COMMITMENT\", \"AD_SPEND\", \"SUBSCRIPTION\", \"PURCHASE\",", "Object.freeze([\"ACTIVE_FEE_COMMITMENT\", \"AD_SPEND\", \"PURCHASE\",", "P09"],
  ["paid credits not monetary", SPEND, "\"PAID_CREDIT_OR_BID\", \"REFUND\", \"TRANSFER_OR_WITHDRAWAL\"]);", "\"REFUND\", \"TRANSFER_OR_WITHDRAWAL\"]);", "P11"],
  ["active fee commitments not monetary", SPEND, "Object.freeze([\"ACTIVE_FEE_COMMITMENT\", \"AD_SPEND\", \"SUBSCRIPTION\"", "Object.freeze([\"AD_SPEND\", \"SUBSCRIPTION\"", "P12"],
  ["withdrawals not monetary", SPEND, "\"REFUND\", \"TRANSFER_OR_WITHDRAWAL\"]);", "\"REFUND\"]);", "P14"],
  ["financial operations become spend-eligible", SPEND, "if (effect === \"FINANCIAL_COMMITMENT\") return deny(\"FINANCIAL_OPERATION_OWNER_REQUIRED\", true);", "", "P15"],
  ["unknown-cost class allowed", SPEND, "if (!cost.allowed)", "if (!cost.allowed && intent.costClass !== \"unknown-cost\")", "P16"],
  ["paid class allowed", SPEND, "if (!cost.allowed)", "if (!cost.allowed && intent.costClass !== \"paid\")", "P17"],
  ["metered free tier allowed", SPEND, "if (!cost.allowed)", "if (!cost.allowed && intent.costClass !== \"metered-free-tier\")", "P18"],
  ["unknown event allowed", SPEND, "if (intent.event !== \"NONE\" && intent.event !== \"PASSIVE_PLATFORM_FEE_OBSERVED\") return deny(\"UNKNOWN_COST_DENIED\", true);", "", "P19"],
  ["passive fee not allowed as accounting", SPEND, "return allow(intent.event === \"PASSIVE_PLATFORM_FEE_OBSERVED\" ? \"PASSIVE_FEE_OBSERVATION\" : \"ZERO_COST_OPERATION\");", "return allow(\"ZERO_COST_OPERATION\");", "P20"],
  ["passive fee authorizes a write", SPEND, "if (effect !== \"READ_ONLY\") return deny(\"MONETARY_COMMITMENT_DENIED\", true);", "", "P21"],
  ["passive fee from a local plan accepted", SPEND, "intent.source !== \"PLATFORM_FACT\" || ", "", "P22"],
  ["negative amounts accepted", SPEND, " && (a.valueMinor as number) >= 0", "", "P23"],
  ["fractional amounts accepted", SPEND, "Number.isSafeInteger(a.valueMinor)", "typeof a.valueMinor === \"number\" && Number.isFinite(a.valueMinor)", "P24"],
  ["unbounded amounts accepted", SPEND, " && (a.valueMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS", "", "P25"],
  ["unknown currencies accepted", SPEND, "&& (AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(a.currency)", "&& typeof a.currency === \"string\"", "P26"],
  ["unknown events accepted", SPEND, "&& (AYAS_REVENUE_MONEY_EVENTS as readonly unknown[]).includes(raw.event)", "&& typeof raw.event === \"string\"", "P27"],
  ["offset fields accepted", SPEND, "!hasExactAyasRevenueKeys(raw, INTENT_KEYS)", "!INTENT_KEYS.every((k) => Object.hasOwn(raw, k))", "P28"],
  ["owner-policy source unlocks spend", SPEND, "  if (AYAS_REVENUE_ACTIVE_MONEY_EVENTS.includes(intent.event)) {", "  if (AYAS_REVENUE_ACTIVE_MONEY_EVENTS.includes(intent.event) && intent.source !== \"OWNER_POLICY\") {", "P29"],
  ["profit offsets spend", SPEND, "export function decideAyasRevenueSpend(raw: unknown): AyasRevenueSpendDecision {", "export function decideAyasRevenueSpend(raw: unknown, context?: { realizedProfitMinor?: number }): AyasRevenueSpendDecision {\n  if ((context?.realizedProfitMinor ?? 0) > 0 && isAyasRevenueSpendIntent(raw) && raw.amount !== null && raw.amount.valueMinor <= (context?.realizedProfitMinor ?? 0)) return allow(\"ZERO_COST_OPERATION\");", "P32"],
  ["unknown sources accepted", SPEND, "(AYAS_REVENUE_SPEND_SOURCES as readonly unknown[]).includes(raw.source)", "typeof raw.source === \"string\"", "P33"],
  ["NONE event carries money", SPEND, "else if (intent.amount !== null && intent.amount.valueMinor !== 0) return deny(\"INVALID_MONEY_INTENT\", false);", "", "P36"],
  ["accessor intents read", SPEND, "if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, INTENT_KEYS)) return false;", "if (!raw || typeof raw !== \"object\" || Array.isArray(raw) || !hasExactAyasRevenueKeys(raw as Record<string, unknown>, INTENT_KEYS)) return false;", "P38"],
  ["allowed decisions may move money", SPEND, "Object.freeze({ allowedAutonomously: true as const, reasonCode, monetaryMutation: false as const,", "Object.freeze({ allowedAutonomously: true as const, reasonCode, monetaryMutation: reasonCode === \"PASSIVE_FEE_OBSERVATION\" as unknown as false,", "P20"],
  ["spend policy rewrites itself", SAFETY, "p.toLowerCase().startsWith(\"src/lib/ayas/revenue/\") || ", "", "P38"],
  ["spend policy document rewrites itself", SAFETY, " || p.toLowerCase() === \"docs/ayas_revenue_spend_policy.md\"", "", "P38"],
  ["spend grader rewrites itself", SAFETY, "  \"scripts/smoke-ayas-revenue-spend-policy.ts\",\n", "", "P38"],
  ["nested money accessors execute during clone", SPEND, "if (!isAyasRevenueSpendIntent(raw)) return deny(\"INVALID_MONEY_INTENT\", false);", "", "P39"],
  ["hostile reflection escapes the refusal", SPEND, "} catch { return deny(\"INVALID_MONEY_INTENT\", false); }", "} catch (error) { throw error; }", "P39"],
  ["amount permits authority fields", SPEND, "hasExactAyasRevenueKeys(a, [\"valueMinor\", \"currency\"])", "Object.hasOwn(a, \"valueMinor\") && Object.hasOwn(a, \"currency\")", "P40"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_REVENUE_SPEND_MUTATION_CASE: selected }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
try {
  copy(test); for (const file of ["tsconfig.json", "package.json", ".gitignore"]) copy(file);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  let caught = 0;
  for (const [name, file, before, after, selected, occurrences = 1] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, occurrences, `${name}: exact mutation`);
    let result: ReturnType<typeof run>;
    try { fs.writeFileSync(target, original.replaceAll(before, () => after)); result = run(selected); } finally { fs.writeFileSync(target, original); }
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    caught++; if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  assert.equal(caught, mutants.length);
  console.log(`Stage 16.1 revenue spend policy mutation audit: PASS (${caught}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(temp).startsWith("ayas-revenue-spend-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
