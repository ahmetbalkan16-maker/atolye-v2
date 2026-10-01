/** Historical evaluator pin controls: mutate copied code, preserve the real registry and Git. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-lifecycle-revision-audit-"));
const copied = new Set<string>(); const test = "scripts/smoke-ayas-lifecycle.ts";
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file);
  const source = fs.readFileSync(path.join(repo, file), "utf8"); const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), match[1]!);
    const found = [base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((file) => fs.existsSync(file));
    if (found) { const relative = path.relative(repo, found); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const contract = "src/lib/ayas/lifecycle/AyasLifecycle.ts";
const verifier = "src/lib/ayas/lifecycle/AyasLifecycleVerifier.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["historical-admission-allowed", contract, '(entry.admission !== "NONE" || !["PINNED", "RETIRED"].includes(entry.state))', "false"],
  ["historical-serving-attested", verifier, 'identity.revision !== undefined && (entry.admission !== "NONE" || !["PINNED", "RETIRED"].includes(entry.state))', "false"],
  ["historical-revision-ignored", verifier, "computeAyasLifecycleSourceDigest(options.repoRoot, identity.files, identity.revision, options.readHistoricalSource)", "computeAyasLifecycleSourceDigest(options.repoRoot, identity.files)"],
  ["unavailable-object-called-match", verifier, 'status: "ABSENT", detail: identity.revision ?', 'status: "MATCH", detail: identity.revision ?'],
  ["mutable-revision-accepted", verifier, 'revision !== undefined && !/^[a-f0-9]{40}$/.test(revision)', "false"],
];
const run = () => spawnSync(process.execPath, ["--import", "tsx", path.join(temp, test)], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 30_000 });
try {
  fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ type: "module" }));
  copy(test); const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const source = fs.readFileSync(target, "utf8");
    assert.equal(source.split(before).length - 1, 1, `${id}: exact anchor`);
    fs.writeFileSync(target, source.replace(before, after)); const result = run(); fs.writeFileSync(target, source);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: assertion rejection required`);
  }
  console.log(`Lifecycle revision audit: PASS (${mutants.length}/${mutants.length} caught; TEMP only)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-lifecycle-revision-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
