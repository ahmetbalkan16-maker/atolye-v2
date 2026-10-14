import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {loadCinematicWorldPreviewArtwork} from "./lib/cinematic-preview-art";
import {prepareCinematicPreviewRenderer,cinematicSpriteTop} from "../src/lib/documentary/CinematicPreviewRenderer";
import type {CinematicShot} from "../src/lib/documentary/CinematicStoryPlan";
async function main(){
 assert.equal(cinematicSpriteTop(996,840,810),186);
 assert.throws(()=>cinematicSpriteTop(996,840,841),/FOOT/);
 const request={packDirectory:"ottoman/early-modern/janissary/cinematic-reference/v1",atlasPath:"design/cinematic-atlas.png",identityPackDirectory:"ottoman/early-modern/janissary/reference/v1",identitySheetPath:"design/pose-atlas.png",poseOverrides:[{index:7,path:"design/serving-pose.png"}]};
 await assert.rejects(loadCinematicWorldPreviewArtwork({...request,identityPackDirectory:"persia/achaemenid/immortal/default/v1"}),/IDENTITY_CONTEXT/);
 await assert.rejects(loadCinematicWorldPreviewArtwork({...request,atlasPath:"../outside.png"}),/UNDECLARED/);
 const {artwork,character,environments}=await loadCinematicWorldPreviewArtwork(request);
 const env=environments.find(f=>f.declaration.path==="environments/courtyard.png")!.declaration;
 const serving=artwork.characters.get(character.id)!.poses[7]!,raw=await sharp(serving).ensureAlpha().raw().toBuffer();
 let strayOpaque=0;for(let y=0;y<500;y++)for(let x=0;x<60;x++)if(raw[(y*500+x)*4+3]!>200)strayOpaque++;
 assert.equal(strayOpaque,0,"isolated serving sprite contains no neighboring sword fragment on left edge");
 const render=await prepareCinematicPreviewRenderer(artwork);
 const shot:CinematicShot={id:"qa-grounded",startSeconds:0,endSeconds:5,civilization:"ottoman",period:"early-modern",year:1480,
  environment:{id:env.id,contentSha256:env.sha256},camera:"feet",purpose:"Opaque sole to floor placement",narrationAnchor:"Avluya yürüyen asker",
  actors:[{instanceId:"hero",character,x:.46,depth:.95,facing:"right",action:"walk",emotion:"serious",lookAt:"travel"}],interactions:[]};
 const png=await render(shot,.7),again=await render(shot,.7);
 assert.deepEqual(png,again,"deterministic source/shot/time");
 await assert.rejects(render({...shot,environment:{...shot.environment,contentSha256:"0".repeat(64)}},.7),/ENV_BINDING/);
 await assert.rejects(render({...shot,actors:[{...shot.actors[0],character:{...character,contentSha256:"0".repeat(64)}}]},.7),/CHARACTER_BINDING/);
 await assert.rejects(render(shot,5.2),/TIME/);
 const output=path.resolve("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/grounded-frame-qa");
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,"feet.png"),png);
 const kitchen=environments.find(f=>f.declaration.path==="environments/kitchen.png")!.declaration;
 const dining=await render({...shot,camera:"two-shot",environment:{id:kitchen.id,contentSha256:kitchen.sha256},actors:[{...shot.actors[0],x:.38,action:"serve"},{...shot.actors[0],instanceId:"companion",x:.70,depth:.88,action:"listen",facing:"left"}]},.7);
 fs.writeFileSync(path.join(output,"serving.png"),dining);
 const wide=await render({...shot,camera:"wide"},.7);fs.writeFileSync(path.join(output,"wide.png"),wide);
 console.log(JSON.stringify({status:"PASS",output,admission:"PREVIEW_ONLY",footPaddingAccounted:true,hash:createHash("sha256").update(png).digest("hex"),sourceRightsNotPromoted:true}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
