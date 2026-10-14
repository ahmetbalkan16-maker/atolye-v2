import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {withCanonicalSmokeRuntime} from "../lib/CanonicalSmokeRuntime";
import {loadCinematicWorldPreviewArtwork} from "../lib/cinematic-preview-art";
import {prepareCinematicPreviewRenderer} from "../../src/lib/documentary/CinematicPreviewRenderer";
import {inspectCinematicStoryPlan,type CinematicStoryPlan} from "../../src/lib/documentary/CinematicStoryPlan";
import {selectMusicTrack} from "../../src/lib/audio/music/MusicLibrary";
import {classifyMediaRightsStatus,isProductionAdmissibleRightsStatus} from "../../src/lib/assets/MediaRightsPolicy";
import {volumeSpeechEnvelope,volumeSpeechLevel} from "../../src/lib/character/volume/VolumeSpeech";
import {assertAyasHeavyWorkloadAllowed} from "../../src/lib/ayas/machine/AyasMachineHealthGuard";
import {SpawnRunner} from "../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import {cinematicActorPerformance} from "../../src/lib/documentary/CinematicActorPerformance";
import {originalCinematicStereoAmbience,type CinematicSoundCue} from "../../src/lib/audio/sfx/CinematicStereoAmbience";
import {cinematicAudioFilterGraph} from "../../src/lib/audio/CinematicAudioMix";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const root=fs.realpathSync.native("D:/ÜRETİM/handover/IMMERSIVE_JANISSARY_2026-10-14");
 const input=path.resolve(process.argv[2]??"");
 if(path.dirname(input)!==root||!/^cinematic-preview-[0-9]+$/.test(path.basename(input))||
  fs.lstatSync(input).isSymbolicLink()||fs.realpathSync.native(input)!==input)throw Error("CINEMATIC_RERENDER_INPUT");
 const output=path.join(root,"cinematic-kinetic-"+Date.now());
 if(fs.existsSync(output))throw Error("CINEMATIC_RERENDER_EXISTS");fs.mkdirSync(output,{recursive:true});
 const checked=(name:string,max:number)=>{
  const file=path.join(input,name),s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.size<=0||s.size>max||fs.realpathSync.native(file)!==file)throw Error("CINEMATIC_RERENDER_SOURCE");
  return fs.readFileSync(file);
 };
 const plan=JSON.parse(checked("story-plan.json",262144).toString("utf8")).plan as CinematicStoryPlan;
 const inspection=inspectCinematicStoryPlan(plan),sourceHashes:Record<string,string>={};
 for(const name of ["narrator.wav","dialogue.wav","ambience.wav","story-plan.json"]){const b=checked(name,32*1024*1024);sourceHashes[name]=sha(b);fs.writeFileSync(path.join(output,name),b,{flag:"wx"});}
 const dialogue=fs.readFileSync(path.join(output,"dialogue.wav")),envelope=volumeSpeechEnvelope(dialogue,0,plan.durationSeconds);
 const {artwork:heroArt}=await loadCinematicWorldPreviewArtwork({packDirectory:"ottoman/early-modern/janissary/cinematic-reference/v1",atlasPath:"design/cinematic-atlas.png",identityPackDirectory:"ottoman/early-modern/janissary/reference/v1",identitySheetPath:"design/pose-atlas.png",poseOverrides:[{index:7,path:"design/serving-pose.png"}]});
 const companion=await loadCinematicWorldPreviewArtwork({packDirectory:"ottoman/early-modern/janissary/cinematic-companion/v1",atlasPath:"design/stand.png",identityPackDirectory:"ottoman/early-modern/janissary/cinematic-companion/v1",identitySheetPath:"design/stand.png",layout:"single",poseOverrides:[{index:1,path:"design/speaking.png"}]});
 const companionResources=companion.artwork.characters.get(companion.character.id)!;
 const artwork={...heroArt,characters:new Map([...heroArt.characters,...new Map([[companion.character.id,{...companionResources,puppetProfile:{frontHand:{x:.35,y:.645},backHand:{x:.71,y:.64},frontElbowV:.58,backElbowV:.575,shoulderV:.49,hipV:.78,kneeV:.87,footV:.92}}]])])};
 const origins=new Map<string,number>();
 for(const shot of plan.shots){const episode=shot.id.split("-shot-")[0]!;if(!origins.has(episode))origins.set(episode,shot.startSeconds);}
 for(const shot of plan.shots){
  const episode=shot.id.split("-shot-")[0]!,origin=origins.get(episode)!;
  const command=plan.speech.find(s=>s.kind==="dramatized-dialogue"&&s.shotId.startsWith(episode));
  const actors=shot.actors.map(a=>({...a,character:a.instanceId==="companion"?companion.character:a.character,clockOriginSeconds:origin,reactionAtSeconds:command&&a.instanceId==="hero"?Math.max(command.startSeconds,command.endSeconds-1.3):undefined,x:episode==="beat-4"?(a.instanceId==="hero"?.46:a.instanceId==="companion"?.59:a.x):a.x}));
  Object.assign(shot,{actors});
  if(episode==="beat-4"){
   const [id,prop]=[...heroArt.props!][0]!;
   Object.assign(shot,{propTransfers:[{asset:{id,contentSha256:prop.contentSha256},from:"hero",to:"companion",startSeconds:origin+7.5,endSeconds:origin+9.0}],interactions:[...shot.interactions,{from:"hero",to:"companion",kind:"handover"}]});
  }
 }
 const revisions:{characterId:string;from:string;to:string}[]=[];
 for(const shot of plan.shots)for(const actor of shot.actors){
  const current=artwork.characters.get(actor.character.id);
  if(!current||current.designIdentitySha256!==actor.character.designIdentitySha256)throw Error("CINEMATIC_RERENDER_MASTER_CHANGED");
  if(actor.character.contentSha256!==current.contentSha256){
   if(actor.character.contentSha256!=="0c5b95927c2d4ed51ef42581cbe0c13696e1d08ebba1837eca5ba156e63ef96c")throw Error("CINEMATIC_RERENDER_UNKNOWN_ART_REVISION");
   revisions.push({characterId:actor.character.id,from:actor.character.contentSha256,to:current.contentSha256});
   (actor.character as {contentSha256:string}).contentSha256=current.contentSha256;
  }
 }
 fs.renameSync(path.join(output,"story-plan.json"),path.join(output,"source-story-plan.json"));
 fs.writeFileSync(path.join(output,"story-plan.json"),JSON.stringify({plan,inspection:inspectCinematicStoryPlan(plan),artRevisions:revisions},null,2),{flag:"wx"});
 const render=await prepareCinematicPreviewRenderer(artwork,{motionMode:"grounded-skin"}),music=selectMusicTrack("historical","cinematic-janissary");
 if(!music||!isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(music.license)))throw Error("CINEMATIC_RERENDER_MUSIC");
 const cues:CinematicSoundCue[]=[],previous=new Map<string,boolean>();
 for(const[episode,origin]of origins){const segment=plan.shots.filter(s=>s.id.startsWith(episode+"-shot-")),end=segment.at(-1)!.endSeconds,fire=episode==="beat-4";
  cues.push({at:origin,duration:end-origin,kind:fire?"fire":"wind",pan:-.65,gain:.10,synchronization:"AUTHORED"},{at:origin,duration:end-origin,kind:fire?"fire":"wind",pan:.65,gain:.08,synchronization:"AUTHORED"});
 }
 for(let f=0;f<Math.floor(plan.durationSeconds*15);f++){
  const t=f/15,shot=plan.shots.find(s=>t>=s.startSeconds&&t<s.endSeconds)!;
  for(const a of shot.actors){const size=a.depth<.5?400:a.depth<.7?560:a.depth<.92?760:840;
   const state=cinematicActorPerformance(a,t,a.clockOriginSeconds!,size,false,a.reactionAtSeconds);
   if(state.action!=="WALK")continue;
   for(const[i,foot]of state.contacts.entries()){const key=(a.clockOriginSeconds??0)+":"+a.instanceId+":"+i,last=previous.get(key);previous.set(key,foot.planted);
    if(last===false&&foot.planted&&t+.2<plan.durationSeconds)cues.push({at:t,duration:.2,kind:"step",pan:Math.max(-.9,Math.min(.9,state.x*2-1)),gain:a.depth>.7?.18:.07,synchronization:"MEASURED_ACTION"});
   }
  }
 }
 fs.renameSync(path.join(output,"ambience.wav"),path.join(output,"source-ambience.wav"));
 fs.writeFileSync(path.join(output,"ambience.wav"),originalCinematicStereoAmbience(plan.durationSeconds,cues),{flag:"wx"});
 fs.writeFileSync(path.join(output,"motion-sound-cues.json"),JSON.stringify(cues,null,2),{flag:"wx"});
 const ffmpeg=process.env.FFMPEG_PATH??"ffmpeg",runner=new SpawnRunner(),frames=Math.ceil(plan.durationSeconds*15)+1;
 await withCanonicalSmokeRuntime({name:"cinematic-grounded-rerender"},async()=>{
  const parent=fs.realpathSync.native(os.tmpdir()),directory=fs.mkdtempSync(path.join(parent,"atolye-cinematic-grounded-"));
  const actual=fs.realpathSync.native(directory);
  if(path.dirname(actual)!==parent)throw Error("CINEMATIC_RERENDER_TEMP");
  try{
   let lastHealth=0;const captured=new Set<string>();
   for(let frame=0;frame<frames;frame++){
    if(Date.now()-lastHealth>5000){
     await assertAyasHeavyWorkloadAllowed({stage:"video",ownedActive:true});lastHealth=Date.now();
     const disk=fs.statfsSync(actual);if(disk.bavail/disk.blocks<.03)throw Error("CINEMATIC_RERENDER_DISK");
    }
    if(fs.existsSync(path.join(output,"STOP_REQUESTED")))throw Error("OWNER_QUOTA_SAFE_PAUSE");
    const t=Math.min(plan.durationSeconds-1e-6,frame/15),shot=plan.shots.find(s=>t>=s.startSeconds&&t<s.endSeconds)!;
    const speaking=plan.speech.find(s=>s.kind==="dramatized-dialogue"&&t>=s.startSeconds&&t<s.endSeconds&&volumeSpeechLevel(envelope,t)>.08)?.speakerInstanceId??null;
    const png=await render(shot,t,speaking);
    fs.writeFileSync(path.join(actual,"f"+String(frame).padStart(5,"0")+".png"),png,{flag:"wx"});
    if(!captured.has(shot.id)&&t>=shot.startSeconds+.7){fs.writeFileSync(path.join(output,shot.id+".png"),png,{flag:"wx"});captured.add(shot.id);}
    if(frame%150===0){console.log("grounded frame "+frame+"/"+frames);fs.writeFileSync(path.join(output,"progress.json"),JSON.stringify({frame,frames}));}
   }
   const result=await runner.run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-framerate","15","-i",path.join(actual,"f%05d.png"),
    "-i",path.join(output,"narrator.wav"),"-i",path.join(output,"dialogue.wav"),"-i",path.join(output,"ambience.wav"),"-stream_loop","-1","-i",music.absolutePath,
    "-filter_complex",cinematicAudioFilterGraph({narration:1,dialogue:2,ambience:3,music:4}),"-map","0:v","-map","[cinematicAudio]","-t",String(plan.durationSeconds),"-vf","fps=30","-c:v","libx264","-preset","veryfast","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-ar","48000","-ac","2","-b:a","192k","-movflags","+faststart",path.join(output,"cinematic-preview.mp4")],
    {timeoutMs:180000,maxOutputBytes:131072,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:"assembly",ownedActive:true})});
   if(result.failed||result.exitCode!==0)throw Error("CINEMATIC_RERENDER_FFMPEG: "+(result.stderr??"").slice(-1600));
   for(const name of Object.keys(sourceHashes))if(sha(checked(name,32*1024*1024))!==sourceHashes[name])throw Error("CINEMATIC_RERENDER_SOURCE_CHANGED");
   const receipt={status:"PASS_PREVIEW",output,sourceInput:input,sourceHashes,artRevisions:revisions,durationSeconds:plan.durationSeconds,storyInspection:inspection,
    footContact:"existing grounded skeleton drives continuous texture skinning; footfall sounds use its support transitions",audio:"four stems, 48kHz spatial stereo ambience plus centred resampled Piper narration",apiUsd:0,paidApiCalls:0,productionAdmission:"NOT_GRANTED",continuousJointRig:true,disconnectedPartRigAdmitted:false,distinctCompanion:true,propTransfer:true,motionSoundCueCount:cues.filter(c=>c.synchronization==="MEASURED_ACTION").length,ownerContentAccepted:false,published:false,liveDefaultModified:false};
   fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});console.log(JSON.stringify(receipt));
  }finally{
   if(fs.realpathSync.native(directory)!==actual||path.dirname(actual)!==parent||!path.basename(actual).startsWith("atolye-cinematic-grounded-"))throw Error("CINEMATIC_RERENDER_CLEANUP");
   fs.rmSync(actual,{recursive:true,force:true});
  }
 });
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
