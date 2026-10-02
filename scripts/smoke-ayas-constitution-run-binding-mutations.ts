/** TEMP negative controls for the actual Stage15N long-run admission seams. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-binding-audit-"));
const test = "scripts/smoke-ayas-constitution-run-binding.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!, base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const firewall = "src/lib/ayas/execution/AyasActionFirewall.ts", light = "src/lib/brain/autonomy/AyasLightResearchEngine.ts", deep = "src/lib/brain/autonomy/AyasDeepResearchEngine.ts";
const mutants: readonly (readonly [string, string, string, string, number])[] = [
  ["firewall all issue/admit checks removed", firewall, "const constitutionRefusal = constitution.refusal(); if (constitutionRefusal) return refuse(constitutionRefusal);", "", 6],
  ["already-admitted discovery run ignores revocation", firewall, "if (constitution.refusal()) return false;", "", 1],
  ["owner reservation mutates protected constitution source", firewall, "raw.exactFiles.some((file) => constitution.protectsPath(file))", "false", 2],
  ["scheduler reserves before verifying constitution", "src/lib/brain/autonomy/AyasResearchScheduler.ts", "if (refusal) throw new Error(refusal);", "", 1],
  ["light run ignores own digest", light, "if (refusal) throw new Error(refusal);", "", 1],
  ["deep run ignores own digest", deep, "if (refusal) throw new Error(refusal);", "", 1],
  ["light run ignores parent revocation", light, "deps.admitEffect?.();", "", 1],
  ["deep run ignores parent revocation", deep, "deps.admitEffect?.();", "", 1],
  ["HTTP retry/redirect ignores admission", "src/lib/brain/autonomy/AyasSafePublicFetch.ts", "options.admitRequest?.();", "", 1],
  ["observer dispatches after changed digest", "scripts/ayas-autonomy-daemon.ts", "if (constitutionRefusal) {", "if (false) {", 1],
  ["durable operator enqueues under invalid constitution", "scripts/ayas-durable-task-recovery.ts", "if (refusal) {", "if (false) {", 1],
  ["owner RAM admission threshold ignored", "src/lib/ayas/machine/AyasMachineHealthGuard.ts", "if (!workload.ownedActive && telemetry.ramUsedPercent >= maxRamAdmissionPercent)", "if (false)", 1],
  ["invalid RAM policy permits heavy work", "src/lib/ayas/machine/AyasMachineHealthGuard.ts", "if (!Number.isSafeInteger(maxRamAdmissionPercent) || maxRamAdmissionPercent < 1 || maxRamAdmissionPercent > 99)", "if (false)", 1],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const name of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[name]) env[name] = process.env[name];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
try {
  copy(test); copy("scripts/ayas-autonomy-daemon.ts"); copy("scripts/ayas-durable-task-recovery.ts"); copy("tsconfig.json");
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr + baseline.stdout);
  for (const [name, file, before, after, expected] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, expected, `${name}: exact mutation`);
    fs.writeFileSync(target, original.split(before).join(after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`); assert.match(result.stderr, /AssertionError/, `${name}: must fail an assertion, not imports/syntax`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15N constitution run-binding mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-binding-audit-")); fs.rmSync(temp, { recursive: true, force: true }); }
