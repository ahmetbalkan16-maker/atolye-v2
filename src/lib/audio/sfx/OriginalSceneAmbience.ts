import type {VolumeSentenceTiming} from "../../character/volume/VolumeSentenceTiming";
import type {IllustratedEnvironment} from "../../character/illustrated/IllustratedJanissaryPreview";
/** Original procedural preview sounds, no recordings/samples/API. CC0 as with
 * OriginalMusicComposer. Speech ducking happens in the existing FFmpeg mix. */
export function originalSceneAmbience(duration:number,environment:IllustratedEnvironment,timing:VolumeSentenceTiming):Buffer{
 if(!Number.isFinite(duration)||duration<=0||duration>120||!["courtyard","barracks","kitchen"].includes(environment)||timing.durationSeconds!==duration)throw Error("ORIGINAL_SCENE_SOUND_INPUT");
 if(!Array.isArray(timing.sentences)||timing.sentences.length===0||timing.sentences.length>64)throw Error("ORIGINAL_SCENE_SOUND_SENTENCES");
 const rate=16000,count=Math.ceil(duration*rate),out=Buffer.alloc(44+count*2);
 out.write("RIFF",0);out.writeUInt32LE(out.length-8,4);out.write("WAVEfmt ",8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36);out.writeUInt32LE(count*2,40);
 let seed=1480,low=0;const noise=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
 const pulses:{start:number;kind:"step"|"metal"}[]=[];
 for(const s of timing.sentences){
   if(s.start<0||s.end>duration+.001||s.end<=s.start)throw Error("ORIGINAL_SCENE_SOUND_TIMING");
   if(s.action==="WALK"||s.action==="RUN")for(let at=s.start+.08;at<s.end;at+=s.action==="RUN"?.38:.68)pulses.push({start:at,kind:"step"});
   if(s.action==="FIGHT")pulses.push({start:s.start+.25,kind:"metal"});
 }
 for(let i=0;i<count;i++){
  const t=i/rate,n=noise();low=low*.98+n*.02;
  let v=environment==="courtyard"?low*.20:environment==="kitchen"?low*.15+n*.007:low*.08;
  if(environment==="courtyard"){const phase=t%5.8;if(phase>.3&&phase<.7)v+=Math.sin(2*Math.PI*(1600+600*(phase-.3))*t)*Math.sin(Math.PI*(phase-.3)/.4)*.025;}
  if(environment==="kitchen"){const phase=t%4.6;if(phase<.11)v+=Math.sin(2*Math.PI*410*t)*Math.exp(-phase*45)*.045;}
  if(environment==="barracks"&&t<.7)v+=Math.sin(2*Math.PI*(70+35*t)*t)*Math.sin(Math.PI*t/.7)*.04;
  for(const p of pulses){const d=t-p.start;if(d>=0&&d<(p.kind==="step"?.16:.7))v+=p.kind==="step"?(Math.sin(2*Math.PI*90*d)*.14+n*.035)*Math.exp(-d*26):Math.sin(2*Math.PI*1850*d)*.09*Math.exp(-d*8);}
  const fade=Math.min(1,t/.4,(duration-t)/.6);
  out.writeInt16LE(Math.round(Math.max(-.8,Math.min(.8,v*fade))*32767),44+i*2);
 }
 return out;
}
