import fs from "node:fs";
import path from "node:path";
import {withCanonicalSmokeRuntime} from "../lib/CanonicalSmokeRuntime";
import {ProjectManager} from "../../src/lib/projects/ProjectManager";
import {CharacterImageProvider} from "../../src/lib/assets/providers/CharacterImageProvider";
import {readCharacterScenePayload} from "../../src/lib/animation/character/CharacterSceneAsset";
import {FFmpegSceneVideoProvider} from "../../src/lib/video/providers/FFmpegSceneVideoProvider";
import {SpawnRunner} from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {PiperAudioProvider} from "../../src/lib/audio/providers/PiperAudioProvider";
import {getPiperAudioProviderConfig} from "../../src/lib/audio/providers/AudioProviderConfig";
import {AudioPipeline} from "../../src/lib/audio/AudioPipeline";
import {resolveRuntimeLogicalPath} from "../../src/lib/runtime/RuntimeStoragePaths";
import {selectMusicTrack} from "../../src/lib/audio/music/MusicLibrary";
import {classifyMediaRightsStatus,isProductionAdmissibleRightsStatus} from "../../src/lib/assets/MediaRightsPolicy";
import {assertAyasHeavyWorkloadAllowed} from "../../src/lib/ayas/machine/AyasMachineHealthGuard";

async function main() {
  const root=fs.realpathSync.native(process.cwd()),output=path.join(root,"bin","ayas-local-visual","demos",`production-volume-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
  const ffmpeg=process.env.FFMPEG_EXECUTABLE??process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_EXECUTABLE??process.env.FFPROBE_PATH;
  if(!ffmpeg||!ffprobe||!path.isAbsolute(ffmpeg)||!path.isAbsolute(ffprobe)) throw new Error("PREVIEW_FFMPEG_REQUIRED");
  const piper=getPiperAudioProviderConfig(),music=selectMusicTrack("historical","volume-design");
  if(!music||!isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(music.license))) throw new Error("PREVIEW_LICENSED_MUSIC_REQUIRED");
  const descriptions=[
    {prompt:"1453 yılında Osmanlı padişahı sarayda konuşuyor.",narration:"Bir hükümdarın kıyafeti bize ne anlatır? Şimdi 1453 yılına gidiyoruz. Bu saray sahnesi bir canlandırma. Padişah konuşurken danışmanı onu dinliyor."},
    {prompt:"1550 yılında Osmanlı padişahı sarayda kıyafetini gösteriyor ve konuşuyor.",narration:"Yüzyıl değiştiğinde kıyafet de değişir. Başlık, kaftan ve kumaş desenleri döneme göre seçilmelidir. Tarihi anlatırken bu ayrıntılar önemlidir."},
  ];
  const results: unknown[]=[],clips: string[]=[];
  await withCanonicalSmokeRuntime({name:"volume-design-preview"},async context=>{
    const project=await ProjectManager.createProject(`volume-design-${context.runId.slice(0,10)}`);
    const imageProvider=new CharacterImageProvider(),videoProvider=new FFmpegSceneVideoProvider(new SpawnRunner(),()=>({ffmpegPath:ffmpeg,ffprobePath:ffprobe,timeoutMs:120000,maxOutputBytes:128*1024*1024,maxStdioBytes:1024*1024}));
    for(const [i,description] of descriptions.entries()) {
      await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
      const image=await imageProvider.generateImage({sceneId:i+1,projectSlug:project.slug,prompt:description.prompt});
      if(!image.success||!image.filePath) throw new Error("PREVIEW_PRODUCTION_IMAGE_FAILED");
      const png=fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,context.runtimeStorageContext)),read=readCharacterScenePayload(png);
      if(read.status!=="VALID"||!read.payload.volume) throw new Error("PREVIEW_PRODUCTION_VOLUME_REQUIRED");
      fs.writeFileSync(path.join(output,`scene-${i+1}.png`),png,{flag:"wx"});
      const audio=await AudioPipeline.generateAudio({projectId:project.id,projectSlug:project.slug,provider:new PiperAudioProvider(()=>piper),audio:{narrator:{style:"narrative",tone:"friendly",language:"tr"},sections:[{chapterId:i+1,title:"Dönem tasarımı",duration:"12",emotion:"neutral",emphasis:[],narrationNotes:"Clear Turkish",pacing:"normal",sourceText:description.narration}],music:{mood:"historical",suggestion:"local",intensity:"low"},production:{targetFormat:"wav",sampleRate:22050,estimatedTotalDuration:"12",generationStatus:"planned"},createdAt:new Date().toISOString()}});
      const narration=audio.projectAssets.assets.find(a=>a.id===audio.audio.sections[0]!.outputAssetId),duration=audio.audio.sections[0]!.durationSeconds??0;
      if(!narration?.filePath||duration<=0||duration>35) throw new Error("PREVIEW_REAL_VOICE_REQUIRED");
      const frame={crop:{x:.1,y:.1,width:.8,height:.8},transform:{scale:1,translateX:0,translateY:0}};
      const video=await videoProvider.generateVideo({projectId:project.id,projectSlug:project.slug,scenes:[{sceneId:i+1,sourceImageAssetId:`preview-image-${i}`,animationAssetId:`preview-anim-${i}`,imageFilePath:image.filePath,imageMimeType:"image/png",motionPlan:{sceneId:i+1,animationPrompt:"contextual performance",sourceImageAssetId:`preview-image-${i}`,outputAssetId:`preview-anim-${i}`,animationAssetId:`preview-anim-${i}`,durationSeconds:duration,motionType:"zoom-in",start:frame,end:frame,transition:"fade",provider:"mock",model:"design-cue",generationMode:"mock",artifactType:"motion-plan",status:"generated"}}]});
      if(!video.success) throw new Error("PREVIEW_PRODUCTION_VIDEO_FAILED");
      const clip=path.join(output,`clip-${i+1}.mp4`);
      const mixed=await new SpawnRunner().run(ffmpeg,["-hide_banner","-loglevel","error","-i",resolveRuntimeLogicalPath(video.scenes[0]!.filePath,context.runtimeStorageContext),"-i",resolveRuntimeLogicalPath(narration.filePath,context.runtimeStorageContext),"-stream_loop","-1","-i",music.absolutePath,"-filter_complex","[1:a]asplit=2[voice][key];[2:a]volume=0.13[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=5:attack=100:release=800[duck];[voice][duck]amix=inputs=2:normalize=0[a]","-map","0:v","-map","[a]","-t",String(duration),"-c:v","copy","-c:a","aac","-movflags","+faststart",clip],{timeoutMs:120000,maxOutputBytes:65536,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
      if(mixed.failed||mixed.exitCode!==0) throw new Error("PREVIEW_MIX_FAILED");clips.push(clip);results.push({scene:i+1,seconds:duration,year:read.payload.volume.sceneYears,recipe:read.payload.volume.wardrobes[0]!.brief.recipe,realProvider:true});
    }
  });
  const listing=path.join(output,"clips.txt");fs.writeFileSync(listing,clips.map(f=>`file '${path.basename(f)}'`).join("\n"),{flag:"wx"});
  const file=path.join(output,"preview.mp4"),joined=await new SpawnRunner().run(ffmpeg,["-hide_banner","-loglevel","error","-f","concat","-safe","1","-i",listing,"-c","copy","-movflags","+faststart",file],{timeoutMs:60000,maxOutputBytes:65536,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
  if(joined.failed||joined.exitCode!==0) throw new Error("PREVIEW_JOIN_FAILED");
  const receipt={status:"PASS",file,scenes:results,realProductionImageAndSceneVideoProviders:true,voice:"piper-local",music:music.title,rightsStatus:classifyMediaRightsStatus(music.license),ducking:true,paidCalls:0,ownerProjectUsed:false,published:false,timing:"SCENE_TEXT_ESTIMATE",wordOrPhonemeAlignment:false,ownerQualityAccepted:false};
  fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});console.log(JSON.stringify(receipt));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
