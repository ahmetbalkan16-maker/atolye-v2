/** Stage 16.0 negative controls: mutate only a copied source closure in an owned gitless TEMP root. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-adapter-standard.ts";
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
const POLICY = "src/lib/ayas/revenue/AyasRevenueActionPolicy.ts", ADAPTER = "src/lib/ayas/revenue/AyasRevenuePlatformAdapter.ts";
const REGISTRY = "src/lib/ayas/revenue/AyasRevenuePlatformRegistry.ts", REDACTION = "src/lib/ayas/revenue/AyasRevenueRedaction.ts";
const TYPES = "src/lib/ayas/revenue/AyasRevenuePlatformTypes.ts", SAFETY = "src/lib/brain/selfheal/BrainPatchSafety.ts";
/** Each change weakens a real contract; the named scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, string, number?])[] = [
  ["forbidden static module import", POLICY, "import { evaluateAyasZeroCost", "import \"node:os\";\nimport { evaluateAyasZeroCost", "P48"],
  ["forbidden dynamic module import", POLICY, "import { evaluateAyasZeroCost", "const forbiddenProbe = () => import(\"node:os\");\nimport { evaluateAyasZeroCost", "P48"],
  ["forbidden module export", POLICY, "import { evaluateAyasZeroCost", "export { tmpdir as forbiddenProbe } from \"node:os\";\nimport { evaluateAyasZeroCost", "P48"],
  ["autonomous financial manifest accepted", ADAPTER, "raw.financialOperationsAutonomous !== false", "false", "P02"],
  ["owner-free writes accepted", ADAPTER, "raw.writeOperationsRequireOwnerApproval !== true", "false", "P03"],
  ["unknown manifest platform accepted", ADAPTER, "!isAyasRevenuePlatform(raw.platform)", "false", "P04"],
  ["unknown operation in manifest accepted", ADAPTER, "!ops.every(isAyasRevenueOperation)", "false", "P05"],
  ["duplicate operations accepted", ADAPTER, "new Set(ops).size !== ops.length", "false", "P05"],
  ["unbounded adapter version accepted", ADAPTER, "(raw.adapterVersion as number) > AYAS_REVENUE_LIMITS.adapterVersionMax", "false", "P06"],
  ["secret-shaped adapter id accepted", ADAPTER, " || isAyasRevenueSensitiveText(raw.adapterId)", "", "P07"],
  ["path-shaped adapter id accepted", ADAPTER, "!/^[a-z][a-z0-9-]{2,63}$/.test(raw.adapterId)", "false", "P07"],
  ["unknown manifest fields accepted", ADAPTER, "!hasExactAyasRevenueKeys(raw, MANIFEST_KEYS)", "false", "P08"],
  ["accessor fields accepted", REDACTION, "&& Object.values(Object.getOwnPropertyDescriptors(value)).every((d) => Object.hasOwn(d, \"value\"))", "", "P08"],
  ["browser automation transport accepted", ADAPTER, "!(AYAS_REVENUE_TRANSPORTS as readonly unknown[]).includes(raw.transport)", "false", "P09"],
  ["manual hand-off may read", ADAPTER, "ops.some((op) => ayasRevenueEffect(op) !== \"LOCAL_DRAFT\")", "false", "P10"],
  ["manual hand-off may hold a credential", ADAPTER, "raw.credentialHandling !== \"NONE\" || ", "", "P10"],
  ["unparsable cost class accepted", ADAPTER, "parseAyasCostClass(raw.costClass) !== raw.costClass", "false", "P11"],
  ["production registry gains an adapter", REGISTRY, "AYAS_REVENUE_PRODUCTION_ADAPTERS: readonly AyasRevenuePlatformAdapter[] = Object.freeze([]);", "AYAS_REVENUE_PRODUCTION_ADAPTERS: readonly AyasRevenuePlatformAdapter[] = Object.freeze([{ manifest: { schemaVersion: \"1\", platform: \"etsy\", adapterId: \"live-etsy\", adapterVersion: 1, transport: \"OFFICIAL_API\", locality: \"EXTERNAL\", credentialHandling: \"NONE\", costClass: \"free-public\", supportedOperations: [\"LISTING_LIST_READ\"], writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false }, read: () => Promise.resolve(null), draft: () => Promise.resolve(null) }] as unknown as AyasRevenuePlatformAdapter[]);", "P12"],
  ["duplicate adapter id accepted", REGISTRY, "if (ids.has(adapterId) || byPlatform.has(platform))", "if (byPlatform.has(platform))", "P13"],
  ["two adapters for one platform", REGISTRY, "if (ids.has(adapterId) || byPlatform.has(platform))", "if (ids.has(adapterId))", "P13"],
  ["extra adapter methods accepted", ADAPTER, "hasExactAyasRevenueKeys(raw, [\"manifest\", \"read\", \"draft\"])", "true", "P14"],
  ["class instances accepted", REDACTION, "Object.getPrototypeOf(value) === Object.prototype", "true", "P14"],
  ["registry shares the caller's manifest", REGISTRY, "const manifest = Object.freeze({ ...adapter.manifest, supportedOperations: Object.freeze([...adapter.manifest.supportedOperations]) });", "const manifest = adapter.manifest;", "P15"],
  ["unknown platform planned", POLICY, "if (!isAyasRevenuePlatform(request.platform)) return plan(request, \"DENY\", \"UNKNOWN_PLATFORM\");", "", "P16"],
  ["platform mismatch planned", POLICY, "if (manifest.platform !== request.platform) return plan(request, \"DENY\", \"PLATFORM_MISMATCH\");", "", "P18"],
  ["mode not checked", POLICY, "if (request.mode !== AYAS_REVENUE_EFFECT_MODE[effect]) return plan(request, \"DENY\", \"MODE_MISMATCH\");", "", "P19"],
  ["external write runs without the owner", POLICY, "if (effect === \"EXTERNAL_WRITE\") return plan(request, \"REQUIRE_OWNER\", \"EXTERNAL_WRITE_REQUIRES_OWNER\", cost.reasonCode);", "", "P22"],
  ["financial operations become owner-approvable", POLICY, "if (effect === \"FINANCIAL_COMMITMENT\") return plan(request, \"DENY\", \"FINANCIAL_NOT_AUTONOMOUS\");", "", "P23"],
  ["financial denial waits for a registered adapter", POLICY, "  if (effect === \"FINANCIAL_COMMITMENT\") return plan(request, \"DENY\", \"FINANCIAL_NOT_AUTONOMOUS\");\n  if (manifest === null) return plan(request, \"DENY\", \"ADAPTER_NOT_REGISTERED\");", "  if (manifest === null) return plan(request, \"DENY\", \"ADAPTER_NOT_REGISTERED\");\n  if (effect === \"FINANCIAL_COMMITMENT\") return plan(request, \"DENY\", \"FINANCIAL_NOT_AUTONOMOUS\");", "P24"],
  ["undeclared operation planned", POLICY, "if (!manifest.supportedOperations.includes(request.operation)) return plan(request, \"DENY\", \"OPERATION_NOT_SUPPORTED\");", "", "P25"],
  ["cost ignored", POLICY, "if (!cost.allowed) return plan(request, \"DENY\", \"COST_DENIED\", cost.reasonCode);", "", "P26"],
  ["read effect mislabelled", TYPES, "LISTING_LIST_READ: \"READ_ONLY\",", "LISTING_LIST_READ: \"LOCAL_DRAFT\",", "P29"],
  ["financial operation marked read-only", TYPES, "FUNDS_WITHDRAW: \"FINANCIAL_COMMITMENT\",", "FUNDS_WITHDRAW: \"READ_ONLY\",", "P29"],
  ["unknown request fields accepted", POLICY, "!hasExactAyasRevenueKeys(raw, REQUEST_REQUIRED, REQUEST_OPTIONAL)", "false", "P30"],
  ["plan reads the caller's request, not one snapshot", REGISTRY, "return planSnapshot(registry, snapshotRequest(request));", "return planSnapshot(registry, request);", "P51"],
  ["clone skipped: proxies pass", REDACTION, "try { return { ok: true, value: structuredClone(raw) }; }", "try { return { ok: true, value: raw }; }", "P51"],
  ["array accessors accepted", REDACTION, "\n      && Object.values(Object.getOwnPropertyDescriptors(v)).every((d) => Object.hasOwn(d, \"value\"))", "", "P35"],
  ["payload size unbounded", REDACTION, "return new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes;", "return true;", "P31"],
  ["payload depth unbounded", REDACTION, "if (depth > maxDepth) return false;", "", "P32"],
  ["malformed request time accepted", POLICY, "|| !isAyasRevenueTimestamp(raw.requestedAt)", "", "P33"],
  ["path-shaped account ref accepted", REDACTION, "&& !value.includes(\"..\")", "", "H07"],
  ["page limit unbounded", POLICY, "(raw.limit as number) > AYAS_REVENUE_LIMITS.pageLimit", "false", "P34"],
  ["prototype keys accepted", REDACTION, "!FORBIDDEN_KEYS.has(key) && ", "", "P35"],
  ["adapter gets the caller's object", REGISTRY, "const sent = snapshot as Parameters<AyasRevenuePlatformAdapter[\"read\"]>[0];", "const sent = request as Parameters<AyasRevenuePlatformAdapter[\"read\"]>[0];", "P36"],
  ["cursor scope not checked", POLICY, "return plan(request, \"DENY\", \"CURSOR_SCOPE_MISMATCH\");", "{}", "P38"],
  ["foreign next cursor accepted", ADAPTER, "readAyasRevenueCursor(raw.nextCursor, request.platform, request.operation) === null", "false", "P38"],
  ["result request id not bound", ADAPTER, "raw.requestId !== request.requestId || ", "", "P39"],
  ["reported external mutation accepted", ADAPTER, "evidence.externalMutation !== false || ", "", "P39"],
  ["reported monetary mutation accepted", ADAPTER, " || evidence.monetaryMutation !== false", "", "P39"],
  ["unknown result fields accepted", ADAPTER, "!hasExactAyasRevenueKeys(raw, RESULT_REQUIRED, [\"errorCode\"])", "false", "P39"],
  ["secrets in results passed on", ADAPTER, "if (containsAyasRevenueSensitiveData(raw.data)) return { ok: false, code: \"AYAS_REVENUE_RESULT_SENSITIVE_REFUSED\" };", "", "P40"],
  ["credential-named fields passed on", REDACTION, "isAyasRevenueSensitiveKey(key) || ", "", "P41"],
  ["card numbers passed on", REDACTION, "|| hasCardNumber(text) ", "", "P41"],
  ["sensitive-key matching inside words", REDACTION, "k === term || (term.length > 3 && k.endsWith(term))", "k.includes(term)", "P41"],
  ["key prefixes refused", REDACTION, "k === term || (term.length > 3 && k.endsWith(term))", "k === term || (term.length > 3 && (k.startsWith(term) || k.endsWith(term)))", "P41"],
  ["result read more than once", ADAPTER, "  const snapshot = snapshotAyasRevenueValue(answer);\n  if (!snapshot.ok) return invalid;\n  const raw = snapshot.value;", "  const raw = answer;", "P52"],
  ["results passed on mutable", ADAPTER, "return { ok: true, result: deepFreezeAyasRevenueValue(result) };", "return { ok: true, result };", "P52"],
  ["numbers not scanned", REDACTION, "isAyasRevenueSensitiveText(JSON.stringify(value) ?? \"\")", "isAyasRevenueSensitiveText(JSON.stringify(value, (_k, v) => typeof v === \"number\" ? 0 : v) ?? \"\")", "P53"],
  ["lower-case IBAN passed", REDACTION, "(?![A-Za-z0-9])/i;", "(?![A-Za-z0-9])/;", "P53"],
  ["card needs a word boundary", REDACTION, "(?<!\\d)\\d(?:[ -]?\\d){12,18}(?!\\d)", "\\b\\d(?:[ -]?\\d){12,18}\\b", "P53"],
  ["request payload secrets travel", POLICY, " && !containsAyasRevenueSensitiveData(raw.payload)", "", "P54"],
  ["cursor secrets travel", POLICY, " || isAyasRevenueSensitiveText(raw.cursor)", "", "P54"],
  ["NaN timeout fires at once", REGISTRY, "typeof options.timeoutMs === \"number\" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : AYAS_REVENUE_LIMITS.adapterTimeoutMs", "options.timeoutMs ?? AYAS_REVENUE_LIMITS.adapterTimeoutMs", "P54"],
  ["EMPTY passes a list on", ADAPTER, "data: status === \"OK\" ? raw.data : null", "data: raw.data", "P54"],
  ["adapter error leaks", REGISTRY, "} catch {\n    return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, \"ERROR\", \"AYAS_REVENUE_ADAPTER_FAILED\", now()) };", "} catch (error) {\n    return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, \"ERROR\", \"AYAS_REVENUE_ADAPTER_FAILED\", String(error)) };", "P42"],
  ["no adapter timeout", REGISTRY, "if (raw === \"TIMEOUT\") return", "if (raw === \"NEVER\") return", "P43"],
  ["blocked plans reach the adapter", REGISTRY, "if (!plan.executable) return { plan, result: ayasRevenueLocalResult(adapter.manifest, sent, \"BLOCKED\", `AYAS_REVENUE_${plan.reason}`, now()) };", "", "P44"],
  ["draft dispatched to read", REGISTRY, "plan.decision === \"ALLOW_READ\" ? adapter.read(sent) : adapter.draft(sent)", "adapter.read(sent)", "P45"],
  ["oversized result data accepted", ADAPTER, "!isAyasRevenueBoundedJson(raw.data, AYAS_REVENUE_LIMITS.resultDataBytes)", "false", "P46"],
  ["error code not required for failures", ADAPTER, "Object.hasOwn(raw, \"errorCode\") !== (status === \"BLOCKED\" || status === \"UNAVAILABLE\" || status === \"ERROR\") || ", "", "P46"],
  ["revenue policy rewrites itself", SAFETY, "p.toLowerCase().startsWith(\"src/lib/ayas/revenue/\") || ", "", "P49"],
  ["revenue standard document rewrites itself", SAFETY, " || p.toLowerCase() === \"docs/ayas_revenue_adapter_standard.md\"", "", "P49"],
  ["revenue grader rewrites itself", SAFETY, "  \"scripts/smoke-ayas-revenue-adapter-standard.ts\",\n", "", "P49"],
  ["revenue fixture rewrites itself", SAFETY, "  \"scripts/fixtures/ayas-revenue-fake-adapter.ts\",\n", "", "P49"],
  ["executable plan for an execute mode", POLICY, "executable: decision === \"ALLOW_READ\" || decision === \"ALLOW_LOCAL_DRAFT\"", "executable: decision !== \"DENY\"", "P50"],
  ["IBAN passed on", REDACTION, "|| IBAN.test(text) ", "", "H05"],
  ["transport claim not bound", ADAPTER, "evidence.transport !== manifest.transport || ", "", "H09"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_REVENUE_MUTATION_CASE: selected }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
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
  console.log(`Stage 16.0 revenue adapter standard mutation audit: PASS (${caught}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(temp).startsWith("ayas-revenue-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
