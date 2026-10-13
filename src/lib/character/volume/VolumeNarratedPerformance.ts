import type {BlockedCharacter,SceneBlocking} from '../SceneBlocking';
import {characterAnimationFrame,type CharacterActorPlan,type CharacterAnimationPlan} from '../../animation/character/CharacterAnimation';
import type {CharacterFrameOverride} from '../SvgSceneRenderer';
import {volumePerformanceFrame} from './VolumePerformance';
import type {VolumeSentenceTiming} from './VolumeSentenceTiming';

/** New V3 main actor only. Measured sentence time drives the action clock.
 * Completed travel carries its endpoint into subsequent sentences: no teleport
 * back to the initial position, and the original supported foot IK is reused. */
export function volumeNarratedActor(character:BlockedCharacter,blocking:SceneBlocking,plan:CharacterAnimationPlan,timing:VolumeSentenceTiming,t:number,scale:number):{character:BlockedCharacter;actor:CharacterActorPlan;frame:CharacterFrameOverride;clock:number} {
 let c:BlockedCharacter={...character,pose:'STAND'};
 const idle=(at:number)=>characterAnimationFrame({...blocking,characters:[c]},{...plan,actors:[{id:c.id,action:'IDLE',toX:null,delaySeconds:0}]},at)[c.id]!;
 for(const s of timing.sentences){
  if(s.start>t)break;
  if(s.action==='WALK'||s.action==='RUN'){
   const speed=s.action==='RUN'?2.4:1.05,span=Math.max(0,s.end-s.start-.9);
   const distance=Math.min(.14,speed*span*.5*scale*Math.cos(12*Math.PI/180)/1920),sign=c.facing==='RIGHT'?1:-1;
   const actor:CharacterActorPlan={id:c.id,action:s.action,toX:Math.max(.14,Math.min(.86,c.x+sign*distance)),delaySeconds:0};
   const clock=Math.max(0,t-s.start),frame=characterAnimationFrame({...blocking,characters:[c]},{...plan,actors:[actor]},clock)[c.id]!;
   const end=volumePerformanceFrame(c,actor,frame,s.end-s.start+1,scale,true);
   if(t<s.end)return {character:c,actor,frame,clock};
   c={...c,x:end.x};continue;
  }
  if(t>=s.end)continue;
  const action=s.action==='FIGHT'&&c.handProp!=='SWORD'?'POINT':s.action;
  const actor:CharacterActorPlan={id:c.id,action,toX:null,delaySeconds:0},clock=t-s.start;
  const moving=characterAnimationFrame({...blocking,characters:[c]},{...plan,actors:[actor]},clock)[c.id]!,rest=idle(t);
  const k=Math.max(0,Math.min(1,clock/.25,(s.end-t)/.25));
  const scalar=(a:number,b:number)=>a+(b-a)*k,limb=(a:{upper:number;bend:number},b:{upper:number;bend:number})=>({upper:scalar(a.upper,b.upper),bend:scalar(a.bend,b.bend)});
  const frame={...moving,pose:{torsoLean:scalar(rest.pose.torsoLean,moving.pose.torsoLean),bodyRotation:scalar(rest.pose.bodyRotation,moving.pose.bodyRotation),armFront:limb(rest.pose.armFront,moving.pose.armFront),armBack:limb(rest.pose.armBack,moving.pose.armBack),legFront:limb(rest.pose.legFront,moving.pose.legFront),legBack:limb(rest.pose.legBack,moving.pose.legBack)}};
  return {character:c,actor,frame,clock};
 }
 return {character:c,actor:{id:c.id,action:'IDLE',toX:null,delaySeconds:0},frame:idle(t),clock:t};
}
