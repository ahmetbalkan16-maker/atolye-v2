import type {CharacterFrameOverride} from '../SvgSceneRenderer';
import {POSE_ANGLES} from '../CharacterPose';

export interface VolumeSpeechEnvelope {readonly timing:'NARRATION_PCM_ACTIVITY';readonly stepSeconds:.04;readonly durationSeconds:number;readonly levels:readonly number[]}

/** A small actual-audio activity track, never claimed as word/phoneme alignment.
 * Handles the PCM/float formats already accepted by AudioStorage. No model/API. */
export function volumeSpeechEnvelope(wav:Buffer,startSeconds:number,durationSeconds:number):VolumeSpeechEnvelope {
  if(wav.length<44||wav.length>64*1024*1024||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||![startSeconds,durationSeconds].every(Number.isFinite)||startSeconds<0||durationSeconds<=0||durationSeconds>600)throw new Error('VOLUME_SPEECH_INPUT');
  let format=0,channels=0,rate=0,bits=0,align=0,data:Buffer|undefined;
  for(let offset=12;offset+8<=wav.length;) {
    const kind=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),begin=offset+8,end=size===0xffffffff&&kind==='data'?wav.length:begin+size;
    if(end>wav.length)throw new Error('VOLUME_SPEECH_CHUNK');
    if(kind==='fmt '){if(format||size<16)throw new Error('VOLUME_SPEECH_FORMAT');format=wav.readUInt16LE(begin);channels=wav.readUInt16LE(begin+2);rate=wav.readUInt32LE(begin+4);align=wav.readUInt16LE(begin+12);bits=wav.readUInt16LE(begin+14);}
    if(kind==='data'){if(data)throw new Error('VOLUME_SPEECH_DUPLICATE_DATA');data=wav.subarray(begin,end);}
    offset=end+(size%2);
  }
  if(!data||![1,3].includes(format)||channels<1||channels>8||rate<8000||rate>192000||align!==channels*bits/8||!(format===1?[8,16,24,32]:[32,64]).includes(bits)||data.length%align)throw new Error('VOLUME_SPEECH_FORMAT');
  const frames=data.length/align,total=frames/rate;
  if(startSeconds+durationSeconds>total+1/rate)throw new Error('VOLUME_SPEECH_SEGMENT');
  const sample=(i:number)=>format===3?(bits===32?data!.readFloatLE(i):data!.readDoubleLE(i)):bits===8?(data![i]!-128)/128:data!.readIntLE(i,bits/8)/(2**(bits-1));
  const rms:number[]=[],stepSeconds=.04 as const;
  for(let bin=0;bin<Math.ceil(durationSeconds/stepSeconds);bin++) {
    const from=Math.floor((startSeconds+bin*stepSeconds)*rate),to=Math.min(frames,Math.floor((startSeconds+Math.min(durationSeconds,(bin+1)*stepSeconds))*rate));
    let sum=0,n=0;
    // Downsample measurement to <=12 kHz/channel; still bound it by PCM time.
    for(let f=from;f<to;f+=Math.max(1,Math.floor(rate/12000)))for(let c=0;c<channels;c++){const v=sample(f*align+c*bits/8);if(!Number.isFinite(v)||Math.abs(v)>1.01)throw new Error('VOLUME_SPEECH_SAMPLE');sum+=v*v;n++;}
    rms.push(Math.sqrt(sum/(n||1)));
  }
  const peak=Math.max(0,...rms),threshold=Math.max(.004,peak*.035),levels:number[]=[];
  let smooth=0;
  for(const r of rms){const desired=r>=threshold?Math.min(1,r/Math.max(.02,peak*.6)):0;smooth=desired>smooth?desired:smooth*.45;levels.push(smooth<.03?0:smooth);}
  return {timing:'NARRATION_PCM_ACTIVITY',stepSeconds,durationSeconds,levels};
}

export function volumeSpeechLevel(track:VolumeSpeechEnvelope,t:number):number {
  if(!Number.isFinite(t)||t<0||t>=track.durationSeconds)return 0;
  const position=t/track.stepSeconds,index=Math.floor(position),a=track.levels[index]??0,b=track.levels[Math.min(index+1,track.levels.length-1)]??0;
  return a+(b-a)*(position-index);
}

/** Do not wave a held weapon through a listener while explaining. Gesture with
 * the free hand; actual narration silence closes the mouth and settles gestures. */
export function volumeSpeakingFrame(frame:CharacterFrameOverride,t:number,holding:boolean,track?:VolumeSpeechEnvelope):CharacterFrameOverride {
  const gain=track?volumeSpeechLevel(track,t):1,rest=POSE_ANGLES.STAND;
  const moving={upper:(frame.pose.armFront.upper-rest.armFront.upper)*gain,bend:(frame.pose.armFront.bend-rest.armFront.bend)*gain};
  const pose=holding?{...frame.pose,armFront:{upper:40,bend:-40},armBack:{upper:rest.armBack.upper-moving.upper,bend:rest.armBack.bend-moving.bend}}:{...frame.pose,armFront:{upper:rest.armFront.upper+moving.upper,bend:rest.armFront.bend+moving.bend}};
  return {...frame,pose,mouthOpen:track?gain>.08:frame.mouthOpen};
}
