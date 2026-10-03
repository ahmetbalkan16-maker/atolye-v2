/** Stage 16.0A negative controls: mutate only a copied source closure in an owned gitless TEMP root. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-account-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-account-boundary.ts";
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
const ACCOUNT = "src/lib/ayas/revenue/AyasRevenueAccountConnection.ts", SAFETY = "src/lib/brain/selfheal/BrainPatchSafety.ts";
/** Each change weakens a real contract; the named scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, string, number?])[] = [
  ["credential value accepted as a holder name", ACCOUNT, " || isAyasRevenueSensitiveText(raw.credentialRef)", "", "P02"],
  ["holder name not tied to the handling", ACCOUNT, "new RegExp(`^${holder}:[a-z0-9][a-z0-9._-]{2,63}$`)", "new RegExp(`^(?:connector|secret):[a-z0-9][a-z0-9._-]{2,63}$`)", "P02"],
  ["connection without an external holder", ACCOUNT, "|| holder === null ", "", "P03"],
  ["path-shaped account accepted", ACCOUNT, "|| !isAyasRevenueExternalId(raw.accountRef)", "", "P04"],
  ["contact detail in the label", ACCOUNT, " || isAyasRevenueSensitiveText(raw.label)", "", "P05"],
  ["long number in the label", ACCOUNT, " || /[\\d]{5,}/.test(raw.label)", "", "P05"],
  ["duplicate scopes accepted", ACCOUNT, " && new Set(value).size === value.length", "", "P06"],
  ["unbounded scope count", ACCOUNT, "value.length <= AYAS_REVENUE_CONNECTION_LIMITS.scopes && ", "", "P06"],
  ["secret-shaped scope accepted", ACCOUNT, "SCOPE.test(value) && !isAyasRevenueSensitiveText(value)", "SCOPE.test(value)", "P06"],
  ["credential fields ride along", ACCOUNT, "!hasExactAyasRevenueKeys(raw, CONNECTION_KEYS)", "false", "P07"],
  ["expiry before connection accepted", ACCOUNT, " || raw.expiresAt <= raw.connectedAt", "", "P08"],
  ["verification before connection accepted", ACCOUNT, " || raw.lastVerifiedAt < raw.connectedAt", "", "P08"],
  ["re-authorization ignored", ACCOUNT, "if (c.reauthRequired) return result(\"REAUTH_REQUIRED\");", "", "P09"],
  ["expiry ignored", ACCOUNT, "if (c.expiresAt !== null && Date.parse(c.expiresAt) <= now) return result(\"EXPIRED\");", "", "P10"],
  ["expiring treated as unusable", ACCOUNT, "usable: health === \"HEALTHY\" || health === \"EXPIRING\"", "usable: health === \"HEALTHY\"", "P11"],
  ["expiry window ignored", ACCOUNT, "if (c.expiresAt !== null && Date.parse(c.expiresAt) - now < AYAS_REVENUE_CONNECTION_LIMITS.expiringWindowMs) return result(\"EXPIRING\");", "", "P11"],
  ["missing scope ignored", ACCOUNT, "if (missingScopes.length) return result(\"SCOPE_MISSING\", { missingScopes });", "", "P12"],
  ["excess scope ignored", ACCOUNT, "if (excessScopes.length) return result(\"SCOPE_EXCESS\", { excessScopes });", "", "P13"],
  ["financial scopes required", ACCOUNT, "if (effect === \"LOCAL_DRAFT\" || effect === \"FINANCIAL_COMMITMENT\") continue;", "if (effect === \"LOCAL_DRAFT\") continue;", "P14"],
  ["drift ignored", ACCOUNT, "if (drift.added.length || drift.removed.length) return result(\"SCOPE_DRIFT\", { drift });", "", "P15"],
  ["never-verified treated as verified", ACCOUNT, "input.observedScopes === null || c.lastVerifiedAt === null || ", "", "P16"],
  ["stale verification accepted", ACCOUNT, " || now - Date.parse(c.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs", "", "P17"],
  ["unmapped operation ignored", ACCOUNT, "if (required.unmapped.length) return result(\"UNVERIFIED\", { unmappedOperations: required.unmapped });", "", "P18"],
  ["empty scope list counts as mapped", ACCOUNT, "if (!isScopeList(needed) || needed.length === 0) { unmapped.push(op); continue; }", "if (!isScopeList(needed)) { unmapped.push(op); continue; }", "P18"],
  ["invalid input assessed", ACCOUNT, "if (!isAyasRevenueAccountConnection(connection) || !isAyasRevenueTimestamp(input.now)", "if (!isAyasRevenueTimestamp(input.now)", "P19"],
  ["gate ignores the platform", ACCOUNT, "if (request.platform !== connection.platform) return out(\"CONNECTION_REFUSED\", \"PLATFORM_MISMATCH\");", "", "P20"],
  ["gate ignores the account", ACCOUNT, "if (request.accountRef !== connection.accountRef) return out(\"CONNECTION_REFUSED\", \"ACCOUNT_MISMATCH\");", "", "P20"],
  ["gate ignores health", ACCOUNT, "if (!assessment.usable) return out(\"CONNECTION_REFUSED\", \"CONNECTION_NOT_USABLE\", assessment.health);", "", "P20"],
  ["gate ignores the operation's scope", ACCOUNT, " || !needed.every((s) => connection.grantedScopes.includes(s))", "", "P20"],
  ["draft requires a connection", ACCOUNT, "if (effect === \"LOCAL_DRAFT\") return out(\"CONNECTION_NOT_REQUIRED\", \"LOCAL_DRAFT\");", "", "P21"],
  ["financial request passes the gate", ACCOUNT, "if (effect === \"FINANCIAL_COMMITMENT\") return out(\"CONNECTION_REFUSED\", \"FINANCIAL_NOT_AUTONOMOUS\");", "", "P22"],
  ["gate skips request validation", ACCOUNT, "if (!isAyasRevenueRequestShape(request) || !isAyasRevenueOperation(request.operation)", "if (!isAyasRevenueOperation((request as { operation?: unknown }).operation)", "P23"],
  ["account boundary rewrites itself", SAFETY, "p.toLowerCase().startsWith(\"src/lib/ayas/revenue/\") || ", "", "P24"],
  ["account grader rewrites itself", SAFETY, "  \"scripts/smoke-ayas-revenue-account-boundary.ts\",\n", "", "P24"],
  ["server secret may name a connector", ACCOUNT, "raw.credentialHandling === \"SERVER_SECRET\" ? \"vault\" : null", "raw.credentialHandling === \"SERVER_SECRET\" ? \"(?:vault|connector)\" : null", "H05"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_REVENUE_ACCOUNT_MUTATION_CASE: selected }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
try {
  copy(test); copy(ACCOUNT); for (const file of ["tsconfig.json", "package.json", ".gitignore"]) copy(file);
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
  console.log(`Stage 16.0A revenue account boundary mutation audit: PASS (${caught}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(temp).startsWith("ayas-revenue-account-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
