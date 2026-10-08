/** Independent post-freeze F97 tests: TEMP memory, injected provider, no network or authority. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ayasReplyHistoryQualityIssue as issue } from "../src/lib/ayas/context/AyasReplyHistoryQuality";
import { streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";
const old = "Dün bu projede araştırma aşamasını birlikte değerlendirmiştik.";
const history = [{role:"user" as const,text:"Dün ne yapmıştık?"},{role:"brain" as const,text:old}];
let count=0;
const check=(name:string,fn:()=>void)=>{fn();count++;console.log("PASS "+name);};
check("previous answer replay",()=>assert.equal(issue(old,"Bugün ne yapalım?",history),"history-replay"));
check("replay with appended question",()=>assert.equal(issue(old+" Şimdi ne yapmak istersin?","Yeni konuyu konuşalım.",history),"history-replay"));
check("previous user line replay",()=>assert.equal(issue(old,"Yeni konuyu konuşalım.",[{role:"user",text:old}]),"history-replay"));
check("direct question echoed",()=>assert.equal(issue("İki artı iki kaç?","İki artı iki kaç?",[]),"question-echo"));
check("global status invented",()=>assert.equal(issue("Sisteminiz tam olarak çalışmaktadır.","Merhaba",[]),"unverified-global-status"));
check("status among other sentences",()=>assert.equal(issue("Merhaba. Sisteminiz tam olarak çalışmaktadır. Neye bakalım?","Merhaba",[]),"unverified-global-status"));
check("global status paraphrase",()=>assert.equal(issue("Sistem tamamen sorunsuzdur.","Merhaba",[]),"unverified-global-status"));
check("explicit repeat",()=>assert.equal(issue(old,"Son yanıtını tekrarla.",history),null));
check("explicit quote",()=>assert.equal(issue("Sisteminiz tam olarak çalışmaktadır.","Bu cümleyi aynen söyle.",[]),null));
check("same question repeated",()=>assert.equal(issue(old,"Dün ne yapmıştık?",history),null));
check("short stable answer",()=>assert.equal(issue("4.","İki artı iki kaç?",[{role:"brain",text:"4."}]),null));
check("historical recall",()=>assert.equal(issue(old,"Daha önce ne yapmıştık?",history),null));
check("honest uncertainty",()=>assert.equal(issue("Sistemin tam olarak çalıştığını doğrulamadım.","Durum?",[]),null));
check("qualified component",()=>assert.equal(issue("Ollama bu isteğe yanıt verdi.","Durum?",[]),null));
check("substantive answer",()=>assert.equal(issue("İki artı iki dört eder.","İki artı iki kaç?",[]),null));
check("system prompt excluded",()=>assert.equal(issue(old,"Bugün ne yapalım?",[{role:"system",text:old}]),null));
const snapshot: BrainConsoleSnapshot={generatedAt:"2026-10-08T00:00:00Z",executionGate:"CLOSED",connected:{tasks:false,cycles:false,experience:false},errors:[],tasks:{total:0,byStatus:{queued:0,running:0,"blocked-on-dependency":0,"blocked-on-approval":0,succeeded:0,failed:0,cancelled:0,"skipped-unsafe":0},pendingApproval:0,skippedUnsafe:0,items:[]},cyclesRecorded:0,experience:{total:0},safety:{decision:"proceed-with-constraints",snapshotSource:"unavailable",reasons:[],hardwareProfileId:"gtx-1650-4gb"}};
async function main(){
  for(const [name,draft,revised] of [["status corrected","Sisteminiz tam olarak çalışmaktadır.","Merhaba, seni dinliyorum."],["history corrected",old,"Bugün yeni bir konu seçebiliriz."],["repeat correction rejected",old,old]]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"ayas-f97-"));let calls=0;
    const provider:AyasModelProvider={id:"ollama",kind:"local",model:"fixture",configured:true,health:async()=>({available:true,detail:"fixture",checkedAtMs:0}),chat:async()=>{calls++;return {text:revised!,finishReason:"stop"};},async *stream(){calls++;yield {type:"delta",text:draft!};yield {type:"done",text:draft!,finishReason:"stop"};}};
    try{
      const events:AyasChatStreamEvent[]=[];
      for await(const event of streamAyasChat({text:name==="status corrected"?"Merhaba":"Bugün yeni bir konu konuşalım.",snapshot,history:name==="status corrected"?[]:history,seq:1,memoryStore:{rootDir:root},env:{NODE_ENV:"test"},route:{decision:{complexity:"NORMAL",providerId:"ollama",providerKind:"local",model:"fixture",reason:"fixture"},provider}}))events.push(event);
      const done=events.findLast(event=>event.type==="done");assert.ok(done&&done.type==="done");
      assert.equal(calls,2,"at most one correction using same provider");assert.equal(done.correctionAttempts,1);assert.equal(done.corrected,true);
      assert.equal(issue(done.text,name==="status corrected"?"Merhaba":"Bugün yeni bir konu konuşalım.",history),null);
      assert.ok(events.filter(e=>e.type==="delta").every(e=>!e.text.includes(draft!)),"unvalidated draft never reaches client");
      assert.equal(done.source,name==="repeat correction rejected"?"fallback":"llm");count++;console.log("PASS "+name);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  }
  console.log(JSON.stringify({status:"PASS",scenarios:count,scope:"TEMP_INJECTED_PROVIDER_NO_LIVE_QUALITY_CLAIM"}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
