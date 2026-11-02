import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CHARACTER_POSES } from "../src/lib/character/CharacterPose";
import { CHARACTER_EXPRESSIONS } from "../src/lib/character/CharacterExpression";
import { createHash } from "node:crypto";
import { renderCharacterSceneSvg, EDITORIAL_RENDER_STYLE } from "../src/lib/character/SvgSceneRenderer";
import { isRasterizableCharacterSceneSvg, rasterizeCharacterSceneSvg } from "../src/lib/character/CharacterSceneRasterizer";
import { planCharacterScene } from "../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../src/lib/animation/character/CharacterSceneDirection";

async function main() {
  const source=fs.readFileSync(path.join(process.cwd(),"src/lib/character/illustration/IllustratedCharacter.ts"),"utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,"");
  assert.doesNotMatch(source,/node:fs|child_process|fetch\s*\(|process\.|Date\.now|Math\.random|import\(/);
  const imports=[...source.matchAll(/from "([^"]+)"/g)].map(m=>m[1]).sort();
  assert.deepEqual(imports,["../CharacterPose","../CharacterRig","../SceneBlocking","../SvgSceneRenderer"], "assert.deepEqual(imports,[\"../CharacterPose\",\"../CharacterRig\",\"../SceneBlocking\",\"../SvgSceneRenderer\"])");
  const plan=planCharacterScene({sceneId:1,text:"Osmanlı padişahı sarayda konuşur",contextualDirection:true});
  const direction=planCharacterSceneDirection("Osmanlı padişahı sarayda konuşur",plan.request.blocking);
  for(const pose of CHARACTER_POSES) {
    const blocking={...plan.request.blocking,characters:plan.request.blocking.characters.map(c=>({...c,pose}))};
    const svg=renderCharacterSceneSvg(blocking,{reenactmentLabel:"tr",renderStyle:EDITORIAL_RENDER_STYLE,artDirection:direction.art});
    assert(isRasterizableCharacterSceneSvg(svg)); assert.doesNotMatch(svg,/NaN|Infinity|<image|href=/); assert.match(svg,/data-art-version="4"/);
    const frame=await rasterizeCharacterSceneSvg(svg); assert(frame.ok,pose);
  }
  for(const version of ["1","2","3"] as const) {
    const svg=renderCharacterSceneSvg(plan.request.blocking,{reenactmentLabel:"tr",renderStyle:EDITORIAL_RENDER_STYLE,artDirection:{...direction.art,version}});
    assert.doesNotMatch(svg,/data-art-version="4"|data-throne-version="4"/);
  }
  const expressions=new Set<string>();
  for(const expression of CHARACTER_EXPRESSIONS) {
    const blocking={...plan.request.blocking,characters:plan.request.blocking.characters.map((c,i)=>i===0?{...c,expression}:c)};
    const svg=renderCharacterSceneSvg(blocking,{reenactmentLabel:"tr",renderStyle:EDITORIAL_RENDER_STYLE,artDirection:direction.art});
    const frame=await rasterizeCharacterSceneSvg(svg); assert(frame.ok);
    if(frame.ok) expressions.add(createHash("sha256").update(frame.png).digest("hex"));
  }
  assert.equal(expressions.size,6,"sad/neutral/angry/determined/surprised/happy must not collapse to the same face");
  const battle=planCharacterScene({sceneId:2,text:"Osmanlı askerleri kılıçlarla savaşıyor",contextualDirection:true});
  const battleArt=planCharacterSceneDirection("Osmanlı askerleri kılıçlarla savaşıyor",battle.request.blocking).art;
  const svg=renderCharacterSceneSvg(battle.request.blocking,{reenactmentLabel:"tr",renderStyle:EDITORIAL_RENDER_STYLE,artDirection:battleArt});
  assert.doesNotMatch(svg,/data-art-version="4"/,"unreviewed non-court gear keeps the established renderer");
  console.log("Illustrated character: PASS (pure module, 10 real PNG poses, 6 distinct expression PNGs, old versions, historical armour retained)");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
