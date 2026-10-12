import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {withCanonicalSmokeRuntime} from '../lib/CanonicalSmokeRuntime';
import {ProjectManager} from '../../src/lib/projects/ProjectManager';
import {CharacterImageProvider} from '../../src/lib/assets/providers/CharacterImageProvider';
import {readCharacterScenePayload} from '../../src/lib/animation/character/CharacterSceneAsset';
import {resolveRuntimeLogicalPath} from '../../src/lib/runtime/RuntimeStoragePaths';
import {assertAyasHeavyWorkloadAllowed} from '../../src/lib/ayas/machine/AyasMachineHealthGuard';

async function main() {
  sharp.concurrency(2);
  const output=path.resolve('bin/ayas-local-visual/demos',`period-production-${Date.now()}`);fs.mkdirSync(output,{recursive:true});
  const prompts=['1480 yılında Osmanlı yeniçeri askerleri meydanda yürüyor.','1550 yılında Osmanlı zırhlı sipahi askeri sur önünde konuşuyor.','1710 yılında Osmanlı yeniçeri ağası sarayda konuşuyor.','1860 yılında Osmanlı padişahı sarayda konuşuyor.'];
  const entries:unknown[]=[],images:Buffer[]=[];
  await withCanonicalSmokeRuntime({name:'period-production-preview'},async runtime=>{
    const p=await ProjectManager.createProject(`period-${runtime.runId.slice(0,10)}`),provider=new CharacterImageProvider();
    for(const [i,prompt] of prompts.entries()) {
      await assertAyasHeavyWorkloadAllowed({stage:'visuals',ownedActive:true});
      const image=await provider.generateImage({sceneId:i+1,projectSlug:p.slug,prompt});if(!image.success||!image.filePath) throw new Error('PERIOD_PREVIEW_PROVIDER_FAILED');
      const png=fs.readFileSync(resolveRuntimeLogicalPath(image.filePath,runtime.runtimeStorageContext)),read=readCharacterScenePayload(png);
      if(read.status!=='VALID'||!read.payload.volume?.design) throw new Error('PERIOD_PREVIEW_METADATA_REQUIRED');
      fs.writeFileSync(path.join(output,`scene-${i+1}.png`),png,{flag:'wx'});images.push(await sharp(png).resize(960,540).png().toBuffer());entries.push({prompt,design:read.payload.volume.design});
    }
  });
  const file=path.join(output,'comparison.png');await sharp({create:{width:1920,height:1080,channels:4,background:'#fff'}}).composite(images.map((input,i)=>({input,left:i%2*960,top:Math.floor(i/2)*540}))).png().toFile(file);
  const receipt={status:'PASS',file,entries,realProvider:true,paidCalls:0,ownerDataUsed:false,sourceInspired:true,historicalPersonCertified:false};fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,file,paidCalls:0}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
