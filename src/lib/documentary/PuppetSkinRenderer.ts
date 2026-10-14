import sharp from "sharp";
import type {CharacterJoints,Point} from "../character/CharacterRig";
import {computeCharacterJoints} from "../character/CharacterRig";
import {POSE_ANGLES} from "../character/CharacterPose";
import {VOLUME_RIG} from "../character/volume/VolumePerformance";
const rest=computeCharacterJoints(VOLUME_RIG,POSE_ANGLES.STAND,{x:0,y:0},1);
type JointName=keyof CharacterJoints;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
export const PUPPET_MODEL_TO_TEXELS=1.16;
interface Vertex {x:number;y:number;u:number;v:number}
export interface PuppetSkinProfile {readonly frontHand:Point;readonly backHand:Point;readonly frontElbowV:number;readonly backElbowV:number;readonly shoulderV:number;readonly hipV:number;readonly kneeV:number;readonly footV:number}
export const DEFAULT_PUPPET_PROFILE:PuppetSkinProfile={frontHand:{x:.406,y:.73},backHand:{x:.78,y:.68},frontElbowV:.63,backElbowV:.59,shoulderV:.49,hipV:.78,kneeV:.87,footV:.92};
export function puppetSkinPoint(j:CharacterJoints,uv:Point,p:PuppetSkinProfile=DEFAULT_PUPPET_PROFILE):Point{
 const delta=(n:JointName):Point=>({x:(j[n].x-rest[n].x)*PUPPET_MODEL_TO_TEXELS*Math.cos(12*Math.PI/180),y:(j[n].y-rest[n].y)*PUPPET_MODEL_TO_TEXELS});
 const mix=(a:Point,b:Point,u:number)=>({x:a.x+(b.x-a.x)*clamp(u),y:a.y+(b.y-a.y)*clamp(u)});
 const u=uv.x,v=uv.y,head=mix(delta("head"),delta("neck"),(v-.32)/.15),torso=mix(delta("shoulder"),delta("hip"),(v-.48)/(p.hipV-.48));
 let d=v<.47?head:torso;
 if(v>p.hipV){const front=u<.52,knee=delta(front?"kneeFront":"kneeBack"),foot=delta(front?"footFront":"footBack");const leg=v<p.kneeV?mix(delta("hip"),knee,(v-p.hipV)/(p.kneeV-p.hipV)):mix(knee,foot,(v-p.kneeV)/(p.footV-p.kneeV));d=mix(torso,leg,(v-p.hipV)/.04);}
 if(v>.47&&v<p.hipV){const front=u<.52,elbowV=front?p.frontElbowV:p.backElbowV,handV=front?p.frontHand.y:p.backHand.y,elbow=delta(front?"elbowFront":"elbowBack"),hand=delta(front?"handFront":"handBack");const arm=v<elbowV?mix(delta("shoulder"),elbow,(v-p.shoulderV)/(elbowV-p.shoulderV)):mix(elbow,hand,(v-elbowV)/(handV-elbowV));const lateral=front?clamp((.50-u)/.08):clamp((u-.63)/.10),gate=Math.min(clamp((v-.47)/.025),clamp((p.hipV-v)/.025));d=mix(d,arm,lateral*gate);}
 return {x:u*500+d.x,y:v*500+d.y};
}
/** CPU texture skinning, not a replacement drawing. The approved bitmap is the
 * unchanged UV source. Closed anatomical regions blend the existing grounded
 * skeleton's deltas; no native/frozen rig or animation stage is rewritten. */
export async function preparePuppetSkin(png:Buffer,profile:PuppetSkinProfile=DEFAULT_PUPPET_PROFILE){
 const values=[profile.frontHand.x,profile.frontHand.y,profile.backHand.x,profile.backHand.y,profile.frontElbowV,profile.backElbowV,profile.shoulderV,profile.hipV,profile.kneeV,profile.footV];
 if(values.some(v=>!Number.isFinite(v)||v<0||v>1)||profile.frontHand.y<=profile.frontElbowV||profile.backHand.y<=profile.backElbowV||profile.frontElbowV<=profile.shoulderV||profile.backElbowV<=profile.shoulderV||profile.hipV>=profile.kneeV||profile.kneeV>=profile.footV)throw Error("PUPPET_PROFILE");
 const m=await sharp(png,{limitInputPixels:1_000_000}).metadata();
 if(m.format!=="png"||!m.hasAlpha||!m.width||!m.height)throw Error("PUPPET_SOURCE");
 const original=await sharp(png).resize(500,500,{fit:"contain",background:"#00000000"}).png().toBuffer();
 const padded=await sharp(original).extend({top:0,bottom:50,left:100,right:100,background:"#00000000"}).png().toBuffer();
 const tex=await sharp(original).ensureAlpha().raw().toBuffer();
 return async(j:CharacterJoints):Promise<Buffer>=>{
  if(Object.keys(j).length!==Object.keys(rest).length||Object.keys(rest).some(k=>{
   const p=j[k as JointName];return !p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>350||Math.abs(p.y)>500;
  }))throw Error("PUPPET_JOINT_BOUNDS");
  const delta=(n:JointName):Point=>({x:(j[n].x-rest[n].x)*PUPPET_MODEL_TO_TEXELS*Math.cos(12*Math.PI/180),y:(j[n].y-rest[n].y)*PUPPET_MODEL_TO_TEXELS});
  if(Object.keys(rest).every(k=>Math.abs(delta(k as JointName).x)+Math.abs(delta(k as JointName).y)<1e-9))return padded;
  const output=Buffer.alloc(700*550*4),vertices:Vertex[]=[],cells=25,step=500/cells;
  for(let row=0;row<=cells;row++)for(let col=0;col<=cells;col++){
   const u=col/cells,v=row/cells;
   const point=puppetSkinPoint(j,{x:u,y:v},profile);
   vertices.push({x:100+point.x,y:point.y,u:col*step,v:row*step});
  }
  function triangle(a:Vertex,b:Vertex,c:Vertex){
   const det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
   if(Math.abs(det)<.001)return;
   const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(699,Math.ceil(Math.max(a.x,b.x,c.x)));
   const minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(549,Math.ceil(Math.max(a.y,b.y,c.y)));
   for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+.5,py=y+.5,w1=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/det,w2=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/det,w3=1-w1-w2;
    if(w1<-.00001||w2<-.00001||w3<-.00001)continue;
    const sx=Math.max(0,Math.min(499,Math.floor(w1*a.u+w2*b.u+w3*c.u))),sy=Math.max(0,Math.min(499,Math.floor(w1*a.v+w2*b.v+w3*c.v))),source=(sy*500+sx)*4,dest=(y*700+x)*4;
    const alpha=tex[source+3]!/255;if(alpha===0)continue;
    const old=output[dest+3]!/255,out=alpha+old*(1-alpha);
    for(let k=0;k<3;k++)output[dest+k]=Math.round((tex[source+k]!*alpha+output[dest+k]!*old*(1-alpha))/out);
    output[dest+3]=Math.round(out*255);
   }
  }
  for(let y=0;y<cells;y++)for(let x=0;x<cells;x++){
   const i=y*(cells+1)+x,a=vertices[i]!,b=vertices[i+1]!,c=vertices[i+cells+1]!,d=vertices[i+cells+2]!;
   triangle(a,b,c);triangle(b,d,c);
  }
  return sharp(output,{raw:{width:700,height:550,channels:4}}).png({compressionLevel:1}).toBuffer();
 };
}
