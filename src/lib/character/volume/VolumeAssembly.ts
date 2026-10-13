import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AssetManager} from '../../assets/AssetManager';
import {ImageStorage} from '../../assets/storage/ImageStorage';
import {ProjectManager} from '../../projects/ProjectManager';
import {readCharacterScenePayload} from '../../animation/character/CharacterSceneAsset';
import {buildCharacterSceneFFmpegArgs,renderCharacterSceneFrames} from '../../video/providers/FFmpegSceneVideoProvider';
import {assertAyasHeavyWorkloadAllowed} from '../../ayas/machine/AyasMachineHealthGuard';
import {resolveRuntimeLogicalPath,type RuntimeStorageContext} from '../../runtime/RuntimeStoragePaths';
import type {VideoAssemblyProcessRunner} from '../../assembly/providers/FFmpegVideoAssemblyProvider';
import type {FFmpegVideoAssemblyConfig} from '../../assembly/providers/VideoAssemblyProviderConfig';
import type {VideoAssemblyInput} from '../../../types/videoAssembly';
import {readVolumeNarration} from './VolumeNarration';
import {readVolumeSentenceTiming} from './VolumeNarrationAlignment';

/** The frozen pipeline renders video before audio. Only V2 characters are drawn
 * again at assembly against the actual narration. Source clips/assets are never
 * overwritten; private clips feed the existing mix/transition/cost guard path. */
export async function prepareVolumeAssembly(input:VideoAssemblyInput,context:RuntimeStorageContext,runner:VideoAssemblyProcessRunner,config:FFmpegVideoAssemblyConfig) {
  const paths=new Map<number,string>(),durations=new Map<number,number>();let directory:string|undefined;
  const dispose=()=>{if(directory){const resolved=fs.realpathSync.native(directory),temp=fs.realpathSync.native(os.tmpdir());if(path.dirname(resolved)!==temp||!path.basename(resolved).startsWith('atolye-volume-sync-'))throw new Error('VOLUME_ASSEMBLY_CLEANUP_PATH');fs.rmSync(resolved,{recursive:true,force:true});directory=undefined;}};
  try {
    if(input.scenes[0]?.inputType!=='scene-video')return {paths,durations,dispose};
    const project=await ProjectManager.getProject(input.projectSlug,context);
    if(!project)return {paths,durations,dispose};
    const assets=AssetManager.getProjectAssets(input.projectSlug,project.id,context).assets;
    for(const scene of input.scenes) {
      if(scene.inputType!=='scene-video')throw new Error('VOLUME_ASSEMBLY_INPUT');
      const candidates=assets.filter(a=>a.id===scene.sourceImageAssetId);
      if(candidates.length!==1||candidates[0]!.provider!=='character')continue;
      const image=candidates[0]!;
      if(image.projectId!==project.id||image.projectSlug!==input.projectSlug||image.sceneId!==scene.sceneId||image.type!=='image'||image.status!=='generated'||image.mimeType!=='image/png'||!image.filePath)throw new Error('VOLUME_ASSEMBLY_IMAGE');
      ImageStorage.inspectStoredImage(input.projectSlug,image.filePath,'image/png',context);
      const parsed=readCharacterScenePayload(fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,context)));
      if(parsed.status==='INVALID')throw new Error('VOLUME_ASSEMBLY_PAYLOAD');
      if(parsed.status!=='VALID'||!parsed.payload.volume?.presentation)continue;
      await assertAyasHeavyWorkloadAllowed({stage:'assembly',ownedActive:true});
      const narration=await readVolumeNarration(project.id,input.projectSlug,scene.sceneId,context,{filePath:scene.audioFilePath,startSeconds:scene.audioStartSeconds??0,durationSeconds:scene.narrationDurationSeconds});
      if(!narration)throw new Error('VOLUME_ASSEMBLY_NARRATION');
      const v3=parsed.payload.volume.presentation==='NARRATION_DIRECTION_V3';
      const sentenceTiming=v3?await readVolumeSentenceTiming(project.id,input.projectSlug,context,{filePath:scene.audioFilePath,startSeconds:scene.audioStartSeconds??0,durationSeconds:scene.narrationDurationSeconds}):undefined;
      const duration=v3?Math.max(scene.durationSeconds,scene.narrationDurationSeconds):scene.durationSeconds;
      directory??=fs.mkdtempSync(path.join(os.tmpdir(),'atolye-volume-sync-'));
      const file=path.join(directory,`scene-${scene.sceneId}.mp4`),frames=await renderCharacterSceneFrames(parsed.payload,duration,parsed.backgroundPng,narration,sentenceTiming);
      try {
        const result=await runner.run(config.ffmpegPath,buildCharacterSceneFFmpegArgs({motionPlan:{durationSeconds:duration}},file,frames.pattern),{timeoutMs:config.timeoutMs,maxOutputBytes:config.maxStdioBytes,healthCheck:()=>assertAyasHeavyWorkloadAllowed({stage:'assembly',ownedActive:true})});
        if(result.failed||result.timedOut||result.signal!==null||result.exitCode!==0)throw new Error('VOLUME_ASSEMBLY_RENDER');
        const stat=fs.statSync(file);if(!stat.isFile()||stat.size<=0||stat.size>config.maxOutputBytes)throw new Error('VOLUME_ASSEMBLY_SIZE');
        paths.set(scene.sceneId,file);
        durations.set(scene.sceneId,duration);
      } finally {frames.dispose();}
    }
    return {paths,durations,dispose};
  } catch(error){dispose();throw error;}
}
