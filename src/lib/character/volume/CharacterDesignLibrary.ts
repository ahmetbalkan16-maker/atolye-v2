import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {CharacterArtDirection} from '../SvgSceneRenderer';
import type {BlockedCharacter} from '../SceneBlocking';
import type {WardrobeBrief,WardrobeRecipe} from './PeriodWardrobe';
import {isPeriodProfile,type PeriodDesign,type PeriodProfile} from './PeriodDesign';

export interface CharacterDesignSpec {
  readonly schema:1;readonly family:string;readonly culture:CharacterArtDirection['culture'];readonly profile:PeriodProfile;readonly recipe:WardrobeRecipe|null;
  readonly period:readonly [number|null,number|null];readonly role:string;readonly costume:string;
  readonly sources:readonly string[];readonly geometryFingerprint:string;
}
export interface CharacterDesignRecord {readonly id:string;readonly spec:CharacterDesignSpec;readonly status:'PENDING_OWNER_APPROVAL'|'OWNER_APPROVED';readonly createdAt:string;readonly approvedAt:string|null;readonly previewSha256:string|null}
export interface CharacterDesignCard extends CharacterDesignRecord {readonly digest:string}
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const identifier=(value:string)=>/^[a-f0-9]{64}$/.test(value);
const ranges:Record<string,readonly [number,number]>={JANISSARY_EARLY:[1450,1500],JANISSARY_OFFICER_18:[1700,1737],JANISSARY_GUARDHOUSE_18:[1780,1800],OTTOMAN_MAIL_PLATE:[1451,1600],OTTOMAN_FEZ_COURT:[1860,1861],OTTOMAN_15_PORTRAIT:[1450,1500],OTTOMAN_16_TEXTILE:[1501,1600],BYZANTINE_PALAIOLOGAN:[1391,1425],ROMAN_EARLY_IMPERIAL:[1,25],EGYPTIAN_DYNASTY_18:[-1473,-1458]};

/** A stored parametric design, not a stored frame: animation must still draw poses.
 * No image model, web call or paid regeneration is involved. Approval is visual
 * owner acceptance, never a certificate of historical correctness.
 */
export function characterDesignSpec(c:BlockedCharacter,art:CharacterArtDirection,wardrobe:WardrobeBrief,design:PeriodDesign,fingerprint:string):CharacterDesignSpec {
  const a=design.actors.find(a=>a.actorId===c.id)!;if(!a||!identifier(fingerprint)) throw new Error('CHARACTER_LIBRARY_CONTEXT');
  const family=a.profile!=='BASE'?a.profile:wardrobe.recipe??`${art.culture}_${wardrobe.role}_${c.costume}`;
  return {schema:1,family,culture:art.culture,profile:a.profile,recipe:wardrobe.recipe,period:ranges[family]??[null,null],role:a.profile==='BASE'?wardrobe.role:'SOURCE_SCOPED_UNIT',costume:a.profile==='BASE'?c.costume:'SOURCE_SCOPED_UNIFORM',sources:a.sources.length?a.sources:wardrobe.sources.map(s=>s.url),geometryFingerprint:fingerprint};
}
function validSpec(s:CharacterDesignSpec):boolean {
  if(!s||Object.keys(s).length!==10||s.schema!==1||typeof s.family!=='string'||!/^[A-Z0-9_]{1,100}$/.test(s.family)||!['UNKNOWN','OTTOMAN','BYZANTINE','ROMAN','EGYPTIAN','WESTERN','STEPPE'].includes(s.culture)||!isPeriodProfile(s.profile)||!(s.recipe===null||Object.hasOwn(ranges,s.recipe))||!['RULER','ADVISOR','GUARD','NARRATOR','CITIZEN','SOURCE_SCOPED_UNIT'].includes(s.role)||!['NONE','TURBAN','HELMET','CROWN','HOOD','CAPE','ROBE','ARMOR','SOURCE_SCOPED_UNIFORM'].includes(s.costume)||!identifier(s.geometryFingerprint)||!Array.isArray(s.period)||s.period.length!==2||s.period.some(y=>y!==null&&(!Number.isInteger(y)||y===0||y< -4000||y>2100))||(s.period[0]===null)!==(s.period[1]===null)||(s.period[0]!==null&&s.period[1]!==null&&s.period[0]>s.period[1])||!Array.isArray(s.sources)||s.sources.length>8)return false;
  return s.sources.every(url=>{try{if(typeof url!=='string'||url.length>512)return false;const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.britishmuseum.org','www.rijksmuseum.nl','www.metmuseum.org','art.thewalters.org','www.npg.org.uk','www.rct.uk','www.nationalgallery.org.uk','www.museivaticani.va'].includes(u.hostname);}catch{return false;}});
}

export class CharacterDesignLibrary {
  private readonly root:string;
  readonly geometryFingerprint:string;
  constructor(base=path.resolve('bin/ayas-local-visual/characters'),fingerprint?:string) {
    this.root=path.resolve(base);
    this.geometryFingerprint=fingerprint??hash(['CharacterVolume.ts','PeriodDesign.ts','PeriodWardrobe.ts','VolumeEquipment.ts'].map(name=>fs.readFileSync(path.resolve('src/lib/character/volume',name),'utf8').replace(/\r\n/g,'\n')).join('\n'));
    if(!identifier(this.geometryFingerprint)) throw new Error('CHARACTER_LIBRARY_REVISION');
  }
  private directory(create=false) {
    if(!fs.existsSync(this.root)){if(!create)return false;let parent=path.dirname(this.root);while(!fs.existsSync(parent)){const next=path.dirname(parent);if(next===parent)throw new Error('CHARACTER_LIBRARY_PATH');parent=next;}if(fs.realpathSync.native(parent)!==parent||!fs.statSync(parent).isDirectory())throw new Error('CHARACTER_LIBRARY_PATH');fs.mkdirSync(this.root,{recursive:true});}
    if(fs.lstatSync(this.root).isSymbolicLink()||fs.realpathSync.native(this.root)!==this.root||!fs.statSync(this.root).isDirectory()) throw new Error('CHARACTER_LIBRARY_PATH');
    return true;
  }
  private file(id:string,extension='.json') {
    if(!identifier(id))throw new Error('CHARACTER_LIBRARY_ID');
    const file=path.join(this.root,id+extension);
    if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw new Error('CHARACTER_LIBRARY_PATH');
    return file;
  }
  private read(id:string):CharacterDesignRecord {
    if(!this.directory())throw new Error('CHARACTER_LIBRARY_MISSING');
    const file=this.file(id);if(fs.statSync(file).size>16384)throw new Error('CHARACTER_LIBRARY_SIZE');
    const r=JSON.parse(fs.readFileSync(file,'utf8')) as CharacterDesignRecord;
    if(!r||Object.keys(r).length!==6||r.id!==id||hash(JSON.stringify(r.spec))!==id||!validSpec(r.spec)||!['PENDING_OWNER_APPROVAL','OWNER_APPROVED'].includes(r.status)||!Number.isFinite(Date.parse(r.createdAt))||(r.approvedAt!==null&&!Number.isFinite(Date.parse(r.approvedAt)))||(r.status==='OWNER_APPROVED')!==(r.approvedAt!==null)||(r.previewSha256!==null&&!identifier(r.previewSha256)))throw new Error('CHARACTER_LIBRARY_CHANGED');
    return r;
  }
  private locked<T>(id:string,operation:()=>T):T {
    this.directory(true);const lock=this.file(id,'.lock');let fd:number;
    try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error('CHARACTER_LIBRARY_BUSY');}
    try{return operation();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  private write(record:CharacterDesignRecord) {
    const file=this.file(record.id),temp=path.join(this.root,`${record.id}-${randomUUID()}.tmp`);
    try{fs.writeFileSync(temp,JSON.stringify(record),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  }
  ensure(spec:CharacterDesignSpec):{record:CharacterDesignRecord;created:boolean} {
    if(!validSpec(spec)||spec.geometryFingerprint!==this.geometryFingerprint)throw new Error('CHARACTER_LIBRARY_REVISION');
    const id=hash(JSON.stringify(spec));
    if(this.directory()&&fs.existsSync(this.file(id)))return {record:this.read(id),created:false};
    return this.locked(id,()=>{
      if(fs.existsSync(this.file(id)))return {record:this.read(id),created:false};
      if(fs.readdirSync(this.root).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).length>=256)throw new Error('CHARACTER_LIBRARY_CAPACITY');
      const record:CharacterDesignRecord={id,spec,status:'PENDING_OWNER_APPROVAL',createdAt:new Date().toISOString(),approvedAt:null,previewSha256:null};this.write(record);return {record,created:true};
    });
  }
  savePreviewOnce(id:string,png:Buffer) {
    if(png.length>512*1024||png.toString('hex',0,8)!=='89504e470d0a1a0a'||png.readUInt32BE(16)>768||png.readUInt32BE(20)>432)throw new Error('CHARACTER_LIBRARY_PREVIEW');
    return this.locked(id,()=>{
      const r=this.read(id);if(r.previewSha256!==null){this.preview(id);return false;}
      const file=this.file(id,'.png');if(fs.existsSync(file))throw new Error('CHARACTER_LIBRARY_PREVIEW_CONFLICT');
      fs.writeFileSync(file,png,{flag:'wx',mode:0o600});this.write({...r,previewSha256:hash(png)});return true;
    });
  }
  preview(id:string):Buffer {
    const r=this.read(id),file=this.file(id,'.png');if(!r.previewSha256||fs.statSync(file).size>512*1024)throw new Error('CHARACTER_LIBRARY_PREVIEW');
    const png=fs.readFileSync(file);if(hash(png)!==r.previewSha256)throw new Error('CHARACTER_LIBRARY_CHANGED');return png;
  }
  list():CharacterDesignCard[] {
    if(!this.directory())return [];
    const files=fs.readdirSync(this.root).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).sort();if(files.length>256)throw new Error('CHARACTER_LIBRARY_CAPACITY');
    return files.map(f=>{const r=this.read(f.slice(0,-5));return {...r,digest:hash(JSON.stringify(r))};});
  }
  /** Called only by the owner-authenticated, same-origin approval route. */
  approve(id:string,expectedDigest:string):CharacterDesignCard {
    if(!identifier(expectedDigest))throw new Error('CHARACTER_LIBRARY_APPROVAL');
    return this.locked(id,()=>{
      const r=this.read(id);if(hash(JSON.stringify(r))!==expectedDigest)throw new Error('CHARACTER_LIBRARY_APPROVAL_CONFLICT');
      if(r.spec.geometryFingerprint!==this.geometryFingerprint)throw new Error('CHARACTER_LIBRARY_OLD_REVISION');
      this.preview(id);
      const next:CharacterDesignRecord=r.status==='OWNER_APPROVED'?r:{...r,status:'OWNER_APPROVED',approvedAt:new Date().toISOString()};
      if(next!==r)this.write(next);return {...next,digest:hash(JSON.stringify(next))};
    });
  }
}
