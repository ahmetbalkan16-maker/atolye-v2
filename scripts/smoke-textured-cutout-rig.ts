import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {loadTexturedWorldPreviewRig} from "./lib/textured-preview-rig";
import {prepareTexturedCutoutRig} from "../src/lib/documentary/TexturedCutoutRig";
import {volumePerformanceFrame} from "../src/lib/character/volume/VolumePerformance";
import {characterAnimationFrame,type CharacterActorPlan} from "../src/lib/animation/character/CharacterAnimation";
import type {BlockedCharacter,SceneBlocking} from "../src/lib/character/SceneBlocking";
async function main(){
 const source=loadTexturedWorldPreviewRig("ottoman/early-modern/janissary/reference-rig/v1","ottoman/early-modern/janissary/reference/v1");
 assert.throws(()=>loadTexturedWorldPreviewRig("ottoman/early-modern/janissary/reference-rig/v1","persia/achaemenid/immortal/default/v1"),/CONTEXT/);
 const render=await prepareTexturedCutoutRig(source.rig);
 const c:BlockedCharacter={id:"hero",x:.35,depth:0,facing:"RIGHT",pose:"STAND",expression:"NEUTRAL",costume:"NONE",handProp:null};
 const blocking:SceneBlocking={backdrop:"INTERIOR",time:"DAY",characters:[c],props:[],arrows:[],caption:null};
 const actor:CharacterActorPlan={id:c.id,action:"WALK",toX:.55,delaySeconds:.2};
 const output=path.resolve("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/textured-rig-qa");fs.mkdirSync(output,{recursive:true});
 const records:unknown[]=[];
 for(const [i,t]of [0,.35,.8,1.4,2.1,3.5].entries()){
  const f=characterAnimationFrame(blocking,{schemaVersion:"1",fps:15,actors:[actor]},t)[c.id]!;
  const p=volumePerformanceFrame(c,actor,f,t,100);
  const png=await render(p.joints,{speaking:false,facing:"right",scale:2.4});
  const raw=await sharp(png).ensureAlpha().raw().toBuffer();let lowest=-1;
  for(let y=0;y<1000;y++){let n=0;for(let x=0;x<1000;x++)if(raw[(y*1000+x)*4+3]!>200)n++;if(n>=8)lowest=y;}
  assert.ok(lowest<=954,"textured soles must not penetrate ground");
  if(p.contacts.some(x=>x.planted))assert.ok(lowest>=940,"a planted foot must actually reach the rendered ground");
  fs.writeFileSync(path.join(output,"rig-"+i+".png"),png);
  records.push({time:t,x:p.x,contacts:p.contacts,lowestOpaqueRow:lowest});
 }
 await assert.rejects(render({} as never,{speaking:false,facing:"right",scale:3}),/BOUNDS/);
 fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify({status:"PASS_GEOMETRY_ONLY_VISUAL_FAIL",visualQa:"Disconnected source sockets and neighboring-cell bleed; do not admit",records,sourceSha:source.sourceBundleSha256,sourceId:source.sourceCharacterId,productionAdmission:"NOT_GRANTED",ownerAppearanceAccepted:false},null,2));
 console.log(JSON.stringify({status:"PASS_TECHNICAL_PREVIEW",output,source:source.sourceBundleSha256}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
