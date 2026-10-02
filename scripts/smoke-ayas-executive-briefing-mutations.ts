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
/** Each removal weakens a real contract; its existing scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, number, number?])[] = [
  [
    "briefing policy rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "[\"src/lib/ayas/briefing/\", \"app/brain/briefing/\", \"data/brain/execution/owner-alerts\"]",
    "[\"src/lib/ayas/unprotected/\", \"app/brain/briefing/\", \"data/brain/execution/owner-alerts\"]",
    1
  ],
  [
    "owner action rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "\"app/brain/briefing/\"",
    "\"app/brain/unprotected/\"",
    1
  ],
  [
    "delivery component rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "p.toLowerCase() === \"src/components/brain/ayasexecutivebriefingpanel.tsx\"",
    "false",
    1
  ],
  [
    "operator rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "  \"scripts/ayas-executive-alerts.ts\",\n",
    "",
    1
  ],
  [
    "grader rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "  \"scripts/smoke-ayas-executive-briefing.ts\",\n",
    "",
    1
  ],
  [
    "negative-control grader rewrites itself",
    "src/lib/brain/selfheal/BrainPatchSafety.ts",
    "  \"scripts/smoke-ayas-executive-briefing-mutations.ts\",\n",
    "",
    1
  ],
  [
    "accessor and hidden authority fields accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "Reflect.ownKeys(v).length === Object.keys(v).length && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, \"value\"))",
    "true",
    2
  ],
  [
    "unknown signal fields accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "!exact(raw, stored ? alertKeys : signalKeys)",
    "false",
    2
  ],
  [
    "invalid priority accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "!AYAS_ALERT_PRIORITIES.includes(raw.priority as AyasAlertPriority)",
    "false",
    2
  ],
  [
    "invalid issue identity accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "!KEY.test(raw.issueKey)",
    "false",
    2
  ],
  [
    "malformed evidence digest accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "!HASH.test(raw.evidence.digest)",
    "false",
    2
  ],
  [
    "secret-bearing summary persisted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "raw.summary !== briefingText(raw.summary)",
    "false",
    3
  ],
  [
    "routine notification interrupts owner",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "a.priority !== \"ROUTINE\"",
    "true",
    4
  ],
  [
    "observation time treated as material",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "reference: signal.evidence.reference, digest: signal.evidence.digest }",
    "reference: signal.evidence.reference, digest: signal.evidence.digest, observedAt: signal.evidence.observedAt }",
    5
  ],
  [
    "duplicate incoming issue accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "if (incoming.has(s.issueKey)) fail();",
    "",
    5
  ],
  [
    "delivery forgets its fingerprint",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "notifiedFingerprint: a.fingerprint",
    "notifiedFingerprint: null",
    6
  ],
  [
    "delivery forgets cooldown",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "new Date(Date.parse(input.at) + input.cooldownMs).toISOString()",
    "input.at",
    6
  ],
  [
    "cooldown bypassed without new evidence",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "at >= a.nextEligibleNotification",
    "true",
    7
  ],
  [
    "invalid cooldown accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "input.cooldownMs < 60_000",
    "false",
    7
  ],
  [
    "severity escalation loses classification",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "\"SEVERITY_INCREASED\" : \"MATERIAL_EVIDENCE_CHANGED\"",
    "\"MATERIAL_EVIDENCE_CHANGED\" : \"MATERIAL_EVIDENCE_CHANGED\"",
    8
  ],
  [
    "new material evidence loses classification",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "\"SEVERITY_INCREASED\" : \"MATERIAL_EVIDENCE_CHANGED\"",
    "\"SEVERITY_INCREASED\" : \"SEVERITY_INCREASED\"",
    9
  ],
  [
    "acknowledgement does not quiet current alert",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "a.acknowledgedFingerprint !== a.fingerprint",
    "true",
    10
  ],
  [
    "stale fingerprint acknowledgement accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "found.fingerprint !== input.fingerprint",
    "false",
    10
  ],
  [
    "new material condition retains stale acknowledgement",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "lastChanged: at, acknowledgedFingerprint: null",
    "lastChanged: at, acknowledgedFingerprint: old.acknowledgedFingerprint",
    11
  ],
  [
    "unavailable domain resolves existing issue",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "old.active && covered.includes(old.domain)",
    "old.active",
    12
  ],
  [
    "reopen loses escalation evidence",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "!old.active ? \"REOPENED\"",
    "!old.active ? null",
    12
  ],
  [
    "clock rollback accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "state.changedAt !== null && at < state.changedAt",
    "false",
    13
  ],
  [
    "forged alert id accepted",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "v.alertId !== alertDigest({ issueKey: v.issueKey })",
    "false",
    13
  ],
  [
    "owner metadata gate bypassed",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "g.mode !== \"enforced\" || !g.key || !await verifySession(input.ownerSession,g.key,now())",
    "false",
    16
  ],
  [
    "record digest ignored",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "digest !== alertDigest(body)",
    "false",
    17
  ],
  [
    "state digest ignored",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "v.stateDigest !== alertDigest(v.state)",
    "false",
    17
  ],
  [
    "previous hash chain link ignored",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "v.previousDigest !== previous",
    "false",
    17
  ],
  [
    "record sequence ignored",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "v.sequence !== i+1",
    "false",
    17
  ],
  [
    "unexpected journal files ignored",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "names.some(n => !FILE.test(n))",
    "false",
    17
  ],
  [
    "junction ancestry read allowed",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "requireContainedRealDirectory(root, target);",
    "",
    18
  ],
  [
    "metadata writes bypass global safe mode",
    "src/lib/ayas/briefing/AyasExecutiveAlertStore.ts",
    "assertAyasSafeModeAllowsMutation(repoRoot);",
    "",
    19,
    2
  ],
  [
    "unknown realized money replaced with zero",
    "src/lib/ayas/briefing/AyasExecutiveBriefing.ts",
    "realizedRevenue:\"NOT_CONFIGURED\" as const",
    "realizedRevenue:0 as const",
    20
  ],
  [
    "known critical health hidden",
    "src/lib/ayas/briefing/AyasExecutiveBriefing.ts",
    "input.server.health.value.findings.some(f => f.severity === \"CRITICAL\")",
    "false",
    21
  ],
  [
    "metadata operation becomes approval",
    "src/lib/ayas/briefing/AyasExecutiveAlerts.ts",
    "![\"ACKNOWLEDGE\", \"DELIVERED\"].includes(input.operation)",
    "false",
    24
  ]
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_EXECUTIVE_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
try {
  for (const file of ["app/brain/briefing/actions.ts","src/components/brain/AyasExecutiveBriefingPanel.tsx","src/components/brain/AyasControlCenter.tsx"]) copy(file,false);
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
