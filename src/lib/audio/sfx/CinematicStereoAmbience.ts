/** Original procedural 48kHz stereo effects. No samples, paid API or culture
 * artwork. Positions use equal-power pan; stereo channels are not duplicated. */
export type CinematicSoundKind="step"|"metal"|"cloth"|"pot"|"fire"|"wind"|"bird"|"wood";
export interface CinematicSoundCue {
 readonly at:number;readonly duration:number;readonly kind:CinematicSoundKind;
 readonly pan:number;readonly gain:number;
 readonly synchronization:"AUTHORED"|"MEASURED_ACTION";
}
export const CINEMATIC_SAMPLE_RATE=48000;
const kinds=new Set(["step","metal","cloth","pot","fire","wind","bird","wood"]);
export function originalCinematicStereoAmbience(duration:number,cues:readonly CinematicSoundCue[]):Buffer{
 if(!Number.isFinite(duration)||duration<=0||duration>120||!Array.isArray(cues)||cues.length>256)throw Error("CINEMATIC_SOUND_BOUNDS");
 for(const c of cues)if(!c||!Number.isFinite(c.at)||c.at<0||!Number.isFinite(c.duration)||c.duration<=0||
  c.at+c.duration>duration+1/48000||!kinds.has(c.kind)||!Number.isFinite(c.pan)||Math.abs(c.pan)>1||
  !Number.isFinite(c.gain)||c.gain<0||c.gain>.35||!["AUTHORED","MEASURED_ACTION"].includes(c.synchronization))throw Error("CINEMATIC_SOUND_CUE");
 const rate=CINEMATIC_SAMPLE_RATE,n=Math.ceil(duration*rate),out=Buffer.alloc(44+n*4);
 out.write("RIFF",0);out.writeUInt32LE(out.length-8,4);out.write("WAVEfmt ",8);out.writeUInt32LE(16,16);
 out.writeUInt16LE(1,20);out.writeUInt16LE(2,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*4,28);
 out.writeUInt16LE(4,32);out.writeUInt16LE(16,34);out.write("data",36);out.writeUInt32LE(n*4,40);
 const prepared=cues.map((c,index)=>({...c,from:Math.round(c.at*rate),to:Math.min(n,Math.ceil((c.at+c.duration)*rate)),
  left:Math.cos((c.pan+1)*Math.PI/4),right:Math.sin((c.pan+1)*Math.PI/4),seed:0x1234567+index*7919,low:0}));
 const startEvents=[...prepared].sort((a,b)=>a.from-b.from);let next=0;
 let active:typeof prepared=[];
 for(let i=0;i<n;i++){
  while(next<startEvents.length&&startEvents[next]!.from<=i)active.push(startEvents[next++]!);
  active=active.filter(c=>i<c.to);
  let left=0,right=0;
  for(const c of active){
   const d=(i-c.from)/rate,remaining=(c.to-i)/rate;
   c.seed^=c.seed<<13;c.seed^=c.seed>>>17;c.seed^=c.seed<<5;
   const noise=(c.seed>>>0)/2147483648-1;c.low=c.low*.99+noise*.01;
   let wave=0;
   switch(c.kind){
    case "step":wave=(Math.sin(2*Math.PI*82*d)*.75+noise*.2)*Math.exp(-d*26);break;
    case "metal":wave=(Math.sin(2*Math.PI*1643*d)+.3*Math.sin(2*Math.PI*2811*d))*Math.exp(-d*8)*.65;break;
    case "pot":wave=(Math.sin(2*Math.PI*407*d)+.4*Math.sin(2*Math.PI*731*d))*Math.exp(-d*11)*.6;break;
    case "wood":wave=(Math.sin(2*Math.PI*121*d)*.7+noise*.18)*Math.exp(-d*14);break;
    case "bird":wave=Math.sin(2*Math.PI*(1600+600*d)*d)*Math.sin(Math.PI*d/c.duration)*.3;break;
    case "cloth":wave=noise*.15;break;
    case "fire":wave=c.low*.5+noise*.055+(Math.abs(noise)>.995?noise*.1:0);break;
    case "wind":wave=c.low*.9*(.65+.35*Math.sin(d*.7));break;
   }
   const fade=Math.min(1,d/.004,remaining/.015),sample=wave*c.gain*fade;
   left+=sample*c.left;right+=sample*c.right;
  }
  out.writeInt16LE(Math.round(Math.max(-.94,Math.min(.94,left))*32767),44+i*4);
  out.writeInt16LE(Math.round(Math.max(-.94,Math.min(.94,right))*32767),46+i*4);
 }
 return out;
}
