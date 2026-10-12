import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { planCharacterScene } from "../../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../../src/lib/animation/character/CharacterSceneDirection";
import { readCharacterLocalBackdrop } from "../../src/lib/animation/character/CharacterLocalBackdrop";
import { CHARACTER_SCENE_FONT_FAMILY, embedCharacterScenePayload, renderCharacterSceneAssetFrame } from "../../src/lib/animation/character/CharacterSceneAsset";
import { EDITORIAL_RENDER_STYLE } from "../../src/lib/character/SvgSceneRenderer";
import { rasterizeCharacterSceneSvg } from "../../src/lib/character/CharacterSceneRasterizer";

async function main() {
  const directory = path.join(process.cwd(),"bin","ayas-local-visual","demos",`cultures-${Date.now()}`); fs.mkdirSync(directory,{recursive:true});
  const texts=["Osmanlı padişahı sarayda konuşuyor.","Hristiyan Bizans imparatoru sarayda konuşuyor.","Roma imparatoru sarayda konuşuyor.","Mısır firavunu sarayda konuşuyor."];
  const tiles: Buffer[]=[];
  for(const [index,text] of texts.entries()) {
    const plan=planCharacterScene({sceneId:index+1,text,contextualDirection:true});
    const request={...plan.request,blocking:{...plan.request.blocking,caption:text,characters:plan.request.blocking.characters.map((c,i)=>i===0?{...c,expression:"HAPPY" as const}:c)}};
    const direction=planCharacterSceneDirection(text,request.blocking);
    const backdrop=readCharacterLocalBackdrop("cache",direction.art,request.blocking.time);
    if(!backdrop) throw new Error("CULTURE_PREVIEW_BACKGROUND_REQUIRED");
    const payload={schemaVersion:"1" as const,request,animation:plan.animation,fontFamily:CHARACTER_SCENE_FONT_FAMILY,renderStyle:EDITORIAL_RENDER_STYLE,direction,background:backdrop.metadata};
    const frame=await rasterizeCharacterSceneSvg(renderCharacterSceneAssetFrame(payload,1.2,6),{backgroundPng:backdrop.png});
    if(!frame.ok) throw new Error("CULTURE_PREVIEW_RENDER_FAILED");
    const file=path.join(directory,`${direction.art.culture.toLowerCase()}.png`);
    fs.writeFileSync(file,embedCharacterScenePayload(frame.png,payload,backdrop.png),{flag:"wx"});
    tiles.push(await sharp(frame.png).resize(960,540).png().toBuffer());
  }
  const png=await sharp({create:{width:1920,height:1080,channels:3,background:"#fff"}}).composite(tiles.map((input,i)=>({input,left:(i%2)*960,top:Math.floor(i/2)*540}))).png().toBuffer();
  const file=path.join(directory,"comparison.png"); fs.writeFileSync(file,png,{flag:"wx"});
  console.log(JSON.stringify({file,characterVersion:4,realProductionRenderer:true,paidCalls:0,ownerQualityAccepted:false,sha256:createHash("sha256").update(png).digest("hex")}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
