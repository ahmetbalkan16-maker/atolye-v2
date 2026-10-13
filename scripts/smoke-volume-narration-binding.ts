import assert from 'node:assert/strict';
import {withCanonicalSmokeRuntime} from './lib/CanonicalSmokeRuntime';
import {ProjectManager} from '../src/lib/projects/ProjectManager';
import {AudioStorage} from '../src/lib/assets/storage/AudioStorage';
import {AudioPipeline} from '../src/lib/audio/AudioPipeline';
import type {AudioProvider} from '../src/lib/audio/providers/AudioProvider';
import type {AudioData} from '../src/types/audio';
import {readVolumeNarration} from '../src/lib/character/volume/VolumeNarration';
import {volumeSpeechLevel} from '../src/lib/character/volume/VolumeSpeech';

async function main(){
  await withCanonicalSmokeRuntime({name:'volume-narration-binding'},async runtime=>{
    const project=await ProjectManager.createProject(`speech-${runtime.runId.slice(0,8)}`),slug=project.slug;
    const wav=Buffer.alloc(44+16000*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
    for(let i=8000;i<16000;i++)wav.writeInt16LE(Math.round(8000*Math.sin(i*Math.PI*440/16000)),44+i*2);
    const provider:AudioProvider={name:'piper',validateInput(){},async generateAudio(input){const saved=AudioStorage.prepareAudio({projectSlug:input.projectSlug,data:wav});return AudioStorage.transferPublicationOwnership(saved,{success:true as const,provider:'piper' as const,model:'private-pcm-fixture',target:input.target,createdAt:new Date().toISOString(),filePath:saved.filePath,url:saved.url,mimeType:'audio/wav' as const,byteLength:saved.byteLength,durationSeconds:saved.durationSeconds});}};
    const plan:AudioData={narrator:{style:'narrative',tone:'neutral',language:'tr'},sections:[{chapterId:5,title:'Fixture',duration:'2',emotion:'neutral',emphasis:[],narrationNotes:'Fixture',pacing:'normal',sourceText:'Private PCM fixture.'}],music:{mood:'historical',suggestion:'none',intensity:'low'},production:{targetFormat:'wav',sampleRate:16000,estimatedTotalDuration:'2',generationStatus:'planned'},createdAt:new Date().toISOString()};
    assert.equal(await readVolumeNarration(project.id,slug,51,runtime.runtimeStorageContext),undefined,'missing audio retains the explicit estimate');
    const audio=await AudioPipeline.generateAudio({projectId:project.id,projectSlug:slug,audio:plan,provider});
    await ProjectManager.saveAudio(slug,audio.audio,runtime.runtimeStorageContext);
    await ProjectManager.saveScenes(slug,{scenes:[{id:51,chapterId:5,title:'A',description:'A',duration:1},{id:52,chapterId:5,title:'B',description:'B',duration:3}],createdAt:new Date().toISOString()},runtime.runtimeStorageContext);
    const first=await readVolumeNarration(project.id,slug,51,runtime.runtimeStorageContext),second=await readVolumeNarration(project.id,slug,52,runtime.runtimeStorageContext);
    assert(first&&second);assert.equal(first.durationSeconds,.5);assert.equal(second.durationSeconds,1.5);assert.equal(volumeSpeechLevel(first,.2),0);assert(volumeSpeechLevel(second,.1)>.5,'scene B starts half a second into its shared chapter');assert.equal(volumeSpeechLevel(second,1),0);
    const asset=audio.projectAssets.assets.find(a=>a.id===audio.audio.sections[0]!.outputAssetId)!;
    await assert.rejects(readVolumeNarration(project.id,slug,51,runtime.runtimeStorageContext,{filePath:asset.filePath!.replace(slug,'other-project'),startSeconds:0,durationSeconds:1}),'foreign project audio must be refused');
    await assert.rejects(readVolumeNarration(project.id,slug,51,runtime.runtimeStorageContext,{filePath:asset.filePath!,startSeconds:1.8,durationSeconds:1}));
    await ProjectManager.saveAudio(slug,{...audio.audio,sections:audio.audio.sections.map(s=>({...s,outputAssetId:'missing'}))},runtime.runtimeStorageContext);
    await assert.rejects(readVolumeNarration(project.id,slug,51,runtime.runtimeStorageContext),'stale section binding must not select another audio');
  });
  console.log('Narration binding: PASS (real canonical WAV publication, assembly allocator shared-chapter offsets, absence fallback, foreign path/out-of-range/stale asset refusal; private data, paid0)');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
