/** Negative controls for the Stage15N owner-only constitution. Only TEMP copies change. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "owner-constitution-audit-"));
const test = "scripts/smoke-ayas-owner-constitution.ts"; const file = "src/lib/ayas/governance/AyasOwnerConstitution.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!; const base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const mutants: readonly (readonly [string, string, string, string])[] = [
  [
    "owner session bypass",
    "store",
    "gate.mode !== \"enforced\" || !gate.key || !await verifySession(input.ownerSession, gate.key, now())",
    "false"
  ],
  [
    "no recheck of previous active digest",
    "store",
    "|| (current.state === \"ACTIVE\" ? current.digest : null) !== input.expectedPreviousDigest",
    ""
  ],
  [
    "replay sequence guard removed",
    "store",
    "|| policy.version !== (current.state === \"ACTIVE\" ? current.policy.version + 1 : 1)",
    ""
  ],
  [
    "owner signer silently changes",
    "store",
    "if (current.state === \"ACTIVE\" && current.publicKeyFingerprint !== constitutionDigest(publicKeyDer))",
    "if (false)"
  ],
  [
    "signature ignored",
    "reader",
    "if (!verify(null, constitutionSignatureBytes(body), key, Buffer.from(signature, \"hex\")))",
    "if (false)"
  ],
  [
    "repository root not bound",
    "reader",
    "trust.repositoryRootDigest !== repositoryRootDigest || ",
    ""
  ],
  [
    "empty adopted root returns missing",
    "reader",
    "if (!files.length || files.length > 1000",
    "if (!files.length) return { state: \"MISSING\", reason: \"mutant bootstrap fallback\" }; if (files.length > 1000"
  ],
  [
    "version chain skips allowed",
    "reader",
    "record.policy.version !== index + 1 || files[index] !== `${index + 1}.json` || ",
    ""
  ],
  [
    "policy digest ignored",
    "reader",
    "|| record.policyDigest !== constitutionDigest(record.policy)",
    ""
  ],
  [
    "active change ignored",
    "reader",
    "state.digest === current.digest ? undefined : \"AYAS_CONSTITUTION_CHANGED\"",
    "undefined"
  ],
  [
    "unverifiable policy permits new work",
    "reader",
    "if (state.state !== \"ACTIVE\" || current.state !== \"ACTIVE\") return \"AYAS_CONSTITUTION_UNAVAILABLE\";",
    "if (state.state !== \"ACTIVE\" || current.state !== \"ACTIVE\") return undefined;"
  ],
  [
    "self promotion permitted",
    "policy",
    "r.selfPromotion === false",
    "true"
  ],
  [
    "autonomous spend allowed",
    "policy",
    "r.autonomousSpendUsd === 0",
    "true"
  ],
  [
    "protected paths ignored",
    "policy",
    "AYAS_CONSTITUTION_PROTECTED_PATHS.every((p) => paths.includes(p))",
    "true"
  ],
  [
    "UI cookie guard bypass",
    "action",
    "gate.mode !== \"enforced\" || !gate.key || !await verifySession(session, gate.key)",
    "false"
  ],
  [
    "UI exact reviewed digest ignored",
    "action",
    "form.get(\"proposalDigest\") !== constitutionDigest(proposal) || ",
    ""
  ],
  [
    "UI owner fields interpreted",
    "action",
    "|| [...form.keys()].some((key) => key !== \"proposalDigest\")",
    ""
  ],
  [
    "adoption state visible to git",
    "ignore",
    "/data/brain/owner-constitution/",
    ""
  ],
  // Only Windows has a second spelling of one directory, so only there can the control be caught.
  ...(process.platform === "win32" ? [[
    "caller spelling decides the bound repository",
    "reader",
    "fs.realpathSync.native(repoRoot)",
    "fs.realpathSync(repoRoot)"
  ] as const] : [])
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
try {
  copy(test); copy("app/brain/constitution/actions.ts"); copy("tsconfig.json"); copy(".gitignore"); fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [name, module, before, after] of mutants) {
    const files: Record<string,string> = {policy:file,reader:"src/lib/ayas/governance/AyasOwnerConstitutionReader.ts",store:"src/lib/ayas/governance/AyasOwnerConstitutionStore.ts",action:"app/brain/constitution/actions.ts",ignore:".gitignore"};
    const target = path.join(temp, files[module]); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`); fs.writeFileSync(target, original.replace(before, () => after)); const r = run(); fs.writeFileSync(target, original);
    assert.equal(r.signal, null, `${name}: timeout`); assert.notEqual(r.status, 0, `${name}: survived`); assert.match(r.stderr, /AssertionError/, `${name}: assertion not syntax/import failure`);
  }
  // Removing the explicit empty-list check alone is safety-equivalent: final.policy throws and the reader returns UNAVAILABLE.
  { const target=path.join(temp, "src/lib/ayas/governance/AyasOwnerConstitutionReader.ts");const original=fs.readFileSync(target,"utf8");const before="if (!files.length || files.length > 1000";assert.equal(original.split(before).length-1,1);fs.writeFileSync(target,original.replace(before,"if (files.length > 1000"));const r=run();fs.writeFileSync(target,original);assert.equal(r.status,0,r.stderr); }
  console.log(`Stage15N owner constitution mutation audit: PASS (${mutants.length}/${mutants.length} caught; 1 safety-equivalent control)`);
} finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("owner-constitution-audit-")); fs.rmSync(temp, { recursive: true, force: true }); }
