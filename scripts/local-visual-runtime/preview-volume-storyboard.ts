import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp, { type OverlayOptions } from "sharp";
import { createVolumeCharacter, rasterizeVolumeCharacter } from "./character-volume";
import { planPeriodWardrobe } from "./period-wardrobe";
import { planCharacterScene } from "../../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../../src/lib/animation/character/CharacterSceneDirection";
import { readCharacterLocalBackdrop } from "../../src/lib/animation/character/CharacterLocalBackdrop";
import { assertAyasHeavyWorkloadAllowed } from "../../src/lib/ayas/machine/AyasMachineHealthGuard";

/** Editorial candidate: establish place, focus on speaker, show reaction/detail.
 * These are our design choices informed by sampled YouTube frames, not measured
 * retention rules or a promise to exceed another creator's audience or quality.
 */
async function main() {
  sharp.concurrency(2);
  const start=performance.now(),directory=path.join(process.cwd(),"bin","ayas-local-visual","demos",`volume-storyboard-${Date.now()}`);
  fs.mkdirSync(directory,{recursive:true});
  const text="1453 yılında Osmanlı padişahı sarayda konuşuyor.";
  const scene=planCharacterScene({sceneId:1,text,contextualDirection:true}),art=planCharacterSceneDirection(text,scene.request.blocking).art;
  const backdrop=readCharacterLocalBackdrop("cache",art,"DAY");if(!backdrop) throw new Error("STORYBOARD_REVIEWED_BACKGROUND_REQUIRED");
  const wardrobe=planPeriodWardrobe({culture:"OTTOMAN",role:"RULER",sceneYears:[1453]});
  const ruler=createVolumeCharacter({culture:"OTTOMAN",role:"RULER",pose:"POINT",mouthOpen:true,faith:"UNSPECIFIED",wardrobe});
  const shots=[{id:"WIDE",label:"Mekân ve roller",x:610,y:900,scale:155,yaw:-12},{id:"MEDIUM",label:"Konuşan kişi ve hareket",x:750,y:1200,scale:250,yaw:-12},{id:"CLOSEUP",label:"İfade ve vurgu",x:880,y:2050,scale:500,yaw:8},{id:"COSTUME_DETAIL",label:"Dönem kıyafeti ve aksesuar",x:920,y:1460,scale:450,yaw:-20}] as const;
  const tiles: Buffer[]=[],files: string[]=[];
  for(const shot of shots) {
    await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
    const composite: OverlayOptions[]=[];
    const addActor=async(mesh: ReturnType<typeof createVolumeCharacter>,x: number,y: number,scale: number,yaw: number)=>{
      composite.push({input:await sharp(Buffer.from(rasterizeVolumeCharacter(mesh,{width:1920,height:1080,x,y,scale,yaw})),{raw:{width:1920,height:1080,channels:4}}).png().toBuffer()});
    };
    if(shot.id==="WIDE") for(const [i,role] of (["ADVISOR","GUARD"] as const).entries()) await addActor(createVolumeCharacter({culture:"OTTOMAN",role,pose:"STAND",mouthOpen:false,faith:"UNSPECIFIED"}),[1110,1510][i]!,900,[140,153][i]!,-12);
    await addActor(ruler,shot.x,shot.y,shot.scale,shot.yaw);
    const label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="45" y="35" width="1720" height="80" rx="12" fill="#242433" opacity=".88"/><text x="74" y="90" font-family="Arial" font-size="39" fill="#fff">${shot.label} — 1453 / 3D tasarım adayı</text><rect x="45" y="982" width="1520" height="58" rx="8" fill="#242433" opacity=".88"/><text x="68" y="1022" font-family="Arial" font-size="28" fill="#fff">Kaynak esinli önizleme • Yardımcı kıyafet ve sarayın dönem doğrulaması tamamlanmadı</text></svg>`);
    const background=await sharp(backdrop.png).resize(1920,1080).modulate({saturation:.78,brightness:.91}).blur(shot.id==="WIDE"?.5:shot.id==="MEDIUM"?1.2:2.2).png().toBuffer();
    const png=await sharp(background).composite([...composite,{input:label}]).png().toBuffer();
    const file=path.join(directory,`${shot.id.toLowerCase()}.png`);fs.writeFileSync(file,png,{flag:"wx"});files.push(file);
    tiles.push(await sharp(png).resize(960,540).png().toBuffer());
  }
  const file=path.join(directory,"storyboard.png");fs.writeFileSync(file,await sharp({create:{width:1920,height:1080,channels:3,background:"#fff"}}).composite(tiles.map((input,i)=>({input,left:i%2*960,top:Math.floor(i/2)*540}))).png().toBuffer(),{flag:"wx"});
  const receipt={status:"PASS",file,files,shots:shots.map(s=>s.id),wardrobe,previewOnly:true,productionIntegrated:false,gpuUsed:false,paidCalls:0,sharpThreads:2,elapsedMs:Math.round(performance.now()-start),peakRssBytes:process.resourceUsage().maxRSS*1024,music:"existing narration ducking retained; reference music not copied",qualityAccepted:false};
  fs.writeFileSync(path.join(directory,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});console.log(JSON.stringify({...receipt,wardrobe:wardrobe.recipe}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
