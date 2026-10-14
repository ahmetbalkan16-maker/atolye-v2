import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {withCanonicalSmokeRuntime} from "../lib/CanonicalSmokeRuntime";
import {loadCinematicWorldPreviewArtwork} from "../lib/cinematic-preview-art";
import {ProjectManager} from "../../src/lib/projects/ProjectManager";
import {PiperAudioProvider} from "../../src/lib/audio/providers/PiperAudioProvider";
import {getPiperAudioProviderConfig} from "../../src/lib/audio/providers/AudioProviderConfig";
import {AudioPipeline} from "../../src/lib/audio/AudioPipeline";
import {AudioStorage} from "../../src/lib/assets/storage/AudioStorage";
import {selectMusicTrack} from "../../src/lib/audio/music/MusicLibrary";
import {classifyMediaRightsStatus,isProductionAdmissibleRightsStatus} from "../../src/lib/assets/MediaRightsPolicy";
import {assertAyasHeavyWorkloadAllowed} from "../../src/lib/ayas/machine/AyasMachineHealthGuard";
import {SpawnRunner} from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {alignLocalNarrationWav} from "../../src/lib/character/volume/VolumeNarrationAlignment";
import {volumeSpeechEnvelope,volumeSpeechLevel} from "../../src/lib/character/volume/VolumeSpeech";
import {inspectCinematicStoryPlan,type CinematicStoryPlan,type CinematicShot,type CinematicSpeech,type CinematicActor} from "../../src/lib/documentary/CinematicStoryPlan";
import {prepareCinematicPreviewRenderer} from "../../src/lib/documentary/CinematicPreviewRenderer";
import {originalCinematicStereoAmbience,type CinematicSoundCue} from "../../src/lib/audio/sfx/CinematicStereoAmbience";
import {cinematicAudioFilterGraph} from "../../src/lib/audio/CinematicAudioMix";

const beats=[
 {environment:"courtyard",narration:"Bin dört yüz seksen. İstanbul'da sabah başlıyor. Bir yeniçeri talime yetişmek için avludan geçiyor.",action:"walk",dialogue:null},
 {environment:"barracks",narration:"Koğuşta arkadaşları hazırlık yapıyor. Birinin gecikmesi, bütün sırayı bekletebilir. Asker donanımını kontrol ederken yanındaki arkadaşına dönüyor.",action:"prepare",dialogue:"Hazır mısın? Birlikte çıkalım."},
 {environment:"courtyard",narration:"Avluda eğitim başlıyor. Talim arkadaşı bir işaret veriyor. Yeniçeri duruşunu değiştiriyor; kılıcın hareketinden önce mesafeyi korumak gerekiyor.",action:"drill",dialogue:"Mesafeni koru. Şimdi bir adım."},
 {environment:"kitchen",narration:"Talim bitince ortak hayat devam ediyor. Kazanın yanında bekleyen asker, arkadaşına bir kap uzatıyor. Ateşin sıcaklığı, yorgunluğun yerini kısa bir molaya bırakıyor.",action:"serve",dialogue:"Al, biraz dinlenelim."},
 {environment:"barracks",narration:"Bu sıradan gün, kaynaklardan esinlenen bir canlandırma. Fatih Sultan Mehmed dönemindeki yeniçeriler, Osmanlı askerî düzeninin bir parçasıydı.",action:"listen",dialogue:null},
 {environment:"courtyard",narration:"Asker yeniden avluya çıkıyor. Birlikte hazırlanmak, öğrenmek ve yaşamak: bu düzen Osmanlı'nın askerî gücünü nasıl etkiledi?",action:"walk",dialogue:null}
] as const;
async function main(){
 const output=path.resolve("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14/cinematic-preview-"+Date.now());
 if(fs.existsSync(output))throw Error("CINEMATIC_OUTPUT_EXISTS");fs.mkdirSync(output,{recursive:true});
 const ffmpeg=process.env.FFMPEG_PATH??process.env.FFMPEG_EXECUTABLE??"ffmpeg",runner=new SpawnRunner();
 const run=async(args:string[],timeoutMs=120000)=>{
  const r=await runner.run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error",...args],{timeoutMs,maxOutputBytes:131072,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
  if(r.failed||r.exitCode!==0)throw Error("CINEMATIC_FFMPEG: "+(r.stderr??"").slice(-1800));return r;
 };
 const music=selectMusicTrack("historical","cinematic-janissary");
 if(!music||!isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(music.license)))throw Error("CINEMATIC_MUSIC_RIGHTS");
 const {artwork,character,environments}=await loadCinematicWorldPreviewArtwork({packDirectory:"ottoman/early-modern/janissary/cinematic-reference/v1",atlasPath:"design/cinematic-atlas.png",identityPackDirectory:"ottoman/early-modern/janissary/reference/v1",identitySheetPath:"design/pose-atlas.png",poseOverrides:[{index:7,path:"design/serving-pose.png"}]});
 const environmentFiles=new Map(environments.map(f=>[path.basename(f.declaration.path,".png"),f]));
 const render=await prepareCinematicPreviewRenderer(artwork);
 const shots:CinematicShot[]=[],speech:CinematicSpeech[]=[],cues:CinematicSoundCue[]=[],inputs:{file:string;at:number;duration:number;kind:"narrator"|"dramatized-dialogue";pan:number;envelope:ReturnType<typeof volumeSpeechEnvelope>;speaker:string|null}[]=[];
 let cursor=0,section=0;
 await withCanonicalSmokeRuntime({name:"cinematic-documentary-preview"},async context=>{
  const rel=path.relative(path.resolve("D:/ÜRETİM"),context.tempRoot),ascii=path.join("D:/URETIM",rel);
  if(rel.startsWith("..")||path.isAbsolute(rel)||fs.realpathSync.native(ascii)!==fs.realpathSync.native(context.tempRoot))throw Error("CINEMATIC_WHISPER_TEMP_IDENTITY");
  process.env.TEMP=ascii;process.env.TMP=ascii;
  const project=await ProjectManager.createProject("cinematic-documentary-"+context.runId.slice(0,8)),piper=getPiperAudioProviderConfig();
  const voice=async(text:string)=>{
   const result=await AudioPipeline.generateAudio({projectId:project.id,projectSlug:project.slug,provider:new PiperAudioProvider(()=>piper),audio:{narrator:{style:"narrative",tone:"warm",language:"tr"},sections:[{chapterId:++section,title:"1480 günlük yaşam canlandırması",duration:"15",emotion:"neutral",emphasis:[],narrationNotes:"Clear Turkish historical documentary",pacing:"normal",sourceText:text}],music:{mood:"historical",suggestion:"original-local",intensity:"low"},production:{targetFormat:"wav",sampleRate:22050,estimatedTotalDuration:"15",generationStatus:"planned"},createdAt:new Date().toISOString()}});
   const s=result.audio.sections[0]!,a=result.projectAssets.assets.find(x=>x.id===s.outputAssetId),duration=s.durationSeconds;
   if(!a?.filePath||!duration||duration>30)throw Error("CINEMATIC_VOICE_ASSET");
   const wav=AudioStorage.readStoredWav(project.slug,a.filePath,context.runtimeStorageContext),file=path.join(output,"voice-"+section+".wav");
   fs.writeFileSync(file,wav,{flag:"wx"});
   return {file,duration,wav,envelope:volumeSpeechEnvelope(wav,0,duration)};
  };
  for(const [i,b]of beats.entries()){
   await assertAyasHeavyWorkloadAllowed({stage:"audio",ownedActive:true});
   const n=await voice(b.narration),d=b.dialogue?await voice(b.dialogue):null,lead=i===0?1.6:.35,pause=d?.65:0;
   const duration=lead+n.duration+pause+(d?.duration??0)+.5,begin=cursor,end=cursor+duration;
   const timing=await alignLocalNarrationWav(n.wav,b.narration,{startSeconds:0,durationSeconds:n.duration});
   fs.writeFileSync(path.join(output,"timing-"+(i+1)+".json"),JSON.stringify(timing,null,2),{flag:"wx"});
   const env=environmentFiles.get(b.environment)!.declaration;
   const actor=(instanceId:string,x:number,depth:number,action:CinematicActor["action"],facing:CinematicActor["facing"],lookAt:string):CinematicActor=>({instanceId,character,x,depth,action,facing,lookAt,emotion:i===4&&instanceId==="hero"?"tired":i===2?"serious":"attentive"});
   const cast=i===0||i===5?[actor("hero",.46,.95,"walk","right","travel"),actor("companion",.16,.48,"walk","right","travel")]:
    [actor("hero",.38,.95,b.action,"right","companion"),actor("companion",.70,.88,d?"speak":"listen","left","hero"),
     actor("background-soldier",.87,.42,"prepare","left","work")];
   const nAt=begin+lead,dAt=nAt+n.duration+pause;
   inputs.push({...n,at:nAt,kind:"narrator",pan:0,speaker:null});
   if(d)inputs.push({...d,at:dAt,kind:"dramatized-dialogue",pan:.4,speaker:"companion"});
   // These editorial shots bind actual speech durations. They do not alter
   // the frozen pipeline's scene count or invent word/phoneme timestamps.
   const split=i===0?Math.min(3,duration/2):i===4?Math.min(3,duration/2):Math.min(duration/2,6);
   const cameras:CinematicShot["camera"][]=i===0?["feet","over-shoulder"]:i===4?["wide","context"]:i===5?["wide","pull-back"]:["wide","two-shot"];
   for(let j=0;j<2;j++){
    const start=j===0?begin:begin+split,stop=j===0?begin+split:end,id="beat-"+(i+1)+"-shot-"+(j+1);
    const shot:CinematicShot={id,startSeconds:start,endSeconds:stop,civilization:"ottoman",period:"early-modern",year:1480,
     environment:{id:env.id,contentSha256:env.sha256},camera:cameras[j]!,purpose:["Talim için sabah hazırlığı","Birlikte hazırlanmanın nedeni","Mesafe ve disiplinle kontrollü eğitim","Ortak yemek ve dinlenme","Kaynaklı tarihsel bağlam","Sonraki tarih sorusuna geçiş"][i]!,
     narrationAnchor:i===4?"Fatih Sultan Mehmed dönemi":b.narration,actors:cast,
     interactions:d?[{from:"companion",to:"hero",kind:i===2?"order":"response"}]:[]};
    shots.push(shot);
   }
   // A spoken paragraph can cross an editorial cut. Keep per-shot clipped
   // semantic anchors, with exactly the original source text and WAV duration.
   for(const segment of inputs.filter(v=>v.at>=begin&&v.at<end)){
    for(const shot of shots.filter(s=>s.startSeconds>=begin&&s.endSeconds<=end)){
     const start=Math.max(segment.at,shot.startSeconds),stop=Math.min(segment.at+segment.duration,shot.endSeconds);
     if(stop>start)speech.push({shotId:shot.id,startSeconds:start,endSeconds:stop,text:segment.kind==="narrator"?b.narration:b.dialogue!,
      kind:segment.kind,speakerInstanceId:segment.speaker,pan:segment.pan,sourceIds:segment.kind==="narrator"?["janissaries","mehmed"]:[]});
    }
   }
   cues.push({at:begin,duration,kind:b.environment==="kitchen"?"fire":"wind",pan:-.65,gain:.10,synchronization:"AUTHORED"},
    {at:begin+.05,duration:duration-.05,kind:b.environment==="kitchen"?"fire":"wind",pan:.65,gain:.075,synchronization:"AUTHORED"});
   if(b.action==="walk")for(let at=begin+.1;at<end-.22;at+=.68)cues.push({at,duration:.2,kind:"step",pan:(at-begin)/duration*.4-.2,gain:.18,synchronization:"AUTHORED"});
   for(const s of timing.sentences)if(s.action==="FIGHT")cues.push({at:nAt+s.start+.2,duration:Math.min(.6,n.duration-s.start-.2),kind:"metal",pan:-.2,gain:.12,synchronization:"MEASURED_ACTION"});
   if(i===2)cues.push({at:dAt+.1,duration:.4,kind:"metal",pan:.35,gain:.10,synchronization:"AUTHORED"});
   if(i===3)cues.push({at:begin+3,duration:.5,kind:"pot",pan:-.4,gain:.14,synchronization:"AUTHORED"});
   cursor=end;
   fs.writeFileSync(path.join(output,"progress.json"),JSON.stringify({beatsComplete:i+1,duration:cursor,apiUsd:0}));
   console.log("cinematic audio/plan beat "+(i+1)+" "+duration.toFixed(3)+"s");
  }
  const plan:CinematicStoryPlan={schemaVersion:"cinematic-story-v1",durationSeconds:cursor,
   question:"Bir yeniçerinin sıradan günü askerî düzeni nasıl görünür kılar?",
   cause:"Birlikte hazırlanmak talimde aynı sırayı ve güvenli mesafeyi korumayı gerektirir.",
   experience:"Hazırlık, talim ve ortak yemek iki anonim askerin gözünden canlandırılır.",
   consequence:"Günlük birlik hayatı tarihsel askerî organizasyon sorusuna bağlanır.",
   sources:[{id:"janissaries",url:"https://islamansiklopedisi.org.tr/yeniceri",claim:"Yeniçerilerin Osmanlı askerî teşkilatı içindeki yeri; günlük sahneler temsili yorumdur."},
    {id:"mehmed",url:"https://islamansiklopedisi.org.tr/mehmed-ii",claim:"1480 Fatih Sultan Mehmed dönemindedir; Osmanlı'nın kuruluş tarihi değildir."}],
   shots,speech:speech.sort((a,b)=>a.startSeconds-b.startSeconds)};
  const inspection=inspectCinematicStoryPlan(plan);
  fs.writeFileSync(path.join(output,"story-plan.json"),JSON.stringify({plan,inspection},null,2),{flag:"wx"});
  fs.writeFileSync(path.join(output,"ambience.wav"),originalCinematicStereoAmbience(cursor,cues),{flag:"wx"});
  fs.writeFileSync(path.join(output,"sound-cues.json"),JSON.stringify(cues,null,2),{flag:"wx"});
  // Native FFmpeg stages actual mono source segments at their measured starts.
  // Character dialogue gets equal-power spatial placement, narrator stays centred.
  for(const kind of ["narrator","dramatized-dialogue"] as const){
   const segments=inputs.filter(x=>x.kind===kind),args=segments.flatMap(s=>["-i",s.file]);
   const filters=segments.map((s,i)=>{
    const pan=kind==="narrator"?"aformat=channel_layouts=mono": "aformat=channel_layouts=mono,pan=stereo|c0="+Math.cos((s.pan+1)*Math.PI/4).toFixed(6)+"*c0|c1="+Math.sin((s.pan+1)*Math.PI/4).toFixed(6)+"*c0";
    return "["+i+":a]aresample=48000,"+pan+",adelay="+Math.round(s.at*1000)+":all=1[s"+i+"]";
   });
   filters.push(segments.map((_,i)=>"[s"+i+"]").join("")+"amix=inputs="+segments.length+":normalize=0,apad,atrim=duration="+cursor+"[stem]");
   await run([...args,"-filter_complex",filters.join(";"),"-map","[stem]","-ar","48000","-c:a","pcm_s16le",path.join(output,kind==="narrator"?"narrator.wav":"dialogue.wav")]);
  }
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"atolye-cinematic-frames-")),actual=fs.realpathSync.native(directory);
  if(path.dirname(actual)!==fs.realpathSync.native(os.tmpdir())||!path.basename(actual).startsWith("atolye-cinematic-frames-"))throw Error("CINEMATIC_FRAMES_PATH");
  try{
   const count=Math.ceil(cursor*15)+1;let lastHealth=0;
   for(let frame=0;frame<count;frame++){
    if(Date.now()-lastHealth>5000){
     await assertAyasHeavyWorkloadAllowed({stage:"video",ownedActive:true});lastHealth=Date.now();
     const disk=fs.statfsSync(actual);if(disk.bavail/disk.blocks<.03)throw Error("CINEMATIC_STORAGE_PRESSURE");
    }
    const t=Math.min(cursor-1e-6,frame/15),shot=shots.find(s=>t>=s.startSeconds&&t<s.endSeconds)!;
    const speaking=inputs.find(s=>s.kind==="dramatized-dialogue"&&t>=s.at&&t<s.at+s.duration&&volumeSpeechLevel(s.envelope,t-s.at)>.08)?.speaker??null;
    const png=await render(shot,t,speaking);
    fs.writeFileSync(path.join(actual,"f"+String(frame).padStart(5,"0")+".png"),png,{flag:"wx"});
    if(frame%150===0){console.log("cinematic frame "+frame+"/"+count);fs.writeFileSync(path.join(output,"render-progress.json"),JSON.stringify({frame,count,time:t}));}
    for(const [index,s]of shots.entries())if(Math.abs(t-s.startSeconds-1)<1/30&&!fs.existsSync(path.join(output,"shot-"+(index+1)+".png")))fs.writeFileSync(path.join(output,"shot-"+(index+1)+".png"),png,{flag:"wx"});
   }
   await run(["-framerate","15","-i",path.join(actual,"f%05d.png"),"-i",path.join(output,"narrator.wav"),"-i",path.join(output,"dialogue.wav"),"-i",path.join(output,"ambience.wav"),"-stream_loop","-1","-i",music.absolutePath,
    "-filter_complex",cinematicAudioFilterGraph({narration:1,dialogue:2,ambience:3,music:4}),"-map","0:v","-map","[cinematicAudio]","-t",String(cursor),"-vf","fps=30","-c:v","libx264","-preset","veryfast","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-ar","48000","-ac","2","-b:a","192k","-movflags","+faststart",path.join(output,"cinematic-preview.mp4")],180000);
  }finally{
   if(fs.realpathSync.native(directory)!==actual||path.dirname(actual)!==fs.realpathSync.native(os.tmpdir()))throw Error("CINEMATIC_FRAME_CLEANUP_IDENTITY");
   fs.rmSync(actual,{recursive:true,force:true});
  }
  const receipt={status:"PASS",output,durationSeconds:cursor,storyInspection:inspection,voiceSource:"Piper 22050Hz mono (resampled, not a new 48kHz voice recording)",dialogue:"Piper anonymous dramatization, explicitly disclosed",ambience:"original CC0, native 48000Hz two independent spatial channels",music:music.title,
   apiUsd:0,paidApiCalls:0,admission:"PREVIEW_ONLY",continuousJointRig:false,phonemeLipSync:false,streetCivilianAssets:false,oldProjectModified:false,liveDefaultModified:false,published:false,ownerContentAccepted:false};
  fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});console.log(JSON.stringify(receipt));
 });
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
