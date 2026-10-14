import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {inspectCinematicStoryPlan,type CinematicStoryPlan} from "../src/lib/documentary/CinematicStoryPlan";
import {originalCinematicStereoAmbience} from "../src/lib/audio/sfx/CinematicStereoAmbience";
import {cinematicAudioFilterGraph} from "../src/lib/audio/CinematicAudioMix";
import {SpawnRunner} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64);
const actor=(instanceId:string)=>({instanceId,character:{id:"ottoman.early-modern.janissary.reference.v1",contentSha256:A,designIdentitySha256:A},x:.4,depth:.9,facing:"right" as const,action:"listen" as const,emotion:"serious" as const,lookAt:"work"});
const plan:CinematicStoryPlan={schemaVersion:"cinematic-story-v1",durationSeconds:12,
 question:"Günlük hazırlık askerî düzeni nasıl açıklar?",cause:"Birlikte hazırlık aynı sırayı korumaya yardım eder.",experience:"İki asker ortak hayat içinde hazırlanır ve konuşur.",consequence:"Bu düzen sonraki tarihsel sorunun bağlamını oluşturur.",
 sources:[{id:"source",url:"https://islamansiklopedisi.org.tr/yeniceri",claim:"Kaynak askerî teşkilat bağlamını açıklar; diyaloglar canlandırmadır."}],
 shots:[{id:"one",startSeconds:0,endSeconds:6,civilization:"ottoman",period:"early-modern",year:1480,
 environment:{id:"ottoman.early-modern.janissary.courtyard.v1",contentSha256:B},camera:"wide",purpose:"Hazırlığın birlikte yapılması",narrationAnchor:"Günlük hayat ve hazırlık",actors:[actor("one"),actor("two")],interactions:[{from:"one",to:"two",kind:"response"}]},
 {id:"two",startSeconds:6,endSeconds:12,civilization:"ottoman",period:"early-modern",year:1480,
 environment:{id:"ottoman.early-modern.janissary.barracks.v1",contentSha256:C},camera:"two-shot",purpose:"Arkadaşına dönüp yanıt verme",narrationAnchor:"Asker arkadaşına yanıt veriyor",actors:[actor("one"),actor("two")],interactions:[{from:"two",to:"one",kind:"response"}]}],
 speech:[{shotId:"one",startSeconds:1,endSeconds:4,text:"Birlikte hazırlık ortak yaşamın bir parçasıdır.",kind:"narrator",speakerInstanceId:null,pan:0,sourceIds:["source"]},
 {shotId:"two",startSeconds:7,endSeconds:9,text:"Birlikte çıkalım.",kind:"dramatized-dialogue",speakerInstanceId:"two",pan:.5,sourceIds:[]}]};
const result=inspectCinematicStoryPlan(plan);
assert.equal(result.storyAccepted,true);assert.equal(result.actualVisualChanges,1);assert.equal(result.productionAdmission,"NOT_GRANTED");
const copy=()=>JSON.parse(JSON.stringify(plan)) as CinematicStoryPlan;
const p1=copy();(p1.shots[1] as {environment:unknown}).environment={id:"ottoman.early-modern.janissary.renamed.v1",contentSha256:B};
assert.equal(inspectCinematicStoryPlan(p1).actualVisualChanges,0,"a renamed copy and camera cut cannot count");
const p2=copy();(p2.shots[1].actors as unknown as {instanceId:string}[]).push({...actor("three")});
(p2.shots[1] as {environment:unknown}).environment=p1.shots[1].environment;
assert.equal(inspectCinematicStoryPlan(p2).actualVisualChanges,0,"extra instances of same character cannot count");
const p3=copy();(p3.shots[0].environment as {id:string}).id="persia.early-modern.janissary.courtyard.v1";
assert.throws(()=>inspectCinematicStoryPlan(p3),/NAMESPACE/);
const p4=copy();(p4.shots[1] as {startSeconds:number}).startSeconds=6.2;assert.throws(()=>inspectCinematicStoryPlan(p4),/SHOT/);
const p5=copy();(p5.speech[1] as unknown as {kind:string}).kind="historical-quote";assert.throws(()=>inspectCinematicStoryPlan(p5),/KIND/);
const p6=copy();(p6.speech[0] as {pan:number}).pan=.5;assert.throws(()=>inspectCinematicStoryPlan(p6),/NARRATOR/);
const p7=copy();(p7.shots[0].actors[0] as {lookAt:string}).lookAt="camera";assert.throws(()=>inspectCinematicStoryPlan(p7),/ACTOR/);
const p8=copy();(p8.shots[1].actors[0].character as {contentSha256:string}).contentSha256=C;assert.throws(()=>inspectCinematicStoryPlan(p8),/ASSET_CHANGED/);
const p9=copy();(p9.shots[1].actors[0].character as {designIdentitySha256:string}).designIdentitySha256=C;assert.throws(()=>inspectCinematicStoryPlan(p9),/DESIGN_IDENTITY_CHANGED/);
const p10=copy();(p10.sources[0] as {url:string}).url="https://user:pass@example.org/";assert.throws(()=>inspectCinematicStoryPlan(p10),/SOURCE/);
const soundtrack=originalCinematicStereoAmbience(2,[{at:.1,duration:.5,kind:"step",pan:-.8,gain:.2,synchronization:"AUTHORED"},{at:1.1,duration:.5,kind:"metal",pan:.8,gain:.2,synchronization:"MEASURED_ACTION"}]);
assert.equal(soundtrack.readUInt32LE(24),48000);assert.equal(soundtrack.readUInt16LE(22),2);assert.equal(soundtrack.length,44+2*48000*4);
const power=(from:number,to:number)=>{
 let l=0,r=0,diff=0;for(let n=Math.floor(from*48000);n<Math.floor(to*48000);n++){
  const a=soundtrack.readInt16LE(44+n*4),b=soundtrack.readInt16LE(46+n*4);l+=a*a;r+=b*b;diff+=Math.abs(a-b);
 }return {l,r,diff};
};
assert.ok(power(.1,.6).l>power(.1,.6).r*10);
assert.ok(power(1.1,1.6).r>power(1.1,1.6).l*10);
assert.ok(power(0,2).diff>0);
assert.deepEqual(originalCinematicStereoAmbience(2,[{at:.1,duration:.5,kind:"step",pan:-.8,gain:.2,synchronization:"AUTHORED"},{at:1.1,duration:.5,kind:"metal",pan:.8,gain:.2,synchronization:"MEASURED_ACTION"}]),soundtrack);
assert.throws(()=>originalCinematicStereoAmbience(121,[]),/BOUNDS/);
assert.throws(()=>originalCinematicStereoAmbience(2,[{at:1.9,duration:.2,kind:"step",pan:0,gain:.1,synchronization:"AUTHORED"}]),/CUE/);
assert.throws(()=>cinematicAudioFilterGraph({narration:0,dialogue:0,ambience:2,music:3}),/INPUT/);
async function main(){
 const tmp=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tmp,"atolye-cinematic-mix-test-")),runner=new SpawnRunner();
 const ffmpeg=process.env.FFMPEG_PATH??"ffmpeg",ffprobe=process.env.FFPROBE_PATH??"ffprobe";
 try{
  const env=path.join(dir,"ambience.wav"),wav=path.join(dir,"mix.wav");fs.writeFileSync(env,soundtrack,{flag:"wx"});
  const r=await runner.run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error",
   "-f","lavfi","-i","sine=frequency=250:sample_rate=22050:duration=2",
   "-f","lavfi","-i","anullsrc=r=48000:cl=stereo:d=2","-i",env,
   "-f","lavfi","-i","sine=frequency=110:sample_rate=22050:duration=2",
   "-filter_complex",cinematicAudioFilterGraph({narration:0,dialogue:1,ambience:2,music:3}),"-map","[cinematicAudio]","-t","2","-ar","48000","-c:a","pcm_s16le",wav],{timeoutMs:15000,maxOutputBytes:16384});
  assert.equal(r.exitCode,0,r.stderr);
  const probe=await runner.run(ffprobe,["-v","error","-show_streams","-of","json",wav],{timeoutMs:10000,maxOutputBytes:16384});
  assert.equal(probe.exitCode,0);const stream=JSON.parse(probe.stdout??"").streams[0];
  assert.equal(stream.sample_rate,"48000");assert.equal(stream.channels,2);assert.equal(stream.codec_name,"pcm_s16le");
  // FFmpeg sometimes adds a LIST chunk; find data, don't assume a 44-byte header.
  const b=fs.readFileSync(wav);let start=0;
  for(let at=12;at+8<=b.length;){const size=b.readUInt32LE(at+4);if(b.toString("ascii",at,at+4)==="data"){start=at+8;break;}at+=8+size+(size%2);}
  assert.ok(start>0);let difference=0;for(let at=start;at+4<=b.length;at+=4)difference+=Math.abs(b.readInt16LE(at)-b.readInt16LE(at+2));
  assert.ok(difference>100000,"four-layer final mix preserves genuine stereo ambience");
  const aac=path.join(dir,"mix.m4a"),encoded=await runner.run(ffmpeg,["-nostdin","-v","error","-i",wav,"-ar","48000","-ac","2","-c:a","aac",aac],{timeoutMs:10000,maxOutputBytes:16384});
  assert.equal(encoded.exitCode,0);
  const compressed=await runner.run(ffprobe,["-v","error","-show_streams","-of","json",aac],{timeoutMs:10000,maxOutputBytes:16384});
  assert.equal(compressed.exitCode,0);const finalStream=JSON.parse(compressed.stdout??"").streams[0];
  assert.equal(finalStream.sample_rate,"48000");assert.equal(finalStream.channels,2);assert.equal(finalStream.channel_layout,"stereo");
  console.log(JSON.stringify({status:"PASS",story:"namespace/identity/camera-only/quote/context/refusal",audio:"real FFmpeg four-layer 48000Hz stereo",hash:createHash("sha256").update(b).digest("hex")}));
 }finally{
  const actual=fs.realpathSync.native(dir);
  assert.equal(path.dirname(actual),tmp);assert.ok(path.basename(actual).startsWith("atolye-cinematic-mix-test-"));
  fs.rmSync(actual,{recursive:true,force:true});
 }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
