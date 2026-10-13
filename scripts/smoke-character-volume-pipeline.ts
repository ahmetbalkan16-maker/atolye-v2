import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {withCanonicalSmokeRuntime} from "./lib/CanonicalSmokeRuntime";
import {ProjectManager} from "../src/lib/projects/ProjectManager";
import {CharacterImageProvider,resolveCharacterVolumeMode} from "../src/lib/assets/providers/CharacterImageProvider";
import {resolveRuntimeLogicalPath} from "../src/lib/runtime/RuntimeStoragePaths";
import {readCharacterScenePayload,findCharacterSceneAssetPayloadProblems,renderCharacterSceneAssetFrame} from "../src/lib/animation/character/CharacterSceneAsset";
import {rasterizeCharacterSceneAssetFrame} from "../src/lib/animation/character/CharacterSceneRasterFrame";
import {extractCostumeSceneYears} from "../src/lib/character/volume/VolumeScenePlan";
import {FFmpegSceneVideoProvider} from "../src/lib/video/providers/FFmpegSceneVideoProvider";
import {SpawnRunner} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";

async function main() {
  assert.deepEqual(extractCostumeSceneYears("1453 yılında 1000 asker ve 200 gemi vardı."),[1453]);
  assert.deepEqual(extractCostumeSceneYears("1000 asker, 2000 kişi, 1.453 metre."),[]);
  assert.deepEqual(extractCostumeSceneYears("MÖ 1460 yılında saray."),[-1460]);
  assert.deepEqual(extractCostumeSceneYears("In 1453 the Ottoman sultan speaks."),[1453]);
  assert.deepEqual(extractCostumeSceneYears("One in 1000 soldiers carried a flag."),[]);
  assert.deepEqual(extractCostumeSceneYears("1550 yilinda saray."),[1550]);
  assert.deepEqual(extractCostumeSceneYears("1453 ve 1550 yıllarında saray."),[1453,1550]);
  const originalMode=process.env.ATOLYE_CHARACTER_RENDER_MODE;
  process.env.ATOLYE_CHARACTER_RENDER_MODE="invalid";assert.throws(()=>resolveCharacterVolumeMode(),/INVALID/);
  delete process.env.ATOLYE_CHARACTER_RENDER_MODE;assert.equal(resolveCharacterVolumeMode(),true);
  const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH;
  assert(ffmpeg&&ffprobe&&fs.existsSync(ffmpeg)&&fs.existsSync(ffprobe),"real FFmpeg required");
  try {
    await withCanonicalSmokeRuntime({name:"volume-production"},async runtime=>{
      const slug=`volume-${runtime.runId.slice(0,10)}`;await ProjectManager.createProject(slug);
      const provider=new CharacterImageProvider();
      const result=await provider.generateImage({sceneId:1,projectSlug:slug,prompt:"1453 yılında Osmanlı padişahı sarayda konuşuyor ve işaret ediyor."});
      assert(result.success,JSON.stringify(result));if(!result.success||!result.filePath) return;
      const stored=fs.readFileSync(resolveRuntimeLogicalPath(result.filePath,runtime.runtimeStorageContext)),read=readCharacterScenePayload(stored);assert.equal(read.status,"VALID");if(read.status!=="VALID") return;
      const payload=read.payload;assert(payload.volume);assert.deepEqual(payload.volume.sceneYears,[1453]);assert.equal(payload.volume.wardrobes[0]!.brief.recipe,"OTTOMAN_15_PORTRAIT");
      assert.equal(payload.volume.design?.performance,'GROUNDED');assert.equal(payload.volume.design?.setting,'OTTOMAN_COURT_15');
      const oldVolume={...payload,volume:{...payload.volume,design:undefined}};
      delete oldVolume.volume.design;
      delete oldVolume.volume.presentation;
      assert.deepEqual(findCharacterSceneAssetPayloadProblems(oldVolume),[],'earlier volume metadata remains valid');
      assert((await rasterizeCharacterSceneAssetFrame(oldVolume,.1,8)).ok,'earlier volume geometry still renders');
      assert.deepEqual(findCharacterSceneAssetPayloadProblems(payload),[]);
      assert(findCharacterSceneAssetPayloadProblems({...payload,volume:{...payload.volume,sceneYears:[1550]}}).length,"tampered year must invalidate matching recipe");
      assert.throws(()=>renderCharacterSceneAssetFrame(payload,0),/REQUIRES_RASTER/);
      const at0=await rasterizeCharacterSceneAssetFrame(payload,.1,8),at1=await rasterizeCharacterSceneAssetFrame(payload,.8,8),camera=await rasterizeCharacterSceneAssetFrame(payload,4,8);
      assert(at0.ok&&at1.ok&&camera.ok);if(at0.ok&&at1.ok&&camera.ok){assert(!at0.png.equals(at1.png));assert(!at1.png.equals(camera.png));}
      const legacy={...payload,volume:undefined};const previous=await rasterizeCharacterSceneAssetFrame(legacy,.1,8);assert(previous.ok);
      process.env.ATOLYE_CHARACTER_RENDER_MODE="2d";
      const mode2d=await new CharacterImageProvider().generateImage({sceneId:2,projectSlug:slug,prompt:"Yapay zekâ ve bilgisayar yazılımı"});assert(mode2d.success);if(mode2d.success&&mode2d.filePath){const p=readCharacterScenePayload(fs.readFileSync(resolveRuntimeLogicalPath(mode2d.filePath,runtime.runtimeStorageContext)));assert(p.status==="VALID"&&!p.payload.volume);}
      const captured=await provider.generateImage({sceneId:3,projectSlug:slug,prompt:"Ekonomi ve enflasyon"});assert(captured.success);if(captured.success&&captured.filePath){const p=readCharacterScenePayload(fs.readFileSync(resolveRuntimeLogicalPath(captured.filePath,runtime.runtimeStorageContext)));assert(p.status==="VALID"&&p.payload.volume,"provider mode captured immutably");}
      for(const [i,prompt,profile] of [[4,'1480 yılında Osmanlı yeniçeri askerleri yürüyor.','JANISSARY_EARLY'],[5,'1550 yılında Osmanlı zırhlı sipahi askeri konuşuyor.','OTTOMAN_MAIL_PLATE'],[6,'1710 yılında Osmanlı yeniçeri ağası konuşuyor.','JANISSARY_OFFICER_18'],[7,'1860 yılında Osmanlı padişahı sarayda konuşuyor.','OTTOMAN_FEZ_COURT']] as const) {
        const image=await provider.generateImage({sceneId:i,projectSlug:slug,prompt});assert(image.success);if(!image.success||!image.filePath) continue;
        const p=readCharacterScenePayload(fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,runtime.runtimeStorageContext)));assert(p.status==='VALID');if(p.status==='VALID'){assert(p.payload.volume?.design?.actors.some(a=>a.profile===profile),'real portable image must contain the requested era-specific uniform');if(i===7)assert.equal(p.payload.volume?.design?.setting,'OTTOMAN_COURT_19');if(i===4)assert(p.payload.animation.actors.some(a=>a.action==='WALK'),'explicit military walk remains a walk');if(i===5){assert.equal(p.payload.animation.actors[0]?.action,'TALK','explicit speech must not inherit a march from soldier nouns');assert(p.payload.animation.actors.every(a=>a.action!=='WALK'&&a.action!=='RUN'));}}
      }
      const frame={crop:{x:.1,y:.1,width:.8,height:.8},transform:{scale:1,translateX:0,translateY:0}};
      const generated=await new FFmpegSceneVideoProvider(new SpawnRunner(),()=>({ffmpegPath:ffmpeg,ffprobePath:ffprobe,timeoutMs:60000,maxOutputBytes:32*1024*1024,maxStdioBytes:1024*1024})).generateVideo({projectId:"volume-proof",projectSlug:slug,scenes:[{sceneId:1,sourceImageAssetId:"volume-source",animationAssetId:"volume-anim",imageFilePath:result.filePath,imageMimeType:"image/png",motionPlan:{sceneId:1,animationPrompt:"motion",sourceImageAssetId:"volume-source",outputAssetId:"volume-anim",animationAssetId:"volume-anim",durationSeconds:1,motionType:"zoom-in",start:frame,end:frame,transition:"fade",provider:"mock",model:"fixture",generationMode:"mock",artifactType:"motion-plan",status:"generated"}}]});
      assert(generated.success,JSON.stringify(generated));if(generated.success){const output=path.join(runtime.runtimeStorageContext.projectsRoot,slug,"assets","videos",path.posix.basename(generated.scenes[0]!.filePath));const sample=(t:string)=>execFileSync(ffmpeg,["-v","error","-ss",t,"-i",output,"-frames:v","1","-f","rawvideo","-pix_fmt","gray","-s","96x54","-"]);assert.notDeepEqual(sample("0.1"),sample("0.8"));assert.equal(generated.scenes[0]!.width,1920);assert.equal(generated.scenes[0]!.height,1080);}
    });
  } finally {if(originalMode===undefined) delete process.env.ATOLYE_CHARACTER_RENDER_MODE;else process.env.ATOLYE_CHARACTER_RENDER_MODE=originalMode;}
  console.log("Production volume: PASS (real provider, portable PNG/context tamper, 3D motion/camera/modern cast, captured mode, legacy2D, real1080p FFmpeg, private project, paid0)");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
