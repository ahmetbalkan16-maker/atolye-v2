import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {SpawnRunner} from '../../src/lib/assembly/providers/FFmpegVideoAssemblyProvider';
import {resolveAyasSttConfig} from '../../src/lib/ayas/stt/AyasSttConfig';
import {alignLocalNarrationWav} from '../../src/lib/character/volume/VolumeNarrationAlignment';
async function main(){
 const [file,sourceFile,durationText,out]=process.argv.slice(2);
 if(!file||!sourceFile||!out)throw Error('NARRATION_PROBE_ARGS');
 const input=fs.realpathSync.native(file),source=fs.realpathSync.native(sourceFile);
 const text=fs.readFileSync(source,'utf8');
 const config=resolveAyasSttConfig(),run=new SpawnRunner((exe,args,options)=>spawn(exe,[...args],{...options,cwd:path.dirname(config.whisperExecutable!)}));
 const runner={async run(exe:string,args:readonly string[],options:Parameters<SpawnRunner['run']>[2]){const result=await run.run(exe,args,options);const index=args.indexOf('-of');if(index>=0&&fs.existsSync(args[index+1]+'.json'))fs.copyFileSync(args[index+1]+'.json',out+'.whisper.json');return result;}};
 const timing=await alignLocalNarrationWav(fs.readFileSync(input),text,{startSeconds:0,durationSeconds:Number(durationText)},runner);
 const result={status:'PASS',timing,paidCalls:0,mode:'CPU_ONLY',ownerProjectUsed:false};
 fs.writeFileSync(path.resolve(out),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
