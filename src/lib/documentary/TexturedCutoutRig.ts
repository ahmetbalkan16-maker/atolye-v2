import sharp, {type OverlayOptions} from "sharp";
import type {Point,CharacterJoints} from "../character/CharacterRig";
/** Explicit in-memory preview rig. Named source parts and pivots remain attached
 * to their native, hash-checked culture/period/role pack. No production admission. */
export const TEXTURED_PARTS=["head","head-speaking","torso","upper-arm-front","forearm-front","upper-arm-back","forearm-back","hand-front","hand-back","thigh-front","shin-front","thigh-back","shin-back"] as const;
export type TexturedPartName=typeof TEXTURED_PARTS[number];
export interface TexturedRigPart {readonly png:Buffer;readonly pivot:Point}
export interface TexturedCutoutRig {readonly admission:"PREVIEW_ONLY";readonly parts:ReadonlyMap<TexturedPartName,TexturedRigPart>}
/** Technical rest-axis calibration for this illustrated cutout template.
 * It shares bone math only; there are no cultural images in this module. */
const ends:Readonly<Record<TexturedPartName,Point>>={
 head:{x:.56,y:.50},"head-speaking":{x:.57,y:.51},torso:{x:.50,y:.90},
 "upper-arm-front":{x:.81,y:.80},"forearm-front":{x:.85,y:.54},
 "upper-arm-back":{x:.24,y:.80},"forearm-back":{x:.22,y:.64},
 "hand-front":{x:.47,y:.75},"hand-back":{x:.51,y:.75},
 "thigh-front":{x:.49,y:.90},"shin-front":{x:.56,y:.92},
 "thigh-back":{x:.53,y:.89},"shin-back":{x:.56,y:.92},
};
interface PreparedPart {png:Buffer;width:number;height:number;pivot:Point;end:Point;sole:readonly Point[]}
export async function prepareTexturedCutoutRig(rig:TexturedCutoutRig){
 if(rig.admission!=="PREVIEW_ONLY"||rig.parts.size!==13||TEXTURED_PARTS.some(n=>!rig.parts.has(n)))throw Error("TEXTURED_RIG_PARTS");
 const parts=new Map<TexturedPartName,PreparedPart>();
 for(const [name,p] of rig.parts){
  if(!TEXTURED_PARTS.includes(name)||!p||![p.pivot.x,p.pivot.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error("TEXTURED_RIG_PIVOT");
  const m=await sharp(p.png,{limitInputPixels:1_000_000}).metadata();
  if(m.format!=="png"||!m.hasAlpha||!m.width||!m.height||m.width<50||m.height<50||m.width>1000||m.height>1000)throw Error("TEXTURED_RIG_SOURCE");
  const raw=await sharp(p.png).ensureAlpha().raw().toBuffer(),sole:Point[]=[];
  let solid=0;
  // Lower outline sample for foot contact. Native decoder samples source alpha,
  // never paints/removes pixels or invents a footwear image.
  for(let y=0;y<m.height;y++){
   let min=m.width,max=-1,count=0;
   for(let x=0;x<m.width;x++)if(raw[(y*m.width+x)*4+3]!>200){min=Math.min(min,x);max=Math.max(max,x);count++;solid++;}
   if(count>=8&&y>=m.height*.5){sole.push({x:min,y},{x:max,y});}
  }
  if(solid<100)throw Error("TEXTURED_RIG_EMPTY");
  const end=ends[name];
  parts.set(name,{png:p.png,width:m.width,height:m.height,pivot:{x:p.pivot.x*m.width,y:p.pivot.y*m.height},
   end:{x:end.x*m.width,y:end.y*m.height},sole});
 }
 const base=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"/>');
 const paint=async (name:TexturedPartName,from:Point,to:Point):Promise<OverlayOptions>=>{
  const p=parts.get(name)!;let sourceEnd=p.end,theta=0;
  const targetLength=Math.hypot(to.x-from.x,to.y-from.y),targetAngle=Math.atan2(to.y-from.y,to.x-from.x);
  if(targetLength<1||targetLength>700)throw Error("TEXTURED_RIG_BONE_BOUNDS");
  if(name.startsWith("shin-")&&p.sole.length){
   // Select the supporting sole corner after rotation, then fit that corner to
   // the grounded skeleton's foot. The foot's alpha does not sink below it.
   for(let pass=0;pass<4;pass++){
    theta=targetAngle-Math.atan2(sourceEnd.y-p.pivot.y,sourceEnd.x-p.pivot.x);
    const co=Math.cos(theta),si=Math.sin(theta);
    sourceEnd=p.sole.reduce((a,b)=>((b.x-p.pivot.x)*si+(b.y-p.pivot.y)*co>(a.x-p.pivot.x)*si+(a.y-p.pivot.y)*co)?b:a);
   }
  }
  const length=Math.hypot(sourceEnd.x-p.pivot.x,sourceEnd.y-p.pivot.y);
  if(length<10)throw Error("TEXTURED_RIG_REST_AXIS");
  const scale=targetLength/length,angle=(targetAngle-Math.atan2(sourceEnd.y-p.pivot.y,sourceEnd.x-p.pivot.x))*180/Math.PI;
  const width=Math.max(1,Math.round(p.width*scale)),height=Math.max(1,Math.round(p.height*scale));
  if(width>1000||height>1000)throw Error("TEXTURED_RIG_RASTER_BOUNDS");
  const rotated=await sharp(p.png).resize(width,height,{fit:"fill"}).rotate(angle,{background:"#00000000"}).png({compressionLevel:1}).toBuffer();
  const rm=await sharp(rotated).metadata(),rw=rm.width!,rh=rm.height!,rad=angle*Math.PI/180;
  const px=p.pivot.x*width/p.width-width/2,py=p.pivot.y*height/p.height-height/2;
  const anchor={x:rw/2+px*Math.cos(rad)-py*Math.sin(rad),y:rh/2+px*Math.sin(rad)+py*Math.cos(rad)};
  const left=Math.round(from.x-anchor.x),top=Math.round(from.y-anchor.y);
  // Physical joints are inside the canvas; source padding can cross an edge.
  const sx=Math.max(0,-left),sy=Math.max(0,-top),w=Math.min(rw-sx,1000-Math.max(0,left)),h=Math.min(rh-sy,1000-Math.max(0,top));
  if(w<1||h<1)throw Error("TEXTURED_RIG_OFF_CANVAS");
  const input=sx||sy||w!==rw||h!==rh?await sharp(rotated).extract({left:sx,top:sy,width:w,height:h}).png({compressionLevel:1}).toBuffer():rotated;
  return {input,left:Math.max(0,left),top:Math.max(0,top)};
 };
 return async (joints:CharacterJoints,input:{speaking:boolean;facing:"left"|"right";scale:number}):Promise<Buffer>=>{
  if(!Number.isFinite(input.scale)||input.scale<1||input.scale>2.5||!["left","right"].includes(input.facing)||
    Object.values(joints).some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>400||Math.abs(p.y)>500))throw Error("TEXTURED_RIG_JOINT_BOUNDS");
  const point=(p:Point,dx=0):Point=>({x:500+(p.x+dx)*input.scale,y:950+p.y*input.scale});
  const layers:OverlayOptions[]=[];
  const bone=async(n:TexturedPartName,a:Point,b:Point,offset=0)=>layers.push(await paint(n,point(a,offset),point(b,offset)));
  const hand=async(n:TexturedPartName,elbow:Point,wrist:Point,offset:number)=>{
   const d=Math.hypot(wrist.x-elbow.x,wrist.y-elbow.y),end={x:wrist.x+(wrist.x-elbow.x)/d*35,y:wrist.y+(wrist.y-elbow.y)/d*35};
   await bone(n,wrist,end,offset);
  };
  await bone("upper-arm-back",joints.shoulder,joints.elbowBack,51);
  await bone("forearm-back",joints.elbowBack,joints.handBack,51);
  await hand("hand-back",joints.elbowBack,joints.handBack,51);
  await bone("thigh-back",joints.hip,joints.kneeBack,-15);
  await bone("shin-back",joints.kneeBack,joints.footBack,-15);
  await bone("thigh-front",joints.hip,joints.kneeFront,15);
  await bone("shin-front",joints.kneeFront,joints.footFront,15);
  await bone("torso",joints.shoulder,joints.hip);
  await bone("upper-arm-front",joints.shoulder,joints.elbowFront,-58);
  await bone("forearm-front",joints.elbowFront,joints.handFront,-58);
  await hand("hand-front",joints.elbowFront,joints.handFront,-58);
  await bone(input.speaking?"head-speaking":"head",joints.neck,joints.head);
  const png=await sharp(base).composite(layers).png({compressionLevel:1}).toBuffer();
  return input.facing==="left"?sharp(png).flop().png({compressionLevel:1}).toBuffer():png;
 };
}
