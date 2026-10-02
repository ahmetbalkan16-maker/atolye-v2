/** Stage 15S negative controls: mutate only a copied source closure in an owned gitless TEMP root. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-portable-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-portable-brain.ts", brain = "src/lib/ayas/migration/AyasPortableBrain.ts";
const store = "src/lib/ayas/migration/AyasPortableBrainStore.ts", migration = "src/lib/ayas/migration/AyasPortableMigration.ts", safety = "src/lib/brain/selfheal/BrainPatchSafety.ts";
const artifacts = "src/lib/ayas/migration/AyasPortableArtifacts.ts";
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
/** Each removal weakens a real contract; its existing scenario must fail with an assertion, not a loader error. */
const mutants: readonly (readonly [string, string, string, string, number])[] = [
  ["portable module rewrites itself", safety, 'p.toLowerCase().startsWith("src/lib/ayas/migration/")', "false", 1],
  ["operator rewrites itself", safety, '  "scripts/ayas-portable-brain.ts",\n', "", 1],
  ["grader rewrites itself", safety, '  "scripts/smoke-ayas-portable-brain.ts",\n', "", 1],
  ["unknown payload fields accepted", brain, '!exact(raw, ["schemaVersion", "sourceHead", "createdAt", "disposition", "sections", "entries", "runtime"])', "false", 2],
  ["missing section inventory accepted", brain, "raw.sections.length !== AYAS_PORTABLE_SECTIONS.length", "false", 2],
  ["empty PRESENT section accepted", brain, '(state === "PRESENT") !== raw.entries.some(e => e.section === s)', "false", 2],
  ["secret and authority fields accepted", brain, "FORBIDDEN_KEY.test(key)", "false", 3],
  ["accessor or hidden JSON fields accepted", brain, 'Reflect.ownKeys(v).length !== Object.keys(v).length || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !Object.hasOwn(d, "value"))', "false", 3],
  ["reserved Windows entry accepted", brain, " || RESERVED_ID.test(e.id)", "", 4],
  ["duplicate entry accepted", brain, "ids.has(e.id)", "false", 4],
  ["mutable artifact identity accepted", brain, "!a.immutableIdentity.includes(a.sha256)", "false", 5],
  ["background heavy concurrency widened", brain, "p.maxHeavyWorkloads !== 1", "false", 5],
  ["automatic WSL shutdown accepted", brain, "p.automaticWslShutdown !== false", "false", 5],
  ["Podman rebuild without pins", brain, 'a.transfer === "REBUILD_PINNED_IMAGE" && a.rebuildInputs.length === 0', "false", 6],
  ["encryption randomness removed", brain, "const salt = randomBytes(32), iv = randomBytes(12), key = keyFor(passphrase, salt);", "const salt = Buffer.alloc(32), iv = Buffer.alloc(12), key = keyFor(passphrase, salt);", 7],
  ["short passphrase accepted", brain, "Buffer.byteLength(passphrase) < 24", "false", 7],
  ["cipher option ignored", brain, 'raw.cipher !== "AES-256-GCM"', "false", 9],
  ["unknown envelope fields accepted", brain, '!exact(raw, ["schemaVersion", "cipher", "kdf", "manifestDigest", "salt", "iv", "tag", "ciphertext"])', "false", 9],
  ["post-restore bytes unchecked", store, "fs.lstatSync(file).isSymbolicLink() || hash(fs.readFileSync(file)) !== e.sha256", "false", 11],
  ["unexpected restored file accepted", store, "JSON.stringify(actualFiles.sort()) !== JSON.stringify(files.sort())", "false", 11],
  ["owner export gate bypassed", store, 'gate.mode !== "enforced" || !gate.key || !await verifySession(input.ownerSession, gate.key, now())', "false", 12],
  ["reviewed digest ignored", store, "digest !== input.expectedManifestDigest", "false", 12],
  ["source HEAD ignored", store, 'readAyasGit(root, ["rev-parse", "HEAD"]).trim() !== manifest.sourceHead', "false", 13],
  ["dirty source tree accepted", store, 'readAyasGit(root, ["status", "--porcelain=v1", "-z"]).trim() !== ""', "false", 13],
  ["archive overwrite allowed", store, "fs.linkSync(pending, file);", "fs.copyFileSync(pending, file);", 14],
  ["approval history becomes executable", migration, 'importedApprovalUse: "HISTORICAL_ONLY_NEVER_EXECUTABLE"', 'importedApprovalUse: "EXECUTABLE"', 15],
  ["missing checks treated as PASS", migration, 'e?.state ?? "NOT_RUN"', 'e?.state ?? "PASS"', 16],
  ["ordered prerequisites ignored", migration, 'if (predecessorHeld && state === "PASS")', "if (false)", 16],
  ["stale HEAD or hardware accepted", migration, "e.manifestDigest !== context.expectedManifestDigest || e.destinationHead !== context.destinationHead || e.hardwareFingerprint !== context.hardwareFingerprint", "false", 17],
  ["synthetic benchmark accepted on destination", migration, 'context.mode === "DESTINATION" && e?.evidenceClass === "DETERMINISTIC_TEST"', "false", 18],
  ["duplicate evidence accepted", migration, "seen.has(e.check)", "false", 19],
  ["artifact bytes hash ignored", artifacts, 'hash.digest("hex") !== a.sha256', "false", 21],
  ["unexecuted image rebuild accepted", artifacts, 'a.transfer === "REBUILD_PINNED_IMAGE"', "false", 22],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (selected?: number) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected === undefined ? env : { ...env, AYAS_PORTABLE_MUTATION_CASE: String(selected) }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 });
try {
  for (const file of [test, "scripts/ayas-portable-brain.ts", "tsconfig.json", "package.json", ".gitignore"]) copy(file);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after, selected] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    let result: ReturnType<typeof run>;
    try { fs.writeFileSync(target, original.replace(before, () => after)); result = run(selected); } finally { fs.writeFileSync(target, original); }
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 500)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${result.stderr.slice(0, 500)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15S portable brain mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase());
  assert.ok(path.basename(temp).startsWith("ayas-portable-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
