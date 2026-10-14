import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {validateWorldPack} from "../src/lib/character/world/WorldCharacterLibrary";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const root=fs.realpathSync.native(process.cwd()),relative="ottoman/early-modern/janissary/cinematic-reference/v1";
 const output=path.join(root,"libraries/world-characters",relative);
 if(fs.existsSync(output))throw Error("CINEMATIC_IMPORT_EXISTS");
 const source=fs.readFileSync("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/cinematic-pose-source.png");
 if(sha(source)!=="0c5b95927c2d4ed51ef42581cbe0c13696e1d08ebba1837eca5ba156e63ef96c")throw Error("CINEMATIC_IMPORT_SHA");
 const m=await sharp(source,{limitInputPixels:4_000_000}).metadata();
 if(m.format!=="png"||!m.hasAlpha||!m.width||!m.height)throw Error("CINEMATIC_IMPORT_ALPHA");
 const original=path.join(root,"libraries/world-characters/ottoman/early-modern/janissary/reference/v1");
 const kinds=["character","equipment","mount","environment"] as const;
 const records=kinds.map(k=>JSON.parse(fs.readFileSync(path.join(original,"metadata",k+".json"),"utf8")));
 const prefix="ottoman.early-modern.janissary.",charId=prefix+"cinematic-reference.v1";
 for(const a of records){
  a.variant="cinematic-"+a.kind;a.id=prefix+a.variant+".v1";a.review="pending";a.status="draft";
  a.provenance.notes="Built-in imagegen performance variants of the approved master design: serious/listening/rear/drill/bowl/tired. Same identity as reference/v1, not nine new characters. Whole-body pose atlas, not continuous limb rig. Interpretive Ottoman/1480; cinematic preview only.";
  if(a.kind==="character"){a.variant="cinematic-reference";a.id=charId;a.displayName="1480 Janissary — cinematic performance candidate";a.files=[{id:prefix+"cinematic-atlas.v1",path:"design/cinematic-atlas.png",purpose:"reference-sheet",sha256:sha(source),pivot:null}];
   a.equipmentIds=[prefix+"cinematic-equipment.v1"];a.mountIds=[prefix+"cinematic-mount.v1"];a.environmentIds=[prefix+"cinematic-environment.v1"];
  }else a.characterId=charId;
  if(a.kind==="environment")for(const f of a.files)f.id=prefix+"cinematic-"+path.basename(f.path,".png")+"-plate.v1";
 }
 const serving=fs.readFileSync("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/cinematic-serving-source.png");
 if(sha(serving)!=="2d4c0ab0f59cff422ff67163f6dca7bf49980dd6d7026c74ccc85318be7c0ac7")throw Error("CINEMATIC_SERVING_SHA");
 records[0].files.push({id:prefix+"cinematic-serving.v1",path:"design/serving-pose.png",purpose:"reference-sheet",sha256:sha(serving),pivot:null});
 records[0].provenance.notes+=" Serving pose is a separate original sprite to avoid adjacent-cell sword bleed.";
 validateWorldPack(records,relative);
 const tempRoot=fs.realpathSync.native("D:/ÜRETİM/private/temp"),temp=fs.mkdtempSync(path.join(tempRoot,"atolye-cinematic-import-")),staged=path.join(temp,"v1");
 try {
 // Build a bounded candidate before atomically installing its new namespace.
 fs.mkdirSync(path.dirname(output),{recursive:true});
 let ancestor=path.dirname(output);
 while(ancestor!==root){if(fs.lstatSync(ancestor).isSymbolicLink()||fs.realpathSync.native(ancestor)!==ancestor)throw Error("CINEMATIC_IMPORT_LINK");ancestor=path.dirname(ancestor);}
 for(const folder of ["design","parts","props","mounts","environments","metadata"])fs.mkdirSync(path.join(staged,folder),{recursive:true});
 fs.writeFileSync(path.join(staged,"design/cinematic-atlas.png"),source,{flag:"wx"});
 fs.writeFileSync(path.join(staged,"design/serving-pose.png"),serving,{flag:"wx"});
 for(const f of records[3].files){const b=fs.readFileSync(path.join(original,f.path));if(sha(b)!==f.sha256)throw Error("CINEMATIC_IMPORT_ENV_SHA");fs.writeFileSync(path.join(staged,f.path),b,{flag:"wx"});}
 for(const a of records)fs.writeFileSync(path.join(staged,"metadata",a.kind+".json"),JSON.stringify(a,null,2)+"\n",{flag:"wx"});
 for(const folder of ["parts","props","mounts"])fs.writeFileSync(path.join(staged,folder,".gitkeep"),"",{flag:"wx"});
 fs.renameSync(staged,output);
 console.log(JSON.stringify({output,width:m.width,height:m.height,status:"draft",review:"pending",paidApiCalls:0}));
 } finally {
  const actual=fs.realpathSync.native(temp);
  if(path.dirname(actual)!==tempRoot||!path.basename(actual).startsWith("atolye-cinematic-import-"))throw Error("CINEMATIC_IMPORT_CLEANUP");
  fs.rmSync(actual,{recursive:true,force:true});
 }
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
