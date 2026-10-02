/**
 * Stage 15O.3 — three golden historical-video projects through the local deterministic engines: the fact pack and its
 * narration check, the narrative contract, and the character scene engine. What they produce is compared with what was
 * frozen. Fixture data only: no narration audio, no rendered video, no file written, no model, provider or network.
 *
 *   npx tsx scripts/smoke-ayas-golden-video-projects.ts [--print-expected]
 *
 * `--print-expected` prints what the engines produce now, for a reviewer who is publishing a new vault version. It
 * checks nothing and changes nothing.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { CAMERA_BEAT_MOTION } from "../src/lib/character/CameraBeat";
import { buildCharacterScene, findCharacterSceneRequestProblems, verifyCharacterScene, type CharacterSceneManifest } from "../src/lib/character/CharacterSceneManifest";
import { checkNarrationEvidence, classifyFactEvidence, validateHistoricalFactPack, type NarrationUnit } from "../src/lib/storytelling/HistoricalFactPack";
import { NARRATIVE_BEATS, NARRATIVE_POLICY, reviewNarrative } from "../src/lib/storytelling/NarrativeContract";
import { AYAS_GOLDEN_VIDEO_PROJECTS, type AyasGoldenVideoProject } from "./fixtures/ayas-golden-video-projects";
import { AYAS_GOLDEN_VIDEO_EXPECTED } from "./fixtures/ayas-golden-video-projects-expected";

let count = 0;
function scenario(name: string, run: () => void) { run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex");
const narration = (project: AyasGoldenVideoProject): NarrationUnit[] => project.units.map((unit) => ({ id: unit.id, sceneIds: [unit.id], text: unit.narration }));
const HEDGES = ["rivayete göre", "tartışmalı", "kesin olarak bilinmiyor", "söylenir"];

/** Everything the engines make of one project, in one value. */
function produce(project: AyasGoldenVideoProject) {
  const evidence = checkNarrationEvidence(project.factPack, narration(project));
  const story = reviewNarrative(project.units, project.factPack);
  const scenes = project.scenes.map((request) => buildCharacterScene(request));
  return { evidence, story, scenes, inputDigest: digest({ factPack: project.factPack, units: project.units, scenes: project.scenes }),
    sceneSvgSha256: scenes.map((scene) => scene.manifest.svgSha256), outputDigest: digest({ evidence, story, manifests: scenes.map((scene) => scene.manifest) }) };
}

if (process.argv.includes("--print-expected")) {
  console.log(JSON.stringify(Object.fromEntries(AYAS_GOLDEN_VIDEO_PROJECTS.map((project) => { const made = produce(project); return [project.id, { inputDigest: made.inputDigest, sceneSvgSha256: made.sceneSvgSha256, outputDigest: made.outputDigest }]; })), null, 2));
} else {
  scenario("three projects, each a whole story: a fact pack with sources, eight beats in order, one scene per unit", () => {
    assert.equal(AYAS_GOLDEN_VIDEO_PROJECTS.length, 3); assert.equal(new Set(AYAS_GOLDEN_VIDEO_PROJECTS.map((project) => project.id)).size, 3);
    assert.deepEqual(Object.keys(AYAS_GOLDEN_VIDEO_EXPECTED).sort(), AYAS_GOLDEN_VIDEO_PROJECTS.map((project) => project.id).sort());
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      const pack = validateHistoricalFactPack(project.factPack); assert.ok(pack.ok, `${project.id}: ${pack.ok ? "" : pack.problems.join(", ")}`);
      assert.ok(project.factPack.sources.some((source) => source.kind === "PRIMARY") && project.factPack.sources.some((source) => source.kind === "SECONDARY"), `${project.id}: a source from the period and a later work`);
      assert.deepEqual(project.units.map((unit) => [unit.id, unit.beat]), NARRATIVE_BEATS.map((beat, index) => [index + 1, beat]), project.id);
      assert.deepEqual(project.scenes.map((scene) => scene.sceneId), project.units.map((unit) => unit.id), project.id);
      // The claim-to-scene map and the units agree in both directions, and no claim is left without a unit.
      for (const unit of project.units) for (const id of unit.claimIds) assert.ok(project.factPack.claims.find((claim) => claim.id === id)?.sceneIds.includes(unit.id), `${project.id} unit ${unit.id}: ${id}`);
      for (const claim of project.factPack.claims) { assert.ok(claim.sourceIds.length > 0, `${project.id}: ${claim.id} has no source`); for (const sceneId of claim.sceneIds) assert.ok(project.units.find((unit) => unit.id === sceneId)?.claimIds.includes(claim.id), `${project.id}: ${claim.id} -> ${sceneId}`); }
      assert.equal(new Set(project.units.flatMap((unit) => unit.claimIds)).size, project.factPack.claims.length, `${project.id}: every claim is narrated once`);
    }
  });

  scenario("nothing unsupported enters narration, and what is disputed is narrated as disputed", () => {
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      const evidence = checkNarrationEvidence(project.factPack, narration(project));
      assert.deepEqual([evidence.gate, evidence.findings, evidence.claims.unsupported, evidence.claims.unmapped, evidence.authority], ["PASS", [], 0, 0, "ADVISORY_ONLY"], project.id);
      // Each project carries one disputed claim, so the uncertainty rule is met by golden data and not only by negative tests.
      const disputed = project.factPack.claims.filter((claim) => classifyFactEvidence(claim, project.factPack) === "SUPPORTED_UNCERTAIN");
      assert.equal(disputed.length, 1, project.id); assert.equal(evidence.claims.supportedUncertain, 1);
      const unit = project.units.find((candidate) => candidate.claimIds.includes(disputed[0]!.id))!;
      assert.ok(HEDGES.some((hedge) => unit.narration.toLocaleLowerCase("tr").includes(hedge)), `${project.id}: the disputed claim is stated as fact`);
    }
  });

  scenario("the story has its shape: ten to fifteen minutes, eight beats, setups answered, no finding", () => {
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      const story = reviewNarrative(project.units, project.factPack);
      assert.deepEqual([story.gate, story.findings, story.authority], ["PASS", [], "ADVISORY_ONLY"], `${project.id}: ${JSON.stringify(story.findings)}`);
      assert.ok(story.totalSeconds >= NARRATIVE_POLICY.minTotalSeconds && story.totalSeconds <= NARRATIVE_POLICY.maxTotalSeconds, project.id);
      for (const beat of NARRATIVE_BEATS) assert.ok(story.beatSeconds[beat] > 0, `${project.id}: ${beat}`);
      assert.ok(project.units.some((unit) => unit.setups.length > 0) && project.units.some((unit) => unit.payoffs.length > 0), `${project.id}: a question is opened and answered`);
    }
  });

  scenario("every scene is a labelled, local, zero-cost reenactment that is evidence of nothing", () => {
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      for (const [index, request] of project.scenes.entries()) {
        assert.deepEqual(findCharacterSceneRequestProblems(request), [], `${project.id} scene ${request.sceneId}`);
        const scene = buildCharacterScene(request);
        assert.deepEqual(verifyCharacterScene(scene.manifest, scene.svg, "DOCUMENTARY"), [], `${project.id} scene ${request.sceneId}`);
        const c = scene.manifest.classification;
        assert.deepEqual([c.mediaClass, c.origin, c.synthetic, c.evidenceValue, c.reenactmentLabel, c.labelText, c.rights, c.cost],
          ["LOCAL_CHARACTER_REENACTMENT", "GENERATED", true, "NONE", "VISIBLE_IN_IMAGE", "CANLANDIRMA", "LOCALLY_GENERATED_NO_THIRD_PARTY_MEDIA", "LOCAL_ZERO_COST"]);
        assert.equal(scene.manifest.motionType, CAMERA_BEAT_MOTION[request.cameraBeat]);
        // A scene illustrates only what its unit narrates.
        assert.deepEqual([...request.claimIds], [...project.units[index]!.claimIds], `${project.id} scene ${request.sceneId}`);
        assert.ok(request.blocking.characters.length > 0 && scene.svg.includes("data-reenactment-label=\"tr\""));
      }
    }
  });

  scenario("frozen: the inputs are the frozen inputs, and the engines still make of them what they made", () => {
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      const made = produce(project); const expected = AYAS_GOLDEN_VIDEO_EXPECTED[project.id]!;
      assert.equal(made.inputDigest, expected.inputDigest, `${project.id}: the golden project itself changed`);
      // Scene by scene first, so a renderer change names the scene it moved.
      made.sceneSvgSha256.forEach((sha, index) => assert.equal(sha, expected.sceneSvgSha256[index], `${project.id} scene ${index + 1}: the rendered bytes changed`));
      assert.equal(made.sceneSvgSha256.length, expected.sceneSvgSha256.length);
      assert.equal(made.outputDigest, expected.outputDigest, `${project.id}: a review or a manifest changed`);
      // Deterministic: the same project gives the same bytes again.
      assert.deepEqual(produce(project).sceneSvgSha256, made.sceneSvgSha256);
    }
  });

  scenario("the golden data is live: each rule it meets fails on the same data once the data breaks it", () => {
    for (const project of AYAS_GOLDEN_VIDEO_PROJECTS) {
      const codes = (units: typeof project.units, pack = project.factPack) => checkNarrationEvidence(pack, units.map((unit) => ({ id: unit.id, sceneIds: [unit.id], text: unit.narration }))).findings.map((finding) => `${finding.code}:${finding.unitId}`);
      const withUnit = (id: number, change: (unit: (typeof project.units)[number]) => (typeof project.units)[number]) => project.units.map((unit) => (unit.id === id ? change(unit) : unit));
      const disputed = project.factPack.claims.find((claim) => claim.certainty === "DISPUTED")!; const uncertainUnit = project.units.find((unit) => unit.claimIds.includes(disputed.id))!;
      // The disputed claim told as plain fact.
      const plain = withUnit(uncertainUnit.id, (unit) => ({ ...unit, narration: HEDGES.reduce((text, hedge) => text.replace(new RegExp(hedge, "giu"), "bilinir"), unit.narration).replace(/Rivayete göre/gu, "Bilindiği gibi") }));
      assert.deepEqual(codes(plain), [`UNCERTAINTY_NOT_STATED:${uncertainUnit.id}`], project.id);
      // A year no claim carries, a name the pack does not know, a claim that lost its sources.
      assert.deepEqual(codes(withUnit(3, (unit) => ({ ...unit, narration: `${unit.narration} Bunların hepsi 1999 yılında yazıldı.` }))), ["DATE_WITHOUT_CLAIM:3"], project.id);
      assert.deepEqual(codes(withUnit(3, (unit) => ({ ...unit, narration: `${unit.narration} Olanları sonradan Napolyon anlattı.` }))), ["NAME_WITHOUT_CLAIM:3"], project.id);
      const firstClaim = project.units[2]!.claimIds[0]!;
      assert.ok(codes(project.units, { ...project.factPack, claims: project.factPack.claims.map((claim) => (claim.id === firstClaim ? { ...claim, sourceIds: [] } : claim)) }).includes("CLAIM_UNSUPPORTED_NARRATED:3"), project.id);
      // The story out of order, a question left open, a superlative nothing supports.
      const story = (units: typeof project.units) => reviewNarrative(units, project.factPack).findings.map((finding) => finding.code);
      assert.ok(story(project.units.map((unit) => (unit.id === 4 ? { ...unit, beat: project.units[4]!.beat } : unit.id === 5 ? { ...unit, beat: project.units[3]!.beat } : unit))).includes("BEAT_ORDER_BREAK"), project.id);
      assert.ok(story(project.units.map((unit) => ({ ...unit, payoffs: [] }))).includes("UNRESOLVED_SETUP"), project.id);
      assert.ok(reviewNarrative(withUnit(3, (unit) => ({ ...unit, claimIds: [], narration: `${unit.narration} Bu, tarihin en büyük kuşatmasıydı.` })), project.factPack).findings.some((finding) => finding.code === "UNSUPPORTED_DRAMATIC_CLAIM" && finding.severity === "BLOCKER"), project.id);
      // A scene that calls itself evidence, an unlabelled documentary scene, and bytes that are not the blocking's.
      const scene = buildCharacterScene(project.scenes[0]!); const manifest: CharacterSceneManifest = scene.manifest;
      assert.deepEqual(verifyCharacterScene({ ...manifest, classification: { ...manifest.classification, evidenceValue: "PRIMARY" as never } }, scene.svg, "DOCUMENTARY"), ["CLASSIFICATION"]);
      assert.ok(verifyCharacterScene(manifest, scene.svg.replace("data-reenactment-label=\"tr\"", "data-label=\"tr\""), "DOCUMENTARY").includes("DOCUMENTARY_REENACTMENT_UNLABELLED"));
      const moved = buildCharacterScene({ ...project.scenes[0]!, blocking: { ...project.scenes[0]!.blocking, time: project.scenes[0]!.blocking.time === "DAY" ? "NIGHT" : "DAY" } });
      assert.notEqual(moved.manifest.svgSha256, AYAS_GOLDEN_VIDEO_EXPECTED[project.id]!.sceneSvgSha256[0], `${project.id}: a changed scene kept its frozen digest`);
    }
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-video-projects", scenarios: count, projects: AYAS_GOLDEN_VIDEO_PROJECTS.length, scenes: AYAS_GOLDEN_VIDEO_PROJECTS.reduce((sum, project) => sum + project.scenes.length, 0), modelRuns: 0, rendered: "SVG_ONLY_NO_AUDIO_NO_VIDEO" }));
}
