import path from 'node:path';
import {AssetManager} from '../../assets/AssetManager';
import {AudioStorage} from '../../assets/storage/AudioStorage';
import {ProjectManager} from '../../projects/ProjectManager';
import {allocateProductionSceneAudioSegments} from '../../production/ProductionAcceptancePreflight';
import type {RuntimeStorageContext} from '../../runtime/RuntimeStoragePaths';
import type {AudioData} from '../../../types/audio';
import type {SceneData} from '../../../types/scene';
import {volumeSpeechEnvelope,type VolumeSpeechEnvelope} from './VolumeSpeech';

export interface VolumeNarrationInput {readonly filePath:string;readonly startSeconds:number;readonly durationSeconds:number}

/** Read-only binding uses exactly assembly's chapter->scene segment allocator.
 * Missing audio retains explicitly estimated timing; malformed existing binding
 * is refused rather than animating against another chapter or another project. */
export async function readVolumeNarration(projectId:string,slug:string,sceneId:number,context:RuntimeStorageContext,explicit?:VolumeNarrationInput):Promise<VolumeSpeechEnvelope|undefined> {
  let input=explicit;
  if(!input) {
    const [audio,scenes]=await Promise.all([ProjectManager.getAudio(slug,context),ProjectManager.getScenes(slug,context)]) as [AudioData|null,SceneData|null];
    if(!audio&&!scenes)return undefined;
    if(!audio||!scenes)return undefined;
    if(!Array.isArray(audio.sections)||!Array.isArray(scenes.scenes))throw new Error('VOLUME_NARRATION_BINDING');
    const assets=AssetManager.getProjectAssets(slug,projectId,context).assets,durations=new Map<number,number>(),paths=new Map<number,string>();
    for(const section of audio.sections) {
      const candidates=assets.filter(a=>a.id===section.outputAssetId);
      if(durations.has(section.chapterId)||candidates.length!==1)throw new Error('VOLUME_NARRATION_BINDING');
      const a=candidates[0]!;
      if(a.projectId!==projectId||a.projectSlug!==slug||a.sceneId!==section.chapterId||a.type!=='audio'||a.status!=='generated'||a.provider==='mock'||a.mimeType!=='audio/wav'||!a.filePath||!a.durationSeconds||a.url!==AudioStorage.getAudioUrl(slug,path.posix.basename(a.filePath)))throw new Error('VOLUME_NARRATION_ASSET');
      const inspected=AudioStorage.inspectStoredWav(slug,a.filePath,context);
      if(inspected.byteLength!==a.byteLength||Math.abs(inspected.durationSeconds-a.durationSeconds)>1e-9)throw new Error('VOLUME_NARRATION_STALE');
      durations.set(section.chapterId,a.durationSeconds);paths.set(section.chapterId,a.filePath);
    }
    const segment=allocateProductionSceneAudioSegments(scenes,durations).get(sceneId);
    if(!segment)throw new Error('VOLUME_NARRATION_SCENE');
    input={filePath:paths.get(segment.chapterId)!,startSeconds:segment.startSeconds,durationSeconds:segment.durationSeconds};
  }
  if(Object.keys(input).length!==3||!input.filePath||![input.startSeconds,input.durationSeconds].every(Number.isFinite)||input.startSeconds<0||input.durationSeconds<=0||input.durationSeconds>600)throw new Error('VOLUME_NARRATION_INPUT');
  AudioStorage.inspectStoredWav(slug,input.filePath,context);
  return volumeSpeechEnvelope(AudioStorage.readStoredWav(slug,input.filePath,context),input.startSeconds,input.durationSeconds);
}
