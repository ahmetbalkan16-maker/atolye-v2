/** Stage 15R negative controls. Source closure copied to a gitless TEMP root; repository files are never mutated. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-safe-mode-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-safe-mode.ts", reader = "src/lib/ayas/safety/AyasSafeModeReader.ts", store = "src/lib/ayas/safety/AyasSafeModeStore.ts";
const firewall = "src/lib/ayas/execution/AyasActionFirewall.ts", safety = "src/lib/brain/selfheal/BrainPatchSafety.ts", cli = "scripts/ayas-safe-mode.ts";
const daemon = "src/lib/brain/autonomy/AyasAutonomyDaemon.ts", proposals = "src/lib/brain/autonomy/AyasProposalApprovalService.ts", batches = "src/lib/brain/autonomy/AyasMicroBatchApprovalService.ts";
const runtime = "src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts", publish = "src/lib/youtube/publish/YouTubePublishPipeline.ts", cost = "src/lib/production/ProductionCostReservationStore.ts";
const discovery = "scripts/ayas-discovery-daemon.ts", selfheal = "scripts/selfheal.ts", actions = "app/brain/safe-mode/actions.ts";
const selfhealGuard = " const safeMode = ayasSafeModeHold(repoRoot); if (safeMode) return { ok: false, detail: safeMode }; // Stage 15R: no source write in SAFE_READ_ONLY\n";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!, base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
/** The whole directory, so the binding scenario's importer scan sees the same product tree. */
function copyTree(dir: string) { for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) { const file = `${dir}/${entry.name}`; if (entry.isDirectory()) copyTree(file); else { const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to); } } }
const constitutionLine = "    const constitutionRefusal = constitution.refusal(); if (constitutionRefusal) return refuse(constitutionRefusal);\n";
const safeLine = "    const safeMode = safeModeRefusal(); if (safeMode) return refuse(safeMode);\n";
const entry = (head: string): readonly [string, string] => [`${head}${constitutionLine}${safeLine}`, `${head}${constitutionLine}`];
const bindHead = "  function bindOwnerReservation(raw: unknown): AyasActionFirewallRefusal | { readonly allowed: true; readonly lease: AyasCapabilityLeaseHandle } {\n";
const admitOwnerHead = "  function admitOwnerReservation(lease: unknown, raw: unknown): AyasActionFirewallRefusal | { readonly allowed: true; readonly decision: \"ALLOW_BOUNDED_LOCAL\"; readonly request: AyasOwnerCapabilityRequest } {\n";
const issueRunHead = "  function issueDiscoveryRun(raw: unknown): AyasActionFirewallRefusal | { readonly allowed: true; readonly lease: AyasCapabilityLeaseHandle } {\n";
const admitRunHead = "    const issued = lease && typeof lease === \"object\" ? discoveryRuns.get(lease) : undefined;\n";
/** [name, file, exact source text, replacement, the scenario that must catch it] */
const mutants: readonly (readonly [string, string, string, string, number])[] = [
  ["the mode's modules can be rewritten autonomously", safety, "[\"src/lib/ayas/safety/\", \"app/brain/safe-mode/\", \"data/brain/execution/safe-mode\"].some((prefix) => p.toLowerCase().startsWith(prefix))", "false", 1],
  ["the mode's grader can rewrite itself", safety, "  \"scripts/smoke-ayas-safe-mode.ts\",\n", "", 1],
  ["the operator CLI can be rewritten autonomously", safety, "  \"scripts/ayas-safe-mode.ts\",\n", "", 1],
  ["a repeated entry appends to an active mode", store, "if (current.state !== \"NORMAL\") return current;", "", 2],
  ["the caller names itself the owner", store, "await ownerSessionValid(input.ownerSession, input.env ?? process.env, now()) ? \"OWNER_SESSION\" : \"LOCAL_OPERATOR\"", "input.ownerSession ? \"OWNER_SESSION\" : \"LOCAL_OPERATOR\"", 2],
  ["the last entry reads as normal", reader, "return state.state === \"NORMAL\" ? undefined : state.state === \"SAFE_READ_ONLY\" ? \"AYAS_SAFE_READ_ONLY\" : \"AYAS_SAFE_MODE_UNAVAILABLE\";", "return state.state === \"UNAVAILABLE\" ? \"AYAS_SAFE_MODE_UNAVAILABLE\" : undefined;", 2],
  ["exit reads the store before the owner is verified", store, "await requireOwner(); // before the store is read or anything is interpreted", "", 3],
  ["the session is not checked again after the health checks", store, "await requireOwner(); // the checks awaited; the session may have expired meanwhile", "", 3],
  ["an unconfigured gate counts as the owner", store, "return gate.mode === \"enforced\" && !!gate.key && await verifySession(ownerSession, gate.key, nowMs);", "return gate.mode !== \"enforced\" || await verifySession(ownerSession, gate.key ?? \"\", nowMs);", 3],
  ["any session string is accepted", store, " && await verifySession(ownerSession, gate.key, nowMs);", ";", 3],
  ["a failed health check does not refuse the exit", store, "if (healthChecks.length === 0 || healthChecks.some((check) => !check.ok)) throw", "if (healthChecks.length === 0) throw", 3],
  ["an empty health report is accepted", store, "healthChecks.length === 0 || ", "", 3],
  ["a concurrent exit is not detected", store, "if (latest.state !== \"SAFE_READ_ONLY\" || latest.sequence !== current.sequence || latest.lastDigest !== current.lastDigest) throw new Error(\"AYAS_SAFE_MODE_CONCURRENT_CHANGE\");", "", 3],
  ["exit is allowed when the mode is not active", store, "if (current.state === \"NORMAL\") throw new Error(\"AYAS_SAFE_MODE_NOT_ACTIVE\");", "", 3],
  ["an unreadable gate passes the health check", store, "return { ok: !read.degraded && read.state === \"CLOSED\",", "return { ok: read.state === \"CLOSED\",", 4],
  ["an unavailable constitution passes the health check", store, "return { ok: state !== \"UNAVAILABLE\", code:", "return { ok: true, code:", 4],
  ["an unreadable inventory passes the health check", store, "return { ok: occupancy !== null, code:", "return { ok: true, code:", 4],
  ["an unverifiable log reads as normal", reader, "return state.state === \"NORMAL\" ? undefined : state.state === \"SAFE_READ_ONLY\" ? \"AYAS_SAFE_READ_ONLY\" : \"AYAS_SAFE_MODE_UNAVAILABLE\";", "return state.state === \"SAFE_READ_ONLY\" ? \"AYAS_SAFE_READ_ONLY\" : undefined;", 5],
  ["an unexpected file in the log is ignored", reader, "if (name !== ayasSafeModeEventFile(index + 1)) return unavailable(\"SAFE_MODE_CHAIN_GAP_OR_UNEXPECTED_ENTRY\");", "if (name !== ayasSafeModeEventFile(index + 1)) continue;", 5],
  ["a malformed event is skipped", reader, "try { event = JSON.parse(bytes); } catch { return unavailable(\"SAFE_MODE_EVENT_MALFORMED\"); }", "try { event = JSON.parse(bytes); } catch { continue; }", 5],
  ["an event's sequence is not bound to its file", reader, " || event.sequence !== index + 1", "", 5],
  ["the chain is not verified", reader, "if (event.previousDigest !== previousDigest) return unavailable(\"SAFE_MODE_CHAIN_BROKEN\");", "", 5],
  ["the order of events is not verified", reader, "if (event.event !== (last === undefined || last.event === \"EXIT\" ? \"ENTER\" : \"EXIT\")) return unavailable(\"SAFE_MODE_CHAIN_ORDER_INVALID\");", "", 5],
  ["an unknown field is accepted", reader, "!exactKeys(v, [\"schemaVersion\", \"sequence\", \"event\", \"at\", \"actor\", \"previousDigest\", \"healthChecks\"]) || ", "", 5],
  ["an exit by a local operator is accepted", reader, "return v.actor === \"OWNER_SESSION\" && Array.isArray(checks)", "return Array.isArray(checks)", 5],
  ["an exit with a failed check is accepted", reader, "      && (check as AyasSafeModeHealthCheck).ok === true && typeof", "      && typeof", 5],
  ["an exit with no checks is accepted", reader, "checks.length >= 1 && ", "", 5],
  ["a store that is not a directory is not noticed", reader, "if (stat.isSymbolicLink() || !stat.isDirectory()) return unavailable(\"SAFE_MODE_STORE_NOT_A_DIRECTORY\");", "", 5],
  ["an unverifiable log is appended to by an exit", store, "if (current.state === \"UNAVAILABLE\") throw new Error(\"AYAS_SAFE_MODE_STORE_UNAVAILABLE\");", "", 5],
  ["non-read tool work is issued in the mode", firewall, "    if (decision !== \"ALLOW_READ\") { const safeMode = safeModeRefusal(); if (safeMode) return refuse(safeMode); }\n", "", 6],
  ["a lease issued before the mode is admitted in it", firewall, "    if (issued.scope.classification !== \"READ\") { const safeMode = safeModeRefusal(); if (safeMode) return refuse(safeMode); }\n", "", 6],
  ["reads are refused in the mode", firewall, "if (issued.scope.classification !== \"READ\") { const safeMode", "if (issued.scope.classification !== \"WRITE\") { const safeMode", 6],
  ["a source write is bound in the mode", firewall, ...entry(bindHead), 6],
  ["a source write bound before the mode is admitted in it", firewall, ...entry(admitOwnerHead), 6],
  ["a discovery run is issued in the mode", firewall, ...entry(issueRunHead), 6],
  ["a running discovery run keeps its capabilities in the mode", firewall, "          if (safeModeRefusal()) return false;\n", "", 6],
  ["the firewall reads the mode once", firewall, "const safeModeRefusal = (): string | undefined => ayasSafeModeRefusal(readAyasSafeMode(repoRoot));", "const safeModeAtStart = ayasSafeModeRefusal(readAyasSafeMode(repoRoot)); const safeModeRefusal = (): string | undefined => safeModeAtStart;", 6],
  ["a discovery run issued before the mode is admitted in it", firewall, ...entry(admitRunHead), 7],
  ["the operator CLI records itself as the owner", cli, "await enterAyasSafeMode({ repoRoot })", "await enterAyasSafeMode({ repoRoot, ownerSession: \"operator\" })", 9],
  ["execution reserves the authorization in the mode", daemon, "    assertAyasSafeModeAllowsMutation(repoRoot);\n", "", 10],
  ["a proposal is decided and published in the mode", proposals, "  assertAyasSafeModeAllowsMutation(deps.repoRoot); // Stage 15R: before a decision is minted\n", "", 10],
  ["a recorded approval is published in the mode", proposals, "  assertAyasSafeModeAllowsMutation(deps.repoRoot); // Stage 15R: a recorded approval is not published in the mode\n", "", 10],
  ["a micro batch is decided and published in the mode", batches, "  assertAyasSafeModeAllowsMutation(deps.repoRoot); // Stage 15R: before a decision is minted\n", "", 10],
  ["a production stage is admitted in the mode", runtime, "  assertAyasSafeModeAllowsMutation();", "", 11],
  ["a mutating route does not ask the mode", "app/api/visuals/route.ts", "  const safeMode = ayasSafeModeHold();", "  const safeMode = undefined;", 11],
  ["the self-heal auto-apply writes source in the mode", selfheal, "    autoApplyToWorkingTree: async ({ diff, changedFiles }) => {\n     " + selfhealGuard, "    autoApplyToWorkingTree: async ({ diff, changedFiles }) => {\n", 11],
  ["the self-heal operator apply writes source in the mode", selfheal, "      applyToWorkingTree: async ({ diff, changedFiles }) => {\n       " + selfhealGuard, "      applyToWorkingTree: async ({ diff, changedFiles }) => {\n", 11],
  ["the publish route runs in the mode", "app/api/youtube/route.ts", "  const safeMode = ayasSafeModeHold();", "  const safeMode = undefined;", 12],
  ["a package is published in the mode", publish, "    assertAyasSafeModeAllowsMutation();", "", 12],
  ["new spend is reserved in the mode", cost, "  if (safeModeHold()) return { ok: false, reason: \"SAFE_READ_ONLY\" };", "", 12],
  ["the hold helper never holds", reader, "  return ayasSafeModeRefusal(readAyasSafeMode(repoRoot));\n}\n\n/** The message is the code", "  return undefined;\n}\n\n/** The message is the code", 12],
  ["the discovery child runs in the mode", discovery, "  if (safeMode) { console.log(JSON.stringify({ status: \"SAFE_READ_ONLY_HOLD\", code: safeMode })); return; }\n", "", 13],
  ["the exit takes its session from the form", actions, "await exitAyasSafeMode({ repoRoot: process.cwd(), ownerSession: session });", "await exitAyasSafeMode({ repoRoot: process.cwd(), ownerSession: String(form.get('ownerSession')) });", 14],
  ["a stale page leaves a mode that was entered again", actions, " || form.get(\"modeDigest\") !== current.lastDigest", "", 14],
  ["the enter action accepts caller fields", actions, "  if (ownFields(form).length > 0) throw new Error(\"AYAS_SAFE_MODE_FORM_INVALID\");\n  const session", "  const session", 14],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_SAFE_MODE_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 100_000, maxBuffer: 1_000_000 });
try {
  for (const file of [test, cli, discovery, selfheal, "tsconfig.json", ".gitignore"]) copy(file);
  for (const dir of ["src", "app"]) copyTree(dir);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after, selected] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(selected); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15R safe mode mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); } assert.ok(!fs.existsSync(link));
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-safe-mode-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
