import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {MUSIC_MOODS} from "../src/lib/audio/music/MusicLibrary";
import {composeOriginalMusic} from "../src/lib/audio/music/OriginalMusicComposer";

for(const mood of MUSIC_MOODS) {
  const directory=path.join(process.cwd(),"public","music",mood),file=path.join(directory,"atolye-original-02.wav");
  fs.mkdirSync(directory,{recursive:true});
  if(fs.existsSync(file)||fs.existsSync(`${file}.license.json`)) throw new Error("ORIGINAL_MUSIC_NO_OVERWRITE");
  const bytes=composeOriginalMusic(mood);
  fs.writeFileSync(file,bytes,{flag:"wx"});
  fs.writeFileSync(`${file}.license.json`,JSON.stringify({title:`Atölye original ${mood} arrangement 02`,source:"Atölye original local composition; OriginalMusicComposer.ts",sourceUrl:"https://creativecommons.org/publicdomain/zero/1.0/",license:"CC0-1.0",attribution:"",priority:10,sha256:createHash("sha256").update(bytes).digest("hex"),externalSamples:false},null,2),{flag:"wx"});
  console.log(JSON.stringify({mood,bytes:bytes.length,paidCalls:0,externalSamples:false}));
}
