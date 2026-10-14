import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {validateWorldPack} from "../src/lib/character/WorldCharacterLibrary";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const base=path.resolve("libraries/world-characters/ottoman/early-modern/janissary/cinematic-reference/v1"),relative="ottoman/early-modern/janissary/cinematic-companion/v1",output=path.resolve("libraries/world-characters",relative);
 if(fs.existsSync(output))throw Error("COMPANION_EXISTS");
 const prefix="ottoman.early-modern.janissary.",id=prefix+"cinematic-companion.v1";
 const records=["character","equipment","mount","environment"].map(k=>JSON.parse(fs.readFileSync(path.join(base,"metadata",k+".json"),"utf8")));
 const inputs=[["stand","companion-source.png","e86c74e5a1392d5cd5da2b3ae68fa93f77a7c3ef105a67c911d3dca1d8abd076"],["speaking","companion-speaking-source.png","91f4a7a149ab0ed19de6c55b287bad39715d921d7f055709a252297df8890145"]] as const;
 const blobs=new Map<string,Buffer>();
 for(const[name,filename,hash]of inputs){
  const b=fs.readFileSync("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/"+filename),m=await sharp(b,{limitInputPixels:4_000_000}).metadata();
  if(sha(b)!==hash||m.format!=="png"||!m.hasAlpha)throw Error("COMPANION_SOURCE");
  blobs.set("design/"+name+".png",b);
 }
 for(const a of records){
  a.variant=a.kind==="character"?"cinematic-companion":"companion-"+a.kind;a.id=prefix+a.variant+".v1";a.review="pending";a.status="draft";
  a.provenance.notes="Original built-in imagegen anonymous moustached Janissary companion in the approved style, interpretive Ottoman/1480. Distinct fictional person, not a named historical portrait. Two source states; preview only until motion/identity/history/rights qualification.";
  if(a.kind==="character"){
   a.displayName="1480 Janissary companion — cinematic draft";a.files=inputs.map(([name,,hash])=>({id:prefix+"companion-"+name+".v1",path:"design/"+name+".png",purpose:"reference-sheet",sha256:hash,pivot:null}));
   a.equipmentIds=[prefix+"companion-equipment.v1"];a.mountIds=[prefix+"companion-mount.v1"];a.environmentIds=[prefix+"companion-environment.v1"];
  }else a.characterId=id;
  if(a.kind==="equipment"){a.files=[];a.items=[];}
  if(a.kind==="environment")for(const f of a.files){f.id=prefix+"companion-"+path.basename(f.path,".png")+"-plate.v1";const b=fs.readFileSync(path.join(base,f.path));if(sha(b)!==f.sha256)throw Error("COMPANION_ENV");blobs.set(f.path,b);}
 }
 validateWorldPack(records,relative);
 const parent=fs.realpathSync.native("D:/ÜRETİM/private/temp"),temp=fs.mkdtempSync(path.join(parent,"atolye-companion-")),staged=path.join(temp,"v1");
 try{
  for(const f of ["design","parts","props","mounts","environments","metadata"])fs.mkdirSync(path.join(staged,f),{recursive:true});
  for(const[name,b]of blobs)fs.writeFileSync(path.join(staged,name),b,{flag:"wx"});
  for(const a of records)fs.writeFileSync(path.join(staged,"metadata",a.kind+".json"),JSON.stringify(a,null,2),{flag:"wx"});
  for(const f of ["parts","props","mounts"])fs.writeFileSync(path.join(staged,f,".gitkeep"),"",{flag:"wx"});
  fs.mkdirSync(path.dirname(output),{recursive:true});if(fs.realpathSync.native(path.dirname(output))!==path.dirname(output))throw Error("COMPANION_DEST_LINK");
  fs.renameSync(staged,output);console.log(JSON.stringify({output,id,status:"draft",apiUsd:0}));
 }finally{
  if(path.dirname(fs.realpathSync.native(temp))!==parent||!path.basename(temp).startsWith("atolye-companion-"))throw Error("COMPANION_CLEANUP");
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
