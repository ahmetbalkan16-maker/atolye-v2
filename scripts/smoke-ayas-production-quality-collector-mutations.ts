/** Negative controls for the Stage 15M physical collection and package. Only TEMP copies change. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "quality-collector-audit-"));
const test = "scripts/smoke-ayas-production-quality-collector.ts"; const file = "src/lib/production/ProductionQualityCollector.ts";
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
    "file digest ignored",
    "collector",
    "if (digest === file.sha256)",
    "if (true)"
  ],
  [
    "byte length ignored",
    "collector",
    "if (stored.stat.size !== file.byteLength) continue;",
    ""
  ],
  [
    "duplicate file accepted",
    "collector",
    "|| seen.has(file.fileName)",
    ""
  ],
  [
    "unsafe file name accepted",
    "collector",
    "!ALLOWED.has(file.fileName) || ",
    ""
  ],
  [
    "manifest checksum ignored",
    "collector",
    "|| qualityBytesDigest(canonicalAyasJson(body)) !== checksum",
    ""
  ],
  [
    "manifest project identity ignored",
    "collector",
    "manifest.slug !== input.projectSlug || ",
    ""
  ],
  [
    "current HEAD ignored",
    "collector",
    "b.repositoryHead === head && ",
    ""
  ],
  [
    "post-probe bytes not checked",
    "collector",
    "if (await digestFile(file.realPath) !== file.digest)",
    "if (false)"
  ],
  [
    "manifest replacement ignored",
    "collector",
    "if (!fs.readFileSync(manifestFile.realPath).equals(bytes))",
    "if (false)"
  ],
  [
    "duration mismatch passes",
    "collector",
    "&& Math.abs(probe.container.durationSeconds - basis.expectedDurationSeconds) <= Math.max(1, basis.expectedDurationSeconds * .01)",
    ""
  ],
  [
    "audio codec ignored",
    "collector",
    "&& probe.audio?.codec === \"aac\"",
    ""
  ],
  [
    "container ignored",
    "collector",
    "probe.container.format.split(\",\").includes(\"mp4\") && ",
    ""
  ],
  [
    "resolution matches itself",
    "collector",
    "probe.video?.height === basis.intendedResolution.height",
    "probe.video?.height === probe.video?.height"
  ],
  [
    "subtitle overrun ignored",
    "collector",
    "&& end <= probe.container.durationSeconds + Math.max(1, probe.container.durationSeconds * .01)",
    ""
  ],
  [
    "subtitle overlap ignored",
    "collector",
    "start >= previousEnd && ",
    ""
  ],
  [
    "invalid timestamp accepted",
    "collector",
    "if (!Number.isFinite(h) || m < 0 || m >= 60 || s < 0 || s >= 60) return NaN;",
    ""
  ],
  [
    "quality intent not revision-bound",
    "collector",
    "declaredFacts: basis.factsDigest, basisDigest: basisFile.digest",
    "declaredFacts: basis.factsDigest, basisDigest: \"constant\""
  ],
  [
    "title control characters accepted",
    "builder",
    "|| /[\\u0000-\\u001f\\u007f-\\u009f]/u.test(title)",
    ""
  ],
  [
    "wrong project cost receipt accepted",
    "builder",
    "|| receipt.projectSlug !== input.projectSlug",
    ""
  ],
  [
    "unknown rights promoted",
    "collector",
    "rightsGate: \"UNKNOWN\"",
    "rightsGate: \"PASS\""
  ]
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
try {
  copy(test); copy("tsconfig.json"); fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr); 
  for (const [name, module, before, after] of mutants) {
    const target = path.join(temp, module === "collector" ? file : "src/lib/export/YouTubeReadyPackage.ts"); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`); fs.writeFileSync(target, original.replace(before, () => after)); const r = run(); fs.writeFileSync(target, original);
    assert.equal(r.signal, null, `${name}: timeout`); assert.notEqual(r.status, 0, `${name}: survived`); assert.match(r.stderr, /AssertionError/, `${name}: assertion not syntax/import failure`);
  }
  console.log(`Stage 15M quality collector mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("quality-collector-audit-")); fs.rmSync(temp, { recursive: true, force: true }); }
