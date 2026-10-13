import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {volumeSpeechEnvelope,volumeSpeechLevel,volumeSpeakingFrame} from '../src/lib/character/volume/VolumeSpeech';
import {createVolumeEquipment,volumeEquipmentGrip,volumeSceneEquipment} from '../src/lib/character/volume/VolumeEquipment';
import {createVolumeCharacter} from '../src/lib/character/volume/CharacterVolume';
import {volumePerformanceFrame,VOLUME_RIG} from '../src/lib/character/volume/VolumePerformance';
import {computeCharacterJoints} from '../src/lib/character/CharacterRig';
import {POSE_ANGLES,CHARACTER_POSES} from '../src/lib/character/CharacterPose';
import {characterAnimationFrame,type CharacterAnimationPlan} from '../src/lib/animation/character/CharacterAnimation';
import {createVolumeScenePlan,findVolumeScenePlanProblems} from '../src/lib/character/volume/VolumeScenePlan';
import type {SceneBlocking} from '../src/lib/character/SceneBlocking';

const rate=16000,wav=Buffer.alloc(44+rate*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=rate/2;i<rate;i++)wav.writeInt16LE(Math.round(8000*Math.sin(i*2*Math.PI*220/rate)),44+i*2);
const track=volumeSpeechEnvelope(wav,0,2);
assert.equal(track.levels.length,50);assert.equal(volumeSpeechLevel(track,.2),0);assert(volumeSpeechLevel(track,.65)>.5);assert.equal(volumeSpeechLevel(track,1.5),0);assert.equal(volumeSpeechLevel(track,2),0);
const cropped=volumeSpeechEnvelope(wav,.5,.5);assert(volumeSpeechLevel(cropped,.1)>.5,'shared chapter segment uses real PCM offset');
assert.throws(()=>volumeSpeechEnvelope(wav,1.8,.5));assert.throws(()=>volumeSpeechEnvelope(Buffer.alloc(44),0,1));
const rest=POSE_ANGLES.STAND,frame={x:.3,pose:{...rest,armFront:{upper:45,bend:30}},mouthOpen:true};
const quiet=volumeSpeakingFrame(frame,.2,true,track),speaking=volumeSpeakingFrame(frame,.7,true,track);
assert(!quiet.mouthOpen&&speaking.mouthOpen);assert.deepEqual(quiet.pose.armFront,{upper:40,bend:-40});assert.deepEqual(speaking.pose.armFront,quiet.pose.armFront);assert.notDeepEqual(quiet.pose.armBack,speaking.pose.armBack,'only the free hand gestures');
assert.equal(volumeSpeakingFrame(frame,.2,false).mouthOpen,true,'explicit no-audio fallback retained');
const hashes=new Set<string>();
for(const prop of ['SPEAR','SWORD','SHIELD','BOW','FLAG','SCROLL','TORCH'] as const) for(const pose of CHARACTER_POSES) {
  const joints=computeCharacterJoints(VOLUME_RIG,POSE_ANGLES[pose],{x:0,y:0},1),grip=volumeEquipmentGrip(joints),faces=createVolumeEquipment(joints,prop);
  assert.deepEqual(grip.at([0,0,0]),grip.anchor);assert(Math.abs(grip.anchor[0]-(joints.handFront.x+39)/100)<1e-10);
  assert(faces.length>0&&faces.length<2000);assert(faces.every(f=>f.vertices.every(v=>v.every(n=>Number.isFinite(n)&&Math.abs(n)<12))));
  const old=createVolumeCharacter({culture:'OTTOMAN',role:'GUARD',pose,mouthOpen:false,faith:'UNSPECIFIED',handProp:prop,joints});
  const current=createVolumeCharacter({culture:'OTTOMAN',role:'GUARD',pose,mouthOpen:false,faith:'UNSPECIFIED',handProp:prop,joints,equipmentStyle:'READABLE_V2'});
  assert.notDeepEqual(old,current,'new version changes equipment only when selected');assert(current.length<40000);
  hashes.add(createHash('sha256').update(JSON.stringify(faces)).digest('hex'));
}
assert.equal(hashes.size,70);
const blocking:SceneBlocking={backdrop:'FIELD',time:'DAY',characters:[{id:'c1',x:.3,depth:.3,facing:'RIGHT',pose:'STAND',expression:'HAPPY',costume:'NONE',handProp:'SPEAR'}],props:[],arrows:[],caption:null};
for(const action of ['KNEEL_DOWN','SIT','BOW','TALK','POINT','FIGHT'] as const) {
  const actor={id:'c1',action,toX:null,delaySeconds:0},plan:CharacterAnimationPlan={schemaVersion:'1',fps:15,actors:[actor]};
  let anchor:number|undefined;
  for(let i=0;i<300;i++){const t=i/60,p=volumePerformanceFrame(blocking.characters[0]!,actor,characterAnimationFrame(blocking,plan,t).c1!,t,120,true);anchor??=p.contacts[0]!.x;assert(Math.abs(p.contacts[0]!.x-anchor)<1e-7,'posture keeps support foot fixed');for(const [knee,foot] of [[p.joints.kneeFront,p.joints.footFront],[p.joints.kneeBack,p.joints.footBack]]){assert(Math.abs(Math.hypot(knee!.x-p.joints.hip.x,knee!.y-p.joints.hip.y)-64)<1e-6);assert(Math.abs(Math.hypot(foot!.x-knee!.x,foot!.y-knee!.y)-60)<1e-6);}}
}
const art={version:'4' as const,culture:'OTTOMAN' as const,faith:'UNSPECIFIED' as const,roles:[{id:'c1',role:'GUARD' as const}]};
assert.equal(volumeSceneEquipment('1550 yılında sipahi kılıcını tutuyor.',blocking).characters[0]!.handProp,'SWORD');
assert.equal(volumeSceneEquipment('Yeniçeri mızrağını tutarak yürüyor.',blocking).characters[0]!.handProp,'SPEAR');
assert.equal(volumeSceneEquipment('Mızrak ve kılıç karşılaştırması.',blocking),blocking,'ambiguous prop ownership must not be guessed');
assert.equal(volumeSceneEquipment('Kılıç olmayan bir sahne.',blocking),blocking);
const old=createVolumeScenePlan(blocking,art,[1480],'JANISSARY'),v2=createVolumeScenePlan(blocking,art,[1480],'JANISSARY','EQUIPMENT_MOTION_V2');
assert(!old.presentation);assert.deepEqual(findVolumeScenePlanProblems(old,blocking,art),[]);assert.deepEqual(findVolumeScenePlanProblems(v2,blocking,art),[]);assert(findVolumeScenePlanProblems({...v2,presentation:'UNBOUNDED'},blocking,art).length);
console.log('Equipment/speech V2: PASS (70 equipment/pose combinations; actual PCM silence, segment offset, fixed grip/free-hand speech, kneel/seat support foot and limb lengths, bounded old/new metadata)');
