import { computeCharacterJoints, type Point, type PoseAngles,type CharacterJoints } from "../CharacterRig";
import { POSE_ANGLES, type CharacterPose } from "../CharacterPose";
import type { CharacterArtDirection } from "../SvgSceneRenderer";
import { reviewedWindowRecipe, type WardrobeBrief } from "./PeriodWardrobe";
import { isHandProp, type HandProp } from "../PropLibrary";
import { isCharacterExpression, type CharacterExpression } from "../CharacterExpression";
import { isHistoricalCostumeHint,type HistoricalCostumeHint } from "../HistoricalCostumeHint";
import {isPeriodProfile,type PeriodProfile} from "./PeriodDesign";
import {createVolumeEquipment} from './VolumeEquipment';

/** Local CPU character geometry shared by stored stills and animated scenes.
 * True XYZ volumes share the established pose rig. No network, GPU or filesystem.
 * PNG previews use a per-pixel z-buffer and smooth sphere lighting. The SVG
 * diagnostic uses depth sorting only; do not use it as the final video renderer.
 */
export type V3 = readonly [number, number, number];
export interface VolumeFace { readonly vertices: readonly [V3, V3, V3]; readonly color: string; readonly normals?: readonly [V3, V3, V3];readonly metallic?:boolean }
export interface VolumeCharacter {
  readonly culture: CharacterArtDirection["culture"];
  readonly role: CharacterArtDirection["roles"][number]["role"];
  readonly pose: CharacterPose;
  readonly mouthOpen: boolean;
  readonly faith: CharacterArtDirection["faith"];
  /** Bounded optional transition from STAND to the named pose for a preview. */
  readonly gesture?: number;
  readonly wardrobe?: WardrobeBrief;
  readonly poseAngles?: PoseAngles;
  readonly expression?: CharacterExpression;
  readonly identity?: number;
  readonly handProp?: HandProp | null;
  readonly costume?: HistoricalCostumeHint;
  readonly designProfile?:PeriodProfile;
  /** Internally calculated bounded rig, never accepted from serialized PNG data. */
  readonly joints?:CharacterJoints;
  readonly equipmentStyle?:'READABLE_V2';
}
const add = (a: V3, b: V3): V3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a: V3, b: V3): V3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a: V3, s: number): V3 => [a[0]*s,a[1]*s,a[2]*s];
const dot = (a: V3, b: V3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: V3,b: V3): V3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (v: V3): V3 => mul(v,1/(Math.hypot(...v)||1));
const ink="#242433",gold="#d7a02f",cream="#fff8e8",blue="#235d9b";

export function createVolumeCharacter(options: VolumeCharacter): readonly VolumeFace[] {
  if(!["UNKNOWN","OTTOMAN","BYZANTINE","ROMAN","EGYPTIAN","WESTERN","STEPPE"].includes(options.culture) || !["RULER","ADVISOR","GUARD","NARRATOR","CITIZEN"].includes(options.role) || !Object.hasOwn(POSE_ANGLES,options.pose) || typeof options.mouthOpen!=="boolean" || !["UNSPECIFIED","ISLAM","CHRISTIANITY","ANCIENT_EGYPT"].includes(options.faith) || (options.gesture!==undefined&&(!Number.isFinite(options.gesture)||options.gesture<0||options.gesture>1)) || (options.expression!==undefined&&!isCharacterExpression(options.expression)) || (options.identity!==undefined&&(!Number.isInteger(options.identity)||options.identity<0||options.identity>7)) || (options.handProp!==undefined&&options.handProp!==null&&!isHandProp(options.handProp))) throw new Error("VOLUME_CHARACTER_OPTIONS_REFUSED");
  if(options.poseAngles) {
    const a=options.poseAngles;
    if([a.torsoLean,a.bodyRotation,a.armFront?.upper,a.armFront?.bend,a.armBack?.upper,a.armBack?.bend,a.legFront?.upper,a.legFront?.bend,a.legBack?.upper,a.legBack?.bend].some(v=>!Number.isFinite(v)||Math.abs(v)>360)) throw new Error("VOLUME_POSE_REFUSED");
  }
  if(options.costume!==undefined&&!isHistoricalCostumeHint(options.costume)) throw new Error("VOLUME_COSTUME_REFUSED");
  if(options.designProfile!==undefined&&(!isPeriodProfile(options.designProfile)||(options.designProfile!=='BASE'&&options.culture!=='OTTOMAN'))) throw new Error("VOLUME_PROFILE_REFUSED");
  if(options.joints&&(Object.keys(options.joints).length!==12||Object.values(options.joints).some(p=>!p||Object.keys(p).length!==2||![p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<1200)))) throw new Error("VOLUME_JOINTS_REFUSED");
  const faces: VolumeFace[]=[];
  const recipe=options.wardrobe?reviewedWindowRecipe(options.wardrobe,options.culture,options.role):null;
  const triangle=(a: V3,b: V3,c: V3,color: string,normals?: readonly [V3,V3,V3])=>faces.push({vertices:[a,b,c],color,...(normals?{normals}:{})});
  const ball=(center: V3,radii: V3,color: string,around=24,rings=12) => {
    const vertex=(i: number,j: number): V3 => {
      const a=2*Math.PI*i/around,b=Math.PI*j/rings;
      return add(center,[radii[0]*Math.sin(b)*Math.cos(a),radii[1]*Math.cos(b),radii[2]*Math.sin(b)*Math.sin(a)]);
    };
    for(let j=0;j<rings;j++) for(let i=0;i<around;i++) {
      const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);
      const normal=(v: V3)=>unit([(v[0]-center[0])/(radii[0]*radii[0]),(v[1]-center[1])/(radii[1]*radii[1]),(v[2]-center[2])/(radii[2]*radii[2])]);
      if(j!==0) triangle(a,b,d,color,[normal(a),normal(b),normal(d)]);
      if(j!==rings-1) triangle(b,c,d,color,[normal(b),normal(c),normal(d)]);
    }
  };
  const tube=(a: V3,b: V3,r1: number,r2: number,color: string,segments=20) => {
    const axis=unit(sub(b,a)),u=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[0,0,1])),v=cross(axis,u);
    const at=(c: V3,r: number,t: number)=>add(c,add(mul(u,r*Math.cos(t)),mul(v,r*Math.sin(t))));
    const normal=(t: number)=>unit(add(add(mul(u,Math.cos(t)),mul(v,Math.sin(t))),mul(axis,(r1-r2)/(Math.hypot(...sub(b,a))||1))));
    for(let i=0;i<segments;i++) {
      const t=i*2*Math.PI/segments,q=(i+1)*2*Math.PI/segments;
      const aa=at(a,r1,t),ab=at(a,r1,q),ba=at(b,r2,t),bb=at(b,r2,q);
      triangle(aa,ab,ba,color,[normal(t),normal(q),normal(t)]); triangle(ab,bb,ba,color,[normal(q),normal(q),normal(t)]);
      triangle(a,ab,aa,color); triangle(b,ba,bb,color);
    }
  };
  const wire=(points: readonly V3[],radius: number,color: string,segments=8) => {
    for(let i=1;i<points.length;i++) tube(points[i-1]!,points[i]!,radius,radius,color,segments);
  };
  const garment=(top: V3,bottom: V3,rx: number,bx: number,rz: number,bz: number,color: string) => {
    const normal=(t: number)=>unit(cross([-rx*Math.sin(t),0,rz*Math.cos(t)],[bottom[0]-top[0]+(bx-rx)*Math.cos(t),bottom[1]-top[1],bottom[2]-top[2]+(bz-rz)*Math.sin(t)]));
    for(let i=0;i<40;i++) {
      const a=i*2*Math.PI/40,b=(i+1)*2*Math.PI/40;
      const p=(c: V3,x: number,z: number,t: number): V3=>add(c,[x*Math.cos(t),0,z*Math.sin(t)]);
      const aa=p(top,rx,rz,a),ab=p(top,rx,rz,b),ba=p(bottom,bx,bz,a),bb=p(bottom,bx,bz,b);
      triangle(aa,ab,ba,color,[normal(a),normal(b),normal(a)]);triangle(ab,bb,ba,color,[normal(b),normal(b),normal(a)]);
      triangle(top,ab,aa,color);triangle(bottom,ba,bb,color);
    }
  };
  const named=options.poseAngles??POSE_ANGLES[options.pose],standing=POSE_ANGLES.STAND,t=options.gesture??1;
  const mix=(a: number,b: number)=>a+(b-a)*t;
  const pose={torsoLean:mix(standing.torsoLean,named.torsoLean),bodyRotation:mix(standing.bodyRotation,named.bodyRotation),armFront:{upper:mix(standing.armFront.upper,named.armFront.upper),bend:mix(standing.armFront.bend,named.armFront.bend)},armBack:{upper:mix(standing.armBack.upper,named.armBack.upper),bend:mix(standing.armBack.bend,named.armBack.bend)},legFront:{upper:mix(standing.legFront.upper,named.legFront.upper),bend:mix(standing.legFront.bend,named.legFront.bend)},legBack:{upper:mix(standing.legBack.upper,named.legBack.upper),bend:mix(standing.legBack.bend,named.legBack.bend)}};
  const raw=options.joints??computeCharacterJoints({id:"volume-candidate-v1",headRadius:61,neck:11,torso:110,upperArm:57,lowerArm:53,upperLeg:64,lowerLeg:60,stroke:12},pose,{x:0,y:0},1);
  const p=(v: Point,x=0,z=0): V3=>[(v.x+x)/100,-v.y/100,z];
  const head=p(raw.head,0,.03),shoulder=p(raw.shoulder),hip=p(raw.hip);
  const ruler=options.role==="RULER",advisor=options.role==="ADVISOR",guard=options.role==="GUARD";
  const culture=options.culture;
  const modern=(!options.designProfile||options.designProfile==='BASE')&&!ruler&&!advisor&&!guard&&(options.costume===undefined||options.costume==="NONE"),identity=options.identity??0;
  const palette=["#dfae34","#327989","#94657f","#517854","#655a89","#a96843","#35688c","#675548"];
  const profile=options.designProfile??'BASE',janissary=profile.startsWith('JANISSARY'),mailPlate=profile==='OTTOMAN_MAIL_PLATE',fez=profile==='OTTOMAN_FEZ_COURT';
  const officer=profile==='JANISSARY_OFFICER_18';
  const coat=fez?'#242d3d':officer?'#e5e0d1':profile==='JANISSARY_GUARDHOUSE_18'?'#76503c':janissary?'#79705f':mailPlate?'#626f79':modern?palette[identity]!:recipe==="OTTOMAN_15_PORTRAIT"?"#913947":culture==="OTTOMAN"?ruler?"#a31b31":advisor?"#225b58":"#343c50":culture==="BYZANTINE"||culture==="WESTERN"?ruler?"#673074":advisor?"#323042":"#91a1ae":culture==="STEPPE"?"#375c68":cream;
  const shortKilt=recipe==="EGYPTIAN_DYNASTY_18",shortTunic=recipe==="ROMAN_EARLY_IMPERIAL"||mailPlate||fez||profile==='JANISSARY_EARLY';
  const bottomY=Math.max(.18,hip[1]-(officer?.98:profile==='JANISSARY_EARLY'?.25:janissary?.58:fez?.30:mailPlate?.35:modern?.18:shortKilt||shortTunic?.42:.96));
  if(ruler&&["ROMAN","BYZANTINE"].includes(culture)) garment(add(shoulder,[0,.03,-.25]),[hip[0],bottomY-.03,-.22],.51,.67,.16,.22,culture==="ROMAN"?"#a32837":"#70296d");
  for(const [knee,foot,side] of [[raw.kneeBack,raw.footBack,-1],[raw.kneeFront,raw.footFront,1]] as const) {
    const k=p(knee,side*15,side*.05),f=p(foot,side*15,side*.05);
    tube(add(hip,[side*.15,0,0]),k,janissary?.19:.095,janissary?.18:.09,janissary?profile==='JANISSARY_GUARDHOUSE_18'?'#315d80':'#f1e2c3':ink);tube(k,f,janissary?.18:.09,janissary?.12:.075,janissary?profile==='JANISSARY_GUARDHOUSE_18'?'#315d80':'#f1e2c3':ink);
    ball(add(f,[.08,.06,.13]),[.26,.105,.29],cream);ball(add(f,[.08,.015,.13]),[.265,.035,.3],"#44454e",20,6);
  }
  if(shortKilt) {
    garment(shoulder,hip,.42,.28,.21,.22,cream);
    garment(hip,[hip[0],bottomY,0],.35,.48,.24,.30,"#fffdf2");
  } else garment(shoulder,[hip[0],bottomY,0],.44,.58,.23,.33,coat);
  if(officer) {
    garment(add(shoulder,[0,.04,-.23]),[hip[0],bottomY-.05,-.20],.59,.76,.22,.29,'#34312e');
    for(const side of [-1,1]) wire([add(shoulder,[side*.38,.02,.23]),[hip[0]+side*.59,bottomY,.33]],.09,'#34312e');
    for(let row=0;row<5;row++) for(const side of [-1,1]) {const center=add(shoulder,[side*.20,-.28-row*.29,.285]);wire([add(center,[-.025,.025,0]),center,add(center,[.025,-.025,0])],.008,'#b8aa83');}
  } else if(profile==='JANISSARY_EARLY') {
    garment(add(shoulder,[0,.04,-.25]),[hip[0],Math.max(.12,hip[1]-.8),-.22],.54,.67,.18,.23,'#655d50');
    for(let row=0;row<6;row++) ball(add(shoulder,[.08,-.18-row*.17,.28]),[.018,.018,.015],'#dfd4b5',8,4);
  } else if(fez) {
    garment(add(shoulder,[0,.05,-.24]),[hip[0],Math.max(.18,hip[1]-.75),-.22],.57,.66,.18,.23,'#262731');
    wire([add(shoulder,[-.18,.015,.21]),add(shoulder,[0,-.24,.29]),add(shoulder,[.18,.015,.21])],.027,gold);
    ball(add(shoulder,[0,-.25,.315]),[.075,.095,.025],gold,16,8);
  }
  if(options.joints&&!shortKilt) for(let i=0;i<7;i++) {
    const x=(i-3)*.10;
    wire([add(shoulder,[x,-.18,.235]),[hip[0]+x*1.3,bottomY+.08,.32]],.013,i%2?'#ae9266':'#6f675b');
  }
  for(const side of [-1,1]) {
    const elbow=p(side===1?raw.elbowFront:raw.elbowBack,side*39,side*.10);
    const hand=p(side===1?raw.handFront:raw.handBack,side*39,side*.10);
    const s=add(shoulder,[side*.39,0,0]),cuff=add(elbow,mul(sub(hand,elbow),.7));
    const sleeveColor=officer?'#34312e':shortKilt?cream:coat,sleeveWidth=janissary?.23:shortKilt||shortTunic?.105:.185;
    tube(s,elbow,sleeveWidth,sleeveWidth*.9,sleeveColor);ball(elbow,[sleeveWidth*.9,sleeveWidth*.9,sleeveWidth*.9],sleeveColor);
    tube(elbow,cuff,sleeveWidth*.9,sleeveWidth*.82,sleeveColor);tube(cuff,add(cuff,mul(sub(hand,cuff),.28)),sleeveWidth*.85,sleeveWidth*.85,janissary?'#ded6c2':mailPlate?'#89969e':shortKilt?cream:gold);
    tube(cuff,hand,.065,.07,ink);ball(hand,[.155,.185,.14],cream);
    ball(add(hand,[side*-.10,.055,.1]),[.07,.11,.075],cream,16,8);
    // A raised gold edge and repeated floral ornaments follow the torso center.
    const hem:[number,number,number]=[hip[0]+side*.44,bottomY+.05,.255];
    if(!shortKilt&&!janissary&&!mailPlate) wire([add(shoulder,[side*.28,-.03,.2]),hem],.023,recipe==="OTTOMAN_15_PORTRAIT"?"#e9d9bd":gold);
    if(!modern&&!guard&&!janissary&&!fez&&!shortKilt&&!shortTunic&&recipe!=="OTTOMAN_15_PORTRAIT") for(let i=0;i<5;i++) {
      const t=(i+.6)/5,center=add(mul(shoulder,1-t),mul([hip[0],bottomY+.12,0],t));
      const x=side*(.18+.16*t),z=.24+.07*t;
      ball(add(center,[x,0,z]),[.025,.043,.013],gold,8,4);
      for(const offset of [-1,1]) ball(add(center,[x+offset*.035,-.035,z]),[.035,.018,.014],gold,8,4);
    }
  }
  if(recipe==="OTTOMAN_15_PORTRAIT") {
    for(const side of [-1,1]) wire([add(shoulder,[side*.13,.035,.245]),[hip[0]+side*.17,bottomY+.01,.355]],.075,"#dbcab0");
  }
  if(recipe==="OTTOMAN_16_TEXTILE") {
    for(const side of [-1,1]) for(let row=0;row<4;row++) {
      const points: V3[]=[],y=shoulder[1]-.27-row*.36,x=hip[0]+side*.29,z=.30;
      for(let i=0;i<=16;i++) {const t=i*2*Math.PI/16;points.push([x+.09*Math.sin(t),y+.17*Math.cos(t),z]);}wire(points,.012,gold);
    }
  }
  if(recipe==="BYZANTINE_PALAIOLOGAN") {
    wire([add(shoulder,[-.20,-.03,.27]),add(hip,[.27,.12,.33]),[hip[0]-.21,bottomY+.1,.35]],.062,gold);
    for(let row=0;row<5;row++) ball(add(shoulder,[-.15+row*.08,-.12-row*.18,.32]),[.028,.039,.018],cream,10,6);
  }
  if(janissary) {
    garment([hip[0],hip[1]-.05,0],[hip[0],hip[1]-.19,0],.46,.47,.28,.29,officer?'#8b4638':profile==='JANISSARY_GUARDHOUSE_18'?'#a53b41':'#756348');
    if(officer) for(let i=0;i<7;i++) ball(add(hip,[(i-3)*.07,-.12,.30]),[.019,.025,.013],'#c0aa79',8,4);
  } else if(!modern&&!fez&&!mailPlate) {
    garment([hip[0],hip[1]-.1,0],[hip[0],hip[1]-.19,0],.48,.485,.28,.29,gold);
    ball(add(hip,[0,-.14,.3]),[.14,.13,.05],gold,20,10);
    ball(add(hip,[0,-.14,.351]),[.075,.083,.025],"#ae1838",16,8);
  }
  // Collar / breastplate / broad collar are separate volumes, not flat costumes.
  if(culture==="ROMAN"&&(ruler||guard)) {
    garment(add(shoulder,[0,-.03,.025]),add(hip,[0,.15,.025]),.38,.32,.25,.28,ruler?"#bb8a31":"#9eabb3");
    for(let i=0;i<3;i++) wire([add(shoulder,[-.30,-.23-i*.2,.2]),add(shoulder,[0,-.30-i*.2,.29]),add(shoulder,[.30,-.23-i*.2,.2])],.035,ruler?gold:"#ccd6db");
    ball(add(shoulder,[.32,.01,.23]),[.13,.12,.055],gold);
  } else if(culture==="EGYPTIAN") {
    for(let i=0;i<4;i++) {
      const points: V3[]=[];
      for(let j=0;j<=20;j++) {const a=j*Math.PI/20;points.push(add(shoulder,[(.24+i*.06)*Math.cos(a),-.07-(.15+i*.06)*Math.sin(a),.265]));}
      wire(points,.028,i%2?gold:blue);
    }
  } else if(janissary||mailPlate) {
    wire([add(shoulder,[-.20,.01,.20]),add(shoulder,[0,-.19,.28]),add(shoulder,[.20,.01,.20])],.025,mailPlate?'#8e9ba2':'#d3cdb9');
  } else if(!modern) {
    wire([add(shoulder,[-.21,.015,.18]),add(shoulder,[0,-.23,.26]),add(shoulder,[.21,.015,.18])],.035,gold);
    ball(add(shoulder,[0,-.23,.28]),[.095,.12,.04],gold);
    ball(add(shoulder,[0,-.23,.321]),[.04,.07,.024],"#357996",16,8);
  }
  if(modern) {
    wire([add(shoulder,[-.2,.02,.24]),add(shoulder,[0,-.08,.3]),add(shoulder,[.20,.02,.24])],.07,identity===0?gold:"#dec6af");
    wire([add(shoulder,[.10,-.09,.32]),add(shoulder,[.2,-.55,.33])],.06,identity===0?gold:"#dec6af");
  }
  if(options.costume==="ARMOR") {
    garment(add(shoulder,[0,-.04,.04]),add(hip,[0,.03,.04]),.39,.35,.27,.29,"#8397a4");
    for(let row=0;row<4;row++) wire([add(shoulder,[-.30,-.20-row*.19,.24]),add(shoulder,[0,-.25-row*.19,.34]),add(shoulder,[.30,-.20-row*.19,.24])],.018,"#c5d3d9");
  }
  const metalize=(start:number)=>{for(let i=start;i<faces.length;i++) faces[i]={...faces[i]!,metallic:true};};
  if(mailPlate) {
    const start=faces.length;
    garment(add(shoulder,[0,-.07,.06]),add(hip,[0,-.27,.05]),.40,.39,.26,.28,'#626f7a');
    const detailStart=faces.length;
    for(let row=0;row<10;row++) for(let col=0;col<10;col++) {
      const center=add(shoulder,[(col-4)*.072+(row%2)*.03,-.14-row*.13,.32]),ring:V3[]=[];
      for(let j=0;j<=8;j++){const a=j*Math.PI/4;ring.push(add(center,[.04*Math.cos(a),.046*Math.sin(a),0]));}wire(ring,.009,row%2?'#b7c1c7':'#8d9ca5',4);
    }
    for(let row=0;row<3;row++) for(const side of [-1,1]) {
      const center=add(shoulder,[side*.15,-.66-row*.22,.37]),a=add(center,[-.135,.095,0]),b=add(center,[-.135,-.095,0]),c=add(center,[.135,-.095,0]),d=add(center,[.135,.095,0]);
      triangle(a,b,c,'#a6b3bb',[[0,0,1],[0,0,1],[0,0,1]]);triangle(a,c,d,'#a6b3bb',[[0,0,1],[0,0,1],[0,0,1]]);
      wire([a,b,c,d,a],.012,'#d0d5d4');
      wire([add(center,[-.09,.04,.008]),add(center,[.06,.04,.008]),add(center,[.06,-.025,.008]),add(center,[-.04,-.025,.008])],.006,'#d3d6cd');
      for(const x of [-.11,.11]) for(const y of [-.065,.065]) ball(add(center,[x,y,.014]),[.014,.014,.012],'#b99961',8,4);
    }
    if(options.equipmentStyle==='READABLE_V2'&&options.joints) {
      // Skin body details along the same shoulder->waist surface as the coat.
      // Fixed world offsets used to leave rings/plates floating below a bow.
      const span=1.37,shear=(shoulder[0]-hip[0])/span,stretch=(shoulder[1]-hip[1]+.27)/span;
      const skin=(v:V3):V3=>[v[0]+shear*(v[1]-shoulder[1]),shoulder[1]+stretch*(v[1]-shoulder[1]),v[2]];
      const normal=(v:V3):V3=>unit([v[0],(v[1]-shear*v[0])/stretch,v[2]]);
      for(let i=detailStart;i<faces.length;i++){const f=faces[i]!;faces[i]={...f,vertices:f.vertices.map(skin) as unknown as typeof f.vertices,...(f.normals?{normals:f.normals.map(normal) as unknown as typeof f.normals}:{})};}
    }
    for(const side of [-1,1]) for(let row=0;row<5;row++) for(let col=0;col<3;col++) {
      const elbow=p(side===1?raw.elbowFront:raw.elbowBack,side*39,side*.10),hand=p(side===1?raw.handFront:raw.handBack,side*39,side*.10),k=(row+.4)/6,center=add(add(mul(elbow,1-k),mul(hand,k)),[(col-1)*.055,0,.17]),ring:V3[]=[];
      for(let j=0;j<=8;j++){const a=j*Math.PI/4;ring.push(add(center,[.033*Math.cos(a),.035*Math.sin(a),0]));}wire(ring,.008,'#b0bac0',4);
    }
    metalize(start);
  }
  if(fez) {
    for(const side of [-1,1]) {ball(add(shoulder,[side*.40,.025,0]),[.17,.12,.25],gold);}
    if(fez) for(let row=0;row<5;row++) ball(add(shoulder,[0,-.15-row*.20,.275]),[.025,.025,.02],gold,8,4);
  }
  tube(shoulder,add(head,[0,-.50,0]),.105,.11,cream);
  const headStart=faces.length;
  ball(head,[.61,.62,.55],cream,64,32);
  // Face volumes lie on the front of the spherical head.
  for(const side of [-1,1]) {
    ball(add(head,[side*.205,.055,.512]),[.075,.115,.035],ink,24,12);
    ball(add(head,[side*.205-.018,.095,.544]),[.019,.028,.012],"#ffffff",12,6);
    ball(add(head,[side*.39,-.14,.402]),[.065,.027,.012],"#e7a898",16,6);
    const angry=options.expression==="ANGRY",determined=guard||options.expression==="DETERMINED",sad=options.expression==="SAD";
    wire([add(head,[side*.32,sad?.19:.24,.445]),add(head,[side*.12,angry?.10:determined?.18:sad?.30:.25,.52])],.023,ink);
  }
  ball(add(head,[0,-.065,.565]),[.047,.036,.042],"#f5e7d8",16,8);
  if(options.mouthOpen) {
    ball(add(head,[0,-.285,.478]),[.175,.13,.047],ink,28,12);
    ball(add(head,[0,-.22,.517]),[.14,.027,.016],"#ffffff",24,8);
    ball(add(head,[0,-.355,.505]),[.075,.028,.018],"#e36978",20,8);
  } else if(options.expression==="SURPRISED") ball(add(head,[0,-.29,.48]),[.075,.11,.04],ink);
  else {
    const points: V3[]=[];
    for(let i=0;i<=12;i++) {const x=-.17+i*.34/12;points.push(add(head,[x,options.expression==="SAD"?-.24-Math.pow(x/.17,2)*.06:options.expression==="ANGRY"?-.26-Math.pow(x/.17,2)*.035:options.expression==="NEUTRAL"||options.expression==="DETERMINED"?-.28:-.30+Math.pow(x/.17,2)*.06,.49]));}
    wire(points,.016,ink);
  }
  if(advisor||(modern&&identity%3===1)) {
    for(const side of [-1,1]) {
      const points: V3[]=[];for(let i=0;i<=28;i++) {const t=i*2*Math.PI/28;points.push(add(head,[side*.205+.165*Math.cos(t),.055+.18*Math.sin(t),.56]));} wire(points,.014,ink);
    }
    wire([add(head,[-.04,.055,.57]),add(head,[.04,.055,.57])],.016,ink);
    if(culture==="OTTOMAN") ball(add(head,[0,-.50,.37]),[.32,.23,.18],"#d8d8d1",28,14);
  }
  if(officer) {
    ball(add(head,[0,-.41,.37]),[.25,.23,.18],'#dfdfd8',28,14);
    ball(add(head,[0,1.04,-.08]),[.45,.73,.40],cream,40,24);
    for(let row=0;row<8;row++) {
      const points:V3[]=[];for(let j=0;j<=18;j++){const x=-.39+j*.78/18,y=.54+row*.12+x*.6,z=.40*Math.sqrt(Math.max(0,1-(x/.45)**2-((y-1.04)/.73)**2))-.065;points.push(add(head,[x,y,z]));}wire(points,.016,'#c8bea8');
    }
  } else if(fez) {
    garment(add(head,[0,.99,-.06]),add(head,[0,.45,-.06]),.37,.52,.33,.47,'#a32338');
    wire([add(head,[.23,.99,.05]),add(head,[.56,.75,.02]),add(head,[.59,.27,.02])],.035,ink);
  } else if(janissary&&profile!=='JANISSARY_GUARDHOUSE_18') {
    garment(add(head,[-.26,1.80,-.07]),add(head,[0,.42,-.04]),.12,.50,.12,.41,cream);
    ball(add(head,[-.32,1.75,-.12]),[.20,.17,.19],cream,28,14);
    garment(add(head,[-.34,1.76,-.20]),add(head,[-.48,1.02,-.28]),.11,.15,.05,.06,cream);
    wire([add(head,[-.50,.43,.25]),add(head,[0,.41,.43]),add(head,[.50,.43,.25])],.015,'#b7ac97');
  } else if(mailPlate) {
    const start=faces.length;
    ball(add(head,[0,.53,-.07]),[.66,.51,.55],'#879ba8',40,20);
    tube(add(head,[0,.95,-.07]),add(head,[0,1.31,-.07]),.17,.025,'#b9c6ca');
    wire([add(head,[-.57,.32,.29]),add(head,[0,.42,.52]),add(head,[.57,.32,.29])],.032,gold);
    wire([add(head,[0,.50,.55]),add(head,[0,-.15,.61])],.024,'#c2cbd0');
    for(const side of [-1,1]) for(let row=0;row<10;row++) wire([add(head,[side*.56,.34-row*.11,.15]),add(head,[side*.63,.28-row*.11,-.08])],.028,row%2?'#aabac1':'#6a7d8a');
    metalize(start);
  } else if(options.costume==="HELMET"||options.costume==="ARMOR") {
    ball(add(head,[0,.42,-.08]),[.635,.36,.55],"#9daebc",36,16);
    wire([add(head,[-.53,.32,.30]),add(head,[0,.40,.50]),add(head,[.53,.32,.30])],.025,"#dce3e5");
  } else if(!modern&&culture==="OTTOMAN") {
    const size=profile==='JANISSARY_GUARDHOUSE_18'?1.16:ruler?1:advisor?.91:.86;
    ball(add(head,[0,.60*size,-.05]),[.68*size,.39*size,.54*size],profile==='JANISSARY_GUARDHOUSE_18'?'#977751':"#f7ead3",48,24);
    for(let row=0;row<4;row++) {
      const points: V3[]=[];
      for(let i=0;i<=24;i++) {
        const x=(-.58+i*1.16/24)*size,y=(.40+row*.095)*size+x*.10;
        const z=.54*size*Math.sqrt(Math.max(0,1-Math.pow(x/(.68*size),2)-Math.pow((y-.60*size)/(.39*size),2)))-.05;
        points.push(add(head,[x,y,z+.014]));
      } wire(points,.015,"#c5ae83");
    }
    if(ruler&&recipe!=="OTTOMAN_15_PORTRAIT") {
      ball(add(head,[.10,.48,.51]),[.105,.145,.035],gold);ball(add(head,[.10,.48,.55]),[.056,.092,.025],"#b61f40");
      wire([add(head,[.12,.72,.03]),add(head,[.30,1.10,.02])],.02,gold);
      for(let i=0;i<5;i++) ball(add(head,[.21+i*.018,.84+i*.05,.01]),[.055,.16,.03],"#f0cd70",14,8);
    }
  } else if((culture==="BYZANTINE"||culture==="WESTERN")&&ruler) {
    ball(add(head,[0,.62,-.02]),[.53,.25,.48],"#64295e",32,14);
    garment(add(head,[0,.71,0]),add(head,[0,.43,0]),.56,.57,.47,.49,gold);
    for(let i=0;i<18;i++) {
      const a=i*2*Math.PI/18,front=Math.sin(a);
      ball(add(head,[.566*Math.cos(a),.48,.495*front]),[.035,.035,.026],cream,10,6);
      if(i%2===0) ball(add(head,[.57*Math.cos(a),.61,.497*front]),[.043,.064,.031],i%4?"#225487":"#ae1e39",12,6);
    }
    for(const side of [-1,1]) for(let i=0;i<5;i++) ball(add(head,[side*.575,.39-i*.077,.06]),[.037,.04,.037],cream,10,6);
    if(options.faith==="CHRISTIANITY") {
      tube(add(head,[0,.82,0]),add(head,[0,1.02,0]),.021,.021,gold);
      tube(add(head,[-.077,.955,0]),add(head,[.077,.955,0]),.022,.022,gold);
    }
  } else if(culture==="ROMAN"&&ruler&&recipe!=="ROMAN_EARLY_IMPERIAL") {
    const points: V3[]=[];
    for(let i=0;i<=24;i++) {const a=i*2*Math.PI/24;points.push(add(head,[.585*Math.cos(a),.39+.05*Math.sin(a),.38*Math.sin(a)]));} wire(points,.02,"#355333");
    for(const side of [-1,1]) for(let i=0;i<8;i++) {
      const a=.35+i*.28;
      ball(add(head,[side*.57*Math.cos(a),.37+.12*Math.sin(a),.40*Math.sin(a)]),[.055,.095,.025],i%2?"#4d783c":"#72924a",14,8);
    }
  } else if(culture==="EGYPTIAN"&&!modern) {
    for(const side of [-1,1]) {
      ball(add(head,[side*.57,.03,-.07]),[.18,.67,.35],blue,24,14);
      for(let i=0;i<8;i++) ball(add(head,[side*.57,.56-i*.145,.20]),[.17,.027,.045],gold,16,6);
    }
    ball(add(head,[0,.52,-.03]),[.59,.24,.51],blue,32,14);
    for(let i=0;i<3;i++) {
      const points: V3[]=[];for(let j=0;j<=20;j++){const x=-.53+j*1.06/20;points.push(add(head,[x,.47+i*.07,.46-Math.pow(x/.62,2)*.20]));} wire(points,.024,gold);
    }
    ball(add(head,[0,.52,.485]),[.044,.115,.048],gold,16,8);
    if(ruler) ball(add(head,[0,.66,.475]),[.075,.045,.039],gold,16,8);
  } else if(guard) {
    ball(add(head,[0,.42,-.08]),[.635,.36,.55],"#9daebc",36,16);
    wire([add(head,[-.53,.32,.30]),add(head,[0,.40,.50]),add(head,[.53,.32,.30])],.025,"#dce3e5");
    ball(add(head,[0,.81,-.15]),[.08,.17,.38],"#a5263a",24,12);
  } else {
    ball(add(head,[0,.46,-.12]),[.60,.25,.5],modern&&identity%2===0?"#343c4b":culture==="BYZANTINE"?"#353447":"#684d3c",28,14);
  }
  if(options.joints) {
    const tilt=pose.torsoLean*.35*Math.PI/180;
    const turn=(v:V3,normal=false):V3=>{const q=normal?v:sub(v,head),r:V3=[q[0]*Math.cos(tilt)+q[1]*Math.sin(tilt),-q[0]*Math.sin(tilt)+q[1]*Math.cos(tilt),q[2]];return normal?r:add(head,r);};
    for(let i=headStart;i<faces.length;i++){const f=faces[i]!;faces[i]={...f,vertices:f.vertices.map(v=>turn(v)) as unknown as typeof f.vertices,...(f.normals?{normals:f.normals.map(v=>turn(v,true)) as unknown as typeof f.normals}:{})};}
  }
  if(options.equipmentStyle!==undefined&&options.equipmentStyle!=='READABLE_V2') throw new Error('VOLUME_EQUIPMENT_STYLE_REFUSED');
  if(options.equipmentStyle==='READABLE_V2') {
    if(guard&&options.handProp===undefined) {faces.push(...createVolumeEquipment(raw,'SPEAR',true),...createVolumeEquipment(raw,'SHIELD'));}
    else if(options.handProp) faces.push(...createVolumeEquipment(raw,options.handProp));
  }
  if(options.equipmentStyle===undefined&&guard&&options.handProp===undefined) {
    const hand=p(raw.handBack,-39,-.10),end=add(hand,[-.04,2.4,0]);
    tube(add(hand,[0,-.65,0]),end,.025,.025,"#775637");
    tube(end,add(end,[0,.28,0]),.075,0,"#a4b5c0");
    ball(p(raw.handFront,39,.27),[.32,.45,.075],culture==="EGYPTIAN"?blue:"#763746",24,16);
  }
  if(options.equipmentStyle===undefined&&options.handProp) {
    const start=faces.length;
    const hand=p(raw.handFront,39,.10),tip=add(hand,[0,1.25,0]);
    if(["SPEAR","FLAG","TORCH"].includes(options.handProp)) {
      tube(add(hand,[0,-.6,0]),tip,.025,.025,"#775637");
      if(options.handProp==="SPEAR") tube(tip,add(tip,[0,.25,0]),.065,0,"#a4b5c0");
      if(options.handProp==="TORCH") ball(tip,[.10,.22,.10],"#e8a435",16,8);
      if(options.handProp==="FLAG") garment(add(tip,[.23,0,0]),add(tip,[.23,-.32,0]),.25,.25,.035,.035,"#a3293a");
    } else if(options.handProp==="SWORD") {tube(hand,add(hand,[0,.72,0]),.05,0,"#b9c8d3");tube(add(hand,[-.14,.06,0]),add(hand,[.14,.06,0]),.025,.025,gold);}
    else if(options.handProp==="SHIELD") ball(add(hand,[0,0,.15]),[.32,.45,.075],"#75384a");
    else if(options.handProp==="SCROLL") {garment(add(hand,[0,.20,.1]),add(hand,[0,-.20,.1]),.27,.27,.035,.035,cream);}
    else if(options.handProp==="BOW") wire([add(hand,[0,.55,0]),add(hand,[.22,0,0]),add(hand,[0,-.55,0])],.035,"#775637");
    if(options.joints) {
      const a=Math.max(-80,Math.min(80,(pose.armFront.upper+pose.armFront.bend-8)*.6))*Math.PI/180;
      const turn=(v:V3,normal=false):V3=>{const q=normal?v:sub(v,hand),r:V3=[q[0]*Math.cos(a)+q[1]*Math.sin(a),-q[0]*Math.sin(a)+q[1]*Math.cos(a),q[2]];return normal?r:add(hand,r);};
      for(let i=start;i<faces.length;i++){const f=faces[i]!;faces[i]={...f,vertices:f.vertices.map(v=>turn(v)) as unknown as typeof f.vertices,...(f.normals?{normals:f.normals.map(v=>turn(v,true)) as unknown as typeof f.normals}:{})};}
    }
  }
  const angle=pose.bodyRotation*Math.PI/180;
  if(!angle) return faces;
  const rotate=(v: V3): V3=>[v[0]*Math.cos(angle)+v[1]*Math.sin(angle),-v[0]*Math.sin(angle)+v[1]*Math.cos(angle),v[2]];
  const rotated=faces.map(face=>({...face,vertices:face.vertices.map(rotate) as unknown as readonly [V3,V3,V3],...(face.normals?{normals:face.normals.map(rotate) as unknown as readonly [V3,V3,V3]}:{})}));
  if(!options.joints) return rotated;
  let low=Infinity;for(const f of rotated) for(const v of f.vertices) low=Math.min(low,v[1]);
  return rotated.map(f=>({...f,vertices:f.vertices.map(v=>[v[0],v[1]-low,v[2]] as V3) as unknown as typeof f.vertices}));
}

/** Bounded z-buffer and interpolated lighting. CPU only, no SVG overlap artefacts.
 * RGBA pixels can be fed to the installed Sharp rasterizer; no downloads required.
 */
export function rasterizeVolumeCharacter(faces: readonly VolumeFace[],options: {readonly width: number;readonly height: number;readonly x: number;readonly y: number;readonly scale: number;readonly yaw: number}): Uint8Array {
  if(!faces.length||faces.length>100000||![options.width,options.height].every(Number.isInteger)||options.width<1||options.width>1920||options.height<1||options.height>1080||![options.x,options.y,options.scale,options.yaw].every(Number.isFinite)||options.scale<=0||options.scale>500) throw new Error("VOLUME_RASTER_BOUNDS");
  const pixels=new Uint8Array(options.width*options.height*4),depths=new Float32Array(options.width*options.height);depths.fill(-Infinity);
  const yaw=options.yaw*Math.PI/180,pitch=.07,light=unit([-1,2,3]);
  const transform=(v: V3): V3=>{
    const x=v[0]*Math.cos(yaw)+v[2]*Math.sin(yaw),z=-v[0]*Math.sin(yaw)+v[2]*Math.cos(yaw);
    return [x,v[1]*Math.cos(pitch)-z*Math.sin(pitch),v[1]*Math.sin(pitch)+z*Math.cos(pitch)];
  };
  const edge=(a: V3,b: V3,x: number,y: number)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
  for(const face of faces) {
    if(!/^#[0-9a-f]{6}$/i.test(face.color)||face.vertices.some(v=>v.length!==3||v.some(c=>!Number.isFinite(c)||Math.abs(c)>12))||face.normals?.some(v=>v.length!==3||v.some(c=>!Number.isFinite(c)||Math.abs(c)>1.001))) throw new Error("VOLUME_MESH_REFUSED");
    const camera=face.vertices.map(transform),normal=unit(cross(sub(camera[1]!,camera[0]!),sub(camera[2]!,camera[0]!)));
    const illuminate=(n:V3)=>.60+.40*Math.max(0,dot(n,light))+(face.metallic?.20*Math.max(0,dot(n,unit(add(light,[0,0,1]))))**14:0);
    const shade=face.normals?face.normals.map(v=>illuminate(transform(v))):[0,1,2].map(()=>illuminate(normal));
    const v=camera.map(p=>[options.x+p[0]*options.scale,options.y-p[1]*options.scale,p[2]] as V3),a=v[0]!,b=v[1]!,c=v[2]!;
    const area=edge(a,b,c[0],c[1]);if(Math.abs(area)<1e-8) continue;
    const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(options.width-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(options.height-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    const rgb=[1,3,5].map(i=>parseInt(face.color.slice(i,i+2),16));
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
      const u=edge(b,c,x+.5,y+.5)/area,w=edge(c,a,x+.5,y+.5)/area,t=1-u-w;
      if(u<0||w<0||t<0) continue;
      const depth=u*a[2]+w*b[2]+t*c[2],index=y*options.width+x;
      if(depth<=depths[index]!) continue;
      depths[index]=depth;
      const brightness=u*shade[0]!+w*shade[1]!+t*shade[2]!;
      for(let i=0;i<3;i++) pixels[index*4+i]=Math.min(255,Math.round(rgb[i]!*brightness));
      pixels[index*4+3]=255;
    }
  }
  return pixels;
}

export function renderVolumeCharacterSvg(faces: readonly VolumeFace[], options: {readonly yaw: number; readonly x: number; readonly y: number; readonly scale: number}): string {
  if(!faces.length||faces.length>100000||![options.yaw,options.x,options.y,options.scale].every(Number.isFinite)||options.scale<=0||options.scale>500) throw new Error("VOLUME_PREVIEW_BOUNDS");
  const yaw=options.yaw*Math.PI/180,pitch=.07;
  const transform=(p: V3): V3=>{
    const x=p[0]*Math.cos(yaw)+p[2]*Math.sin(yaw),z=-p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw);
    return [x,p[1]*Math.cos(pitch)-z*Math.sin(pitch),p[1]*Math.sin(pitch)+z*Math.cos(pitch)];
  };
  const light=unit([-1,2,3]);
  const projected=faces.map(face=>{
    if(!/^#[0-9a-f]{6}$/i.test(face.color)||face.vertices.some(v=>v.length!==3||v.some(c=>!Number.isFinite(c)||Math.abs(c)>12))) throw new Error("VOLUME_MESH_REFUSED");
    const v=face.vertices.map(transform),normal=unit(cross(sub(v[1]!,v[0]!),sub(v[2]!,v[0]!)));
    const illumination=.60+.40*Math.max(0,dot(normal,light));
    const color="#"+[1,3,5].map(i=>Math.round(parseInt(face.color.slice(i,i+2),16)*illumination).toString(16).padStart(2,"0")).join("");
    return {v,color,depth:(v[0]![2]+v[1]![2]+v[2]![2])/3};
  }).sort((a,b)=>a.depth-b.depth);
  const n=(v: number)=>String(Math.round(v*100)/100);
  return `<g data-volume-preview="1" data-projection="orthographic" data-yaw="${n(options.yaw)}">${projected.map(({v,color})=>`<path d="M${v.map(p=>`${n(options.x+p[0]*options.scale)} ${n(options.y-p[1]*options.scale)}`).join("L")}Z" fill="${color}" stroke="${color}" stroke-width="0.35" stroke-linejoin="round"/>`).join("")}</g>`;
}

/** Plain OBJ coordinates allow later artist editing; no executable or URLs. */
export function volumeCharacterObj(faces: readonly VolumeFace[]): string {
  if(!faces.length||faces.length>100000) throw new Error("VOLUME_OBJ_BOUNDS");
  return "# Atolye experimental volume v1; untextured geometry, not an animation asset\n"+faces.map((face,i)=>face.vertices.map(v=>{
    if(v.some(c=>!Number.isFinite(c)||Math.abs(c)>12)) throw new Error("VOLUME_OBJ_VERTEX_REFUSED");
    return `v ${v.map(c=>c.toFixed(5)).join(" ")}\n`;
  }).join("")+`f ${3*i+1} ${3*i+2} ${3*i+3}\n`).join("");
}
