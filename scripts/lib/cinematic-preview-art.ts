import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {readWorldCharacterLibrary} from "./world-character-library-files";
import type {CinematicPreviewArtwork} from "../../src/lib/documentary/CinematicPreviewRenderer";
/** Bounded draft intake for offline previews only. Every selected byte is
 * declared by native V1 metadata and hash-checked; no readiness is promoted. */
export async function loadCinematicWorldPreviewArtwork(input:{packDirectory:string;atlasPath:string;identityPackDirectory:string;identitySheetPath:string;poseOverrides?:readonly {index:number;path:string}[];layout?:"atlas"|"single"}){
 const packs=readWorldCharacterLibrary(),pack=packs.find(p=>p.directory===input.packDirectory),master=packs.find(p=>p.directory===input.identityPackDirectory);
 if(!pack||!master||pack.character.status!=="draft"||pack.character.civilization!==master.character.civilization||
   pack.character.period!==master.character.period||pack.character.role!==master.character.role)throw Error("CINEMATIC_PREVIEW_IDENTITY_CONTEXT");
 const read=(directory:string,logical:string)=>{
  const p=packs.find(p=>p.directory===directory)!;
  const f=p.assets.flatMap(a=>a.files).find(f=>f.path===logical);
  if(!f)throw Error("CINEMATIC_PREVIEW_UNDECLARED");
  const file=path.resolve("libraries/world-characters",p.directory,f.path),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==file||stat.size>32*1024*1024)throw Error("CINEMATIC_PREVIEW_LINK_OR_SIZE");
  const bytes=fs.readFileSync(file);
  if(createHash("sha256").update(bytes).digest("hex")!==f.sha256)throw Error("CINEMATIC_PREVIEW_ART_HASH");
  return {declaration:f,bytes};
 };
 const atlas=read(pack.directory,input.atlasPath),identity=read(master.directory,input.identitySheetPath);
 if(atlas.declaration.purpose!=="reference-sheet"||identity.declaration.purpose!=="reference-sheet")throw Error("CINEMATIC_PREVIEW_SOURCE_KIND");
 const m=await sharp(atlas.bytes,{limitInputPixels:4_000_000}).metadata();
 if(m.format!=="png"||!m.hasAlpha||!m.width||!m.height||m.width<900||m.height<900||m.width>2400||m.height>2400)throw Error("CINEMATIC_PREVIEW_ATLAS");
 const poses:Buffer[]=[];
 if(input.layout==="single"){const body=await sharp(atlas.bytes).trim({background:"#00000000",threshold:1}).resize(470,470,{fit:"contain",background:"#00000000"}).extend({top:15,bottom:15,left:15,right:15,background:"#00000000"}).png().toBuffer();for(let i=0;i<9;i++)poses.push(body);} else {
 for(let i=0;i<9;i++){
  const x=i%3,y=Math.floor(i/3),left=Math.floor(x*m.width/3),top=Math.floor(y*m.height/3);
  poses.push(await sharp(atlas.bytes).extract({left,top,width:Math.floor((x+1)*m.width/3)-left,height:Math.floor((y+1)*m.height/3)-top}).png().toBuffer());
 }
 }
 const overrides=input.poseOverrides??[];
 if(overrides.length>9||new Set(overrides.map(o=>o.index)).size!==overrides.length)throw Error("CINEMATIC_PREVIEW_OVERRIDE_CAPACITY");
 const bundle=createHash("sha256").update(atlas.bytes);
 for(const o of overrides){
  if(!Number.isInteger(o.index)||o.index<0||o.index>8)throw Error("CINEMATIC_PREVIEW_OVERRIDE_INDEX");
  const replacement=read(pack.directory,o.path),m=await sharp(replacement.bytes,{limitInputPixels:4_000_000}).metadata();
  if(replacement.declaration.purpose!=="reference-sheet"||m.format!=="png"||!m.hasAlpha)throw Error("CINEMATIC_PREVIEW_OVERRIDE_KIND");
  bundle.update(replacement.bytes);
  poses[o.index]=await sharp(replacement.bytes).trim({background:"#00000000",threshold:1}).resize(470,470,{fit:"contain",background:"#00000000"}).extend({top:15,bottom:15,left:15,right:15,background:"#00000000"}).png().toBuffer();
 }
 const character={id:pack.character.id,contentSha256:overrides.length?bundle.digest("hex"):atlas.declaration.sha256,designIdentitySha256:identity.declaration.sha256};
 const environments=pack.assets.flatMap(a=>a.files).filter(f=>f.purpose==="background").map(f=>read(pack.directory,f.path));
 const artwork:CinematicPreviewArtwork={admission:"PREVIEW_ONLY",characters:new Map([[character.id,{...character,poses,posesFaceRight:input.layout==="single",hasRearView:input.layout!=="single"}]]),
  environments:new Map(environments.map(f=>[f.declaration.id,{contentSha256:f.declaration.sha256,png:f.bytes}]))};
 const props=pack.assets.flatMap(a=>a.files).filter(f=>f.purpose==="prop").map(f=>read(pack.directory,f.path));
 const withProps:CinematicPreviewArtwork={...artwork,props:new Map(props.map(f=>[f.declaration.id,{contentSha256:f.declaration.sha256,png:f.bytes}]))};
 return {artwork:withProps,character,environments,props};
}
