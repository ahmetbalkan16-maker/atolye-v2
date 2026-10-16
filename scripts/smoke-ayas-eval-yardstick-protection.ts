/**
 * Stage 15F — eval-pinned suites are part of the yardstick: no AYAS lane may draft, approve or execute a change to them.
 *
 * e79162fe (an owner-approved, AYAS-applied improvement) added assertion messages to the eval-pinned
 * `scripts/smoke-ayas-chat-stream-client.ts`; the classifier called it SAFE as an ordinary smoke script, nothing bumped
 * its pin and the CF49 CI gate went red. This oracle proves every pin of the manifest of record is FORBIDDEN_AUTONOMOUS
 * in any spelling, that the literal list holds exactly the pins no other rule forbids (so an existing protection stays
 * the single one its mutation audit removes), and that the bare-assertion generator never proposes a pin. Reads the
 * repository's own manifest; every write is TEMP. No network, model or production state.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AYAS_EVAL_PINNED_FILES } from "../src/lib/ayas/observability/AyasEvalPinnedFiles";
import { checkAyasNovelPatchLimits, findAyasBareAssertionGaps } from "../src/lib/brain/autonomy/AyasPatchDetectors";
import { classifyPatchSet, classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";

const MANIFEST = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
const UNPINNED = "scripts/smoke-ayas-unpinned-yardstick-example.ts";
const EVAL_PIN_WHY = /^an eval-pinned suite \(the eval yardstick/;
let scenarios = 0;
const scenario = (name: string, run: () => void) => { run(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`); };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-eval-yardstick-smoke-"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { suites: { pins: { file: string }[] }[] };
const pinned = [...new Set(manifest.suites.flatMap((suite) => suite.pins.map((pin) => pin.file)))].sort();
const verdicts = (file: string) => [file, file.toUpperCase(), `./${file.replace(/\//g, "\\")}`].map((spelling) => classifyPatchTarget(spelling));
const reliesOnEvalPin = (file: string) => verdicts(file).some((verdict) => EVAL_PIN_WHY.test(verdict.why));

try {
  scenario("every file the manifest pins is FORBIDDEN_AUTONOMOUS in any path spelling", () => {
    assert.ok(pinned.length > 0, "the manifest pins at least one file");
    const unprotected = pinned.filter((file) => verdicts(file).some((verdict) => verdict.level !== "FORBIDDEN_AUTONOMOUS"));
    assert.deepEqual(unprotected, [], `pinned by ${MANIFEST} but autonomous — add them to AyasEvalPinnedFiles`);
  });

  scenario("the list holds exactly the pins no other rule forbids, sorted and without duplicates", () => {
    const listed = new Set(AYAS_EVAL_PINNED_FILES);
    assert.equal(listed.size, AYAS_EVAL_PINNED_FILES.length, "AyasEvalPinnedFiles has duplicate entries");
    assert.deepEqual([...AYAS_EVAL_PINNED_FILES], [...AYAS_EVAL_PINNED_FILES].sort(), "AyasEvalPinnedFiles is not sorted");
    assert.deepEqual(AYAS_EVAL_PINNED_FILES.filter((file) => !pinned.includes(file)), [], `listed in AyasEvalPinnedFiles but not pinned by ${MANIFEST} — remove them`);
    // The eval-pin reason appears only where no rule forbade that spelling first: such an entry is needed, and a listed
    // file another rule forbids in every spelling is a second protection that would let a mutation audit's removal survive.
    assert.deepEqual(AYAS_EVAL_PINNED_FILES.filter((file) => !reliesOnEvalPin(file)), [], "already forbidden by another rule in every spelling — remove them from AyasEvalPinnedFiles");
    assert.deepEqual(pinned.filter((file) => !listed.has(file) && reliesOnEvalPin(file)), [], "unexpected eval-pin reason outside the list");
  });

  scenario("the regression of e79162fe: the eval-pinned chat stream smoke is no longer an ordinary SAFE smoke", () => {
    assert.ok(AYAS_EVAL_PINNED_FILES.includes("scripts/smoke-ayas-chat-stream-client.ts"), "the e79162fe target is listed");
    const verdict = classifyPatchTarget("scripts/smoke-ayas-chat-stream-client.ts");
    assert.equal(verdict.level, "FORBIDDEN_AUTONOMOUS");
    assert.match(verdict.why, EVAL_PIN_WHY);
  });

  scenario("the pin list, this oracle and the manifest are themselves protected yardstick files", () => {
    for (const file of ["src/lib/ayas/observability/AyasEvalPinnedFiles.ts", "scripts/smoke-ayas-eval-yardstick-protection.ts", MANIFEST]) {
      const verdict = classifyPatchTarget(file);
      assert.equal(verdict.level, "FORBIDDEN_AUTONOMOUS", file);
      assert.match(verdict.why, /eval yardstick/, file);
    }
  });

  scenario("an unpinned smoke stays SAFE; mixing it with a pinned file forbids the whole set", () => {
    assert.ok(!AYAS_EVAL_PINNED_FILES.includes(UNPINNED), "the unpinned example must not be pinned");
    assert.equal(classifyPatchTarget(UNPINNED).level, "SAFE");
    assert.equal(classifyPatchSet([UNPINNED]).autoApplicable, true);
    const mixed = classifyPatchSet([UNPINNED, AYAS_EVAL_PINNED_FILES[0]!]);
    assert.equal(mixed.level, "FORBIDDEN_AUTONOMOUS");
    assert.equal(mixed.autoApplicable, false);
    assert.deepEqual(mixed.forbidden.map((target) => target.path), [AYAS_EVAL_PINNED_FILES[0]]);
  });

  scenario("the novel-patch policy refuses a replacement of a pinned file before any sandbox work", () => {
    const pinnedSmoke = AYAS_EVAL_PINNED_FILES.find((file) => file.startsWith("scripts/smoke-"))!;
    const violations = checkAyasNovelPatchLimits([{ filePath: pinnedSmoke, expectedHash: "0".repeat(64), content: "export {};\n", allowCreate: false }]);
    assert.deepEqual(violations.map((violation) => violation.rule), ["domain-allowlist"]);
    assert.deepEqual(checkAyasNovelPatchLimits([{ filePath: UNPINNED, expectedHash: "0".repeat(64), content: "export {};\n", allowCreate: false }]), []);
  });

  scenario("the bare-assertion generator proposes the unpinned smoke and never the pinned one", () => {
    const scripts = path.join(temp, "scripts");
    fs.mkdirSync(scripts, { recursive: true });
    const bare = 'import assert from "node:assert/strict";\nassert.equal(1, 1);\n';
    fs.writeFileSync(path.join(scripts, "smoke-ayas-chat-stream-client.ts"), bare);
    fs.writeFileSync(path.join(temp, UNPINNED), bare);
    const gaps = findAyasBareAssertionGaps(temp);
    assert.deepEqual(gaps.map((gap) => gap.file), [UNPINNED]);
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-eval-yardstick-protection", scenarios, pinnedFiles: AYAS_EVAL_PINNED_FILES.length, modelRuns: 0 }));
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("ayas-eval-yardstick-smoke-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
