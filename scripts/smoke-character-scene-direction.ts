import assert from "node:assert/strict";
import { planCharacterScene } from "../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection, findCharacterStoryBeatProblems, characterDirectedFrame } from "../src/lib/animation/character/CharacterSceneDirection";
import { renderCharacterSceneAssetFrame, findCharacterSceneAssetPayloadProblems, embedCharacterScenePayload, readCharacterScenePayload, CHARACTER_SCENE_FONT_FAMILY } from "../src/lib/animation/character/CharacterSceneAsset";
import { EDITORIAL_RENDER_STYLE } from "../src/lib/character/SvgSceneRenderer";
import { rasterizeCharacterSceneSvg, isRasterizableCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";
import { characterAnimationFrame } from "../src/lib/animation/character/CharacterAnimation";

async function main() {
  const examples = [
    ["Osmanlı padişahı sarayda konuşur. Haritayı gösterir.", "OTTOMAN"],
    ["Hristiyan Bizans imparatoru sarayda konuşur. Tahta oturur.", "BYZANTINE"],
    ["Roma imparatoru sarayda konuşur. Zaferi kutlar.", "ROMAN"],
    ["Firavun sarayda konuşur. Elçi selam verir.", "EGYPTIAN"],
    ["İngiliz kralı sarayda konuşur. Haritayı işaret eder.", "WESTERN"],
  ] as const;
  const fingerprints = new Set<string>();
  for (const [text, culture] of examples) {
    const p = planCharacterScene({ sceneId: 1, text, contextualDirection: true });
    const direction = planCharacterSceneDirection(text, p.request.blocking);
    assert.equal(direction.art.culture, culture);
    assert.equal(direction.art.faith, culture === "BYZANTINE" ? "CHRISTIANITY" : "UNSPECIFIED");
    assert.equal(direction.art.roles[0]!.role, "RULER");
    assert.deepEqual(findCharacterStoryBeatProblems(direction.beats, p.request.blocking), []);
    const payload = { schemaVersion: "1" as const, request: p.request, animation: p.animation, fontFamily: CHARACTER_SCENE_FONT_FAMILY, renderStyle: EDITORIAL_RENDER_STYLE, direction };
    assert.deepEqual(findCharacterSceneAssetPayloadProblems(payload), []);
    const svg = renderCharacterSceneAssetFrame(payload, 0.8, 8);
    assert(isRasterizableCharacterSceneSvg(svg)); assert.match(svg, /data-throne-culture=/);
    assert.match(svg, new RegExp(`data-art-culture="${culture}"`));
    assert.equal(svg, renderCharacterSceneAssetFrame(payload, 0.8, 8));
    fingerprints.add(svg);
    const raster = await rasterizeCharacterSceneSvg(svg); assert(raster.ok);
    if (raster.ok) assert.deepEqual(readCharacterScenePayload(embedCharacterScenePayload(raster.png, payload)), { status: "VALID", payload });
    assert(findCharacterSceneAssetPayloadProblems({ ...payload, direction: { ...direction, art: { ...direction.art, roles: [{ id: "missing", role: "RULER" }] } } }).length);
    assert(findCharacterSceneAssetPayloadProblems({ ...payload, renderStyle: undefined }).length);
    assert(findCharacterSceneAssetPayloadProblems({ ...payload, direction: { ...direction, beats: [{ actorId: "c1", action: "TALK", start: 0.9, end: 0.1 }] } }).length);
  }
  assert.equal(fingerprints.size, examples.length);
  const p = planCharacterScene({ sceneId: 3, text: "Kral sarayda konuşur. Haritayı gösterir." });
  const d = planCharacterSceneDirection("Kral sarayda konuşur. Haritayı gösterir.", p.request.blocking);
  assert.deepEqual(d.beats.map(b => b.action), ["TALK", "POINT"]);
  assert.equal(d.art.culture, "UNKNOWN"); assert.equal(d.art.faith, "UNSPECIFIED");
  assert.equal(planCharacterSceneDirection("Kral zaferi kutlamadı.", p.request.blocking).beats.length, 0);
  assert.deepEqual(characterDirectedFrame(p.request.blocking, p.animation, [], 0.5, 8), characterAnimationFrame(p.request.blocking, p.animation, 0.5));
  assert.notDeepEqual(characterDirectedFrame(p.request.blocking, p.animation, d.beats, 6.5, 8), characterAnimationFrame(p.request.blocking, p.animation, 6.5));
  assert.deepEqual(characterDirectedFrame(p.request.blocking, p.animation, d.beats, 8, 8), characterAnimationFrame(p.request.blocking, p.animation, 8));
  console.log("Character scene direction: PASS (five culture profiles, explicit faith, estimated sentence actions, bounded validation, real PNG round-trip, legacy unchanged)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
