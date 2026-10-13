import assert from "node:assert/strict";
import { LocalWhisperWakeListener, qualifyLocalWakeTranscript, type LocalWakeTranscript } from "../src/components/brain/voice/wake/localWhisperWakeListener";
const confidence = { minTokenP: 0.9, meanTokenP: 0.95 };
let checks = 0;
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`); }
const settle = async () => { for (let i=0;i<5;i++) await new Promise(r=>setImmediate(r)); };
const frame = (speech=false) => Float32Array.from({length:1280},(_,i)=>speech?Math.sin(i/4)*0.1:0);
const utterance = (listener: LocalWhisperWakeListener) => { for(let i=0;i<5;i++)listener.accept(frame(true));for(let i=0;i<6;i++)listener.accept(frame()); };
async function main() {
  for (const text of ["AYAS", "AYAZ bugün nasılsın", "HAYAS"]) check(text,()=>assert(qualifyLocalWakeTranscript({text,confidence})));
  for (const text of ["beyaz", "hayat güzel", "Qiyas", "Ayyes", "Altyazı M.K.", "Bugün Ayas burada", "Ayas'ın sesi"]) check(`negative:${text}`,()=>assert(!qualifyLocalWakeTranscript({text,confidence})));
  for(const c of [null,{minTokenP:0.29,meanTokenP:0.9},{minTokenP:0.9,meanTokenP:0.64},{minTokenP:NaN,meanTokenP:0.9},{minTokenP:1.2,meanTokenP:0.9},{minTokenP:0.9,meanTokenP:1.2}])check("low/missing/invalid confidence",()=>assert(!qualifyLocalWakeTranscript({text:"AYAS",confidence:c})));
  let now=0,hits=0,requests=0,signal:AbortSignal|undefined,resolve:((r:LocalWakeTranscript)=>void)|undefined,wavBytes=0;
  const listener=new LocalWhisperWakeListener({now:()=>now,onChange:()=>{},onWake:()=>hits++,transcribe:async(wav,s)=>{requests++;signal=s;wavBytes=wav.byteLength;return new Promise(r=>{resolve=r;});}});
  for(let i=0;i<2000;i++)listener.accept(frame());
  await settle();check("silence never uploaded",()=>assert.equal(requests,0));
  utterance(listener);await settle();check("one request for voiced clip",()=>{assert.equal(requests,1);assert(wavBytes<=256044);});
  for(let i=0;i<2000;i++)listener.accept(frame(true));await settle();check("single-flight / no backlog",()=>assert.equal(requests,1));
  resolve!({text:"AYAS",confidence});await settle();check("confirmed alias hit",()=>assert.equal(hits,1));
  utterance(listener);await settle();check("4s rate bound",()=>assert.equal(requests,1));
  now=4000;utterance(listener);await settle();listener.stop();
  check("STOP aborts current fetch",()=>assert.equal(signal?.aborted,true));
  resolve!({text:"AYAS",confidence});await settle();check("late reply after STOP ignored",()=>{assert.equal(hits,1);assert.equal(listener.status.phase,"stopped");});
  let maxBytes=0;
  const long=new LocalWhisperWakeListener({onChange:()=>{},onWake:()=>{},transcribe:async(w)=>{maxBytes=w.byteLength;return {text:"hayat güzel",confidence};}});
  for(let i=0;i<500;i++)long.accept(frame(true));await settle();check("continuous speech bounded to8s",()=>assert(maxBytes>0&&maxBytes<=256044));long.stop();
  const failed=new LocalWhisperWakeListener({onChange:()=>{},onWake:()=>{throw new Error("unexpected wake");},transcribe:async()=>{throw new Error("thermal-hold");}});
  utterance(failed);await settle();check("error visible; no hit; rearmed",()=>{assert.equal(failed.status.lastReason,"thermal-hold");assert.equal(failed.status.phase,"listening");assert.equal(failed.status.hits,0);});failed.stop();
  console.log(`PASS ${checks} local Whisper wake checks`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
