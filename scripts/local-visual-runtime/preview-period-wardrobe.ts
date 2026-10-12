import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { createVolumeCharacter, rasterizeVolumeCharacter, type VolumeCharacter } from "./character-volume";
import { planPeriodWardrobe } from "./period-wardrobe";
import { assertAyasHeavyWorkloadAllowed } from "../../src/lib/ayas/machine/AyasMachineHealthGuard";

async function main() {
  sharp.concurrency(2);
  const started=performance.now(),directory=path.join(process.cwd(),"bin","ayas-local-visual","demos",`period-volume-${Date.now()}`);
  fs.mkdirSync(directory,{recursive:true});
  const examples: readonly {culture: VolumeCharacter["culture"];year: number;label: string}[]=[
    {culture:"OTTOMAN",year:1453,label:"Osmanlı • 1453 / 15. yy adayı"},
    {culture:"OTTOMAN",year:1550,label:"Osmanlı • 1550 / 16. yy adayı"},
    {culture:"BYZANTINE",year:1400,label:"Bizans • 1400 / Palaiologos adayı"},
    {culture:"ROMAN",year:10,label:"Roma • MS 10 / erken imparatorluk"},
    {culture:"EGYPTIAN",year:-1460,label:"Mısır • MÖ 1460 / 18. hanedan"},
  ];
  const tiles: Buffer[]=[],briefs=[];
  for(const example of examples) {
    await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
    const brief=planPeriodWardrobe({culture:example.culture,role:"RULER",sceneYears:[example.year]});
    if(!brief.recipe) throw new Error("PERIOD_PREVIEW_REQUIRES_REFERENCE_WINDOW");
    const mesh=createVolumeCharacter({culture:example.culture,role:"RULER",pose:"STAND",mouthOpen:false,faith:"UNSPECIFIED",wardrobe:brief});
    const input=Buffer.from(rasterizeVolumeCharacter(mesh,{width:640,height:720,x:320,y:655,scale:137,yaw:-15}));
    const label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720"><text x="22" y="37" font-family="Arial" font-weight="bold" font-size="24" fill="#242433">${example.label}</text><text x="22" y="698" font-family="Arial" font-size="19" fill="#242433">Kaynak esinli tasarım • Tarihsel inceleme gerekli</text></svg>`);
    const png=await sharp(input,{raw:{width:640,height:720,channels:4}}).flatten({background:"#e7e4df"}).composite([{input:label}]).png().toBuffer();
    fs.writeFileSync(path.join(directory,`${brief.recipe.toLowerCase()}.png`),png,{flag:"wx"});
    tiles.push(await sharp(png).resize(384,432).png().toBuffer());briefs.push(brief);
  }
  const file=path.join(directory,"period-comparison.png");
  fs.writeFileSync(file,await sharp({create:{width:1920,height:432,channels:3,background:"#e7e4df"}}).composite(tiles.map((input,i)=>({input,left:i*384,top:0}))).png().toBuffer(),{flag:"wx"});
  const receipt={status:"PASS",file,previewOnly:true,productionIntegrated:false,allWardrobesHistoricallyAccepted:false,briefs,elapsedMs:Math.round(performance.now()-started),peakRssBytes:process.resourceUsage().maxRSS*1024,sharpThreads:2,gpuUsed:false,paidCalls:0};
  fs.writeFileSync(path.join(directory,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
  console.log(JSON.stringify({...receipt,briefs:briefs.map(b=>({year:b.year,recipe:b.recipe,status:b.status,sourceCount:b.sources.length}))}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
