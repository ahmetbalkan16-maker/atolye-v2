import fs from "node:fs";
import path from "node:path";
import {withCanonicalSmokeRuntime} from "../lib/CanonicalSmokeRuntime";
import {ProjectManager} from "../../src/lib/projects/ProjectManager";
import {CharacterImageProvider} from "../../src/lib/assets/providers/CharacterImageProvider";
import {readCharacterScenePayload} from "../../src/lib/animation/character/CharacterSceneAsset";
import {PiperAudioProvider} from "../../src/lib/audio/providers/PiperAudioProvider";
import {getPiperAudioProviderConfig} from "../../src/lib/audio/providers/AudioProviderConfig";
import {AudioPipeline} from "../../src/lib/audio/AudioPipeline";
import {AudioStorage} from "../../src/lib/assets/storage/AudioStorage";
import {resolveRuntimeLogicalPath} from "../../src/lib/runtime/RuntimeStoragePaths";
import {selectMusicTrack} from "../../src/lib/audio/music/MusicLibrary";
import {classifyMediaRightsStatus,isProductionAdmissibleRightsStatus} from "../../src/lib/assets/MediaRightsPolicy";
import {assertAyasHeavyWorkloadAllowed} from "../../src/lib/ayas/machine/AyasMachineHealthGuard";
import {SpawnRunner} from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {renderCharacterSceneFrames,buildCharacterSceneFFmpegArgs} from "../../src/lib/video/providers/FFmpegSceneVideoProvider";
import {alignLocalNarrationWav} from "../../src/lib/character/volume/VolumeNarrationAlignment";
import {volumeSpeechEnvelope} from "../../src/lib/character/volume/VolumeSpeech";
import {loadIllustratedJanissaryPreview,ILLUSTRATED_JANISSARY_ID,type IllustratedEnvironment} from "../../src/lib/character/illustrated/IllustratedJanissaryPreview";
import {originalSceneAmbience} from "../../src/lib/audio/sfx/OriginalSceneAmbience";

const scenes:{environment:IllustratedEnvironment;prompt:string;narration:string}[]=[
 {environment:"barracks",prompt:"1480 yılında Osmanlı yeniçeri askeri koğuşta oturuyor, sonra konuşuyor.",narration:"Bin dört yüz seksen. İstanbul'da, Fatih Sultan Mehmed'in dönemindeyiz. Kaynaklardan esinlenen bu günü bir yeniçerinin gözünden canlandırıyoruz. Asker koğuşta oturuyor; dışarıdan sabahın ilk sesleri geliyor."},
 {environment:"courtyard",prompt:"1480 yılında Osmanlı yeniçeri askeri avluda yürüyor ve eğiliyor.",narration:"Yeniçeri avluya yürüyor. Keçe başlığının ardındaki kumaş, adımlarıyla hafifçe sallanıyor. Arkadaşına selam verirken eğiliyor. Kışladaki hayatın merkezinde yalnız savaş değil, birlikte yaşama disiplini de var."},
 {environment:"courtyard",prompt:"1480 yılında Osmanlı yeniçeri askeri avluda kılıcını savuruyor; kontrollü talim.",narration:"Şimdi talim alanına geçiyoruz. Yeniçeri kılıcını savuruyor. Bu kontrollü talimde karşısındaki gerçek bir düşman değil. Her ayrıntıyı belgelenmiş bir sabah gibi düşünmeyin: bu sahne, dönemi anlatan temsili bir canlandırma."},
 {environment:"kitchen",prompt:"1480 yılında Osmanlı yeniçeri askeri mutfakta işaret ediyor ve konuşuyor.",narration:"Mutfakta ateş çıtırdıyor. Yeniçeri, ortak yemeğin hazırlandığı kazanı gösteriyor. Birlikte yemek yemek, askerleri aynı hayatın içine bağlıyor. Bu sade ortam, gösterişli bir saraydan farklı bir dünyanın kapısını açıyor."},
 {environment:"courtyard",prompt:"1480 yılında Osmanlı yeniçeri askeri avluda diz çöküyor sonra ekipmanı gösteriyor.",narration:"Avluya dönen asker diz çöküyor. Kemerini ve taşıdığı donanımı kontrol ediyor; biraz sonra nöbete hazırlanacak. Yeniçeriyle zırhlı süvariyi birbirine karıştırmayalım. Görev, kıyafet ve kullanılan malzeme aynı değil."},
 {environment:"barracks",prompt:"1480 yılında Osmanlı yeniçeri askeri koğuşta oturuyor ve konuşuyor.",narration:"Koğuşta yeniden oturuyor. Bugünkü yolculuğumuz, tek bir toplantının tekrarından değil; hazırlık, talim ve ortak hayatın farklı sahnelerinden oluştu. Gördüğümüz ayrıntılar yorumdur. Tarihî kaynak ile canlandırma arasındaki sınırı koruyarak o dünyanın içine baktık."}
];
async function main(){
 const output=path.resolve("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/illustrated-preview-"+Date.now());
 if(fs.existsSync(output))throw Error("ILLUSTRATED_PREVIEW_OUTPUT_EXISTS");fs.mkdirSync(output,{recursive:true});
 const ffmpeg=process.env.FFMPEG_EXECUTABLE??process.env.FFMPEG_PATH??"ffmpeg",runner=new SpawnRunner();
 const music=selectMusicTrack("historical","illustrated-janissary");
 if(!music||!isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(music.license)))throw Error("ILLUSTRATED_PREVIEW_MUSIC_RIGHTS");
 const receipt:unknown[]=[],clips:string[]=[];
 await withCanonicalSmokeRuntime({name:"illustrated-janissary-preview"},async context=>{
  const rel=path.relative(path.resolve("D:/ÜRETİM"),context.tempRoot);if(rel.startsWith("..")||path.isAbsolute(rel))throw Error("ILLUSTRATED_PREVIEW_TEMP_ROOT");
  const ascii=path.join("D:/URETIM",rel);if(fs.realpathSync.native(ascii)!==fs.realpathSync.native(context.tempRoot))throw Error("ILLUSTRATED_PREVIEW_TEMP_IDENTITY");process.env.TEMP=ascii;process.env.TMP=ascii;
  const project=await ProjectManager.createProject("illustrated-janissary-"+context.runId.slice(0,8));
  const provider=new CharacterImageProvider(),piper=getPiperAudioProviderConfig();
  for(const [index,s] of scenes.entries()){
   await assertAyasHeavyWorkloadAllowed({stage:"visuals",ownedActive:true});
   const image=await provider.generateImage({sceneId:index+1,projectSlug:project.slug,prompt:s.prompt});
   if(!image.success||!image.filePath)throw Error("ILLUSTRATED_PREVIEW_NATIVE_IMAGE");
   const parsed=readCharacterScenePayload(fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,context.runtimeStorageContext)));
   if(parsed.status!=="VALID")throw Error("ILLUSTRATED_PREVIEW_PAYLOAD");
   const art=await loadIllustratedJanissaryPreview({civilization:"ottoman",period:"early-modern",role:"janissary",characterId:ILLUSTRATED_JANISSARY_ID,year:1480,environment:s.environment});
   const audio=await AudioPipeline.generateAudio({projectId:project.id,projectSlug:project.slug,provider:new PiperAudioProvider(()=>piper),audio:{narrator:{style:"narrative",tone:"warm",language:"tr"},sections:[{chapterId:index+1,title:"1480 yeniçeri günü",duration:"20",emotion:"neutral",emphasis:[],narrationNotes:"Clear Turkish documentary",pacing:"normal",sourceText:s.narration}],music:{mood:"historical",suggestion:"original-local",intensity:"low"},production:{targetFormat:"wav",sampleRate:22050,estimatedTotalDuration:"20",generationStatus:"planned"},createdAt:new Date().toISOString()}});
   const narration=audio.projectAssets.assets.find(a=>a.id===audio.audio.sections[0]!.outputAssetId),duration=audio.audio.sections[0]!.durationSeconds??0;
   if(!narration?.filePath||duration<=0||duration>40)throw Error("ILLUSTRATED_PREVIEW_AUDIO");
   const wav=AudioStorage.readStoredWav(project.slug,narration.filePath,context.runtimeStorageContext);
   const timing=await alignLocalNarrationWav(wav,s.narration,{startSeconds:0,durationSeconds:duration});
   const envelope=volumeSpeechEnvelope(wav,0,duration);
   fs.writeFileSync(path.join(output,"timing-"+(index+1)+".json"),JSON.stringify(timing,null,2),{flag:"wx"});
   fs.writeFileSync(path.join(output,"narration-"+(index+1)+".wav"),wav,{flag:"wx"});
   const bed=path.join(output,"ambience-"+(index+1)+".wav");fs.writeFileSync(bed,originalSceneAmbience(duration,s.environment,timing),{flag:"wx"});
   const frames=await renderCharacterSceneFrames(parsed.payload,duration,undefined,envelope,timing,art);
   const silent=path.join(output,"silent-"+(index+1)+".mp4");
   try{
    const rendered=await runner.run(ffmpeg,buildCharacterSceneFFmpegArgs({motionPlan:{durationSeconds:duration}},silent,frames.pattern),{timeoutMs:120000,maxOutputBytes:131072,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
    if(rendered.failed||rendered.exitCode!==0)throw Error("ILLUSTRATED_PREVIEW_VIDEO");
    fs.copyFileSync(frames.pattern.replace("f%05d.png","f00030.png"),path.join(output,"scene-"+(index+1)+".png"));
   }finally{frames.dispose();}
   const clip=path.join(output,"clip-"+(index+1)+".mp4");
   const mix=await runner.run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-i",silent,"-i",path.join(output,"narration-"+(index+1)+".wav"),"-stream_loop","-1","-i",music.absolutePath,"-i",bed,"-filter_complex","[1:a]asplit=2[voice][key];[2:a]volume=0.12[music];[3:a]volume=0.65[fx];[music][fx]amix=inputs=2:normalize=0[bed];[bed][key]sidechaincompress=threshold=0.025:ratio=7:attack=50:release=600[duck];[voice][duck]amix=inputs=2:normalize=0,alimiter=limit=0.94:level=false[a]","-map","0:v","-map","[a]","-t",String(duration),"-c:v","copy","-c:a","aac","-movflags","+faststart",clip],{timeoutMs:120000,maxOutputBytes:131072,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
   if(mix.failed||mix.exitCode!==0)throw Error("ILLUSTRATED_PREVIEW_MIX");
   clips.push(clip);receipt.push({sceneId:index+1,environment:s.environment,duration,narration:s.narration,actions:timing.sentences.map(x=>x.action),timing:timing.timing,hashes:art.hashes});
   fs.writeFileSync(path.join(output,"progress.json"),JSON.stringify(receipt,null,2));console.log("scene "+(index+1)+" complete "+duration+"s");
  }
 });
 const listing=path.join(output,"clips.txt");fs.writeFileSync(listing,clips.map(f=>"file '"+path.basename(f)+"'").join("\n"),{flag:"wx"});
 const file=path.join(output,"preview.mp4"),joined=await runner.run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-f","concat","-safe","1","-i",listing,"-vf","fps=30","-c:v","libx264","-preset","veryfast","-crf","18","-c:a","aac","-movflags","+faststart",file],{timeoutMs:60000,maxOutputBytes:131072,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
 if(joined.failed||joined.exitCode!==0)throw Error("ILLUSTRATED_PREVIEW_JOIN");
 const final={status:"PASS",file,scenes:receipt,voice:"piper-local",music:music.title,sfx:"original-procedural-CC0",ducking:true,realLocalSentenceAlignment:true,paidApiCalls:0,apiUsd:0,approvedTotalVideoCapUsd:1,admission:"PREVIEW_ONLY",oldProjectModified:false,liveDefaultModified:false,published:false,continuousLimbRig:false,phonemeLipSync:false,ownerAnimationAccepted:false};
 fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify(final,null,2),{flag:"wx"});console.log(JSON.stringify(final));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
