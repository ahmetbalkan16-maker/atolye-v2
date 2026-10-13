import fs from 'node:fs';
import path from 'node:path';
import {withCanonicalSmokeRuntime} from '../lib/CanonicalSmokeRuntime';
import {ProjectManager} from '../../src/lib/projects/ProjectManager';
import {AssetManager} from '../../src/lib/assets/AssetManager';
import {CharacterImageProvider} from '../../src/lib/assets/providers/CharacterImageProvider';
import {FFmpegSceneVideoProvider} from '../../src/lib/video/providers/FFmpegSceneVideoProvider';
import {FFmpegVideoAssemblyProvider,SpawnRunner} from '../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider';
import {PiperAudioProvider} from '../../src/lib/audio/providers/PiperAudioProvider';
import {getPiperAudioProviderConfig} from '../../src/lib/audio/providers/AudioProviderConfig';
import {AudioPipeline} from '../../src/lib/audio/AudioPipeline';
import {resolveRuntimeLogicalPath} from '../../src/lib/runtime/RuntimeStoragePaths';
import {readCharacterScenePayload} from '../../src/lib/animation/character/CharacterSceneAsset';
import {selectMusicTrack} from '../../src/lib/audio/music/MusicLibrary';
import {stageProjectBackgroundMusic} from '../../src/lib/audio/music/AudioMusicSelection';
import {assertAyasHeavyWorkloadAllowed} from '../../src/lib/ayas/machine/AyasMachineHealthGuard';

/** Real local provider proof, preserving video-before-audio production order.
 * Two private scenes, actual assembly PCM synchronisation and existing ducking. */
async function main(){
  const root=fs.realpathSync.native(process.cwd()),output=path.join(root,'bin/ayas-local-visual/demos',`equipment-speech-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
  const ffmpeg=process.env.FFMPEG_PATH,ffprobe=process.env.FFPROBE_PATH,piper=getPiperAudioProviderConfig(),music=selectMusicTrack('historical','equipment-proof');
  if(!ffmpeg||!ffprobe||!music)throw new Error('EQUIPMENT_PREVIEW_CONFIG');
  const clips:string[]=[],results:unknown[]=[];
  const cases=[
    {prompt:'1480 yılında Osmanlı yeniçeri askeri mızrağını tutarak meydanda yürüyor.',text:'Mızrağın metal ucu ve sapı artık daha belirgin. Yürürken silah elde kalıyor.'},
    {prompt:'1550 yılında Osmanlı zırhlı sipahi askeri kılıcını tutuyor, konuşuyor ve işaret ediyor. Ardından eğilip selam veriyor.',text:'Kılıcın ağzına ve sapına bakalım. Şimdi eğilip selam veriyorum.'},
  ];
  await withCanonicalSmokeRuntime({name:'equipment-speech-preview'},async runtime=>{
    process.env.FFMPEG_PATH=ffmpeg;process.env.FFPROBE_PATH=ffprobe;
    const project=await ProjectManager.createProject(`equipment-${runtime.runId.slice(0,8)}`),runner=new SpawnRunner();
    const provider=new FFmpegSceneVideoProvider(runner,()=>({ffmpegPath:ffmpeg,ffprobePath:ffprobe,timeoutMs:120000,maxOutputBytes:128*1024*1024,maxStdioBytes:1024*1024}));
    for(const [i,c] of cases.entries()){
      await assertAyasHeavyWorkloadAllowed({stage:'visuals',ownedActive:true});
      const image=await new CharacterImageProvider().generateImage({sceneId:i+1,projectSlug:project.slug,prompt:c.prompt});
      if(!image.success||!image.filePath)throw new Error('EQUIPMENT_IMAGE');
      const png=fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,runtime.runtimeStorageContext)),parsed=readCharacterScenePayload(png);
      if(parsed.status!=='VALID'||parsed.payload.volume?.presentation!=='EQUIPMENT_MOTION_V2')throw new Error('EQUIPMENT_PAYLOAD');
      fs.writeFileSync(path.join(output,`scene-${i+1}.png`),png);
      const asset=AssetManager.createAsset({projectId:project.id,projectSlug:project.slug,sceneId:i+1,type:'image',status:'generated',provider:'character',model:image.model,prompt:c.prompt,filePath:image.filePath,url:image.url,mimeType:'image/png',width:1920,height:1080,byteLength:png.length});AssetManager.addAsset(project.slug,project.id,asset);
      const frame={crop:{x:.1,y:.1,width:.8,height:.8},transform:{scale:1,translateX:0,translateY:0}};
      const video=await provider.generateVideo({projectId:project.id,projectSlug:project.slug,scenes:[{sceneId:i+1,sourceImageAssetId:asset.id,animationAssetId:`preview-anim-${i}`,imageFilePath:image.filePath,imageMimeType:'image/png',motionPlan:{sceneId:i+1,animationPrompt:'Equipment proof',sourceImageAssetId:asset.id,outputAssetId:`preview-anim-${i}`,animationAssetId:`preview-anim-${i}`,durationSeconds:8,motionType:'static',start:frame,end:frame,transition:'cut',provider:'mock',model:'private-plan',generationMode:'mock',artifactType:'motion-plan',status:'generated'}}]});
      if(!video.success)throw new Error('EQUIPMENT_VIDEO');
      const audio=await AudioPipeline.generateAudio({projectId:project.id,projectSlug:project.slug,provider:new PiperAudioProvider(()=>piper),audio:{narrator:{style:'narrative',tone:'friendly',language:'tr'},sections:[{chapterId:i+1,title:'Equipment proof',duration:'8',emotion:'neutral',emphasis:[],narrationNotes:'Clear Turkish',pacing:'normal',sourceText:c.text}],music:{mood:'historical',suggestion:'local',intensity:'low'},production:{targetFormat:'wav',sampleRate:22050,estimatedTotalDuration:'8',generationStatus:'planned'},createdAt:new Date().toISOString()}});
      const narration=audio.projectAssets.assets.find(a=>a.id===audio.audio.sections[0]!.outputAssetId)!,v=video.scenes[0]!;
      if(!narration.filePath||!narration.durationSeconds)throw new Error('EQUIPMENT_AUDIO');
      const bed=await stageProjectBackgroundMusic({projectId:project.id,projectSlug:project.slug,audio:audio.audio,storageContext:runtime.runtimeStorageContext,musicSelector:()=>music});
      if(!bed.staged||!bed.asset.filePath)throw new Error('EQUIPMENT_MUSIC_STAGING');
      const assembled=await new FFmpegVideoAssemblyProvider(runner).assemble({projectSlug:project.slug,scenes:[{inputType:'scene-video',sceneId:i+1,videoAssetId:`preview-video-${i}`,sourceImageAssetId:asset.id,animationAssetId:v.animationAssetId,filePath:v.filePath,url:v.url,durationSeconds:v.durationSeconds,narrationDurationSeconds:narration.durationSeconds,chapterId:i+1,audioStartSeconds:0,byteLength:v.byteLength,provider:'ffmpeg',generationMode:'production',status:'generated',audioFilePath:narration.filePath,transition:'cut'}],backgroundMusic:{filePath:bed.asset.filePath,volume:.13,ducking:true}});
      if(!assembled.success||assembled.provider!=='ffmpeg')throw new Error('EQUIPMENT_REAL_ASSEMBLY');
      const clip=path.join(output,`clip-${i+1}.mp4`);fs.copyFileSync(resolveRuntimeLogicalPath(assembled.filePath,runtime.runtimeStorageContext),clip);clips.push(clip);
      results.push({scene:i+1,narrationSeconds:narration.durationSeconds,assemblySeconds:assembled.durationSeconds,prop:parsed.payload.request.blocking.characters[0]?.handProp,actions:parsed.payload.animation.actors,beats:parsed.payload.direction?.beats,videoBeforeAudio:true});
    }
  });
  const list=path.join(output,'clips.txt');fs.writeFileSync(list,clips.map(f=>`file '${path.basename(f)}'`).join('\n'));
  const file=path.join(output,'preview.mp4'),join=await new SpawnRunner().run(ffmpeg,['-hide_banner','-loglevel','error','-f','concat','-safe','1','-i',list,'-c','copy','-movflags','+faststart',file],{timeoutMs:60000,maxOutputBytes:65536,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:'assembly',ownedActive:true})});
  if(join.failed||join.exitCode!==0)throw new Error('EQUIPMENT_JOIN');
  const result={status:'PASS',file,scenes:results,timing:'NARRATION_PCM_ACTIVITY',wordOrPhonemeAlignment:false,semanticBeatTiming:'SCENE_TEXT_ESTIMATE',realImageVideoAudioAndAssemblyProviders:true,voice:'piper-local',music:music.title,ducking:true,paidCalls:0,ownerProjectUsed:false,published:false,qualityAccepted:false};fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
