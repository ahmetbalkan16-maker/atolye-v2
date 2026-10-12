import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {volumePerformanceFrame,volumeCameraZoom,VOLUME_RIG} from '../src/lib/character/volume/VolumePerformance';
import {characterAnimationFrame,type CharacterAnimationPlan} from '../src/lib/animation/character/CharacterAnimation';
import {POSE_ANGLES} from '../src/lib/character/CharacterPose';
import type {SceneBlocking,BlockedCharacter} from '../src/lib/character/SceneBlocking';
import {createPeriodDesign,periodUnitFromScene} from '../src/lib/character/volume/PeriodDesign';
import {createVolumeCharacter,rasterizeVolumeCharacter} from '../src/lib/character/volume/CharacterVolume';
import {createVolumeScenePlan,findVolumeScenePlanProblems} from '../src/lib/character/volume/VolumeScenePlan';

const character:BlockedCharacter={id:'c1',x:.15,depth:.3,facing:'RIGHT',pose:'STAND',expression:'HAPPY',costume:'NONE',handProp:'SPEAR'};
const blocking:SceneBlocking={backdrop:'FIELD',time:'DAY',characters:[character],props:[],arrows:[],caption:null};
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
for(const action of ['WALK','RUN'] as const) for(const facing of ['LEFT','RIGHT'] as const) for(const scale of [69,100,138]) {
  const c={...character,facing,x:facing==='RIGHT'?.15:.85},b={...blocking,characters:[c]},actor={id:'c1',action,toX:facing==='RIGHT'?.55:.45,delaySeconds:.2};
  const plan:CharacterAnimationPlan={schemaVersion:'1',fps:15,actors:[actor]};
  let previous:ReturnType<typeof volumePerformanceFrame>|undefined;
  for(let i=0;i<2400;i++) {
    const t=i/120,frame=characterAnimationFrame(b,plan,t).c1!,p=volumePerformanceFrame(c,actor,frame,t,scale);
    for(const [knee,foot] of [[p.joints.kneeFront,p.joints.footFront],[p.joints.kneeBack,p.joints.footBack]]) {
      assert(Math.abs(distance(p.joints.hip,knee!)-VOLUME_RIG.upperLeg)<1e-5,'upper leg length must be conserved');
      assert(Math.abs(distance(knee!,foot!)-VOLUME_RIG.lowerLeg)<1e-5,'lower leg length must be conserved');
    }
    assert(p.contacts.every(f=>f.height>=-1e-9),'feet must not sink under stage');
    if(previous) p.contacts.forEach((f,index)=>{
      const old=previous!.contacts[index]!;
      if(old.planted&&f.planted) assert(Math.abs(old.x-f.x)<1e-7,'support foot must remain fixed in stage coordinates');
      assert(Math.abs(old.x-f.x)<20,'no foot teleport at stride/arrival boundary');
    });
    previous=p;
  }
  assert(previous&&Math.abs(previous.x-actor.toX)<1e-8,'actor arrives and stops at requested target');
}
for(const action of ['TALK','POINT','CHEER','BOW','FIGHT'] as const) {
  const actor={id:'c1',action,toX:null,delaySeconds:0},plan:CharacterAnimationPlan={schemaVersion:'1',fps:15,actors:[actor]};
  const reference=volumePerformanceFrame(character,actor,characterAnimationFrame(blocking,plan,0).c1!,0,120).contacts;
  for(let i=1;i<90;i++){const t=i/15,p=volumePerformanceFrame(character,actor,characterAnimationFrame(blocking,plan,t).c1!,t,120);assert.deepEqual(p.contacts,reference,'stationary gesture must preserve planted feet');}
}
for(const boundary of [2.5,3.2,8.3,9,12]) assert(Math.abs(volumeCameraZoom(boundary+.00001,12)-volumeCameraZoom(boundary-.00001,12))<.0001,'camera must enter and exit continuously');
assert.equal(volumeCameraZoom(4,4),1);
const art={version:'4' as const,culture:'OTTOMAN' as const,faith:'UNSPECIFIED' as const,roles:[{id:'c1',role:'GUARD' as const}]};
const examples=[[1480,'JANISSARY','JANISSARY_EARLY'],[1710,'JANISSARY_OFFICER','JANISSARY_OFFICER_18'],[1790,'JANISSARY_GUARDHOUSE','JANISSARY_GUARDHOUSE_18'],[1550,'ARMOURED','OTTOMAN_MAIL_PLATE']] as const;
const hashes=new Set<string>();
for(const [year,unit,profile] of examples) {
  const design=createPeriodDesign(blocking,art,[year],unit);assert.equal(design.actors[0]!.profile,profile);assert.equal(design.actors[0]!.status,'REFERENCE_INSPIRED_NEEDS_REVIEW');
  const joints=volumePerformanceFrame(character,undefined,{x:character.x,pose:POSE_ANGLES.STAND,mouthOpen:false},0,120).joints;
  const mesh=createVolumeCharacter({culture:'OTTOMAN',role:'GUARD',pose:'STAND',mouthOpen:false,faith:'UNSPECIFIED',designProfile:profile,joints,handProp:'SPEAR'});
  assert(mesh.length<40000,'bounded richer costume geometry');
  hashes.add(createHash('sha256').update(rasterizeVolumeCharacter(mesh,{x:280,y:700,scale:110,yaw:-12,width:560,height:720})).digest('hex'));
}
assert.equal(hashes.size,4,'period-specific hat, uniform and armour silhouettes must differ');
assert.equal(createPeriodDesign(blocking,art,[1850],'JANISSARY').actors[0]!.profile,'BASE','do not invent a Janissary uniform after the institution ended');
assert.equal(createPeriodDesign(blocking,art,[1480,1710],'JANISSARY').actors[0]!.status,'RESEARCH_REQUIRED');
assert.equal(createPeriodDesign(blocking,{...art,culture:'ROMAN'},[1480],'JANISSARY').actors[0]!.profile,'BASE','no cross-culture costume leakage');
assert.equal(periodUnitFromScene('1480 yılında yeniçeri askerleri yürüyor.'),'JANISSARY');
assert.equal(periodUnitFromScene('1710 yılında yeniçeri ağası konuşuyor.'),'JANISSARY_OFFICER');
assert.equal(periodUnitFromScene('1790 yılında karakol yeniçerisi.'),'JANISSARY_GUARDHOUSE');
assert.equal(periodUnitFromScene('1550 yılında Osmanlı zırhlı sipahisi.'),'ARMOURED');
assert.equal(periodUnitFromScene('1480 yılında yeniçeri ve zırhlı sipahi karşılaştırması.'),'UNSPECIFIED','ambiguous mixed troop scene requires actor-specific research');
assert.equal(periodUnitFromScene('1480 yılında yeniçeri değil.'),'UNSPECIFIED','do not enact a negated costume');
const old=createVolumeScenePlan(blocking,art,[1480]);assert(!old.design);assert.deepEqual(findVolumeScenePlanProblems(old,blocking,art),[]);
const current=createVolumeScenePlan(blocking,art,[1480],'JANISSARY');assert.deepEqual(findVolumeScenePlanProblems(current,blocking,art),[]);
assert(findVolumeScenePlanProblems({...current,design:{...current.design!,actors:current.design!.actors.map(a=>({...a,profile:'OTTOMAN_FEZ_COURT'}))}},blocking,art).length,'tampered costume must fail canonical metadata check');
console.log('Grounded performance: PASS (12 dense walk/run trajectories, planted-foot invariance, bone lengths, stationary gestures, arrival, continuous camera, four distinct sourced uniform silhouettes, era/culture/ambiguity/tamper/old-volume guards)');
