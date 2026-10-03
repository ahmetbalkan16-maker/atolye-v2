/** Stage 15T negative controls: mutate only a copied source closure in an owned gitless TEMP root. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-executive-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-executive-briefing.ts";
const copied = new Set<string>();
function copy(file: string, follow = true) {
  if (copied.has(file)) return; copied.add(file);
  const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!follow || !/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = m[1]!, base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const ALERTS = "src/lib/ayas/briefing/AyasExecutiveAlerts.ts", STORE = "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts";
const BRIEFING = "src/lib/ayas/briefing/AyasExecutiveBriefing.ts", VIEW = "src/lib/ayas/briefing/AyasExecutiveOwnerView.ts", SAFETY = "src/lib/brain/selfheal/BrainPatchSafety.ts";
/** Each change weakens a real contract; the named scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, number, number?])[] = [
  ["briefing policy rewrites itself", SAFETY, "[\"src/lib/ayas/briefing/\", \"app/brain/briefing/\", \"data/brain/execution/owner-alerts\"]", "[\"src/lib/ayas/unprotected/\", \"app/brain/briefing/\", \"data/brain/execution/owner-alerts\"]", 1],
  ["owner action rewrites itself", SAFETY, "\"app/brain/briefing/\"", "\"app/brain/unprotected/\"", 1],
  ["alert history rewrites itself", SAFETY, "\"data/brain/execution/owner-alerts\"]", "\"data/brain/execution/unprotected\"]", 1],
  ["delivery component rewrites itself", SAFETY, "p.toLowerCase() === \"src/components/brain/ayasexecutivebriefingpanel.tsx\"", "false", 1],
  ["operator rewrites itself", SAFETY, "  \"scripts/ayas-executive-alerts.ts\",\n", "", 1],
  ["grader rewrites itself", SAFETY, "  \"scripts/smoke-ayas-executive-briefing.ts\",\n", "", 1],
  ["negative-control grader rewrites itself", SAFETY, "  \"scripts/smoke-ayas-executive-briefing-mutations.ts\",\n", "", 1],
  ["accessor and hidden authority fields accepted", ALERTS, "Reflect.ownKeys(v).length === Object.keys(v).length && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, \"value\"))", "true", 2],
  ["unknown signal fields accepted", ALERTS, "!exact(raw, stored ? alertKeys : signalKeys)", "false", 2],
  ["invalid priority accepted", ALERTS, "!AYAS_ALERT_PRIORITIES.includes(raw.priority as AyasAlertPriority)", "false", 2],
  ["invalid issue identity accepted", ALERTS, "!KEY.test(raw.issueKey)", "false", 2],
  ["malformed evidence digest accepted", ALERTS, "!HASH.test(raw.evidence.digest)", "false", 2],
  ["secret-bearing summary persisted", ALERTS, "raw.summary !== briefingText(raw.summary)", "false", 3],
  ["routine notification interrupts owner", ALERTS, "a.priority !== \"ROUTINE\"", "true", 4],
  ["routine stored as an alert", ALERTS, "if (s.priority !== \"ROUTINE\") incoming.set(s.issueKey, s);", "incoming.set(s.issueKey, s);", 4],
  ["stored routine accepted", ALERTS, "|| (stored && raw.priority === \"ROUTINE\")", "", 4],
  ["observation time treated as material", ALERTS, "reference: signal.evidence.reference, digest: signal.evidence.digest }", "reference: signal.evidence.reference, digest: signal.evidence.digest, observedAt: signal.evidence.observedAt }", 5],
  ["duplicate incoming issue accepted", ALERTS, "if (keys.has(s.issueKey)) fail();", "", 5],
  ["delivery forgets its fingerprint", ALERTS, "notifiedFingerprint: a.fingerprint", "notifiedFingerprint: null", 6],
  ["delivery forgets cooldown", ALERTS, "new Date(Date.parse(input.at) + input.cooldownMs).toISOString()", "input.at", 6],
  ["cooldown bypassed without new evidence", ALERTS, "at >= a.nextEligibleNotification", "true", 7],
  ["reopen bypasses cooldown", ALERTS, "[\"SEVERITY_INCREASED\", \"MATERIAL_EVIDENCE_CHANGED\"];", "[\"SEVERITY_INCREASED\", \"MATERIAL_EVIDENCE_CHANGED\", \"REOPENED\"];", 7],
  ["lower severity bypasses cooldown", ALERTS, "rank[s.priority] < rank[old.priority] ? null", "rank[s.priority] < rank[old.priority] ? \"MATERIAL_EVIDENCE_CHANGED\"", 7],
  ["invalid cooldown accepted", ALERTS, "input.cooldownMs < AYAS_EXECUTIVE_COOLDOWN_MS.min", "false", 7],
  ["severity escalation loses classification", ALERTS, "rank[s.priority] > rank[old.priority] ? \"SEVERITY_INCREASED\"", "rank[s.priority] > rank[old.priority] ? \"MATERIAL_EVIDENCE_CHANGED\"", 8],
  ["higher-severity reopen waits for cooldown", ALERTS, "rank[s.priority] > rank[old.priority] ? \"SEVERITY_INCREASED\"", "old.active && rank[s.priority] > rank[old.priority] ? \"SEVERITY_INCREASED\"", 8],
  ["escalation never bypasses cooldown", ALERTS, " || COOLDOWN_BYPASS.includes(a.escalationReason)", "", 8],
  ["new material evidence loses classification", ALERTS, "? null : \"MATERIAL_EVIDENCE_CHANGED\"", "? null : \"SEVERITY_INCREASED\"", 9],
  ["acknowledgement does not quiet current alert", ALERTS, "a.acknowledgedFingerprint !== a.fingerprint", "true", 10],
  ["stale fingerprint acknowledgement accepted", ALERTS, "found.fingerprint !== input.fingerprint", "false", 10],
  ["new material condition retains stale acknowledgement", ALERTS, "lastChanged: at, acknowledgedFingerprint: null", "lastChanged: at, acknowledgedFingerprint: old.acknowledgedFingerprint", 11],
  ["unavailable domain resolves existing issue", ALERTS, "old.active && covered.includes(old.domain)", "old.active", 12],
  ["reopen loses escalation evidence", ALERTS, "!old.active ? \"REOPENED\"", "!old.active ? null", 12],
  ["clock rollback accepted", ALERTS, "state.changedAt !== null && at < state.changedAt", "false", 13],
  ["forged alert id accepted", ALERTS, "v.alertId !== alertDigest({ issueKey: v.issueKey })", "false", 13],
  ["owner metadata gate bypassed", STORE, "g.mode !== \"enforced\" || !g.key || !await verifySession(input.ownerSession,g.key,now())", "false", 16],
  ["record digest ignored", STORE, "digest !== alertDigest(body)", "false", 17],
  ["state digest ignored", STORE, "v.stateDigest !== alertDigest(v.state)", "false", 17],
  ["record sequence ignored", STORE, "v.sequence !== sequence", "false", 17],
  ["junction ancestry read allowed", STORE, "requireContainedRealDirectory(root, target);", "", 18],
  ["metadata writes bypass global safe mode", STORE, "assertAyasSafeModeAllowsMutation(repoRoot);", "", 19, 2],
  ["unknown realized money replaced with zero", BRIEFING, "realizedRevenue:\"NOT_CONFIGURED\" as const", "realizedRevenue:0 as const", 20],
  ["unreadable sources not surfaced", BRIEFING, "if (unreadable.length) signals.push", "if (false) signals.push", 20],
  ["known critical health hidden", BRIEFING, "input.server.health.value.findings.some(f => f.severity === \"CRITICAL\")", "false", 21],
  ["metadata operation becomes approval", ALERTS, "![\"ACKNOWLEDGE\", \"DELIVERED\"].includes(input.operation)", "false", 24],
  ["resolved alerts never age out", ALERTS, "a.active || now - Date.parse(a.lastChanged) <= AYAS_EXECUTIVE_ALERT_LIMITS.inactiveRetentionMs", "true", 25],
  ["resolved alerts unbounded", ALERTS, "Math.max(0, inactive.length - AYAS_EXECUTIVE_ALERT_LIMITS.inactive)", "0", 25],
  ["active limit not enforced", ALERTS, "active > AYAS_EXECUTIVE_ALERT_LIMITS.active || ", "", 25],
  ["stored inactive limit not enforced", ALERTS, " || raw.alerts.length - active > AYAS_EXECUTIVE_ALERT_LIMITS.inactive", "", 25],
  ["unexpected journal files ignored", STORE, "names.some(n => !FILE.test(n))", "false", 26],
  ["history numbering outside the window ignored", STORE, "(names.length > 0 && (names[0] !== recordName(1) || names[names.length - 1] !== recordName(names.length)))", "false", 26],
  ["window not chained to its anchor", STORE, "previous = anchor.digest;", "previous = null;", 26],
  ["window anchor not verified", STORE, "const anchor = loadRecord(dir, first - 1);", "const anchor = JSON.parse(fs.readFileSync(path.join(dir, recordName(first - 1)), \"utf8\")) as StoredRecord;", 27],
  ["previous hash chain link ignored", STORE, "r.previousDigest !== previous", "false", 27],
  ["full verification reads only the window", STORE, "full ? 1 : Math.max(1, names.length - AYAS_EXECUTIVE_ALERT_WINDOW + 1)", "Math.max(1, names.length - AYAS_EXECUTIVE_ALERT_WINDOW + 1)", 27],
  ["reliability breach hidden", BRIEFING, "if (counter.status !== \"BREACH\") continue;", "continue;", 28],
  ["reliability breach not critical", BRIEFING, "domain: \"failures\", priority: \"CRITICAL\"", "domain: \"failures\", priority: \"MATERIAL_INFO\"", 28],
  ["unknown reliability shown as zero", BRIEFING, "reliability[key].status === \"UNKNOWN\" ? \"ölçülemedi\"", "reliability[key].status === \"UNKNOWN\" ? \"0 (kapsamlı)\"", 28],
  ["unread reliability treated as observed", BRIEFING, "(!reliability || input.reportCenterUnavailable === true)", "(input.reportCenterUnavailable === true)", 28],
  ["unread report center treated as observed", BRIEFING, "(!reliability || input.reportCenterUnavailable === true)", "(!reliability)", 28],
  ["unread report center not surfaced", BRIEFING, "...(input.reportCenterUnavailable === true ? [\"AYAS Raporları\"] : [])", "", 28],
  ["unreadable source replaces a known condition", BRIEFING, "if (!validDomains.some(d => d.id === item.domain)) continue;", "", 29],
  ["unreadable notice interrupts as critical", BRIEFING, "issueKey: \"health:sources-unavailable\", domain: \"health\", priority: \"MATERIAL_INFO\"", "issueKey: \"health:sources-unavailable\", domain: \"health\", priority: \"CRITICAL\"", 29],
  ["preview marks alerts deliverable", VIEW, "notificationEligible: persistence === \"VERIFIED\" && executiveNotificationEligible(a, now)", "notificationEligible: executiveNotificationEligible(a, now)", 30],
  ["unauthenticated refresh writes metadata", VIEW, "else if (input.synchronize && input.ownerAuthenticated)", "else if (input.synchronize)", 30],
  ["owner view ignores SAFE_READ_ONLY", VIEW, "if (ayasSafeModeHold(repoRoot)) persistence", "if (false) persistence", 30],
  ["clock behind history breaks the owner view", VIEW, "try { state = observeAyasExecutiveSignals(base, briefing.signals, briefing.covered, now); }\n  catch { persistence = \"UNAVAILABLE\"; }", "state = observeAyasExecutiveSignals(base, briefing.signals, briefing.covered, now);", 30],
  ["unreadable history previewed as readable", VIEW, "read.status === \"UNAVAILABLE\" ? \"UNAVAILABLE\" : \"PREVIEW\"", "\"PREVIEW\"", 30],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_EXECUTIVE_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
try {
  for (const file of ["app/brain/briefing/actions.ts","app/brain/briefing/page.tsx","src/components/brain/AyasExecutiveBriefingPanel.tsx","src/components/brain/AyasControlCenter.tsx"]) copy(file,false);
  for (const file of [test, "scripts/ayas-executive-alerts.ts", "tsconfig.json", "package.json", ".gitignore"]) copy(file);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after, selected, occurrences = 1] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, occurrences, `${name}: exact mutation`);
    let result: ReturnType<typeof run>;
    try { fs.writeFileSync(target, original.replaceAll(before, () => after)); result = run(selected); } finally { fs.writeFileSync(target, original); }
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15T executive briefing mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(temp).startsWith("ayas-executive-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
