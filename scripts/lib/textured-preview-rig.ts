import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {readWorldCharacterLibrary} from "./world-character-library-files";
import {TEXTURED_PARTS,type TexturedPartName,type TexturedCutoutRig} from "../../src/lib/documentary/TexturedCutoutRig";
/** Exact source namespace, no nearest-period or cross-civilization fallback. */
export function loadTexturedWorldPreviewRig(directory:string,masterDirectory:string){
 const packs=readWorldCharacterLibrary(),pack=packs.find(p=>p.directory===directory),master=packs.find(p=>p.directory===masterDirectory);
 if(!pack||!master||pack.character.status!=="draft"||
  ["civilization","period","role"].some(k=>pack.character[k as "civilization"]!==master.character[k as "civilization"]))throw Error("TEXTURED_PREVIEW_CONTEXT");
 const parts=new Map<TexturedPartName,{png:Buffer;pivot:{x:number;y:number}}>(),digest=createHash("sha256");
 for(const name of TEXTURED_PARTS){
  const f=pack.character.files.find(f=>f.path==="parts/"+name+".png");
  if(!f||f.purpose!=="body-part"||!f.pivot)throw Error("TEXTURED_PREVIEW_PART");
  const file=path.resolve("libraries/world-characters",pack.directory,f.path),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync.native(file)!==file||s.size>32*1024*1024)throw Error("TEXTURED_PREVIEW_LINK");
  const png=fs.readFileSync(file),sha=createHash("sha256").update(png).digest("hex");
  if(sha!==f.sha256)throw Error("TEXTURED_PREVIEW_HASH");
  digest.update(f.id).update(png);parts.set(name,{png,pivot:f.pivot});
 }
 const rig:TexturedCutoutRig={admission:"PREVIEW_ONLY",parts};
 return {rig,sourceBundleSha256:digest.digest("hex"),sourceCharacterId:pack.character.id};
}
