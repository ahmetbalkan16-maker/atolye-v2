import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import sharp, { type OverlayOptions } from "sharp";
import { createVolumeCharacter, rasterizeVolumeCharacter, volumeCharacterObj, type VolumeCharacter } from "./character-volume";
import { planCharacterScene } from "../../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../../src/lib/animation/character/CharacterSceneDirection";
import { readCharacterLocalBackdrop } from "../../src/lib/animation/character/CharacterLocalBackdrop";
import { assertAyasHeavyWorkloadAllowed } from "../../src/lib/ayas/machine/AyasMachineHealthGuard";

/** Manual quality preview only. No provider/default/env/live/project mutation. */
async function main() {
  sharp.concurrency(2);
  const started=performance.now(),cpu=process.cpuUsage();
  const directory=path.join(process.cwd(),"bin","ayas-local-visual","demos",`volume-${Date.now()}`);
  fs.mkdirSync(directory,{recursive:true});
  const texts=["Osmanlı padişahı sarayda konuşuyor.","Hristiyan Bizans imparatoru sarayda konuşuyor.","Roma imparatoru sarayda konuşuyor.","Mısır firavunu sarayda konuşuyor."];
  const tiles: Buffer[]=[],counts: number[]=[],health: unknown[]=[];
  for(const text of texts) {
    health.push(await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true}));
    const plan=planCharacterScene({sceneId:1,text,contextualDirection:true});
    const art=planCharacterSceneDirection(text,plan.request.blocking).art;
    const background=readCharacterLocalBackdrop("cache",art,"DAY");
    if(!background) throw new Error("VOLUME_PREVIEW_REVIEWED_BACKGROUND_REQUIRED");
    const culture=art.culture as VolumeCharacter["culture"];
    const actors: OverlayOptions[]=[];
    for(const [i,role] of (["RULER","ADVISOR","GUARD"] as const).entries()) {
      const mesh=createVolumeCharacter({culture,role,faith:art.faith,pose:role==="RULER"?"POINT":"STAND",mouthOpen:role==="RULER"});
      counts.push(mesh.length);
      if(role==="RULER") fs.writeFileSync(path.join(directory,`${culture.toLowerCase()}-ruler.obj`),volumeCharacterObj(mesh),{flag:"wx"});
      actors.push({input:await sharp(Buffer.from(rasterizeVolumeCharacter(mesh,{width:1920,height:1080,x:[620,1120,1530][i]!,y:900,scale:155,yaw:-12})),{raw:{width:1920,height:1080,channels:4}}).png().toBuffer()});
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="45" y="30" width="1800" height="82" rx="14" fill="#242433" opacity=".86"/><text x="73" y="85" font-family="Arial" font-weight="bold" font-size="39" fill="#fff">${text} — 3D DENEME</text><rect x="45" y="970" width="670" height="64" rx="10" fill="#242433"/><text x="68" y="1016" font-family="Arial" font-size="30" fill="#fff">3D karakter / 2D saray • Üretime bağlı değil</text></svg>`;
    const foreground=await sharp(Buffer.from(svg),{limitInputPixels:2073600}).png().toBuffer();
    const png=await sharp(background.png).resize(1920,1080).composite([...actors,{input:foreground}]).png().toBuffer();
    fs.writeFileSync(path.join(directory,`${culture.toLowerCase()}.png`),png,{flag:"wx"});
    tiles.push(await sharp(png).resize(960,540).png().toBuffer());
  }
  const comparison=await sharp({create:{width:1920,height:1080,channels:3,background:"#fff"}}).composite(tiles.map((input,i)=>({input,left:i%2*960,top:Math.floor(i/2)*540}))).png().toBuffer();
  const file=path.join(directory,"comparison.png");fs.writeFileSync(file,comparison,{flag:"wx"});
  const views: Buffer[]=[];
  for(const [i,yaw] of [-28,0,28].entries()) {
    await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
    const mesh=createVolumeCharacter({culture:"OTTOMAN",role:"RULER",pose:i===1?"POINT":"STAND",faith:"ISLAM",mouthOpen:i===1});
    const png=await sharp(Buffer.from(rasterizeVolumeCharacter(mesh,{width:640,height:720,x:320,y:660,scale:145,yaw})),{raw:{width:640,height:720,channels:4}}).flatten({background:"#e7e4df"}).png().toBuffer();
    views.push(png);
  }
  const motionFile=path.join(directory,"pose-camera-check.png");
  fs.writeFileSync(motionFile,await sharp({create:{width:1920,height:720,channels:3,background:"#fff"}}).composite(views.map((input,i)=>({input,left:i*640,top:0}))).png().toBuffer(),{flag:"wx"});
  // Small silent loop demonstrates genuine volume turns and rig interpolation.
  // Mouth changes are a synthetic illustration, never a claim of audio alignment.
  const animated: Buffer[]=[],frameCount=24;
  for(let i=0;i<frameCount;i++) {
    if(i%6===0) await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
    const phase=2*Math.PI*i/frameCount;
    const mesh=createVolumeCharacter({culture:"OTTOMAN",role:"RULER",pose:"POINT",faith:"ISLAM",mouthOpen:i%4<2,gesture:(1-Math.cos(phase))/2});
    animated.push(await sharp(Buffer.from(rasterizeVolumeCharacter(mesh,{width:480,height:640,x:240,y:590,scale:126,yaw:Math.sin(phase)*24})),{raw:{width:480,height:640,channels:4}}).flatten({background:"#e7e4df"}).composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><text x="20" y="38" font-family="Arial" font-size="20" fill="#242433">3D DENEME • Ses hizalaması yok</text></svg>')}]).raw().ensureAlpha().toBuffer());
  }
  const animationFile=path.join(directory,"volume-motion.webp");
  fs.writeFileSync(animationFile,await sharp(Buffer.concat(animated),{raw:{width:480,height:640*frameCount,channels:4,pageHeight:640}}).webp({quality:85,loop:0,delay:Array(frameCount).fill(167)}).toBuffer(),{flag:"wx"});
  const used=process.cpuUsage(cpu);
  const receipt={status:"PASS",file,motionFile,animationFile,animationFrames:frameCount,animationFps:6,animationSilent:true,mouthTiming:"SYNTHETIC_PREVIEW_ONLY",previewOnly:true,productionIntegrated:false,characterGeometry:"XYZ_TRIANGLE_MESH",projection:"ORTHOGRAPHIC",backdrop:"reviewed SDXL 2D cache",cameraYawDegrees:[-28,0,28],poses:["STAND","POINT"],mouthStates:[false,true],meshTriangles:counts,elapsedMs:Math.round(performance.now()-started),cpuMs:Math.round((used.user+used.system)/1000),peakRssBytes:process.resourceUsage().maxRSS*1024,sharpThreads:2,gpuUsed:false,paidCalls:0,ownerProjectUsed:false,ownerQualityAccepted:false,sha256:createHash("sha256").update(comparison).digest("hex"),health};
  fs.writeFileSync(path.join(directory,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
  console.log(JSON.stringify({...receipt,health:health.map(()=>"ADMITTED")}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
