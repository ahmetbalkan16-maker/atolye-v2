/** Stage 15J — historical fact pack, narrative contract and the local character scene engine. Fixture data and one TEMP directory only; no provider, no model, no network. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { CAMERA_BEAT_MOTION, CAMERA_BEATS } from "../src/lib/character/CameraBeat";
import { CHARACTER_EXPRESSIONS } from "../src/lib/character/CharacterExpression";
import { CHARACTER_POSES, POSE_ANGLES } from "../src/lib/character/CharacterPose";
import { computeCharacterJoints, STICK_FIGURE_RIG } from "../src/lib/character/CharacterRig";
import { buildCharacterScene, findCharacterSceneRequestProblems, verifyCharacterScene, type CharacterSceneRequest } from "../src/lib/character/CharacterSceneManifest";
import { isRasterizableCharacterSceneSvg, rasterizeCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";
import { HISTORICAL_COSTUME_HINTS } from "../src/lib/character/HistoricalCostumeHint";
import { HAND_PROPS, STAGE_PROPS } from "../src/lib/character/PropLibrary";
import { BLOCKING_LIMITS, findSceneBlockingProblems, STAGE_BACKDROPS, STAGE_TIMES, type BlockedCharacter, type SceneBlocking } from "../src/lib/character/SceneBlocking";
import { CHARACTER_SCENE_HEIGHT, CHARACTER_SCENE_WIDTH, renderCharacterSceneSvg } from "../src/lib/character/SvgSceneRenderer";
import {
  checkNarrationEvidence, classifyFactEvidence, extractNarratedNames, extractNarratedYears, validateHistoricalFactPack,
  type HistoricalFactClaim, type HistoricalFactPack,
} from "../src/lib/storytelling/HistoricalFactPack";
import { NARRATIVE_BEATS, NARRATIVE_POLICY, reviewNarrative, type NarrativeBeat, type NarrativeUnit } from "../src/lib/storytelling/NarrativeContract";
import { animationMotionTypes } from "../src/types/animation";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

const claim = (id: string, over: Partial<HistoricalFactClaim> = {}): HistoricalFactClaim => ({ id, statement: "Konstantinopolis 1453 yılında Osmanlı ordusu tarafından alındı.", dates: ["29 Mayıs 1453"], people: ["II. Mehmed"], locations: ["Konstantinopolis"], certainty: "ESTABLISHED", sourceIds: ["s1"], sceneIds: [1], ...over });
const pack = (claims: readonly HistoricalFactClaim[] = [claim("c1")]): HistoricalFactPack => ({
  schemaVersion: "1", topic: "Konstantinopolis'in Fethi", claims,
  sources: [{ id: "s1", kind: "PRIMARY", title: "Kritovulos, Tarih", reference: "Kritovulos, History of Mehmed the Conqueror" }, { id: "s2", kind: "SECONDARY", title: "Runciman, The Fall of Constantinople 1453", reference: "Cambridge University Press, 1965" }],
});
const problems = (value: unknown) => { const result = validateHistoricalFactPack(value); return result.ok ? [] : [...result.problems]; };

const unit = (id: number, beat: NarrativeBeat | null, over: Partial<NarrativeUnit> = {}): NarrativeUnit => ({ id, beat, narration: `Bölüm ${id} kendi olayını anlatır ve hikayeyi bir adım ileri taşır.`, durationSeconds: 90, year: 1450 + id, transition: null, outOfSequence: false, claimIds: [], setups: [], payoffs: [], staticVisualSeconds: 10, ...over });
/** Eight units, one per beat, in order: 720 seconds. */
const story = (over: Partial<Record<number, Partial<NarrativeUnit>>> = {}): NarrativeUnit[] => NARRATIVE_BEATS.map((beat, index) => unit(index + 1, beat, over[index + 1] ?? {}));
const codes = (units: readonly NarrativeUnit[], factPack: HistoricalFactPack | null = null) => reviewNarrative(units, factPack).findings.map((finding) => `${finding.code}:${finding.unitId ?? "-"}`);

const person = (id: string, over: Partial<BlockedCharacter> = {}): BlockedCharacter => ({ id, x: 0.5, depth: 0, facing: "RIGHT", pose: "STAND", expression: "NEUTRAL", costume: "NONE", handProp: null, ...over });
const blocking = (over: Partial<SceneBlocking> = {}): SceneBlocking => ({ backdrop: "FIELD", time: "DAY", characters: [person("a")], props: [], arrows: [], caption: null, ...over });
const request = (over: Partial<CharacterSceneRequest> = {}): CharacterSceneRequest => ({ sceneId: 1, format: "DOCUMENTARY", language: "tr", blocking: blocking(), cameraBeat: "HOLD", claimIds: [], ...over });

/** Tags open and close in order, and no text holds a raw angle bracket or a bare ampersand. */
function assertWellFormed(svg: string): void {
  const body = svg.replace(/^<\?xml[^>]*\?>\n/, "");
  const stack: string[] = [];
  let last = 0;
  for (const match of body.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9:-]*="[^"<]*")*)\s*(\/?)>/g)) {
    const between = body.slice(last, match.index);
    assert.ok(!/[<>]/.test(between) && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(between), `text between tags: ${between.slice(0, 60)}`);
    last = match.index! + match[0].length;
    if (match[1]) assert.equal(stack.pop(), match[2], `closing ${match[2]}`);
    else if (!match[4]) stack.push(match[2]!);
  }
  assert.equal(body.slice(last).trim(), "", "nothing after the last tag"); assert.deepEqual(stack, []);
  assert.ok(!/NaN|undefined|Infinity/.test(svg), "every number is a number");
}

async function main() {
  await scenario("the design's own lists: the fact pack's seven parts, eight beats, seven checks and nine engine parts", () => {
    const order = fs.readFileSync(path.join(repo, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md"), "utf8").replace(/\r\n/g, "\n");
    const section = order.slice(order.indexOf("## STAGE 15J"), order.indexOf("## STAGE 15K"));
    const list = (from: string, to: string) => section.slice(section.indexOf(from), section.indexOf(to)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
    assert.deepEqual(list("Historical Fact Pack:", "Unsupported factual claim"), ["claims", "dates", "people", "locations", "uncertainty", "source refs", "claim-to-scene map"]);
    assert.deepEqual(Object.keys(claim("c1")).sort(), ["certainty", "dates", "id", "locations", "people", "sceneIds", "sourceIds", "statement"]);
    const beats = list("Narrative structure:", "Check:");
    assert.deepEqual([beats.length, beats[0], beats[7]], [NARRATIVE_BEATS.length, "cold open / question / tension", "legacy/closing thought"]);
    assert.deepEqual([...NARRATIVE_BEATS], ["COLD_OPEN", "CONTEXT", "STAKES", "ESCALATION", "TURNING_POINT", "CONSEQUENCE", "PAYOFF", "LEGACY"]);
    assert.match(section, /repetition, exposition, unresolved setup, chronology, abrupt transition, unsupported drama, static visual duration\./);
    const engine = list("Stick-figure/character engine local-first:", "Reuse current motion plan");
    assert.deepEqual(engine, ["CharacterRig", "CharacterPose", "CharacterExpression", "SceneBlocking", "PropLibrary", "HistoricalCostumeHint", "CameraBeat", "SvgSceneRenderer", "CharacterSceneManifest"]);
    for (const part of engine) assert.ok(fs.existsSync(path.join(repo, "src/lib/character", `${part}.ts`)), part);
    assert.deepEqual([NARRATIVE_POLICY.minTotalSeconds, NARRATIVE_POLICY.maxTotalSeconds], [600, 900], "10 to 15 minutes");
  });

  await scenario("fact pack: read only in its own shape, with every problem named", () => {
    assert.deepEqual(problems(pack()), []);
    assert.deepEqual(problems(null), ["NOT_AN_OBJECT"]); assert.deepEqual(problems([]), ["NOT_AN_OBJECT"]);
    assert.deepEqual(problems({ ...pack(), schemaVersion: "2" }), ["SCHEMA_VERSION"]);
    assert.deepEqual(problems({ ...pack(), topic: "" }), ["TOPIC"]);
    assert.deepEqual(problems({ ...pack(), claims: [] }), ["CLAIMS"]);
    assert.deepEqual(problems({ ...pack(), claims: Array.from({ length: 301 }, (_, index) => claim(`c${index}`)) }), ["CLAIMS"]);
    assert.deepEqual(problems(pack([claim("c1"), claim("c1")])), ["CLAIM:1"], "a claim id twice");
    assert.deepEqual(problems(pack([claim("c1", { sourceIds: ["s9"] })])), ["CLAIM_SOURCE_UNRESOLVED:c1"], "a source that is not in the pack");
    for (const bad of [{ certainty: "CERTAIN" }, { statement: "" }, { dates: "1453" }, { people: [""] }, { sceneIds: [0] }, { sceneIds: [1.5] }, { sourceIds: [7] }, { id: "has space" }]) assert.deepEqual(problems(pack([claim("c1", bad as never)])), ["CLAIM:0"], JSON.stringify(bad));
    assert.deepEqual(problems({ ...pack(), sources: [{ id: "s1", kind: "RUMOUR", title: "x", reference: "y" }] }), ["SOURCE:0", "CLAIM_SOURCE_UNRESOLVED:c1"]);
    assert.deepEqual(problems({ ...pack(), sources: [...pack().sources, pack().sources[0]] }), ["SOURCE:2"]);
  });

  await scenario("a claim may be narrated only with a source, and a disputed or legendary one only as uncertain", () => {
    const of = (over: Partial<HistoricalFactClaim>) => classifyFactEvidence(claim("c1", over), pack());
    assert.deepEqual([of({}), of({ certainty: "PROBABLE" }), of({ certainty: "DISPUTED" }), of({ certainty: "LEGENDARY" })], ["SUPPORTED", "SUPPORTED", "SUPPORTED_UNCERTAIN", "SUPPORTED_UNCERTAIN"]);
    assert.deepEqual([of({ sourceIds: [] }), of({ certainty: "UNKNOWN" }), of({ sourceIds: ["s9"] }), of({ sourceIds: [], certainty: "LEGENDARY" })], ["UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED", "UNSUPPORTED"]);
  });

  await scenario("what a narration states: years (not counts) and names (not sentence openers)", () => {
    assert.deepEqual(extractNarratedYears("Şehir 1453'te düştü. Kuşatma 6 Nisan 1453 günü başladı; 451 yılındaki konsilden çok sonra."), ["1453", "451"]);
    assert.deepEqual(extractNarratedYears("Orduda 1000 asker, 300 gemi ve 2000 kişi vardı. Surlar 22 kilometre uzunluğundaydı."), [], "counts are not years");
    assert.deepEqual(extractNarratedYears("In 1453 the walls fell; 80000 soldiers and 1.453 metres and 14,53 and 99 and 2101 are not years."), ["1453"]);
    // The first word of a sentence is capitalized whatever it is, so it is never counted as a name.
    assert.deepEqual(extractNarratedNames("Sultan Mehmed surlara baktı. Haliç'e zincir gerilmişti. Giustiniani yaralandı ve Konstantinopolis düştü."), ["Mehmed", "Konstantinopolis"]);
    assert.deepEqual(extractNarratedNames("Sonra Giustiniani yaralandı; Haliç'e zincir gerildi."), ["Giustiniani"]);
    assert.deepEqual(extractNarratedNames("şehir düştü. ordu ilerledi."), []);
  });

  await scenario("narration evidence: a factual claim without evidence cannot silently enter narration", () => {
    const narration = "Sultan Mehmed 1453 yılında Konstantinopolis önündeydi.";
    const clean = checkNarrationEvidence(pack(), [{ id: 1, sceneIds: [1], text: narration }]);
    assert.deepEqual([clean.gate, clean.findings, clean.claims, clean.authority], ["PASS", [], { total: 1, supported: 1, supportedUncertain: 0, unsupported: 0, unmapped: 0 }, "ADVISORY_ONLY"]);
    // A mapped claim nothing backs.
    for (const over of [{ sourceIds: [] }, { certainty: "UNKNOWN" as const }]) {
      const blocked = checkNarrationEvidence(pack([claim("c1", over)]), [{ id: 1, sceneIds: [1], text: "Şehir düştü." }]);
      assert.deepEqual([blocked.gate, blocked.findings], ["BLOCKED", [{ code: "CLAIM_UNSUPPORTED_NARRATED", severity: "BLOCKER", unitId: 1, subject: "c1" }]]);
    }
    // A year no supported claim holds; a year whose claim is mapped to another scene; a year only an unsupported claim holds.
    assert.deepEqual(checkNarrationEvidence(pack(), [{ id: 1, sceneIds: [1], text: "Kuşatma 1422 yılında denenmişti." }]).findings, [{ code: "DATE_WITHOUT_CLAIM", severity: "BLOCKER", unitId: 1, subject: "1422" }]);
    const elsewhere = checkNarrationEvidence(pack([claim("c1"), claim("c2", { dates: ["1422"], sceneIds: [5] })]), [{ id: 1, sceneIds: [1], text: "Kuşatma 1422 yılında denenmişti." }]);
    assert.deepEqual([elsewhere.gate, elsewhere.findings, elsewhere.claims.unmapped], ["REVIEW_REQUIRED", [{ code: "CLAIM_NOT_MAPPED_TO_SCENE", severity: "REVIEW", unitId: 1, subject: "1422" }], 1]);
    assert.equal(checkNarrationEvidence(pack([claim("c1"), claim("c2", { dates: ["1422"], sceneIds: [5], sourceIds: [] })]), [{ id: 1, sceneIds: [1], text: "Kuşatma 1422 yılında denenmişti." }]).findings[0]!.code, "DATE_WITHOUT_CLAIM");
    // A legend told as fact, and the same legend told as a legend.
    const legend = pack([claim("c1", { certainty: "LEGENDARY", statement: "Surların altından gizli bir geçit vardı.", dates: [], people: [], locations: [] })]);
    assert.deepEqual(checkNarrationEvidence(legend, [{ id: 1, sceneIds: [1], text: "Surların altından gizli bir geçit vardı." }]).findings, [{ code: "UNCERTAINTY_NOT_STATED", severity: "MAJOR", unitId: 1, subject: "c1" }]);
    assert.equal(checkNarrationEvidence(legend, [{ id: 1, sceneIds: [1], text: "Rivayete göre surların altından gizli bir geçit vardı." }]).gate, "PASS");
    assert.equal(checkNarrationEvidence(legend, [{ id: 1, sceneIds: [1], text: "According to legend there was a hidden passage under the walls." }]).findings.filter((finding) => finding.code === "UNCERTAINTY_NOT_STATED").length, 0);
    // A name the pack does not know is reported, not blocked.
    const named = checkNarrationEvidence(pack(), [{ id: 1, sceneIds: [1], text: "Kuşatmayı Papa Nikolaus da izliyordu." }]);
    assert.deepEqual([named.gate, named.findings.map((finding) => `${finding.code}:${finding.subject}`)], ["REVIEW_REQUIRED", ["NAME_WITHOUT_CLAIM:Papa", "NAME_WITHOUT_CLAIM:Nikolaus"]]);
    // A unit that states nothing checkable passes on its own.
    assert.equal(checkNarrationEvidence(pack(), [{ id: 2, sceneIds: [9], text: "sabah sisi surların üzerine çökmüştü." }]).gate, "PASS");
  });

  await scenario("narrative contract: eight beats in order, 10 to 15 minutes, nothing to report", () => {
    const review = reviewNarrative(story(), pack());
    assert.deepEqual([review.gate, review.findings, review.totalSeconds, review.staticVisualSeconds, review.authority], ["PASS", [], 720, 80, "ADVISORY_ONLY"]);
    assert.deepEqual(Object.values(review.beatSeconds), [90, 90, 90, 90, 90, 90, 90, 90]);
    assert.deepEqual(reviewNarrative([]).findings, []);
  });

  await scenario("each of the seven checks, and the beat structure, reports alone and by name", () => {
    // Beats: none declared is reported per unit and never assumed; a missing beat and a step backwards are named.
    assert.deepEqual(codes(story({ 3: { beat: null } })), ["BEAT_NOT_DECLARED:3", "BEAT_MISSING:-"]);
    assert.deepEqual(codes(story().map((item) => ({ ...item, beat: null }))), [1, 2, 3, 4, 5, 6, 7, 8].map((id) => `BEAT_NOT_DECLARED:${id}`));
    assert.deepEqual(reviewNarrative(story().filter((item) => item.beat !== "STAKES" && item.beat !== "PAYOFF").map((item) => ({ ...item, durationSeconds: 120, transition: "sonra" }))).findings.map((finding) => `${finding.code}:${finding.evidence}`), ["BEAT_MISSING:STAKES", "BEAT_MISSING:PAYOFF"]);
    const swapped = story(); [swapped[3], swapped[4]] = [{ ...swapped[4]!, year: 1454 }, { ...swapped[3]!, year: 1455 }];
    assert.deepEqual(codes(swapped), ["ABRUPT_TRANSITION:5", "BEAT_ORDER_BREAK:4", "ABRUPT_TRANSITION:6"]);
    // Length.
    assert.deepEqual(codes(story().map((item) => ({ ...item, durationSeconds: 60 }))), ["DURATION_OUT_OF_RANGE:-"]);
    assert.deepEqual(codes(story().map((item) => ({ ...item, durationSeconds: 120 }))), ["DURATION_OUT_OF_RANGE:-"]);
    // Repeated facts: the same claim twice, and the same sentence twice.
    assert.deepEqual(codes(story({ 2: { claimIds: ["c1"] }, 6: { claimIds: ["c1"] } })), ["REPEATED_FACT:6"]);
    const sentence = "Surlar bin yıl boyunca hiçbir orduya geçit vermemişti.";
    assert.deepEqual(codes(story({ 2: { narration: sentence }, 5: { narration: `Bir kez daha söyleyelim. ${sentence}` } }).map((item) => ({ ...item, claimIds: item.id === 2 || item.id === 5 ? ["c1"] : [] })), pack()).filter((code) => code.startsWith("REPEATED")), ["REPEATED_FACT:5", "REPEATED_FACT:5"]);
    // Long exposition: more time setting up than the rise and the turn take together.
    assert.deepEqual(codes(story({ 2: { durationSeconds: 200 }, 4: { durationSeconds: 60 }, 5: { durationSeconds: 60 }, 8: { durationSeconds: 40 } })), ["LONG_EXPOSITION:-"]);
    assert.deepEqual(codes(story({ 2: { durationSeconds: 180 }, 4: { durationSeconds: 90 }, 5: { durationSeconds: 90 }, 8: { durationSeconds: 0 } })), []);
    // Setups and payoffs.
    assert.deepEqual(codes(story({ 1: { setups: ["zincir"] } })), ["UNRESOLVED_SETUP:1"]);
    assert.deepEqual(codes(story({ 1: { setups: ["zincir"] }, 7: { payoffs: ["zincir"] } })), []);
    assert.deepEqual(codes(story({ 3: { payoffs: ["zincir"] }, 5: { setups: ["zincir"] } })), ["PAYOFF_WITHOUT_SETUP:3", "UNRESOLVED_SETUP:5"]);
    // Chronology: a step back in time is a break unless the unit says it leaves the timeline.
    assert.deepEqual(codes(story({ 4: { year: 1400 } })), ["CHRONOLOGY_BREAK:4"]);
    assert.deepEqual(codes(story({ 4: { year: 1400, outOfSequence: true } })), []);
    assert.deepEqual(codes(story({ 4: { year: null } })), []);
    // Abrupt transition: a step over a beat with nothing said about the change.
    const jump = story().filter((item) => item.beat !== "STAKES").map((item) => ({ ...item, durationSeconds: 100 }));
    assert.deepEqual(codes(jump), ["BEAT_MISSING:-", "ABRUPT_TRANSITION:4"]);
    assert.deepEqual(codes(jump.map((item) => (item.id === 4 ? { ...item, transition: "Yıllar sonra" } : item))), ["BEAT_MISSING:-"]);
    // Drama needs a supported claim in the same unit.
    const drama = "Bu, tarihin en büyük kuşatmasıydı.";
    assert.deepEqual(reviewNarrative(story({ 4: { narration: drama } }), pack()).findings, [{ code: "UNSUPPORTED_DRAMATIC_CLAIM", severity: "BLOCKER", unitId: 4, evidence: "\"en büyük\" with no supported claim in the unit" }]);
    assert.equal(reviewNarrative(story({ 4: { narration: drama } }), pack()).gate, "BLOCKED");
    assert.deepEqual(codes(story({ 4: { narration: drama, claimIds: ["c1"] } }), pack()), []);
    assert.deepEqual(codes(story({ 4: { narration: drama, claimIds: ["c1"] } }), pack([claim("c1", { certainty: "LEGENDARY" })])), ["UNSUPPORTED_DRAMATIC_CLAIM:4"], "a legend does not carry a superlative");
    assert.deepEqual(codes(story({ 4: { narration: drama, claimIds: ["c9"] } }), pack()), ["UNSUPPORTED_DRAMATIC_CLAIM:4"], "a claim that is not in the pack");
    assert.deepEqual(reviewNarrative(story({ 4: { narration: "It was the greatest siege, never before seen." } })).findings.map((finding) => [finding.code, finding.severity]), [["UNSUPPORTED_DRAMATIC_CLAIM", "MAJOR"]], "without a fact pack it cannot be checked, and is not passed");
    // Static visual time: one unit too long on a still image, and a story more still than moving.
    assert.deepEqual(codes(story({ 3: { staticVisualSeconds: 26 } })), ["EXCESSIVE_STATIC_VISUAL_TIME:3"]);
    assert.deepEqual(codes(story({ 3: { staticVisualSeconds: 25 } })), []);
    assert.deepEqual(codes(story().map((item) => ({ ...item, staticVisualSeconds: 46 }))), [...[1, 2, 3, 4, 5, 6, 7, 8].map((id) => `EXCESSIVE_STATIC_VISUAL_TIME:${id}`), "EXCESSIVE_STATIC_VISUAL_TIME:-"]);
  });

  await scenario("rig and poses: feet on the ground line, a kneeling or sitting figure lowers its hip, and scale is plain proportion", () => {
    const ground = { x: 500, y: 900 };
    for (const pose of CHARACTER_POSES) {
      const joints = computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES[pose], ground, 1);
      for (const point of Object.values(joints)) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), pose);
      assert.ok(Math.abs(Math.max(joints.footFront.y, joints.footBack.y) - ground.y) < 1e-9, `${pose}: the lower foot is on the ground`);
      assert.ok(joints.head.y < joints.hip.y || pose === "BOW", `${pose}: the head is above the hip`);
    }
    const stand = computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.STAND, ground, 1);
    const kneel = computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.KNEEL, ground, 1);
    const sit = computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.SIT, ground, 1);
    assert.ok(kneel.hip.y > stand.hip.y + 60 && sit.hip.y > stand.hip.y + 60);
    const half = computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.STAND, ground, 0.5);
    assert.ok(Math.abs((ground.y - half.head.y) * 2 - (ground.y - stand.head.y)) < 1e-9);
    assert.deepEqual(computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.RUN, ground, 0.8), computeCharacterJoints(STICK_FIGURE_RIG, POSE_ANGLES.RUN, ground, 0.8));
  });

  await scenario("renderer: one deterministic, self-contained SVG for every pose, face, costume, prop, backdrop and time", () => {
    const first = renderCharacterSceneSvg(blocking(), { reenactmentLabel: "tr" });
    assert.equal(first, renderCharacterSceneSvg(JSON.parse(JSON.stringify(blocking())) as SceneBlocking, { reenactmentLabel: "tr" }), "the same blocking gives the same bytes");
    assert.ok(first.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${CHARACTER_SCENE_WIDTH}" height="${CHARACTER_SCENE_HEIGHT}"`));
    let rendered = 0;
    const check = (value: SceneBlocking) => { const svg = renderCharacterSceneSvg(value, { reenactmentLabel: "en" }); assertWellFormed(svg); assert.ok(!/<image\b|<use\b|<script\b|<style\b|href=|url\(|<foreignObject/.test(svg), "nothing outside the document"); rendered++; return svg; };
    for (const pose of CHARACTER_POSES) for (const facing of ["LEFT", "RIGHT"] as const) check(blocking({ characters: [person("a", { pose, facing })] }));
    for (const expression of CHARACTER_EXPRESSIONS) check(blocking({ characters: [person("a", { expression })] }));
    for (const costume of HISTORICAL_COSTUME_HINTS) check(blocking({ characters: [person("a", { costume })] }));
    for (const handProp of HAND_PROPS) check(blocking({ characters: [person("a", { handProp, pose: "SWORD_RAISED" })] }));
    for (const prop of STAGE_PROPS) for (const facing of ["LEFT", "RIGHT"] as const) check(blocking({ characters: [], props: [{ prop, x: 0.5, depth: 0.5, facing }] }));
    for (const backdrop of STAGE_BACKDROPS) for (const time of STAGE_TIMES) check(blocking({ backdrop, time }));
    assert.equal(rendered, 20 + 6 + 8 + 7 + 16 + 18);
    // Each choice changes the picture.
    const variants = new Set([...CHARACTER_POSES.map((pose) => sha256(check(blocking({ characters: [person("a", { pose })] })))), ...CHARACTER_EXPRESSIONS.map((expression) => sha256(check(blocking({ characters: [person("a", { expression })] })))),
      ...HISTORICAL_COSTUME_HINTS.map((costume) => sha256(check(blocking({ characters: [person("a", { costume })] })))), ...STAGE_BACKDROPS.map((backdrop) => sha256(check(blocking({ backdrop }))))]);
    assert.equal(variants.size, CHARACTER_POSES.length + CHARACTER_EXPRESSIONS.length + HISTORICAL_COSTUME_HINTS.length + STAGE_BACKDROPS.length - 3, "STAND, NEUTRAL, NONE and FIELD are the same default picture");
    // Farther figures are drawn first, whatever order they are listed in.
    const layered = check(blocking({ characters: [person("near", { depth: 0 }), person("far", { depth: 0.9, x: 0.52 })] }));
    assert.ok(layered.indexOf('data-character="far"') < layered.indexOf('data-character="near"'));
    // A caption is text, whatever it says; the label is in the image only when asked for.
    const hostile = check(blocking({ caption: "<script>alert(1)</script> & \"1453\"" }));
    assert.ok(hostile.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;1453&quot;") && !hostile.includes("<script>"));
    assert.ok(/data-reenactment-label="tr"[^]*CANLANDIRMA/.test(first) && /data-reenactment-label="en"[^]*REENACTMENT/.test(hostile));
    const unlabelled = renderCharacterSceneSvg(blocking(), { reenactmentLabel: null });
    assert.ok(!unlabelled.includes("data-reenactment-label") && !unlabelled.includes("CANLANDIRMA"));
    assert.throws(() => renderCharacterSceneSvg(blocking(), { reenactmentLabel: "de" as never }), /CHARACTER_SCENE_LABEL_INVALID/);
  });

  await scenario("blocking: a closed vocabulary and bounded sizes; a blocking with a problem is refused, never drawn as far as it goes", () => {
    assert.deepEqual(findSceneBlockingProblems(blocking()), []);
    const bad: readonly (readonly [unknown, readonly string[]])[] = [
      [null, ["BLOCKING_SHAPE"]], [{ ...blocking(), extra: 1 }, ["BLOCKING_SHAPE"]], [{ backdrop: "FIELD" }, ["BLOCKING_SHAPE"]],
      [blocking({ backdrop: "SPACE" as never }), ["BACKDROP"]], [blocking({ time: "NOON" as never }), ["TIME"]],
      [blocking({ caption: "" }), ["CAPTION"]], [blocking({ caption: "x".repeat(BLOCKING_LIMITS.captionLength + 1) }), ["CAPTION"]], [blocking({ caption: "line\nbreak" }), ["CAPTION"]],
      [blocking({ characters: Array.from({ length: BLOCKING_LIMITS.characters + 1 }, (_, index) => person(`p${index}`)) }), ["CHARACTERS"]],
      [blocking({ characters: [person("a"), person("a")] }), ["CHARACTER:1"]], [blocking({ characters: [person("A b")] }), ["CHARACTER:0"]],
      [blocking({ characters: [person("a", { x: 1.2 })] }), ["CHARACTER:0"]], [blocking({ characters: [person("a", { depth: -0.1 })] }), ["CHARACTER:0"]], [blocking({ characters: [person("a", { x: Number.NaN })] }), ["CHARACTER:0"]],
      [blocking({ characters: [person("a", { pose: "FLY" as never })] }), ["CHARACTER:0"]], [blocking({ characters: [person("a", { expression: "SMUG" as never })] }), ["CHARACTER:0"]],
      [blocking({ characters: [person("a", { costume: "UNIFORM" as never })] }), ["CHARACTER:0"]], [blocking({ characters: [person("a", { handProp: "GUN" as never })] }), ["CHARACTER:0"]],
      [blocking({ characters: [{ ...person("a"), svg: "<image/>" } as never] }), ["CHARACTER:0"]],
      [blocking({ props: [{ prop: "TANK" as never, x: 0.5, depth: 0, facing: "LEFT" }] }), ["PROP:0"]], [blocking({ props: Array.from({ length: BLOCKING_LIMITS.props + 1 }, () => ({ prop: "TREE" as const, x: 0.5, depth: 0, facing: "LEFT" as const })) }), ["PROPS"]],
      [blocking({ arrows: [{ fromX: 0.2, fromY: 0.2, toX: 0.2, toY: 0.2 }] }), ["ARROW:0"]], [blocking({ arrows: [{ fromX: 0.2, fromY: 0.2, toX: 2, toY: 0.2 }] }), ["ARROW:0"]],
    ];
    for (const [value, expected] of bad) { assert.deepEqual(findSceneBlockingProblems(value), expected, JSON.stringify(value)?.slice(0, 120)); assert.throws(() => renderCharacterSceneSvg(value as SceneBlocking, { reenactmentLabel: "tr" }), /CHARACTER_SCENE_BLOCKING_INVALID/); }
  });

  await scenario("manifest: a character scene is synthetic, evidence of nothing, zero-cost and, in a documentary, always labelled in the image", () => {
    const scene = buildCharacterScene(request({ claimIds: ["c1"], cameraBeat: "PUSH_IN", blocking: blocking({ caption: "Konstantinopolis, 1453" }) }));
    assert.deepEqual(scene.manifest.classification, { mediaClass: "LOCAL_CHARACTER_REENACTMENT", origin: "GENERATED", synthetic: true, evidenceValue: "NONE", reenactmentLabel: "VISIBLE_IN_IMAGE", labelText: "CANLANDIRMA", rights: "LOCALLY_GENERATED_NO_THIRD_PARTY_MEDIA", cost: "LOCAL_ZERO_COST" });
    assert.deepEqual([scene.manifest.schemaVersion, scene.manifest.renderer, scene.manifest.motionType, scene.manifest.counts, scene.manifest.svgSha256, scene.manifest.svgBytes],
      ["1", { id: "svg-stick-figure", rig: "stick-figure-v1", width: 1920, height: 1080 }, "zoom-in", { characters: 1, props: 0, arrows: 0 }, sha256(scene.svg), Buffer.byteLength(scene.svg, "utf8")]);
    assert.equal(JSON.stringify(buildCharacterScene(request({ claimIds: ["c1"], cameraBeat: "PUSH_IN", blocking: blocking({ caption: "Konstantinopolis, 1453" }) }))), JSON.stringify(scene));
    assert.deepEqual(verifyCharacterScene(scene.manifest, scene.svg, "DOCUMENTARY"), []);
    // A documentary scene is labelled whatever else is true. A general scene is labelled as soon as it has a caption or illustrates a claim.
    for (const language of ["tr", "en"] as const) assert.equal(buildCharacterScene(request({ language })).manifest.classification.labelText, language === "tr" ? "CANLANDIRMA" : "REENACTMENT");
    assert.equal(buildCharacterScene(request({ format: "GENERAL" })).manifest.classification.reenactmentLabel, "NOT_REQUIRED");
    assert.equal(buildCharacterScene(request({ format: "GENERAL", claimIds: ["c1"] })).manifest.classification.reenactmentLabel, "VISIBLE_IN_IMAGE");
    assert.equal(buildCharacterScene(request({ format: "GENERAL", blocking: blocking({ caption: "1453" }) })).manifest.classification.reenactmentLabel, "VISIBLE_IN_IMAGE");
    // The camera beat is one of the motion plan's own motion types.
    for (const beat of CAMERA_BEATS) assert.ok((animationMotionTypes as readonly string[]).includes(CAMERA_BEAT_MOTION[beat]), beat);
    assert.equal(new Set(Object.values(CAMERA_BEAT_MOTION)).size, CAMERA_BEATS.length);
    // A request is taken only in its own shape.
    assert.deepEqual(findCharacterSceneRequestProblems(request()), []);
    for (const [bad, expected] of [[{ sceneId: 0 }, "SCENE_ID"], [{ format: "SHORT" }, "FORMAT"], [{ language: "de" }, "LANGUAGE"], [{ cameraBeat: "DOLLY" }, "CAMERA_BEAT"], [{ claimIds: ["has space"] }, "CLAIM_IDS"], [{ evidenceValue: "PRIMARY" }, "REQUEST_UNKNOWN_FIELD"], [{ reenactmentLabel: null }, "REQUEST_UNKNOWN_FIELD"]] as const) {
      assert.deepEqual(findCharacterSceneRequestProblems({ ...request(), ...bad }), [expected], JSON.stringify(bad)); assert.throws(() => buildCharacterScene({ ...request(), ...bad } as never), /CHARACTER_SCENE_REQUEST_INVALID/);
    }
    // A stored manifest that no longer says what the scene is, or no longer describes its image, is refused.
    const general = buildCharacterScene(request({ format: "GENERAL" }));
    assert.deepEqual(verifyCharacterScene(general.manifest, general.svg, "GENERAL"), []);
    assert.deepEqual(verifyCharacterScene(general.manifest, general.svg, "DOCUMENTARY"), ["DOCUMENTARY_REENACTMENT_UNLABELLED"]);
    assert.deepEqual(verifyCharacterScene(scene.manifest, scene.svg.replace("#d9e6f2", "#ffffff"), "DOCUMENTARY"), ["SVG_DIGEST_MISMATCH"]);
    for (const over of [{ evidenceValue: "PRIMARY_SOURCE" }, { origin: "REAL" }, { synthetic: false }, { mediaClass: "REAL_PHOTO" }]) assert.deepEqual(verifyCharacterScene({ ...scene.manifest, classification: { ...scene.manifest.classification, ...over } as never }, scene.svg, "DOCUMENTARY"), ["CLASSIFICATION"], JSON.stringify(over));
    const stripped = scene.svg.replace(/<g data-reenactment-label="tr">[^]*?<\/g>/, "");
    assert.deepEqual(verifyCharacterScene({ ...scene.manifest, svgSha256: sha256(stripped), svgBytes: Buffer.byteLength(stripped, "utf8") }, stripped, "DOCUMENTARY"), ["LABEL_STATE_MISMATCH", "DOCUMENTARY_REENACTMENT_UNLABELLED"]);
    assert.deepEqual(verifyCharacterScene({ ...scene.manifest, classification: { ...scene.manifest.classification, reenactmentLabel: "NOT_REQUIRED", labelText: null } }, scene.svg, "GENERAL"), ["LABEL_STATE_MISMATCH"]);
    const other = buildCharacterScene(request({ claimIds: ["c1"], cameraBeat: "PUSH_IN", blocking: blocking({ caption: "Konstantinopolis, 1453", time: "NIGHT" }) }));
    assert.deepEqual(verifyCharacterScene({ ...scene.manifest, svgSha256: other.manifest.svgSha256, svgBytes: other.manifest.svgBytes }, other.svg, "DOCUMENTARY"), ["SVG_NOT_FROM_BLOCKING"]);
    assert.deepEqual(verifyCharacterScene({ ...scene.manifest, motionType: "pan-left" }, scene.svg, "DOCUMENTARY"), ["MOTION_TYPE"]);
  });

  await scenario("rasterizer: only the renderer's own SVG is accepted, and the PNG is the stage's size", async () => {
    const scene = buildCharacterScene(request({ blocking: blocking({ backdrop: "CITY_WALLS", caption: "Konstantinopolis, 1453", characters: [person("a", { costume: "TURBAN", pose: "POINT" }), person("b", { x: 0.7, depth: 0.3, facing: "LEFT", handProp: "SHIELD" })] }) }));
    assert.equal(isRasterizableCharacterSceneSvg(scene.svg), true);
    for (const hostile of [scene.svg.replace("</svg>", '<image href="file:///C:/secrets.png"/></svg>'), scene.svg.replace("</svg>", '<use href="#a"/></svg>'), scene.svg.replace("<rect ", '<rect style="fill:url(http://example.invalid/x)" '),
      scene.svg.replace("</svg>", "<script>1</script></svg>"), scene.svg.replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'), scene.svg.replace("<rect ", '<rect onload="x()" '),
      "<svg></svg>", scene.svg.slice(0, -8), `${scene.svg.slice(0, -7)}${"<g/>".repeat(140_000)}</svg>\n`]) {
      assert.equal(isRasterizableCharacterSceneSvg(hostile), false, hostile.slice(-60));
      assert.deepEqual(await rasterizeCharacterSceneSvg(hostile), { ok: false, reason: "SVG_REJECTED" });
    }
    const raster = await rasterizeCharacterSceneSvg(scene.svg);
    // The image library is the one installed with the framework. Where it is absent the answer is a typed refusal; it is never a pass.
    if (!raster.ok) { assert.equal(raster.reason, "RASTERIZER_UNAVAILABLE"); console.log("rasterizer: UNAVAILABLE on this machine (not measured)"); return; }
    assert.deepEqual([raster.width, raster.height, raster.rasterizer, raster.png.readUInt32BE(0), raster.png.readUInt32BE(16), raster.png.readUInt32BE(20)], [1920, 1080, "sharp", 0x89504e47, 1920, 1080]);
    assert.ok(raster.png.length > 5_000, "a drawn image, not an empty one");
  });

  await scenario("operator script: prints by default, writes new files only, and refuses a request it cannot read", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-storytelling-"));
    try {
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const script = path.join(repo, "scripts", "ayas-character-scene.ts");
      const run = (...args: string[]) => spawnSync(process.execPath, [tsx, script, ...args], { cwd: temp, encoding: "utf8", windowsHide: true, timeout: 120_000 });
      fs.writeFileSync(path.join(temp, "request.json"), JSON.stringify(request({ sceneId: 7, blocking: blocking({ caption: "1453" }) })));
      const printed = run("--request", "request.json");
      assert.equal(printed.status, 0, printed.stderr);
      assert.deepEqual([JSON.parse(printed.stdout).classification.evidenceValue, JSON.parse(printed.stdout).written, fs.readdirSync(temp)], ["NONE", [], ["request.json"]], "nothing is written without --out");
      const written = run("--request", "request.json", "--out", "out");
      assert.equal(written.status, 0, written.stderr);
      assert.deepEqual(fs.readdirSync(path.join(temp, "out")).sort(), ["scene-7.manifest.json", "scene-7.svg"]);
      const stored = JSON.parse(fs.readFileSync(path.join(temp, "out", "scene-7.manifest.json"), "utf8"));
      assert.deepEqual(verifyCharacterScene(stored, fs.readFileSync(path.join(temp, "out", "scene-7.svg"), "utf8"), "DOCUMENTARY"), []);
      const again = run("--request", "request.json", "--out", "out");
      assert.equal(again.status, 1, "a scene already written is not replaced"); assert.match(again.stderr, /EEXIST/);
      fs.writeFileSync(path.join(temp, "bad.json"), JSON.stringify({ ...request(), evidenceValue: "PRIMARY" }));
      const refused = run("--request", "bad.json", "--out", "other");
      assert.equal(refused.status, 1); assert.match(refused.stderr, /CHARACTER_SCENE_REQUEST_INVALID: REQUEST_UNKNOWN_FIELD/); assert.ok(!fs.existsSync(path.join(temp, "other")));
      for (const args of [[], ["--request"], ["--request", "request.json", "--png"], ["--request", "request.json", "--publish"], ["--request", "missing.json"]]) { const failed = run(...args); assert.equal(failed.status, 1, args.join(" ")); assert.match(failed.stderr, /CHARACTER_SCENE_(?:ARGUMENTS_INVALID|REQUEST_UNREADABLE)/, args.join(" ")); }
    } finally { assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); fs.rmSync(temp, { recursive: true, force: true }); }
  });

  await scenario("local and inert: no filesystem, process, network, provider or model in the storytelling and character modules", () => {
    const files = ["src/lib/storytelling/HistoricalFactPack.ts", "src/lib/storytelling/NarrativeContract.ts", ...fs.readdirSync(path.join(repo, "src/lib/character")).filter((name) => name.endsWith(".ts")).map((name) => `src/lib/character/${name}`)];
    assert.equal(files.length, 12);
    for (const file of files) {
      const code = fs.readFileSync(path.join(repo, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const forbidden of [/node:fs|node:child_process|node:path|node:os|node:https?|node:net/, /\bfetch\s*\(/, /process\.(?:env|cwd|argv)/, /Date\.now|new Date\(/, /Math\.random/, /openai|ollama|Provider/i]) assert.ok(!forbidden.test(code), `${file} must not contain ${forbidden}`);
      const imports = [...code.matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)].map((match) => match[1] ?? match[2]!);
      for (const specifier of imports) assert.ok(specifier.startsWith("./") || specifier === "node:crypto" || (specifier === "sharp" && file.endsWith("CharacterSceneRasterizer.ts")), `${file} imports ${specifier}`);
    }
  });

  console.log(`Stage 15J historical storytelling: PASS (${count} scenarios; ${NARRATIVE_BEATS.length} beats, ${CHARACTER_POSES.length} poses; fixture data only; provider/model/network actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
