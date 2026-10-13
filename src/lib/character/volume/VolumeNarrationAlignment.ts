import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolveAyasSttConfig} from '../../ayas/stt/AyasSttConfig';
import {assertAyasHeavyWorkloadAllowed} from '../../ayas/machine/AyasMachineHealthGuard';
import {SpawnRunner,type VideoAssemblyProcessRunner} from '../../assembly/providers/FFmpegVideoAssemblyProvider';
import {AudioStorage} from '../../assets/storage/AudioStorage';
import {AssetManager} from '../../assets/AssetManager';
import {ProjectManager} from '../../projects/ProjectManager';
import type {RuntimeStorageContext} from '../../runtime/RuntimeStoragePaths';
import type {AudioData} from '../../../types/audio';
import type {VolumeNarrationInput} from './VolumeNarration';
import {alignNarrationSentences,parseNarrationWords,type VolumeSentenceTiming} from './VolumeSentenceTiming';
import {volumeSpeechEnvelope} from './VolumeSpeech';
const timingCache=new Map<string,VolumeSentenceTiming>();

/** This leaves the phone STT service/config unchanged. Local CPU-only acoustic
 * alignment is a serial, bounded assembly operation; no model downloads/APIs. */
export async function readVolumeSentenceTiming(projectId:string,slug:string,context:RuntimeStorageContext,input:VolumeNarrationInput,runner?:VideoAssemblyProcessRunner):Promise<VolumeSentenceTiming> {
 const audio=await ProjectManager.getAudio(slug,context) as AudioData|null;
 const assets=AssetManager.getProjectAssets(slug,projectId,context).assets;
 const candidates=assets.filter(a=>a.type==='audio'&&a.filePath===input.filePath&&a.projectId===projectId&&a.projectSlug===slug&&a.status==='generated');
 if(candidates.length!==1||!audio)throw Error('NARRATION_ALIGNMENT_BINDING');
 if(!Array.isArray(audio.sections))throw Error('NARRATION_ALIGNMENT_SOURCE');
 const section=audio.sections.find(s=>s.outputAssetId===candidates[0]!.id&&s.chapterId===candidates[0]!.sceneId);
 if(!section?.sourceText)throw Error('NARRATION_ALIGNMENT_SOURCE');
 const wav=AudioStorage.readStoredWav(slug,input.filePath,context);
 return alignLocalNarrationWav(wav,section.sourceText,input,runner);
}

export async function alignLocalNarrationWav(wav:Buffer,source:string,input:Pick<VolumeNarrationInput,'startSeconds'|'durationSeconds'>,injected?:VideoAssemblyProcessRunner):Promise<VolumeSentenceTiming> {
 const config=resolveAyasSttConfig();
 if(!config.enabled||!config.whisperExecutable||!config.whisperModel)throw Error('NARRATION_ALIGNMENT_NOT_CONFIGURED');
 if(wav.length>64*1024*1024||!source.trim()||source.length>32000||!Number.isFinite(input.startSeconds)||input.startSeconds<0||!Number.isFinite(input.durationSeconds)||input.durationSeconds<=0||input.durationSeconds>600)throw Error('NARRATION_ALIGNMENT_INPUT');
 if(!volumeSpeechEnvelope(wav,input.startSeconds,input.durationSeconds).levels.some(level=>level>.08))throw Error('NARRATION_ALIGNMENT_NO_SPEECH');
 const modelStat=fs.statSync(config.whisperModel);
 const key=createHash('sha256').update(wav).update(JSON.stringify([source,input.startSeconds,input.durationSeconds,config.whisperExecutable,config.whisperModel,modelStat.size,modelStat.mtimeMs,'sentences-v1'])).digest('hex');
 if(!injected&&timingCache.has(key))return timingCache.get(key)!;
 await assertAyasHeavyWorkloadAllowed({stage:'assembly',ownedActive:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atolye-sentence-sync-'));
 try {
  if(!/^[\x20-\x7e]+$/.test(dir))throw Error('NARRATION_ALIGNMENT_ASCII_TEMP');
  const executable=config.whisperExecutable,cwd=path.dirname(executable);
  const model=/^[\x20-\x7e]+$/.test(config.whisperModel)?config.whisperModel:path.relative(cwd,config.whisperModel);
  if(!model||!/^[\x20-\x7e]+$/.test(model))throw Error('NARRATION_ALIGNMENT_MODEL_PATH');
  const run=injected??new SpawnRunner((exe,args,options)=>spawn(exe,[...args],{...options,cwd}));
  const from=path.join(dir,'source.wav'),file=path.join(dir,'segment.wav'),base=path.join(dir,'words');fs.writeFileSync(from,wav,{flag:'wx'});
  const disk=fs.statfsSync(dir);if(disk.bavail/disk.blocks<.03)throw Error('NARRATION_ALIGNMENT_DISK');
  const healthCheck=()=>assertAyasHeavyWorkloadAllowed({stage:'assembly',ownedActive:true});
  const decoded=await run.run(config.ffmpegPath,['-nostdin','-hide_banner','-loglevel','error','-y','-ss',String(input.startSeconds),'-i',from,'-t',String(input.durationSeconds),'-ac','1','-ar','16000','-c:a','pcm_s16le',file],{timeoutMs:30000,maxOutputBytes:131072,healthCheck});
  if(decoded.failed||decoded.timedOut||decoded.exitCode!==0)throw Error('NARRATION_ALIGNMENT_DECODE');
  const result=await run.run(executable,['-m',model,'-f',file,'-l','tr','-t','4','-ng','-tp','0','-mc','0','-sns','-ml','1','-sow','-ojf','-of',base],{timeoutMs:Math.min(300000,30000+input.durationSeconds*4000),maxOutputBytes:2*1024*1024,healthCheck});
  if(result.failed||result.timedOut||result.exitCode!==0)throw Error('NARRATION_ALIGNMENT_TRANSCRIBE');
  const json=base+'.json';if(!fs.statSync(json).isFile()||fs.statSync(json).size>2*1024*1024)throw Error('NARRATION_ALIGNMENT_OUTPUT');
  // Scene-local process cache only. No arbitrary disk timing sidecar is trusted.
  const timing=alignNarrationSentences(source,parseNarrationWords(fs.readFileSync(json,'utf8'),input.durationSeconds),input.durationSeconds);
  const frozen=Object.freeze({...timing,sentences:Object.freeze(timing.sentences.map(s=>Object.freeze(s)))});
  if(!injected){timingCache.set(key,frozen);if(timingCache.size>16)timingCache.delete(timingCache.keys().next().value!);}
  return frozen;
 } finally {
  const resolved=fs.realpathSync.native(dir),temp=fs.realpathSync.native(os.tmpdir());
  if(path.dirname(resolved)!==temp||!path.basename(resolved).startsWith('atolye-sentence-sync-'))throw Error('NARRATION_ALIGNMENT_CLEANUP');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
}
