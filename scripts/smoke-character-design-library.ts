import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {CharacterDesignLibrary,characterDesignSpec} from '../src/lib/character/volume/CharacterDesignLibrary';
import {createVolumeScenePlan} from '../src/lib/character/volume/VolumeScenePlan';
import type {SceneBlocking} from '../src/lib/character/SceneBlocking';
async function main(){
  const directory=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'atolye-character-library-'));
  const root=fs.realpathSync.native(directory),fingerprint='a'.repeat(64),library=new CharacterDesignLibrary(path.join(root,'library'),fingerprint);
  const blocking:SceneBlocking={backdrop:'FIELD',time:'DAY',characters:[{id:'c1',x:.3,depth:.3,facing:'RIGHT',pose:'STAND',expression:'HAPPY',costume:'NONE',handProp:'SPEAR'}],props:[],arrows:[],caption:null};
  const art={version:'4' as const,culture:'OTTOMAN' as const,faith:'UNSPECIFIED' as const,roles:[{id:'c1',role:'GUARD' as const}]};
  const volume=createVolumeScenePlan(blocking,art,[1480],'JANISSARY'),spec=characterDesignSpec(blocking.characters[0]!,art,volume.wardrobes[0]!.brief,volume.design!,fingerprint);
  try{
    const selected=library.ensure(spec);assert(selected.created);assert.equal(selected.record.status,'PENDING_OWNER_APPROVAL');
    const png=await sharp({create:{width:64,height:36,channels:4,background:'#73452a'}}).png().toBuffer();assert(library.savePreviewOnce(selected.record.id,png));
    const card=library.list()[0]!;assert.throws(()=>library.approve(card.id,'b'.repeat(64)),/CONFLICT/);
    const approved=library.approve(card.id,card.digest);assert.equal(approved.status,'OWNER_APPROVED');
    const file=path.join(root,'library',`${card.id}.json`),bytes=fs.readFileSync(file),mtime=fs.statSync(file).mtimeMs;
    const restarted=new CharacterDesignLibrary(path.join(root,'library'),fingerprint),reused=restarted.ensure(spec);assert(!reused.created);assert.equal(reused.record.status,'OWNER_APPROVED');assert.equal(fs.statSync(file).mtimeMs,mtime);assert.deepEqual(fs.readFileSync(file),bytes,'reuse must not rewrite approved design');
    const later=createVolumeScenePlan(blocking,art,[1490],'JANISSARY'),same=characterDesignSpec(blocking.characters[0]!,art,later.wardrobes[0]!.brief,later.design!,fingerprint);assert.deepEqual(same,spec,'same sourced period family reuses one stored design');assert(!restarted.ensure(same).created);
    const other=createVolumeScenePlan(blocking,art,[1550],'ARMOURED'),different=characterDesignSpec(blocking.characters[0]!,art,other.wardrobes[0]!.brief,other.design!,fingerprint);assert(restarted.ensure(different).created);assert.equal(restarted.list().length,2,'only missing costume family is created');
    assert.throws(()=>restarted.preview('../outside'),/ID/);
    const stale=new CharacterDesignLibrary(path.join(root,'library'),'c'.repeat(64));assert.throws(()=>stale.approve(approved.id,approved.digest),/OLD_REVISION/);
    fs.writeFileSync(path.join(root,'library',`${card.id}.png`),Buffer.from('tampered'));assert.throws(()=>restarted.preview(card.id),/CHANGED/);
    fs.writeFileSync(file,JSON.stringify({...approved,spec:{...spec,culture:'ROMAN'}}));assert.throws(()=>restarted.ensure(spec),/CHANGED/);
    console.log('Character design library: PASS (draft is not owner approval, exact preview/CAS approval, restart and same-period reuse without writes, missing family only, stale-version/path/tamper guards, private fixture)');
  }finally{
    const current=fs.realpathSync.native(directory),parent=fs.realpathSync.native(os.tmpdir());if(current!==root||path.dirname(current)!==parent||!path.basename(current).startsWith('atolye-character-library-'))throw new Error('LIBRARY_FIXTURE_CLEANUP_PATH');fs.rmSync(current,{recursive:true,force:true});
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
