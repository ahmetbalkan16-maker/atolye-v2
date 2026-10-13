import {splitTurkishSentences} from '../../export/SubtitleGenerator';
import type {CharacterAction} from '../../animation/character/CharacterAnimation';
export interface NarrationWord {readonly text:string;readonly start:number;readonly end:number}
export interface NarrationSentence {readonly text:string;readonly start:number;readonly end:number;readonly action:CharacterAction}
export interface VolumeSentenceTiming {readonly timing:'LOCAL_NARRATION_SENTENCES';readonly durationSeconds:number;readonly coverage:number;readonly sentences:readonly NarrationSentence[]}
const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
// Turkish proper-name/year suffixes remain one acoustic word (Ankara'nın,
// 1480'de). Apply the same normalization to source and Whisper text; spaces
// and other separators still delimit words, and measured offsets stay intact.
const words=(s:string)=>fold(s).replace(/(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu,'').match(/[\p{L}\p{N}]+/gu)??[];

/** Bounded closed gestures from the actual narrated sentence, not visual prose.
 * Ambiguous/negated actions remain explanatory speech; no inferred violence. */
export function narrationSentenceAction(text:string):CharacterAction {
 const s=fold(text);
 if(/\b(?:not|never|without|degil|hayir)\b|\b\w+(?:madi|medi|miyor|miyoruz|meyecek|mayacak)\b/.test(s))return 'TALK';
 if(/\b(?:egil\w*|selam\w*|bow\w*)\b/.test(s))return 'BOW';
 if(/\b(?:otur(?:uyor|du|dum|duk|arak|an|acak|acag|ma|un)\w*|sit|sits|sitting|sat)\b/.test(s))return 'SIT';
 if(/\b(?:diz cok\w*|kneel\w*)\b/.test(s))return 'KNEEL_DOWN';
 if(/\b(?:kos(?:uyor|tu|tuk|tum|acak|acag|arak|maya|an|arken)\w*|run|runs|running|ran)\b/.test(s))return 'RUN';
 if(/\b(?:yuru\w*|ilerle\w*|walk\w*|march\w*)\b/.test(s))return 'WALK';
 if(/\b(?:kilic\w*|sword\w*)\b/.test(s)&&/\b(?:saldir\w*|savur\w*|attack\w*|swing\w*)\b/.test(s))return 'FIGHT';
 if(/\b(?:kutla\w*|celebrat\w*|cheer\w*)\b/.test(s))return 'CHEER';
 if(/\b(?:goster\w*|isaret\w*|bakalim|burada|point\w*|look)\b/.test(s))return 'POINT';
 return 'TALK';
}

/** whisper.cpp word-sized -ml 1 -sow JSON. Times are milliseconds, not
 * confidence-derived estimates. Refuse unordered/out-of-segment output. */
export function parseNarrationWords(raw:string,duration:number):NarrationWord[] {
 if(raw.length>2*1024*1024||!Number.isFinite(duration)||duration<=0||duration>600)throw Error('NARRATION_TIMING_INPUT');
 const doc=JSON.parse(raw) as {transcription?:{text?:unknown;offsets?:{from?:unknown;to?:unknown}}[]};
 if(!Array.isArray(doc.transcription)||!doc.transcription.length||doc.transcription.length>4000)throw Error('NARRATION_TIMING_SHAPE');
 const result:NarrationWord[]=[];let last=0;
 for(const s of doc.transcription){
  if(typeof s.text!=='string'||s.text.length>512)throw Error('NARRATION_TIMING_TEXT');
  if(!words(s.text).length)continue;
  const start=Number(s.offsets?.from)/1000,end=Number(s.offsets?.to)/1000;
  // Whisper can emit a zero-width word anchor (e.g. "Şimdi") next to a
  // measured word. Keep the anchor; never invent a word duration for it.
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<last-.04||start<0||end<start||end<last-.04||end>duration+.05||words(s.text).length!==1)throw Error('NARRATION_TIMING_OFFSETS');
  result.push({text:s.text.trim(),start:Math.max(last,start),end:Math.min(duration,end)});last=end;
 }
 if(!result.length)throw Error('NARRATION_TIMING_EMPTY');return result;
}

/** Source text is already the selected audio chapter. A bounded monotone LCS
 * verifies acoustic words against that exact narration; unknown words never
 * supply a gesture. Chapter segments can cover just part of the source. */
export function alignNarrationSentences(source:string,timed:readonly NarrationWord[],duration:number):VolumeSentenceTiming {
 if(!source.trim()||source.length>32000||timed.length>1600||!Number.isFinite(duration)||duration<=0||duration>600)throw Error('NARRATION_ALIGNMENT_INPUT');
 const sentences=splitTurkishSentences(source);if(sentences.length>200)throw Error('NARRATION_ALIGNMENT_SIZE');
 const tokens=sentences.flatMap((text,index)=>words(text).map(text=>({text,index})));
 if(!tokens.length||tokens.length>4000||!timed.length)throw Error('NARRATION_ALIGNMENT_SIZE');
 const heard=timed.map(w=>words(w.text)[0]??''),stride=heard.length+1,dp=new Uint16Array((tokens.length+1)*stride);
 for(let i=tokens.length-1;i>=0;i--)for(let j=heard.length-1;j>=0;j--)dp[i*stride+j]=tokens[i]!.text===heard[j]?1+dp[(i+1)*stride+j+1]!:Math.max(dp[(i+1)*stride+j]!,dp[i*stride+j+1]!);
 const matched:{source:number;heard:number}[]=[];let i=0,j=0;
 while(i<tokens.length&&j<heard.length){if(tokens[i]!.text===heard[j]){matched.push({source:i++,heard:j++});}else if(dp[(i+1)*stride+j]!>=dp[i*stride+j+1]!)i++;else j++;}
 const coverage=matched.length/heard.length;
 if(coverage<.8||matched.length<Math.min(3,heard.length))throw Error('NARRATION_ALIGNMENT_UNCERTAIN');
 const output:NarrationSentence[]=[];
 for(const [index,text] of sentences.entries()){
  const hits=matched.filter(m=>tokens[m.source]!.index===index);if(!hits.length)continue;
  const firstHit=hits[0]!,lastHit=hits.at(-1)!;
  const sourceIndices=tokens.flatMap((token,i)=>token.index===index?[i]:[]);
  const previous=matched.filter(m=>tokens[m.source]!.index<index).at(-1),next=matched.find(m=>tokens[m.source]!.index>index);
  // A proper noun can be misheard while the rest matches. Preserve the actual
  // adjacent acoustic span; do not silently drop that spoken prefix/suffix or
  // use its unverified word to choose an action.
  const from=Math.max(previous?previous.heard+1:0,firstHit.heard-(firstHit.source-sourceIndices[0]!));
  const to=Math.min(next?next.heard-1:timed.length-1,lastHit.heard+(sourceIndices.at(-1)!-lastHit.source));
  const first=timed[from]!,last=timed[to]!;
  // Do not enact an action verb the recognizer did not actually match.
  const verified=hits.map(h=>tokens[h.source]!.text).join(' ');
  const expected=narrationSentenceAction(text),actual=narrationSentenceAction(verified);
  const action=expected===actual?expected:'TALK';
  if(last.end<=first.start)throw Error('NARRATION_ALIGNMENT_ZERO_SENTENCE');
  output.push({text,start:first.start,end:last.end,action});
 }
 if(!output.length)throw Error('NARRATION_ALIGNMENT_EMPTY');
 return {timing:'LOCAL_NARRATION_SENTENCES',durationSeconds:duration,coverage,sentences:output};
}
