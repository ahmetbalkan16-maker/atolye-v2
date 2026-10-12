import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { createVolumeCharacter, rasterizeVolumeCharacter, renderVolumeCharacterSvg, volumeCharacterObj } from "./local-visual-runtime/character-volume";
import { planPeriodWardrobe } from "./local-visual-runtime/period-wardrobe";
import { CHARACTER_POSES } from "../src/lib/character/CharacterPose";

async function main() {
  sharp.concurrency(2);
  const meshes=new Set<string>();
  for(const culture of ["OTTOMAN","BYZANTINE","ROMAN","EGYPTIAN"] as const) {
    const mesh=createVolumeCharacter({culture,role:"RULER",pose:"POINT",mouthOpen:true,faith:"UNSPECIFIED"});
    assert(mesh.length<30000);
    meshes.add(createHash("sha256").update(JSON.stringify(mesh)).digest("hex"));
  }
  assert.equal(meshes.size,4,"culture-specific volumes must differ");
  const images=new Set<string>();
  for(const pose of CHARACTER_POSES) {
    const mesh=createVolumeCharacter({culture:"OTTOMAN",role:"RULER",pose,mouthOpen:true,faith:"ISLAM"});
    const svg=renderVolumeCharacterSvg(mesh,{x:320,y:690,scale:110,yaw:-18});
    assert.doesNotMatch(svg,/NaN|Infinity|<image|href=|url\(|filter=/);
    const raw=rasterizeVolumeCharacter(mesh,{width:640,height:720,x:320,y:690,scale:110,yaw:-18});
    assert(raw.some((v,i)=>i%4===3&&v===255),"real projected geometry must produce opaque pixels");
    const png=await sharp(Buffer.from(raw),{raw:{width:640,height:720,channels:4}}).png().toBuffer();
    images.add(createHash("sha256").update(png).digest("hex"));
  }
  assert.equal(images.size,10,"ten existing poses should remain distinct");
  const closed=createVolumeCharacter({culture:"BYZANTINE",role:"RULER",pose:"STAND",mouthOpen:false,faith:"UNSPECIFIED"});
  const open=createVolumeCharacter({culture:"BYZANTINE",role:"RULER",pose:"STAND",mouthOpen:true,faith:"UNSPECIFIED"});
  assert.notDeepEqual(open,closed);
  const explicit=createVolumeCharacter({culture:"BYZANTINE",role:"RULER",pose:"STAND",mouthOpen:false,faith:"CHRISTIANITY"});
  assert.notDeepEqual(explicit,closed,"cross must require explicit faith");
  const views=[-28,0,28].map(yaw=>renderVolumeCharacterSvg(closed,{x:320,y:690,scale:110,yaw}));
  assert.equal(new Set(views).size,3);
  const obj=volumeCharacterObj(closed);
  assert.equal((obj.match(/^v /gm)||[]).length,closed.length*3);
  assert.equal((obj.match(/^f /gm)||[]).length,closed.length);
  assert.throws(()=>renderVolumeCharacterSvg(closed,{x:NaN,y:0,scale:110,yaw:0}),/BOUNDS/);
  assert.throws(()=>renderVolumeCharacterSvg([{color:"<script>",vertices:[[0,0,0],[1,1,1],[2,0,1]]}],{x:0,y:0,scale:110,yaw:0}),/REFUSED/);
  assert.throws(()=>rasterizeVolumeCharacter(closed,{x:0,y:0,scale:110,yaw:0,width:3840,height:2160}),/BOUNDS/);
  assert.throws(()=>createVolumeCharacter({culture:"OTTOMAN",role:"RULER",pose:"STAND",mouthOpen:false,faith:"ISLAM",gesture:1.1}),/REFUSED/);
  const early=planPeriodWardrobe({culture:"OTTOMAN",role:"RULER",sceneYears:[1453]});
  const late=planPeriodWardrobe({culture:"OTTOMAN",role:"RULER",sceneYears:[1550]});
  assert.notEqual(early.recipe,late.recipe);
  const context={culture:"OTTOMAN" as const,role:"RULER" as const,pose:"STAND" as const,mouthOpen:false,faith:"UNSPECIFIED" as const};
  assert.notDeepEqual(createVolumeCharacter({...context,wardrobe:early}),createVolumeCharacter({...context,wardrobe:late}));
  for(const years of [[],[1830],[1453,1550]]) {
    const brief=planPeriodWardrobe({culture:"OTTOMAN",role:"RULER",sceneYears:years});
    assert.equal(brief.recipe,null); assert.equal(brief.status,"RESEARCH_REQUIRED");
    assert.throws(()=>createVolumeCharacter({...context,wardrobe:brief}),/SUPPORTED_CANDIDATE/);
  }
  assert.equal(planPeriodWardrobe({culture:"OTTOMAN",role:"ADVISOR",sceneYears:[1453]}).recipe,null,"royal portrait cannot establish advisor clothing");
  assert.equal(planPeriodWardrobe({culture:"EGYPTIAN",role:"RULER",sceneYears:[-1460]}).recipe,"EGYPTIAN_DYNASTY_18");
  assert.equal(planPeriodWardrobe({culture:"EGYPTIAN",role:"RULER",sceneYears:[1460]}).recipe,null,"CE and BCE must not be confused");
  assert.throws(()=>planPeriodWardrobe({culture:"ROMAN",role:"RULER",sceneYears:[0]}),/REFUSED/);
  assert.throws(()=>createVolumeCharacter({...context,wardrobe:{...early,recipe:late.recipe}}),/SUPPORTED_CANDIDATE/);
  // A real per-pixel depth test must be independent of triangle submission order.
  const faces=[{vertices:[[-1,-1,1],[1,-1,1],[0,1,1]] as const,color:"#ff0000"},{vertices:[[-1,-1,0],[1,-1,0],[0,1,0]] as const,color:"#0000ff"}];
  const rasterOptions={x:32,y:32,scale:20,yaw:0,width:64,height:64};
  assert.deepEqual(rasterizeVolumeCharacter(faces,rasterOptions),rasterizeVolumeCharacter([...faces].reverse(),rasterOptions));
  const source=fs.readFileSync("scripts/local-visual-runtime/character-volume.ts","utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,"");
  assert.doesNotMatch(source,/node:fs|child_process|fetch\s*\(|process\.|Date\.now|Math\.random|import\(/);
  console.log("Volume candidate: PASS (4 cultures, 10 PNG poses, z-buffer occlusion, mouth/camera/faith/OBJ/bounds, period/role/BCE/ambiguity/refusal); production NOT_INTEGRATED");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
