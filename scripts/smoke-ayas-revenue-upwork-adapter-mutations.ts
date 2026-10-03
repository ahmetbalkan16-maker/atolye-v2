/** Stage16.5 assertion-caught mutations in an isolated synthetic-only TEMP copy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-upwork-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-upwork-adapter.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const D = "src/lib/ayas/revenue/adapters/upwork/";
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  [
    "workflow status env-like authority",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "\"OWNER_SUPPORT_CONFIRMATION_REQUIRED\" as const",
    "\"CONFIRMED\" as const",
    "P01"
  ],
  [
    "default catalog fabricated",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "Object.freeze([]);",
    "Object.freeze([{} as AyasUpworkReviewedTool]);",
    "P01"
  ],
  [
    "unknown name mapped by position",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "pins.find(p => p.name === tool.name)",
    "pins[0]",
    "P04"
  ],
  [
    "write tool read classification",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "return \"OWNER_REQUIRED\"",
    "return \"READ_PIN_MATCH\"",
    "P05"
  ],
  [
    "financial tool read classification",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "return \"FINANCIAL_NOT_AUTONOMOUS\"",
    "return \"READ_PIN_MATCH\"",
    "P06"
  ],
  [
    "input pin skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "digestAyasRevenueData(tool.inputSchema) !== pin.inputSchemaDigest",
    "false",
    "P08"
  ],
  [
    "output pin skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "digestAyasRevenueData(tool.outputSchema) !== pin.outputSchemaDigest",
    "false",
    "P09"
  ],
  [
    "annotations pin skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "digestAyasRevenueData(tool.annotations) !== pin.annotationsDigest",
    "false",
    "P10"
  ],
  [
    "readOnly hint skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "tool.annotations.readOnlyHint === true",
    "true",
    "P07"
  ],
  [
    "destructive hint skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "tool.annotations.destructiveHint === false",
    "true",
    "P07"
  ],
  [
    "open world hint skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "tool.annotations.openWorldHint === false",
    "true",
    "P07"
  ],
  [
    "metadata preflight skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "if (!isAyasRevenueBoundedJson(raw, AYAS_UPWORK_MAX_BYTES)) return null;",
    "",
    "P16"
  ],
  [
    "array preflight skipped",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "if (!isAyasRevenueBoundedJson(raw, AYAS_UPWORK_MAX_BYTES)) return null;",
    "",
    "P17"
  ],
  [
    "duplicate pins accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    " || names.has(tool.name)",
    "",
    "P11"
  ],
  [
    "duplicate operation pins accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "(effect === \"READ_ONLY\" && reads.has(tool.operation))",
    "false",
    "P12"
  ],
  [
    "empty scopes accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    " || tool.scopes.length === 0",
    "",
    "P14"
  ],
  [
    "unknown cost hint accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts",
    "pin.zeroCostVerified === true",
    "true",
    "P15"
  ],
  [
    "owner callback gates removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "authorizeOwnerRead() !== true",
    "false",
    "P19"
  ],
  [
    "scheduled workflow gate removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "!allowAyasUpworkWorkflow(workflow)",
    "false",
    "P20"
  ],
  [
    "AI ranking workflow gate removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "!allowAyasUpworkWorkflow(workflow)",
    "false",
    "P21"
  ],
  [
    "raw storage workflow gate removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "!allowAyasUpworkWorkflow(workflow)",
    "false",
    "P22"
  ],
  [
    "connection gate removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "gate.gate !== \"CONNECTION_OK\"",
    "false",
    "P31"
  ],
  [
    "account binding removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    " || request.accountRef !== accountRef",
    "",
    "P37"
  ],
  [
    "tool discovery drift ignored",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    " || !tools.some(t => isAyasRevenuePlainRecord(t) && t.name === binding.pin.name && inspectAyasUpworkTool(t, pins) === \"READ_PIN_MATCH\")",
    "",
    "P38"
  ],
  [
    "duplicate discovered tools accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    " || new Set(tools.map(t => (t as Record<string, unknown>).name)).size !== tools.length",
    "",
    "P39"
  ],
  [
    "mutable transport parameters",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "transport(deepFreezeAyasRevenueValue({ endpoint: AYAS_UPWORK_MCP_ENDPOINT, toolName: binding.pin.name, arguments: args }))",
    "transport({ endpoint: AYAS_UPWORK_MCP_ENDPOINT, toolName: binding.pin.name, arguments: { ...args } })",
    "P40"
  ],
  [
    "429 handling removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "if (answer.status === 429) return envelope(request, \"UNAVAILABLE\", null, \"RATE_LIMITED\");",
    "",
    "P41"
  ],
  [
    "401 handling removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "answer.status === 401 || answer.status === 403",
    "answer.status === 403",
    "P42"
  ],
  [
    "403 handling removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "answer.status === 401 || answer.status === 403",
    "answer.status === 401",
    "P43"
  ],
  [
    "5xx handling removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "if ((answer.status as number) >= 500 && (answer.status as number) <= 599) return envelope(request, \"UNAVAILABLE\", null, \"UPSTREAM_UNAVAILABLE\");",
    "",
    "P44"
  ],
  [
    "MCP error flag ignored",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    " || answer.isError !== false",
    "",
    "P45"
  ],
  [
    "page size bound removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    " || (request.limit ?? 10) > AYAS_UPWORK_PAGE_LIMIT",
    "",
    "P48"
  ],
  [
    "projected owner identity ignored",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "value.accountRef !== accountRef",
    "false",
    "P50"
  ],
  [
    "duplicate facts accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    " || seen.has(item.ref)",
    "",
    "P51"
  ],
  [
    "unknown private fields preserved",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "!hasExactAyasRevenueKeys(item, [\"ref\", \"state\"], [\"title\", \"amounts\"])",
    "false",
    "P52"
  ],
  [
    "cross currency facts accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "if (new Set(currencies).size > 1) return null;",
    "",
    "P53"
  ],
  [
    "money shape bypassed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "m === null || isAyasRevenueScenarioMoney(m)",
    "true",
    "P54"
  ],
  [
    "draft publication opened",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "publication: \"CLOSED\"",
    "publication: \"OPEN\"",
    "P55"
  ],
  [
    "draft commercial digest incomplete",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "draftDigest: digestAyasRevenueData(p)",
    "draftDigest: digestAyasRevenueData(p.coverLetter)",
    "P56"
  ],
  [
    "draft links accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "/[\\u0000-\\u0008\\u000b-\\u001f]|[a-z][a-z0-9+.-]*:\\/\\/|\\bwww\\.|\\b[a-z0-9-]+\\.(?:com|net|org|io|co|app|link)\\b/i.test(p.coverLetter)",
    "false",
    "P57"
  ],
  [
    "duplicate draft attachments accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "new Set(p.attachmentDigests).size !== p.attachmentDigests.length",
    "false",
    "P58"
  ],
  [
    "milestone sum mismatch accepted",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "if (p.milestones.length > 0 && total !== p.bid.valueMinor) return null;",
    "",
    "P59"
  ],
  [
    "missing rights hidden",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "...(p.rightsEvidenceDigest === null ? [\"RIGHTS_EVIDENCE_MISSING\"] : []), ",
    "",
    "P60"
  ],
  [
    "second owner and connection check removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "if (authorizeOwnerRead() !== true || gateAyasRevenueRequestConnection(request, connection, { now: now(), operations, scopeMap, observedScopes }).gate !== \"CONNECTION_OK\")",
    "if (false)",
    "P62"
  ],
  [
    "second freshness check removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "gateAyasRevenueRequestConnection(request, connection, { now: now(), operations, scopeMap, observedScopes }).gate !== \"CONNECTION_OK\"",
    "false",
    "H14"
  ],
  [
    "response metadata raw snapshot bypass",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts",
    "answer = snapshotAyasUpworkData(await transport(deepFreezeAyasRevenueValue({ endpoint: AYAS_UPWORK_MCP_ENDPOINT, toolName: binding.pin.name, arguments: args })))",
    "answer = await transport(deepFreezeAyasRevenueValue({ endpoint: AYAS_UPWORK_MCP_ENDPOINT, toolName: binding.pin.name, arguments: args }))",
    "P63"
  ],
  [
    "attribution discarded",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "attribution: \"Upwork\", aiOrigin: value.aiOrigin",
    "attribution: \"Other\", aiOrigin: value.aiOrigin",
    "P65"
  ],
  [
    "AI origin overwritten",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "aiOrigin: value.aiOrigin",
    "aiOrigin: false",
    "P65"
  ],
  [
    "state open vocabulary",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    " || !STATES[kind].includes(item.state as string)",
    "",
    "H06"
  ],
  [
    "projection pagination bound removed",
    "src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts",
    "isAyasRevenueDataArray(value.items, limit)",
    "isAyasRevenueDataArray(value.items, 100)",
    "H12"
  ]
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (id?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: id ? { ...env, AYAS_REVENUE_UPWORK_MUTATION_CASE: id } : env, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 4_000_000 });
try {
  copy(test); for (const f of ["tsconfig.json", "package.json", ".gitignore", "src/lib/brain/selfheal/BrainPatchSafety.ts"]) copy(f);
  // The source guard scans the adapter directory, src and app; copy the adapter directory whole.
  for (const f of fs.readdirSync(path.join(repo, D))) copy(`${D}${f}`);
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
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-upwork-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
