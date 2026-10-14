import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {validateWorldPack} from "../src/lib/character/world/WorldCharacterLibrary";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const root=fs.realpathSync.native(process.cwd()),relative="ottoman/early-modern/janissary/reference-rig/v1",output=path.join(root,"libraries/world-characters",relative);
 if(fs.existsSync(output))throw Error("RIG_IMPORT_EXISTS");
 const source=fs.readFileSync("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/rig-source.png");
 if(sha(source)!=="0d9ecc29d56e972e351a0815b2ff607900b7707fa567d736b352e86d2fe35a11")throw Error("RIG_SOURCE_CHANGED");
 const meta=await sharp(source,{limitInputPixels:2_000_000}).metadata();
 if(meta.format!=="png"||meta.width!==1254||meta.height!==1254||!meta.hasAlpha)throw Error("RIG_SOURCE_FORMAT");
 const temp=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),"atolye-rig-import-")),staged=path.join(temp,"v1");
 try{
  for(const folder of ["design","parts","props","mounts","environments","metadata"])fs.mkdirSync(path.join(staged,folder),{recursive:true});
  fs.writeFileSync(path.join(staged,"design/rig-atlas.png"),source,{flag:"wx"});
  const prefix="ottoman.early-modern.janissary.",id=prefix+"reference-rig.v1";
  const file=(f:string,purpose:"reference-sheet"|"body-part"|"background",variant:string,pivot:{x:number;y:number}|null)=>({id:prefix+variant+".v1",path:f,purpose,sha256:sha(fs.readFileSync(path.join(staged,f))),pivot});
  const parts=[
   ["head",0,.56,.94],["torso",1,.50,.16],["upper-arm-front",2,.29,.28],["forearm-front",3,.15,.53],
   ["upper-arm-back",4,.70,.25],["forearm-back",5,.81,.47],["hand-front",6,.47,.24],["hand-back",7,.51,.25],
   ["thigh-front",8,.44,.17],["shin-front",9,.42,.16],["thigh-back",10,.51,.14],["shin-back",11,.45,.17],["head-speaking",12,.57,.95],
  ] as const;
  const files=[file("design/rig-atlas.png","reference-sheet","rig-atlas",null)];
  for(const[name,index,x,y]of parts){
   const col=index%4,row=Math.floor(index/4),left=Math.floor(col*1254/4),top=Math.floor(row*1254/4);
   const png=await sharp(source).extract({left,top,width:Math.floor((col+1)*1254/4)-left,height:Math.floor((row+1)*1254/4)-top}).png().toBuffer();
   const raw=await sharp(png).ensureAlpha().raw().toBuffer();let transparent=0,visible=0;
   for(let i=3;i<raw.length;i+=4){if(raw[i]===0)transparent++;if(raw[i]!>240)visible++;}
   if(transparent<raw.length/4*.1||visible<raw.length/4*.04)throw Error("RIG_PART_ALPHA");
   fs.writeFileSync(path.join(staged,"parts/"+name+".png"),png,{flag:"wx"});
   files.push(file("parts/"+name+".png","body-part","rig-"+name,{x,y}));
  }
  const envs=["courtyard","barracks","kitchen"].map(name=>{
   const b=fs.readFileSync(path.join(root,"libraries/world-characters/ottoman/early-modern/janissary/reference/v1/environments",name+".png"));
   fs.writeFileSync(path.join(staged,"environments",name+".png"),b,{flag:"wx"});
   return file("environments/"+name+".png","background","rig-"+name+"-plate",null);
  });
  const base={schemaVersion:1,civilization:"ottoman",period:"early-modern",role:"janissary",version:1,status:"draft",review:"pending",provenance:{source:"chatgpt",rights:"owner-cleared",historicalReview:"source-scoped",sources:["https://www.britishmuseum.org/collection/object/P_Pp-1-19"],notes:"Original imagegen rig atlas derived from the owner-approved character style. Import samples 4x4 cells without repainting the source; actual pivots recorded. Draft until assembled anatomy/joint motion and frame quality are verified. Interpretive Ottoman/1480 only; not a certified historical uniform."}};
  const companion=(kind:string,variant:string,extra:object)=>({...base,kind,id:prefix+variant+".v1",variant,files:[],characterId:id,...extra});
  const records=[
   {...base,kind:"character",id,variant:"reference-rig",files,displayName:"1480 Janissary — textured joint rig candidate",styleId:"stylized-history-v1",rigId:"cutout-humanoid-v1",equipmentIds:[prefix+"rig-equipment.v1"],mountIds:[prefix+"rig-mount.v1"],environmentIds:[prefix+"rig-environments.v1"]},
   companion("equipment","rig-equipment",{items:[]}),companion("mount","rig-mount",{availability:"none",species:"none"}),
   companion("environment","rig-environments",{files:envs,availability:"present",setting:"Interpretive Ottoman/1480 courtyard, barracks and kitchen; own namespace copies."})
  ];
  validateWorldPack(records,relative);
  for(const a of records)fs.writeFileSync(path.join(staged,"metadata",a.kind+".json"),JSON.stringify(a,null,2)+"\n",{flag:"wx"});
  for(const folder of ["props","mounts"])fs.writeFileSync(path.join(staged,folder,".gitkeep"),"",{flag:"wx"});
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if(!fs.realpathSync.native(path.dirname(output)).startsWith(root+path.sep))throw Error("RIG_DESTINATION_PATH");
  fs.renameSync(staged,output);
  console.log(JSON.stringify({output,characterId:id,parts:13,status:"draft",sourceSha256:sha(source),paidApiCalls:0}));
 }finally{
  const actual=fs.realpathSync.native(temp),parent=fs.realpathSync.native(os.tmpdir());
  if(path.dirname(actual)!==parent||!path.basename(actual).startsWith("atolye-rig-import-"))throw Error("RIG_TEMP_PATH");
  fs.rmSync(actual,{recursive:true,force:true});
 }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
