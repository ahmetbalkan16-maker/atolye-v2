import {computeCharacterJoints,type CharacterJoints,type CharacterRig,type PoseAngles,type Point} from "../CharacterRig";
import {POSE_ANGLES} from "../CharacterPose";
import type {BlockedCharacter} from "../SceneBlocking";
import type {CharacterActorPlan} from "../../animation/character/CharacterAnimation";
import type {CharacterFrameOverride} from "../SvgSceneRenderer";

export const VOLUME_RIG: CharacterRig=Object.freeze({id:"volume-grounded-v1",headRadius:61,neck:11,torso:110,upperArm:57,lowerArm:53,upperLeg:64,lowerLeg:60,stroke:12});
const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*t*(t*(6*t-15)+10);};
export interface VolumePerformance {readonly x:number;readonly pose:PoseAngles;readonly joints:CharacterJoints;readonly contacts:readonly {readonly x:number;readonly height:number;readonly planted:boolean}[]}

/** New-volume-only performance. Feet are fixed in stage space throughout support;
 * the other foot follows an eased, lifted arc. Two-bone IK bends each knee.
 * No shared/frozen 2D animation plan or provider stage is changed.
 */
export function volumePerformanceFrame(c:BlockedCharacter,actor:CharacterActorPlan|undefined,frame:CharacterFrameOverride,t:number,scale:number):VolumePerformance {
  if(!Number.isFinite(t)||t<0||!Number.isFinite(scale)||scale<60||scale>150) throw new Error("VOLUME_PERFORMANCE_BOUNDS");
  const standing=POSE_ANGLES.STAND,base=POSE_ANGLES[c.pose];
  if(!actor||!['WALK','RUN'].includes(actor.action)||actor.toX===null||actor.toX===c.x) {
    const fixed=actor&&['TALK','POINT','CHEER','BOW','FIGHT','IDLE'].includes(actor.action);
    const rest=c.pose==='WALK'||c.pose==='RUN'?standing:base;
    const pose=fixed?{...frame.pose,legFront:rest.legFront,legBack:rest.legBack}:frame.pose;
    const joints=computeCharacterJoints(VOLUME_RIG,pose,{x:0,y:0},1);
    return {x:frame.x,pose,joints,contacts:[joints.footFront,joints.footBack].map((p,i)=>({x:frame.x*1920+(p.x+(i===0?15:-15))*scale/100,height:-p.y/100,planted:Math.abs(p.y)<1e-6}))};
  }
  const sign=c.facing==='RIGHT'?1:-1,projection=Math.cos(12*Math.PI/180),speed=actor.action==='RUN'?2.4:1.05;
  const period=actor.action==='RUN'?.5:.9,total=Math.abs(actor.toX-c.x)*1920/(scale*projection),ramp=Math.min(.25,total/speed),travel=total/speed+ramp;
  const centerAt=(time:number)=>{const s=Math.max(0,Math.min(travel,time));return s<ramp?speed*s*s/(2*ramp):s>travel-ramp?total-speed*(travel-s)**2/(2*ramp):speed*(s-ramp/2);};
  const u=Math.max(0,t-actor.delaySeconds),moving=Math.min(u,travel),center=centerAt(moving);
  const x=c.x+sign*center*scale*projection/1920;
  const stand=computeCharacterJoints(VOLUME_RIG,standing,{x:0,y:0},1);
  const neutral=[(stand.footFront.x+15)/100,(stand.footBack.x-15)/100];
  function stepFoot(time:number,index:number) {
    const offset=index===0?0:period/2;
    if(index===0&&time<period/2) return {world:neutral[0]!,height:0,planted:true};
    const cycle=Math.floor((time-offset)/period),phase=time-offset-cycle*period;
    const anchor=(k:number)=>k<0||(index===0&&k===0)?neutral[index]!:centerAt(k*period+offset+period/4);
    if(phase<period/2&&cycle>=0) return {world:anchor(cycle),height:0,planted:true};
    const start=cycle<0?0:cycle*period+offset+period/2,end=cycle<0?period/2:(cycle+1)*period+offset;
    const k=Math.max(0,Math.min(1,(time-start)/(end-start)));
    return {world:anchor(cycle)+(anchor(cycle+1)-anchor(cycle))*ease(k),height:(actor!.action==='RUN'?.22:.15)*Math.sin(Math.PI*k)**2,planted:false};
  }
  const movingFeet=[0,1].map(i=>stepFoot(moving,i));
  const settle=u>travel?u-travel:0;
  const feet=movingFeet.map((foot,i)=>{
    const k=ease((settle-i*.28)/.28);
    if(settle<=i*.28) return foot;
    return {world:foot.world+(center+neutral[i]!-foot.world)*k,height:foot.height*(1-k)+.12*Math.sin(Math.PI*k)**2,planted:k===1};
  });
  const restHeight=-stand.hip.y/100,desiredHeight=restHeight+((actor.action==='RUN'?.90:.98)-restHeight)*ease(u/.2)*(1-ease(settle/.56));
  const height=Math.min(desiredHeight,...feet.map((f,i)=>f.height+Math.sqrt(Math.max(0,1.24**2-((f.world-center)-(i===0?.15:-.15))**2))));
  const activity=ease(u/.2)*(1-ease(settle/.56)),swing=Math.sin(2*Math.PI*moving/period),arm=c.handProp?8:actor.action==='RUN'?45:22,bend=c.handProp?6:actor.action==='RUN'?55:12;
  const pose={...frame.pose,bodyRotation:0,torsoLean:(actor.action==='RUN'?12:4)*activity,armFront:{upper:standing.armFront.upper+arm*swing*activity,bend:bend*activity},armBack:{upper:standing.armBack.upper-arm*swing*activity,bend:bend*activity}};
  const raw=computeCharacterJoints(VOLUME_RIG,pose,{x:0,y:0},1),dy=-height*100-raw.hip.y;
  const shift=(p:Point):Point=>({x:p.x,y:p.y+dy});
  const joints={...raw,hip:shift(raw.hip),shoulder:shift(raw.shoulder),neck:shift(raw.neck),head:shift(raw.head),elbowFront:shift(raw.elbowFront),handFront:shift(raw.handFront),elbowBack:shift(raw.elbowBack),handBack:shift(raw.handBack)};
  const legs=feet.map((f,i)=>{
    const target={x:(f.world-center)*100-(i===0?15:-15),y:-f.height*100};
    const dx=target.x-joints.hip.x,down=target.y-joints.hip.y,d=Math.hypot(dx,down),upper=VOLUME_RIG.upperLeg,lower=VOLUME_RIG.lowerLeg;
    if(d>upper+lower+1e-5||d<Math.abs(upper-lower)-1e-5) throw new Error("VOLUME_FOOT_REACH_REFUSED");
    const angle=Math.atan2(dx,down)+Math.acos(Math.max(-1,Math.min(1,(upper*upper+d*d-lower*lower)/(2*upper*d))));
    return {foot:target,knee:{x:joints.hip.x+upper*Math.sin(angle),y:joints.hip.y+upper*Math.cos(angle)}};
  });
  return {x,pose,joints:{...joints,kneeFront:legs[0]!.knee,footFront:legs[0]!.foot,kneeBack:legs[1]!.knee,footBack:legs[1]!.foot},contacts:feet.map(f=>({x:(c.x*1920)+sign*f.world*scale*projection,height:f.height,planted:f.planted}))};
}

/** Continuous camera move, including the entrance/exit of the close shot. */
export function volumeCameraZoom(t:number,duration:number):number {
  if(!Number.isFinite(t)||t<0||!Number.isFinite(duration)||duration<=0) throw new Error("VOLUME_CAMERA_TIME");
  if(duration<7) return 1;
  const phase=t%12;
  return 1+.16*Math.min(ease((phase-2.5)/.7),1-ease((phase-8.3)/.7));
}
