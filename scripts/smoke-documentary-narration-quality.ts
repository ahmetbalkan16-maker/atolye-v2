import assert from "node:assert/strict";
import {assertDistinctDocumentaryNarration,DocumentaryNarrationRepetitionError} from "../src/lib/ai/DocumentaryNarrationQuality";
const original="Osmanlı yeniçerileri bu toplantıda genel durum hakkında bilgi aldılar ve gelecekteki görevler için çeşitli stratejiler geliştirmeye devam ettiler. Bütün askerler aynı odada hazırlıkları konuşarak beklediler.";
assert.throws(()=>assertDistinctDocumentaryNarration([{narration:"Ayrı giriş."},...Array.from({length:6},()=>({narration:original}))]),DocumentaryNarrationRepetitionError);
assert.throws(()=>assertDistinctDocumentaryNarration([{narration:original},{narration:original.toLocaleUpperCase("tr-TR")},{narration:original.replaceAll(" ","  ")}]),DocumentaryNarrationRepetitionError);
assert.doesNotThrow(()=>assertDistinctDocumentaryNarration([{narration:original},{narration:original},{narration:"Farklı anlatı."},{narration:"Başka bölüm."}]));
assert.doesNotThrow(()=>assertDistinctDocumentaryNarration(Array.from({length:6},()=>({narration:"Kısa bir tekrar."}))));
assert.doesNotThrow(()=>assertDistinctDocumentaryNarration([{narration:"Aynı avluda hazırlık."},{narration:"Aynı avluda yürüyüş."},{narration:"Aynı avluda farklı bir talim."}]));
console.log("Documentary narration quality: PASS (dominant copy rejected; casing/punctuation, callbacks, short quotes and same venue checked).");

import {AIManager} from "../src/lib/ai/AIManager";
import {withCanonicalSmokeRuntime} from "./lib/CanonicalSmokeRuntime";
import {ProjectManager} from "../src/lib/projects/ProjectManager";
void withCanonicalSmokeRuntime({name:"documentary-quality-gate"},async context=>{
 const project=await ProjectManager.createProject("narration-quality-"+context.runId.slice(0,8));
 let calls=0;const provider={generate:async()=>{calls++;return JSON.stringify({chapters:Array.from({length:6},(_,i)=>({id:i+1,title:"Bölüm "+(i+1),narration:original,duration:15,visualGoal:"Aynı odadaki toplantı.",emotion:"neutral",transition:"Sonra devam."}))});}};
 await assert.rejects(()=>AIManager.runScript("1480 yeniçeri günü",{projectSlug:project.slug,provider:"ollama"},provider),DocumentaryNarrationRepetitionError);
 assert.equal(calls,1,"bad narration is rejected, never retried invisibly or replaced with mock output");
 console.log("Native AIManager lenient-local gate: PASS; one stub/free call, copied narration refused before writer.");
}).catch(error=>{console.error(error);process.exitCode=1;});
