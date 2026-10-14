import {characterAnimationFrame,type CharacterActorPlan} from "../animation/character/CharacterAnimation";
import type {BlockedCharacter,SceneBlocking} from "../character/SceneBlocking";
import {volumePerformanceFrame} from "../character/volume/VolumePerformance";
import {volumeSpeakingFrame} from "../character/volume/VolumeSpeech";
import type {CinematicActor} from "./CinematicStoryPlan";
import {PUPPET_MODEL_TO_TEXELS} from "./PuppetSkinRenderer";
export function actorPhase(id:string){let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;return (h%997)/997;}
/** One clock per scene episode, shared across camera cuts. Each actor has its
 * own stagger and motion plan; no chorus of identical simultaneous motions. */
export function cinematicActorPerformance(actor:CinematicActor,time:number,origin:number,size:number,speaking:boolean,reactionAt?:number){
 if(![time,origin,size].every(Number.isFinite)||origin<0||time<origin||size<200||size>1000)throw Error("CINEMATIC_PERFORMANCE_CLOCK");
 const phase=actorPhase(actor.instanceId),local=time-origin,c:BlockedCharacter={
  id:actor.instanceId,x:actor.x,depth:0,facing:actor.facing==="right"?"RIGHT":"LEFT",
  pose:"STAND",expression:"NEUTRAL",costume:"NONE",handProp:null
 };
 const factor=PUPPET_MODEL_TO_TEXELS*size/500;
 const stepOnOrder=actor.action==="drill"&&reactionAt!==undefined&&time>=reactionAt;
 const walking=actor.action==="walk"||stepOnOrder;
 const target=Math.max(.03,Math.min(.97,actor.x+(actor.facing==="right"?1:-1)*(stepOnOrder?.035:.13)/factor));
 const action:CharacterActorPlan["action"]=walking?"WALK":actor.action==="speak"&&speaking?"TALK":["prepare","serve"].includes(actor.action)?"POINT":"IDLE";
 const plan:CharacterActorPlan={id:c.id,action,toX:walking?target:null,delaySeconds:stepOnOrder?reactionAt!-origin:walking?.15+phase*1.45:phase*.5};
 const blocking:SceneBlocking={backdrop:"INTERIOR",time:"DAY",characters:[c],props:[],arrows:[],caption:null};
 const f=characterAnimationFrame(blocking,{schemaVersion:"1",fps:15,actors:[plan]},local)[c.id]!;
 let frame=action==="TALK"?volumeSpeakingFrame(f,local,false):f;
 if(actor.action==="prepare")frame={...frame,pose:{...frame.pose,armFront:{upper:8,bend:45+12*Math.sin(local*.9+phase*6)},armBack:{upper:-8,bend:15}}};
 if(reactionAt!==undefined&&time>=reactionAt&&time<reactionAt+1.2){
  const nod=Math.sin(Math.PI*(time-reactionAt)/1.2)*5;
  frame={...frame,pose:{...frame.pose,torsoLean:frame.pose.torsoLean+nod}};
 }
 const performance=volumePerformanceFrame(c,plan,frame,local,100);
 return {joints:performance.joints,x:actor.x+(performance.x-actor.x)*factor,
  contacts:performance.contacts.map(p=>({...p,x:actor.x*1920+(p.x-actor.x*1920)*factor})),
  phase,delaySeconds:plan.delaySeconds,action,clockOrigin:origin};
}
