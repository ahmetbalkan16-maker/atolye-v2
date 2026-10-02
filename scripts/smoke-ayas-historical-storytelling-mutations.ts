/** Reproducible Stage 15J negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-storytelling-audit-"));
const test = "scripts/smoke-ayas-historical-storytelling.ts";
const copied = new Set<string>();
/** Copies a module and everything it imports by relative path or by the `@/` alias. */
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
  if (!/\.tsx?$/.test(file)) return;
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}

const fact = "src/lib/storytelling/HistoricalFactPack.ts";
const narrative = "src/lib/storytelling/NarrativeContract.ts";
const manifest = "src/lib/character/CharacterSceneManifest.ts";
const renderer = "src/lib/character/SvgSceneRenderer.ts";
const blocking = "src/lib/character/SceneBlocking.ts";
const rasterizer = "src/lib/character/CharacterSceneRasterizer.ts";
const cli = "scripts/ayas-character-scene.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["unsourced-claim-supported", fact, 'if (resolved.length === 0 || claim.certainty === "UNKNOWN") return "UNSUPPORTED";', 'if (claim.certainty === "UNKNOWN") return "UNSUPPORTED";'],
  ["unknown-certainty-supported", fact, 'if (resolved.length === 0 || claim.certainty === "UNKNOWN") return "UNSUPPORTED";', 'if (resolved.length === 0) return "UNSUPPORTED";'],
  ["legend-told-as-fact", fact, 'return claim.certainty === "ESTABLISHED" || claim.certainty === "PROBABLE" ? "SUPPORTED" : "SUPPORTED_UNCERTAIN";', 'return "SUPPORTED";'],
  ["source-that-is-not-in-the-pack-accepted", fact, "if ((claim.sourceIds as string[]).some((id) => !sourceIds.has(id))) problems.push(", "if (false) problems.push("],
  ["claim-id-twice-accepted", fact, "!ID.test(claim.id) || claimIds.has(claim.id) ||", "!ID.test(claim.id) ||"],
  ["unsupported-claim-only-reviewed", fact, 'findings.push({ code: "CLAIM_UNSUPPORTED_NARRATED", severity: "BLOCKER"', 'findings.push({ code: "CLAIM_UNSUPPORTED_NARRATED", severity: "REVIEW"'],
  ["year-without-claim-only-reviewed", fact, ': { code: "DATE_WITHOUT_CLAIM", severity: "BLOCKER", unitId: unit.id, subject: year });', ': { code: "DATE_WITHOUT_CLAIM", severity: "REVIEW", unitId: unit.id, subject: year });'],
  ["year-of-an-unsupported-claim-accepted", fact, 'const usable = (claim: HistoricalFactClaim) => evidence.get(claim.id) !== "UNSUPPORTED";', "const usable = (claim: HistoricalFactClaim) => claim.id.length > 0;"],
  ["count-read-as-a-year", fact, "if (match[2] && COUNT_NOUNS.has(lower(match[2]))) continue;", "if (false) continue;"],
  ["legend-needs-no-hedge", fact, 'else if (state === "SUPPORTED_UNCERTAIN" && !HEDGES.some(', 'else if (state === "NEVER" && !HEDGES.some('],
  ["sentence-opener-counted-as-a-name", fact, "if (index === 0 || word.length < 3 ||", "if (word.length < 3 ||"],
  ["undeclared-beat-silent", narrative, 'if (!unit.beat) add("BEAT_NOT_DECLARED", "REVIEW", unit.id,', 'if (false) add("BEAT_NOT_DECLARED", "REVIEW", unit.id,'],
  ["missing-beat-silent", narrative, 'if (!declared.some((unit) => unit.beat === beat)) add("BEAT_MISSING"', 'if (false) add("BEAT_MISSING"'],
  ["beat-order-ignored", narrative, 'if (to < from && !unit.outOfSequence) add("BEAT_ORDER_BREAK"', 'if (false) add("BEAT_ORDER_BREAK"'],
  ["chronology-ignored", narrative, "unit.year < previous.year && !unit.outOfSequence) add(", "false) add("],
  ["declared-flashback-still-a-break", narrative, "unit.year < previous.year && !unit.outOfSequence) add(", "unit.year < previous.year) add("],
  ["abrupt-transition-ignored", narrative, 'if (to > from + 1 && !unit.transition?.trim()) add("ABRUPT_TRANSITION"', 'if (false) add("ABRUPT_TRANSITION"'],
  ["too-long-story-accepted", narrative, "(totalSeconds < NARRATIVE_POLICY.minTotalSeconds || totalSeconds > NARRATIVE_POLICY.maxTotalSeconds)", "(totalSeconds < NARRATIVE_POLICY.minTotalSeconds)"],
  ["repeated-claim-ignored", narrative, 'if (first !== undefined) add("REPEATED_FACT", "REVIEW", unit.id, `claim', 'if (false) add("REPEATED_FACT", "REVIEW", unit.id, `claim'],
  ["long-exposition-ignored", narrative, "if (beatSeconds.CONTEXT > 0 && beatSeconds.CONTEXT > beatSeconds.ESCALATION + beatSeconds.TURNING_POINT) {", "if (false) {"],
  ["unresolved-setup-ignored", narrative, 'for (const [label, unitId] of open) add("UNRESOLVED_SETUP", "MAJOR", unitId, label);', "void open;"],
  ["legend-carries-a-superlative", narrative, 'classifyFactEvidence(claim, factPack) === "SUPPORTED"; }) : false;', 'classifyFactEvidence(claim, factPack) !== "UNSUPPORTED"; }) : false;'],
  ["unsupported-drama-only-reviewed", narrative, 'add("UNSUPPORTED_DRAMATIC_CLAIM", factPack ? "BLOCKER" : "MAJOR"', 'add("UNSUPPORTED_DRAMATIC_CLAIM", factPack ? "REVIEW" : "MAJOR"'],
  ["long-static-image-ignored", narrative, "if (staticSeconds(unit) > NARRATIVE_POLICY.maxStaticSecondsPerUnit) add(", "if (false) add("],
  ["mostly-static-story-ignored", narrative, "if (totalSeconds > 0 && staticVisualSeconds > totalSeconds / 2) add(", "if (false) add("],
  ["documentary-scene-unlabelled", manifest, 'const labelled = request.format === "DOCUMENTARY" || request.claimIds.length > 0 || request.blocking.caption !== null;', "const labelled = request.claimIds.length > 0 || request.blocking.caption !== null;"],
  ["scene-of-a-claim-unlabelled", manifest, 'const labelled = request.format === "DOCUMENTARY" || request.claimIds.length > 0 || request.blocking.caption !== null;', 'const labelled = request.format === "DOCUMENTARY" || request.blocking.caption !== null;'],
  ["scene-called-evidence", manifest, 'origin: "GENERATED", synthetic: true, evidenceValue: "NONE",', 'origin: "GENERATED", synthetic: true, evidenceValue: "ILLUSTRATIVE" as "NONE",'],
  ["edited-classification-accepted", manifest, '|| c.synthetic !== true || c.evidenceValue !== "NONE") problems.push("CLASSIFICATION");', ') problems.push("CLASSIFICATION");'],
  ["edited-image-accepted", manifest, 'if (manifest.svgSha256 !== sha256(svg) || manifest.svgBytes !== Buffer.byteLength(svg, "utf8")) problems.push(', "if (false) problems.push("],
  ["unlabelled-documentary-verified", manifest, 'if (format === "DOCUMENTARY" && (c?.reenactmentLabel !== "VISIBLE_IN_IMAGE" || !labelInImage)) problems.push(', "if (false) problems.push("],
  ["image-of-another-scene-accepted", manifest, 'if (expected !== svg) problems.push("SVG_NOT_FROM_BLOCKING");', 'if (false) problems.push("SVG_NOT_FROM_BLOCKING");'],
  ["unknown-request-field-accepted", manifest, 'if (Object.keys(request).some((key) => !keys.includes(key))) problems.push("REQUEST_UNKNOWN_FIELD");', 'if (false) problems.push("REQUEST_UNKNOWN_FIELD");'],
  ["caption-written-unescaped", renderer, 'fill="#ffffff">${xml(blocking.caption)}</text>', 'fill="#ffffff">${blocking.caption}</text>'],
  ["invalid-blocking-drawn", renderer, "if (problems.length) throw new Error(`CHARACTER_SCENE_BLOCKING_INVALID", "if (false) throw new Error(`CHARACTER_SCENE_BLOCKING_INVALID"],
  ["label-left-out-of-the-image", renderer, 'const label = options.reenactmentLabel === null ? "" :', 'const label = options.reenactmentLabel !== undefined ? "" :'],
  ["far-figures-drawn-over-near-ones", renderer, ".sort((a, b) => b.depth - a.depth || a.order - b.order);", ".sort((a, b) => a.depth - b.depth || a.order - b.order);"],
  ["unknown-blocking-field-accepted", blocking, "=> Object.keys(value).every((key) => keys.includes(key)) && keys.every(", "=> keys.every("],
  ["position-off-the-stage-accepted", blocking, "Number.isFinite(value) && value >= 0 && value <= 1;", "Number.isFinite(value) && value >= 0;"],
  ["character-id-twice-accepted", blocking, "!/^[a-z0-9][a-z0-9-]{0,39}$/.test(character.id) || ids.has(character.id) ||", "!/^[a-z0-9][a-z0-9-]{0,39}$/.test(character.id) ||"],
  ["svg-that-reaches-outside-rasterized", rasterizer, '<= MAX_SVG_BYTES && !OUTSIDE.test(svg);', "<= MAX_SVG_BYTES;"],
  ["oversized-svg-rasterized", rasterizer, 'Buffer.byteLength(svg, "utf8") <= MAX_SVG_BYTES && ', ""],
  ["png-of-another-size-returned", rasterizer, 'resize(CHARACTER_SCENE_WIDTH, CHARACTER_SCENE_HEIGHT, { fit: "fill" })', 'resize(960, 540, { fit: "fill" })'],
  ["kneeling-figure-sinks-into-the-ground", "src/lib/character/CharacterRig.ts", "const hip: Point = { x: ground.x, y: ground.y - drop };", "const hip: Point = { x: ground.x, y: ground.y - (rig.upperLeg + rig.lowerLeg) * scale };"],
  ["camera-beat-outside-the-motion-plan", "src/lib/character/CameraBeat.ts", 'PUSH_IN: "zoom-in",', 'PUSH_IN: "dolly-in" as "zoom-in",'],
  ["existing-scene-overwritten", cli, '{ flag: "wx" }', "{}"],
  ["unknown-flag-accepted", cli, 'else if (SWITCHES.has(arg)) switches.add(arg);\n    else throw new Error("CHARACTER_SCENE_ARGUMENTS_INVALID");', "else switches.add(arg);"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
try {
  // The suite reads the master order, lists the character folder and starts the operator script by path.
  for (const file of [test, cli, "src/lib/character/CharacterRig.ts", "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md", "package.json", "tsconfig.json"]) copy(file);
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  // The image library has to be present here: otherwise the rasterizer controls below would be caught for the wrong reason.
  assert.ok(!baseline.stdout.includes("rasterizer: UNAVAILABLE"), "the rasterizer was not measured on this machine");
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.copyFileSync(path.join(repo, file), target);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.ok(fs.readFileSync(path.join(temp, file)).equals(fs.readFileSync(path.join(repo, file))), "the repository source was read, never written");
  console.log(`Stage 15J historical storytelling mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-storytelling-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
