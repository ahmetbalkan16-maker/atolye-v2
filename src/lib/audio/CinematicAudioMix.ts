/** Four independently stored tracks. Narration remains centred; dialogue and
 * ambience must already have genuine spatial stereo before this mix.
 * Existing default assembly graph is deliberately unchanged. */
export function cinematicAudioFilterGraph(input:{narration:number;dialogue:number;ambience:number;music:number}):string{
 const indices=Object.values(input);
 if(indices.length!==4||new Set(indices).size!==4||indices.some(x=>!Number.isInteger(x)||x<0||x>16))throw Error("CINEMATIC_AUDIO_INPUT");
 const rate="aresample=48000";
 return [
  "["+input.narration+":a]"+rate+",aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0[narrator]",
  "["+input.dialogue+":a]"+rate+",aformat=channel_layouts=stereo,volume=0.95[dialogue]",
  "[narrator][dialogue]amix=inputs=2:normalize=0,asplit=3[speech][keyMusic][keyAmbience]",
  "["+input.ambience+":a]"+rate+",aformat=channel_layouts=stereo,volume=0.9[ambience]",
  "["+input.music+":a]"+rate+",aformat=channel_layouts=stereo,volume=0.10[music]",
  "[music][keyMusic]sidechaincompress=threshold=0.025:ratio=8:attack=30:release=650[duckMusic]",
  "[ambience][keyAmbience]sidechaincompress=threshold=0.035:ratio=3:attack=15:release=300[duckAmbience]",
  "[speech][duckAmbience][duckMusic]amix=inputs=3:normalize=0,alimiter=limit=0.94:level=false,aresample=48000[cinematicAudio]"
 ].join(";");
}
