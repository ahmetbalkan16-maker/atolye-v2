/** Negative controls for the Stage 15O.3 golden historical-video projects. Only a TEMP copy changes; the repository is read. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-golden-video-audit-")); const link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-golden-video-projects.ts"; const projects = "scripts/fixtures/ayas-golden-video-projects.ts"; const expected = "scripts/fixtures/ayas-golden-video-projects-expected.ts";
const renderer = "src/lib/character/SvgSceneRenderer.ts"; const rig = "src/lib/character/CharacterRig.ts"; const manifest = "src/lib/character/CharacterSceneManifest.ts";
const facts = "src/lib/storytelling/HistoricalFactPack.ts"; const narrative = "src/lib/storytelling/NarrativeContract.ts";
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
// The first frozen output digest, with one hexadecimal digit changed: found in the file, not written here, so it follows a new vault version.
const firstOutputDigest = /outputDigest: "([a-f0-9]{64})"/.exec(fs.readFileSync(path.join(repo, expected), "utf8"))?.[1];
assert.ok(firstOutputDigest, "no frozen output digest");
const mutants: readonly (readonly [string, string, string, string])[] = [
  // What the engines draw: any change of the rendered bytes is seen.
  ["the ground line moves", renderer, "const GROUND_FRONT = 900;", "const GROUND_FRONT = 904;"],
  ["the ink colour changes", renderer, "const INK = \"#1c1c1c\";", "const INK = \"#1c1c1d\";"],
  ["the figure's head grows", rig, "headRadius: 38,", "headRadius: 39,"],
  // What a scene says about itself.
  ["a documentary scene is not labelled", manifest, "const labelled = request.format === \"DOCUMENTARY\" || request.claimIds.length > 0 || request.blocking.caption !== null;", "const labelled = false;"],
  ["a drawn scene is called evidence", manifest, "origin: \"GENERATED\", synthetic: true, evidenceValue: \"NONE\",", "origin: \"GENERATED\", synthetic: true, evidenceValue: \"PRIMARY\" as never,"],
  ["a manifest that calls itself evidence verifies", manifest, " || c.evidenceValue !== \"NONE\") problems.push(\"CLASSIFICATION\");", ") problems.push(\"CLASSIFICATION\");"],
  // What may be narrated.
  ["a disputed claim may be told as fact", facts, "else if (state === \"SUPPORTED_UNCERTAIN\" && !HEDGES.some((hedge) => said.includes(hedge))) findings.push({ code: \"UNCERTAINTY_NOT_STATED\", severity: \"MAJOR\", unitId: unit.id, subject: claim.id });", ""],
  ["a year needs no claim", facts, "if (mapped.some((claim) => usable(claim) && yearsOf(claim).includes(year))) continue;", "continue;"],
  ["a claim without a source is supported", facts, "if (resolved.length === 0 || claim.certainty === \"UNKNOWN\") return \"UNSUPPORTED\";", "if (claim.certainty === \"UNKNOWN\") return \"UNSUPPORTED\";"],
  ["an unknown name passes", facts, "if (!vocabulary.has(lower(name))) findings.push({ code: \"NAME_WITHOUT_CLAIM\", severity: \"REVIEW\", unitId: unit.id, subject: name });", ""],
  // The shape of the story.
  ["the beats may come in any order", narrative, "if (to < from && !unit.outOfSequence) add(\"BEAT_ORDER_BREAK\"", "if (to < from && unit.outOfSequence) add(\"BEAT_ORDER_BREAK\""],
  ["a question may stay open", narrative, "for (const [label, unitId] of open) add(\"UNRESOLVED_SETUP\", \"MAJOR\", unitId, label);", ""],
  ["a superlative needs no supported claim", narrative, "if (supported) continue;", "continue;"],
  // The golden data itself.
  ["a golden project is edited: a disputed claim becomes established", projects, "[\"dukas\", \"runciman\"], \"DISPUTED\"),", "[\"dukas\", \"runciman\"]),"],
  ["a golden project is edited: one second of one unit", projects, ", 70, 1453, [\"zincir\"]", ", 71, 1453, [\"zincir\"]"],
  ["a golden project is edited: one scene's time of day", projects, "backdrop: \"SEA\", time: \"DUSK\", caption: \"Haliç, 1453\"", "backdrop: \"SEA\", time: \"NIGHT\", caption: \"Haliç, 1453\""],
  ["a frozen digest is edited", expected, `outputDigest: "${firstOutputDigest}"`, `outputDigest: "${firstOutputDigest[0] === "0" ? "1" : "0"}${firstOutputDigest.slice(1)}"`],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
try {
  copy(test); copy("tsconfig.json");
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 2000));
  for (const [name, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    // Caught by a check of the suite, not by the mutated file failing to load.
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 400)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: must fail an assertion: ${result.stderr.slice(0, 400)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15O golden video projects mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  // The junction goes first, so the recursive removal can never follow it into the real node_modules.
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-golden-video-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
