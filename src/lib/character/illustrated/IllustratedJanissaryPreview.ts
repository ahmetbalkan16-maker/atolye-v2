import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {validateWorldPack, type WorldAsset} from "../WorldCharacterLibrary";
import type {CharacterSceneAssetPayload} from "../../animation/character/CharacterSceneAsset";
import {findCharacterSceneAssetPayloadProblems} from "../../animation/character/CharacterSceneAsset";
import type {VolumeSentenceTiming} from "../volume/VolumeSentenceTiming";
import type {VolumeSpeechEnvelope} from "../volume/VolumeSpeech";
import {volumeSpeechLevel} from "../volume/VolumeSpeech";

export const ILLUSTRATED_JANISSARY_ID="ottoman.early-modern.janissary.reference.v1";
export const ILLUSTRATED_PACK_DIRECTORY="ottoman/early-modern/janissary/reference/v1";
export type IllustratedEnvironment="courtyard"|"barracks"|"kitchen";
export interface IllustratedJanissaryPreview {
  readonly characterId:typeof ILLUSTRATED_JANISSARY_ID;
  readonly environment:IllustratedEnvironment;
  readonly background:Buffer;
  readonly poses:readonly Buffer[];
  readonly hashes:Readonly<Record<string,string>>;
  readonly admission:"PREVIEW_ONLY";
}
const kinds=["character","equipment","mount","environment"] as const;
const catalog={
 "design/pose-atlas.png":"a45b41f382109ace319faced5ebc4bd0696ecf492d455f9bbd8e934a507ccc44",
 "environments/courtyard.png":"c8bda4bdc19ef5a60ecac65a9f5e7966f1bf835dd96e77b621946eb0eb8eb983",
 "environments/barracks.png":"96c7f72d779760bf92a183cd685d4d04f5f9dedd04186192441a3095bca89386",
 "environments/kitchen.png":"151931602deaa1bf9fd5447998d0ab9e2fd9d411497b1e87ab9b525b2d03fe3e",
} as const;
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
/** Explicit local preview import. Draft design sheets never acquire production
 * admission, owner/rights approval or an installed limb rig through this reader.
 * Fixed catalog, no metadata-supplied root, no aliases/nearest-period fallback. */
export async function loadIllustratedJanissaryPreview(input:{
  civilization:string;period:string;role:string;characterId:string;year:number;
  environment:IllustratedEnvironment;
}):Promise<IllustratedJanissaryPreview>{
  if(input.civilization!=="ottoman"||input.period!=="early-modern"||input.role!=="janissary"||input.characterId!==ILLUSTRATED_JANISSARY_ID||input.year!==1480||!["courtyard","barracks","kitchen"].includes(input.environment))throw Error("ILLUSTRATED_PREVIEW_CONTEXT");
  const root=path.resolve("libraries/world-characters"),base=path.join(root,ILLUSTRATED_PACK_DIRECTORY);
  const read=(name:string,max:number)=>{
    const file=path.join(base,name),relative=path.relative(root,file);
    if(relative.startsWith("..")||path.isAbsolute(relative))throw Error("ILLUSTRATED_PREVIEW_PATH");
    let ancestor=file;
    while(true){
      if(fs.lstatSync(ancestor).isSymbolicLink()||fs.realpathSync.native(ancestor)!==ancestor)throw Error("ILLUSTRATED_PREVIEW_LINK");
      if(ancestor===root)break;
      ancestor=path.dirname(ancestor);
    }
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size<=0||stat.size>max)throw Error("ILLUSTRATED_PREVIEW_SIZE");
    return fs.readFileSync(file);
  };
  const metadata=kinds.map(k=>JSON.parse(read("metadata/"+k+".json",65536).toString("utf8")));
  const pack=validateWorldPack(metadata,ILLUSTRATED_PACK_DIRECTORY);
  if(pack.character.id!==input.characterId||pack.assets.some(a=>a.status!=="draft"))throw Error("ILLUSTRATED_PREVIEW_METADATA");
  const declared=new Map(pack.assets.flatMap((a:WorldAsset)=>a.files.map(f=>[f.path,f.sha256] as const)));
  const bytes=new Map<string,Buffer>();
  for(const [file,expected] of Object.entries(catalog)){
    const b=read(file,20*1024*1024);
    if(declared.get(file)!==expected||sha(b)!==expected)throw Error("ILLUSTRATED_PREVIEW_HASH");
    bytes.set(file,b);
  }
  const atlas=bytes.get("design/pose-atlas.png")!,meta=await sharp(atlas,{limitInputPixels:4_000_000}).metadata();
  if(meta.format!=="png"||!meta.hasAlpha||meta.width!==1261||meta.height!==1247)throw Error("ILLUSTRATED_PREVIEW_ATLAS");
  const raw=await sharp(atlas).ensureAlpha().raw().toBuffer();
  let clear=0,solid=0;
  for(let i=3;i<raw.length;i+=4){if(raw[i]===0)clear++;if(raw[i]!>240)solid++;}
  if(clear<1261*1247*.3||solid<1261*1247*.1)throw Error("ILLUSTRATED_PREVIEW_ALPHA");
  const poses:Buffer[]=[];
  // Sampling an atlas at animation import, not changing the design source.
  for(let index=0;index<9;index++){
    const col=index%3,row=Math.floor(index/3);
    const left=Math.floor(col*1261/3),top=Math.floor(row*1247/3);
    poses.push(await sharp(atlas).extract({left,top,width:Math.floor((col+1)*1261/3)-left,height:Math.floor((row+1)*1247/3)-top}).resize(500,500,{fit:"contain",background:"#00000000"}).png().toBuffer());
  }
  const bg=bytes.get("environments/"+input.environment+".png")!,bm=await sharp(bg,{limitInputPixels:4_000_000}).metadata();
  if(bm.format!=="png"||!bm.width||!bm.height||bm.width<1600||bm.height<900)throw Error("ILLUSTRATED_PREVIEW_PLATE");
  return Object.freeze({characterId:ILLUSTRATED_JANISSARY_ID,environment:input.environment,background:await sharp(bg).resize(1920,1080,{fit:"cover"}).png().toBuffer(),poses:Object.freeze(poses),hashes:Object.freeze({...catalog}),admission:"PREVIEW_ONLY"});
}

export function illustratedPerformance(t:number,timing?:VolumeSentenceTiming){
  let x=.40,cell=0,action="IDLE",start=0,end=1,index=-1;
  if(timing)for(const [i,s] of timing.sentences.entries()){
    if(t>=s.start&&t<s.end){action=s.action;start=s.start;end=s.end;index=i;break;}
    if(t>=s.end&&(s.action==="WALK"||s.action==="RUN"))x=Math.min(.66,x+.14);
  }
  if(action==="WALK"||action==="RUN"){
    const p=Math.max(0,Math.min(1,(t-start)/Math.max(.01,end-start)));
    x+=.14*(p*p*(3-2*p));cell=(Math.floor((t-start)/(action==="RUN"?.19:.34))%2)+3;
  }else cell=({TALK:1,POINT:2,BOW:5,SIT:6,KNEEL_DOWN:7,FIGHT:8,CHEER:1} as Record<string,number>)[action]??0;
  return {cell,x,action,index,start,end};
}
/** Uses measured sentence timing when supplied. Pose performance and camera cuts,
 * not a claim of continuous joint rigging or phoneme lip synchronisation. */
export async function renderIllustratedJanissaryFrame(payload:CharacterSceneAssetPayload,t:number,duration:number,preview:IllustratedJanissaryPreview,timing?:VolumeSentenceTiming,envelope?:VolumeSpeechEnvelope):Promise<Buffer>{
  if(findCharacterSceneAssetPayloadProblems(payload).length||payload.direction?.art.culture!=="OTTOMAN"||payload.volume?.sceneYears.length!==1||payload.volume.sceneYears[0]!==1480||!payload.volume.design?.actors.some(a=>a.profile==="JANISSARY_EARLY")||preview.characterId!==ILLUSTRATED_JANISSARY_ID||preview.admission!=="PREVIEW_ONLY"||!Number.isFinite(t)||t<0||t>duration+1/15||!Number.isFinite(duration)||duration<=0||duration>120)throw Error("ILLUSTRATED_PREVIEW_FRAME_CONTEXT");
  // The native 15fps frame writer includes one terminal coverage frame.
  // Hold the end pose for that bounded partial frame; do not extend speech.
  t=Math.min(t,duration);
  const cue=illustratedPerformance(t,timing),speaking=!!envelope&&volumeSpeechLevel(envelope,t)>.08;
  const cell=cue.action==="TALK"&&!speaking&&envelope?0:cue.cell;
  const travel=cue.action==="WALK"||cue.action==="RUN",bob=travel?Math.sin(t*(cue.action==="RUN"?25:16))*4:Math.sin(t*2.8)*1.8;
  const fit=illustratedStageFit(preview.environment);
  const actor=await sharp(preview.poses[cell]!).resize(fit.canvas,fit.canvas).png().toBuffer();
  const left=Math.round(cue.x*1920-fit.canvas/2),top=Math.round(fit.floor-fit.canvas+bob);
  const overlays:import("sharp").OverlayOptions[]=[
    {input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><ellipse cx="'+Math.round(cue.x*1920)+'" cy="982" rx="152" ry="15" fill="#201510" opacity=".22"/></svg>')},
    {input:actor,left,top},
  ];
  // Small atmosphere tied to the setting. These are synthetic editorial cues.
  let atmosphere="";
  if(preview.environment==="kitchen")atmosphere='<ellipse cx="365" cy="615" rx="150" ry="95" fill="#ffbb61" opacity="'+(.025+.012*Math.sin(t*6)).toFixed(3)+'"/>';
  else if(preview.environment==="courtyard")for(let i=0;i<7;i++)atmosphere+='<circle cx="'+Math.round((t*21+i*233)%1920)+'" cy="'+(230+i*71)+'" r="2" fill="#ffe7ae" opacity=".17"/>';
  if(atmosphere)overlays.push({input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">'+atmosphere+'</svg>')});
  let scene=await sharp(preview.background).composite(overlays).png({compressionLevel:1}).toBuffer();
  const shot=cue.index<0?0:cue.index%3,zoom=(shot===0?1:shot===1?1.20:1.42)+.02*Math.min(1,t/duration);
  if(zoom>1){
    const width=Math.floor(1920/zoom),height=Math.floor(1080/zoom);
    scene=await sharp(scene).extract({left:Math.max(0,Math.min(1920-width,Math.round(cue.x*1920-width/2))),top:Math.min(1080-height,Math.max(0,Math.round((fit.floor-fit.canvas*.52)-height/2))),width,height}).resize(1920,1080).png({compressionLevel:1}).toBuffer();
  }
  const label='<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="40" y="38" width="280" height="50" rx="8" fill="#1b1b25" opacity=".82"/><text x="58" y="72" font-family="Arial" font-size="24" fill="white">CANLANDIRMA · 1480</text><rect x="40" y="994" width="710" height="46" rx="8" fill="#1b1b25" opacity=".80"/><text x="60" y="1025" font-family="Arial" font-size="22" fill="white">Osmanlı yeniçerisi — görsel ve hareket önizlemesi</text></svg>';
  return sharp(scene).composite([{input:Buffer.from(label)}]).png({compressionLevel:1}).toBuffer();
}
/** Source plates reserve foreground floor. Interior door/furniture scale needs
 * a stronger foreground actor than a wide exterior; one global 600px toy scale
 * made the first room frame too small. Foot baseline stays anchored. */
export function illustratedStageFit(environment:IllustratedEnvironment){
  if(!["courtyard","barracks","kitchen"].includes(environment))throw Error("ILLUSTRATED_PREVIEW_STAGE");
  return {canvas:environment==="courtyard"?760:840,floor:996,actorToFrame:environment==="courtyard"?760/1080:840/1080};
}
