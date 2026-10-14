import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {loadCinematicWorldPreviewArtwork} from "./lib/cinematic-preview-art";
import {preparePuppetSkin} from "../src/lib/documentary/PuppetSkinRenderer";
import {volumePerformanceFrame,VOLUME_RIG} from "../src/lib/character/volume/VolumePerformance";
import {computeCharacterJoints} from "../src/lib/character/CharacterRig";
import {POSE_ANGLES} from "../src/lib/character/CharacterPose";
import {characterAnimationFrame,type CharacterActorPlan} from "../src/lib/animation/character/CharacterAnimation";
import type {BlockedCharacter,SceneBlocking} from "../src/lib/character/SceneBlocking";
async function main(){
 const {artwork,character}=await loadCinematicWorldPreviewArtwork({packDirectory:"ottoman/early-modern/janissary/cinematic-reference/v1",atlasPath:"design/cinematic-atlas.png",identityPackDirectory:"ottoman/early-modern/janissary/reference/v1",identitySheetPath:"design/pose-atlas.png",poseOverrides:[{index:7,path:"design/serving-pose.png"}]});
 const source=artwork.characters.get(character.id)!.poses[0]!,render=await preparePuppetSkin(source);
 const neutral=await sharp(source).resize(500,500,{fit:"contain",background:"#00000000"}).extend({top:0,bottom:50,left:100,right:100,background:"#00000000"}).png().toBuffer();
 const rest=computeCharacterJoints(VOLUME_RIG,POSE_ANGLES.STAND,{x:0,y:0},1);
 assert.deepEqual(await render(rest),neutral,"rest pose preserves the approved artwork exactly");
 const c:BlockedCharacter={id:"hero",x:.35,depth:0,facing:"RIGHT",pose:"STAND",expression:"NEUTRAL",costume:"NONE",handProp:null};
 const blocking:SceneBlocking={backdrop:"INTERIOR",time:"DAY",characters:[c],props:[],arrows:[],caption:null};
 const actor:CharacterActorPlan={id:c.id,action:"WALK",toX:.55,delaySeconds:.2};
 const output=path.resolve("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/puppet-skin-qa");fs.mkdirSync(output,{recursive:true});
 const records:unknown[]=[];let changed=0;
 for(const [i,t]of [0,.35,.8,1.4,2.1,3.5].entries()){
  const f=characterAnimationFrame(blocking,{schemaVersion:"1",fps:15,actors:[actor]},t)[c.id]!,p=volumePerformanceFrame(c,actor,f,t,100);
  const png=await render(p.joints);if(!png.equals(neutral))changed++;
  fs.writeFileSync(path.join(output,"skin-"+i+".png"),png);
  records.push({time:t,x:p.x,contacts:p.contacts});
 }
 assert.ok(changed>=4,"grounded joint deltas actually deform the texture, not just move the camera");
 await assert.rejects(render({} as never),/BOUNDS/);
 const wrong={...rest,head:{x:Number.NaN,y:0}};await assert.rejects(render(wrong),/BOUNDS/);
 fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify({status:"PASS_TECHNICAL_PREVIEW",records,sourceId:character.id,productionAdmission:"NOT_GRANTED",ownerAppearanceAccepted:false},null,2));
 console.log(JSON.stringify({status:"PASS_TECHNICAL_PREVIEW",output,changedFrames:changed}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
