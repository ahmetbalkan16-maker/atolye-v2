import {AIResponseError} from "./AIResponseError";
import type {ScriptChapter} from "../../types/script";
/** Refuses the concrete observed failure: one substantial narration pasted into
 * most chapters. Same venue, short quotations and one callback remain valid. */
export class DocumentaryNarrationRepetitionError extends AIResponseError{
 constructor(){super("AI_RESPONSE_SCHEMA_INVALID",{code:"AI_RESPONSE_SCHEMA_INVALID",issues:[{path:"$.chapters",reason:"INVALID_FORMAT",expected:"distinct chapter narration; no majority copied chapters",observedType:"array"}]});this.name="DocumentaryNarrationRepetitionError";}
}
export function assertDistinctDocumentaryNarration(chapters:readonly Pick<ScriptChapter,"narration">[]):void{
 if(chapters.length<3)return;
 const groups=new Map<string,number>();
 for(const c of chapters){
  const normalized=c.narration.normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu," ").trim();
  if(normalized.split(/\s+/u).length<20)continue;
  groups.set(normalized,(groups.get(normalized)??0)+1);
 }
 if([...groups.values()].some(count=>count>=3&&count>chapters.length/2))throw new DocumentaryNarrationRepetitionError();
}
