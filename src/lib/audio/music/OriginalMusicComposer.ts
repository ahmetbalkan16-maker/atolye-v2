import type {MusicMood} from "./MusicLibrary";

/** Our original local arrangement: no external samples or reference melody.
 * Bounded PCM composition with an arpeggio, chord pad, soft bass and percussion.
 * The generated arrangement is contributed under CC0-1.0 with its source.
 */
export function composeOriginalMusic(mood: MusicMood): Buffer {
  const profiles={epic:{bpm:100,gain:.19,minor:true},dramatic:{bpm:76,gain:.16,minor:true},tense:{bpm:112,gain:.15,minor:true},calm:{bpm:72,gain:.12,minor:false},historical:{bpm:88,gain:.16,minor:true}};
  const profile=profiles[mood];if(!profile) throw new Error("MUSIC_MOOD_REFUSED");
  const rate=22050,duration=32*60/profile.bpm,samples=Math.ceil(duration*rate),wav=Buffer.alloc(44+samples*2);
  wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(samples*2,40);
  const chords=profile.minor?[[57,60,64],[53,57,60],[60,64,67],[55,59,62]]:[[60,64,67],[57,60,64],[53,57,60],[55,59,62]];
  const frequency=(note:number)=>440*Math.pow(2,(note-69)/12);
  const tau=2*Math.PI,beatSeconds=60/profile.bpm;
  let noise=48191;
  for(let i=0;i<samples;i++) {
    const time=i/rate,beat=time/beatSeconds,chord=chords[Math.floor(beat/8)%4]!,pulse=Math.floor(beat*2),onset=(beat*2-pulse)*beatSeconds/2;
    const note=chord[[0,1,2,1,0,2,1,2][pulse%8]!]!+12,f=frequency(note);
    const attack=Math.min(1,onset/.014),pluck=attack*Math.exp(-onset*8)*(Math.sin(tau*f*onset)+.26*Math.sin(tau*f*2*onset)+.08*Math.sin(tau*f*3*onset));
    const pad=chord.reduce((sum,n)=>sum+Math.sin(tau*frequency(n)*time),0)/3;
    const local=beat-Math.floor(beat),bass=Math.sin(tau*frequency(chord[0]!-12)*time)*Math.exp(-local*4);
    noise=(Math.imul(noise,1664525)+1013904223)>>>0;
    const hat=((noise/4294967296)*2-1)*Math.exp(-onset*85)*.06;
    const kick=mood==="calm"?0:Math.sin(tau*(49*time+12*Math.exp(-local*9)))*Math.exp(-local*15)*.14;
    const envelope=Math.min(1,time/.7,(duration-time)/1.1),sample=profile.gain*envelope*(pluck*.55+pad*.24+bass*.16+hat+kick);
    wav.writeInt16LE(Math.round(Math.max(-.8,Math.min(.8,sample))*32767),44+i*2);
  }
  return wav;
}
