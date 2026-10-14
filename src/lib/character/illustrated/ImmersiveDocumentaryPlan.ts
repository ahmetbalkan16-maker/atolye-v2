/** Editorial subshots, separate from frozen pipeline stages/scene admission.
 * Thirty camera zooms on one actor/room do not count as thirty visual changes. */
export interface ImmersiveVisualShot {
 readonly startSeconds:number;readonly endSeconds:number;
 readonly civilization:string;readonly period:string;readonly role:string;
 readonly characterId:string;readonly environmentId:string;
 readonly narrationAnchor:string;readonly action:string;
}
export function requiredImmersiveVisualChanges(durationSeconds:number):number{
 if(!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>600)throw Error("IMMERSIVE_DURATION");
 return Math.ceil(durationSeconds/6);
}
export function inspectImmersiveVisualPlan(durationSeconds:number,shots:readonly ImmersiveVisualShot[]){
 const required=requiredImmersiveVisualChanges(durationSeconds);
 if(!Array.isArray(shots)||shots.length<1||shots.length>128)throw Error("IMMERSIVE_SHOT_CAPACITY");
 const id=/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.v[1-9][0-9]*$/;
 let last=0,changes=0,longest=0,previous:ImmersiveVisualShot|undefined;
 for(const s of shots){
  if(!s||!Number.isFinite(s.startSeconds)||!Number.isFinite(s.endSeconds)||s.startSeconds<0||Math.abs(s.startSeconds-last)>.001||s.endSeconds<=s.startSeconds||s.endSeconds>durationSeconds+.001||!id.test(s.characterId)||!id.test(s.environmentId)||typeof s.narrationAnchor!=="string"||s.narrationAnchor.trim().length<8||s.narrationAnchor.length>1200||typeof s.action!=="string"||s.action.trim().length<2||s.action.length>128)throw Error("IMMERSIVE_SHOT_BINDING");
  // Every shot has its own exact namespace. A documentary can visit different
  // civilizations in different shots; their character/background never mix.
  const expected=[s.civilization,s.period,s.role].join(".");
  if(s.characterId.split(".").slice(0,3).join(".")!==expected||s.environmentId.split(".").slice(0,3).join(".")!==expected)throw Error("IMMERSIVE_MIXING_DENIED");
  if(previous&&(previous.characterId!==s.characterId||previous.environmentId!==s.environmentId))changes++;
  longest=Math.max(longest,s.endSeconds-s.startSeconds);last=s.endSeconds;previous=s;
 }
 if(Math.abs(last-durationSeconds)>.001)throw Error("IMMERSIVE_DURATION_COVERAGE");
 return {requiredChanges:required,actualChanges:changes,shotCount:shots.length,longestShotSeconds:longest,
  accepted:changes>=required&&longest<=6+.001,
  reason:changes<required?"INSUFFICIENT_CHARACTER_OR_ENVIRONMENT_CHANGES":longest>6+.001?"SHOT_TOO_LONG":"PASS",
  authority:"NONE" as const};
}
