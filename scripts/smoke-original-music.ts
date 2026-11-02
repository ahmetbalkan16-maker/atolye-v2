import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {composeOriginalMusic} from "../src/lib/audio/music/OriginalMusicComposer";
import {MUSIC_MOODS,selectMusicTrack} from "../src/lib/audio/music/MusicLibrary";
import {AudioStorage} from "../src/lib/assets/storage/AudioStorage";
import {classifyMediaRightsStatus} from "../src/lib/assets/MediaRightsPolicy";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"original-music-"));
try {
  for(const mood of MUSIC_MOODS) {
    const wav=composeOriginalMusic(mood);assert(wav.length<2*1024*1024);AudioStorage.inspectWav(wav);
    assert(wav.equals(composeOriginalMusic(mood)),"same local arrangement must be deterministic");
    let energy=0,peak=0;for(let i=44;i<wav.length;i+=2){const v=wav.readInt16LE(i);peak=Math.max(peak,Math.abs(v));energy+=v*v;}
    assert(energy>0&&peak<27000,"non-silent, bounded unclipped signal");
    const directory=path.join(root,mood);fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,"old.wav"),wav);fs.writeFileSync(path.join(directory,"new.wav"),wav);
    fs.writeFileSync(path.join(directory,"new.wav.license.json"),JSON.stringify({license:"CC0-1.0",priority:10}));
    const selected=selectMusicTrack(mood,"stable-seed",{NODE_ENV:"test",ATOLYE_MUSIC_LIBRARY_ROOT:root});assert.equal(selected?.fileName,"new.wav", "assert.equal(selected?.fileName,\"new.wav\")");assert.equal(classifyMediaRightsStatus(selected?.license),"public-domain", "assert.equal(classifyMediaRightsStatus(selected?.license),\"public-domain\")");
    fs.writeFileSync(path.join(directory,"old.wav.license.json"),JSON.stringify({priority:1000}));
    assert.equal(selectMusicTrack(mood,"stable-seed",{NODE_ENV:"test",ATOLYE_MUSIC_LIBRARY_ROOT:root})?.fileName,"new.wav","out-of-bounds priority not admitted");
  }
  console.log("Original music: PASS (5 real bounded WAV moods, no samples/API, deterministic arrangement, no clipping, optional curated priority, licence gate retained)");
} finally {
  const resolved=fs.realpathSync.native(root);assert.equal(path.dirname(resolved),fs.realpathSync.native(os.tmpdir()), "assert.equal(path.dirname(resolved),fs.realpathSync.native(os.tmpdir()))");fs.rmSync(resolved,{recursive:true,force:true});
}
