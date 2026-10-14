/** Additive editorial direction. This object never grants asset/runtime authority
 * and never changes the frozen video -> audio -> assembly stage order. */
export type CinematicCamera = "feet" | "wide" | "two-shot" | "over-shoulder" | "context" | "pull-back";
export type CinematicEmotion = "attentive" | "serious" | "tired" | "calm";
export type CinematicAction = "walk" | "listen" | "speak" | "drill" | "prepare" | "serve";
export interface CinematicAssetBinding {
 readonly id:string;
 /** Hash of the actual source artwork, not an instance name or metadata file. */
 readonly contentSha256:string;
}
export interface CinematicActor {
 readonly instanceId:string;readonly character:CinematicAssetBinding & {readonly designIdentitySha256:string};
 readonly x:number;readonly depth:number;readonly facing:"left"|"right";
 readonly action:CinematicAction;readonly emotion:CinematicEmotion;
 readonly lookAt:"work"|"travel"|string;
}
export interface CinematicShot {
 readonly id:string;readonly startSeconds:number;readonly endSeconds:number;
 readonly civilization:string;readonly period:string;readonly year:number;
 readonly environment:CinematicAssetBinding;
 readonly camera:CinematicCamera;readonly purpose:string;readonly narrationAnchor:string;
 readonly actors:readonly CinematicActor[];
 readonly interactions:readonly {readonly from:string;readonly to:string;readonly kind:"order"|"response"|"handover"}[];
}
export interface CinematicSource {readonly id:string;readonly url:string;readonly claim:string}
export interface CinematicSpeech {
 readonly startSeconds:number;readonly endSeconds:number;readonly text:string;
 readonly kind:"narrator"|"dramatized-dialogue";readonly speakerInstanceId:string|null;
 readonly shotId:string;readonly pan:number;readonly sourceIds:readonly string[];
}
export interface CinematicStoryPlan {
 readonly schemaVersion:"cinematic-story-v1";readonly durationSeconds:number;
 readonly question:string;readonly cause:string;readonly experience:string;readonly consequence:string;
 readonly sources:readonly CinematicSource[];readonly shots:readonly CinematicShot[];
 readonly speech:readonly CinematicSpeech[];
}

const slug=/^[a-z][a-z0-9-]{0,63}$/;
const assetId=/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9][0-9]*$/;
const sha=/^[a-f0-9]{64}$/;
const cameras=new Set(["feet","wide","two-shot","over-shoulder","context","pull-back"]);
const emotions=new Set(["attentive","serious","tired","calm"]);
const actions=new Set(["walk","listen","speak","drill","prepare","serve"]);
function text(value:unknown,min:number,max:number):value is string {
 return typeof value==="string"&&value.trim().length>=min&&value.length<=max;
}
function bound(binding:CinematicAssetBinding,civilization:string,period:string){
 if(!binding||!assetId.test(binding.id)||!sha.test(binding.contentSha256)||
 binding.id.split(".").slice(0,2).join(".")!==civilization+"."+period)throw Error("CINEMATIC_ASSET_NAMESPACE");
}

/** Semantic quality inspection of a resolved, measured editorial plan. The caller
 * must independently load/admit every source byte through the native library.
 * A renamed ID, extra crowd instance or camera cut cannot inflate visual changes. */
export function inspectCinematicStoryPlan(plan:CinematicStoryPlan){
 if(!plan||plan.schemaVersion!=="cinematic-story-v1"||
 !Number.isFinite(plan.durationSeconds)||plan.durationSeconds<=0||plan.durationSeconds>600||
 ![plan.question,plan.cause,plan.experience,plan.consequence].every(s=>text(s,12,1200)))throw Error("CINEMATIC_STORY_CONTEXT");
 if(!Array.isArray(plan.sources)||plan.sources.length<1||plan.sources.length>32||
 !Array.isArray(plan.shots)||plan.shots.length<1||plan.shots.length>128||
 !Array.isArray(plan.speech)||plan.speech.length>128)throw Error("CINEMATIC_CAPACITY");
 const sources=new Set<string>();
 for(const s of plan.sources){
  if(!s||!slug.test(s.id)||sources.has(s.id)||!text(s.claim,12,1200)||
    !text(s.url,8,2048)||!/^https:\/\/[^\s]+$/.test(s.url))throw Error("CINEMATIC_SOURCE");
  const u=new URL(s.url);
  if(u.username||u.password||u.protocol!=="https:")throw Error("CINEMATIC_SOURCE");
  sources.add(s.id);
 }
 const shots=new Map<string,CinematicShot>(),identities=new Map<string,string>(),designIdentities=new Map<string,string>();
 let cursor=0,changes=0,previous:CinematicShot|undefined,maxShot=0,interactions=0;
 const binding=(b:CinematicAssetBinding,s:CinematicShot)=>{
  bound(b,s.civilization,s.period);
  const previousHash=identities.get(b.id);
  if(previousHash&&previousHash!==b.contentSha256)throw Error("CINEMATIC_ASSET_CHANGED");
  identities.set(b.id,b.contentSha256);
 };
 for(const s of plan.shots){
  if(!s||!slug.test(s.id)||shots.has(s.id)||!slug.test(s.civilization)||!slug.test(s.period)||
   !Number.isInteger(s.year)||s.year<-4000||s.year>2100||
   !Number.isFinite(s.startSeconds)||!Number.isFinite(s.endSeconds)||
   s.startSeconds<0||Math.abs(s.startSeconds-cursor)>.001||s.endSeconds<=s.startSeconds||s.endSeconds>plan.durationSeconds+.001||
   !cameras.has(s.camera)||!text(s.purpose,8,240)||!text(s.narrationAnchor,8,1200)||
   !Array.isArray(s.actors)||s.actors.length>12||
   !Array.isArray(s.interactions)||s.interactions.length>12)throw Error("CINEMATIC_SHOT");
  binding(s.environment,s);
  const cast=new Set<string>();
  for(const a of s.actors){
   if(!a||!slug.test(a.instanceId)||cast.has(a.instanceId)||
     !Number.isFinite(a.x)||a.x<-.2||a.x>1.2||
     !Number.isFinite(a.depth)||a.depth<.35||a.depth>1||
     !["left","right"].includes(a.facing)||!actions.has(a.action)||!emotions.has(a.emotion)||
     !text(a.lookAt,2,64)||a.lookAt==="camera")throw Error("CINEMATIC_ACTOR");
   if(!sha.test(a.character.designIdentitySha256))throw Error("CINEMATIC_DESIGN_IDENTITY");
   const knownIdentity=designIdentities.get(a.character.id);
   if(knownIdentity&&knownIdentity!==a.character.designIdentitySha256)throw Error("CINEMATIC_DESIGN_IDENTITY_CHANGED");
   designIdentities.set(a.character.id,a.character.designIdentitySha256);
   cast.add(a.instanceId);binding(a.character,s);
  }
  for(const a of s.actors)if(!["work","travel"].includes(a.lookAt)&&(!cast.has(a.lookAt)||a.lookAt===a.instanceId))throw Error("CINEMATIC_LOOK_TARGET");
  for(const i of s.interactions){
   if(!i||!cast.has(i.from)||!cast.has(i.to)||i.from===i.to||!["order","response","handover"].includes(i.kind))throw Error("CINEMATIC_INTERACTION");
   interactions++;
  }
  if(s.camera!=="context"&&!s.actors.length)throw Error("CINEMATIC_EMPTY_STAGE");
  const signature=(shot:CinematicShot)=>[...new Set(shot.actors.map(a=>a.character.designIdentitySha256))].sort().join(".");
  if(previous&&(s.environment.contentSha256!==previous.environment.contentSha256||signature(s)!==signature(previous)))changes++;
  cursor=s.endSeconds;maxShot=Math.max(maxShot,s.endSeconds-s.startSeconds);shots.set(s.id,s);previous=s;
 }
 if(Math.abs(cursor-plan.durationSeconds)>.001)throw Error("CINEMATIC_COVERAGE");
 let lastSpeechEnd=0,dialogueCount=0;
 for(const v of plan.speech){
  const s=shots.get(v?.shotId);
  if(!s||!Number.isFinite(v.startSeconds)||!Number.isFinite(v.endSeconds)||
   v.startSeconds<lastSpeechEnd-.001||v.startSeconds<s.startSeconds-.001||
   v.endSeconds> s.endSeconds+.001||v.endSeconds<=v.startSeconds||!text(v.text,2,2400)||
   !Number.isFinite(v.pan)||Math.abs(v.pan)>1||!Array.isArray(v.sourceIds)||v.sourceIds.length>32||
   v.sourceIds.some((id:unknown)=>typeof id!=="string"||!sources.has(id)))throw Error("CINEMATIC_SPEECH");
  if(v.kind==="narrator"){
   if(v.speakerInstanceId!==null||v.pan!==0||!v.sourceIds.length)throw Error("CINEMATIC_NARRATOR");
  }else if(v.kind==="dramatized-dialogue"){
   if(!s.actors.some(a=>a.instanceId===v.speakerInstanceId))throw Error("CINEMATIC_DIALOGUE");
   dialogueCount++;
  }else throw Error("CINEMATIC_SPEECH_KIND");
  lastSpeechEnd=v.endSeconds;
 }
 const requiredChanges=Math.ceil(plan.durationSeconds/6);
 return Object.freeze({storyAccepted:interactions>0&&dialogueCount>0,
  visualPacingAccepted:changes>=requiredChanges&&maxShot<=6.001,
  actualVisualChanges:changes,requiredChanges,maxShotSeconds:maxShot,interactionCount:interactions,dialogueCount,
  authority:"NONE" as const,productionAdmission:"NOT_GRANTED" as const,videoApiCapUsd:1 as const,
  disclosure:"Canlandırma" as const,dialogueDisclosure:"Dramatizasyon — tarihî alıntı değildir" as const});
}
