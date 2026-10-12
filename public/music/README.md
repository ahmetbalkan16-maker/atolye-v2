# Background music library

`src/lib/audio/music/MusicLibrary.ts` selects a background-music bed for a
project from license-cleared audio files placed here. It performs **no
download and no paid API call** - it only picks from files that already exist
on disk.

## Layout

```
public/music/<mood>/<track>.mp3              (or .wav)
public/music/<mood>/<track>.mp3.license.json  (matching metadata sidecar)
```

`<mood>` must be one of: `epic`, `dramatic`, `tense`, `calm`, `historical`
(see `MUSIC_MOODS`). A free-text mood from the script/audio plan is mapped onto
one of these buckets by `normalizeMusicMood`; if the preferred bucket is empty
the selector falls back across the other buckets, and returns `null` when the
whole library is empty. In that case assembly renders narration only.
The library currently contains five original beds and five newer original
arrangements, one of each in every mood bucket.

## Licensing rules

Only add a track whose license permits **monetised YouTube use**:

- CC0 / public domain, or
- Pixabay Content License / YouTube Audio Library "no attribution required", or
- a license whose terms you have read and that allows commercial reuse.

For every track add a sidecar `*.license.json`:

```json
{
  "title": "Siege March",
  "source": "Pixabay",
  "sourceUrl": "https://pixabay.com/music/...",
  "license": "Pixabay Content License",
  "attribution": "Composer Name (if required)"
}
```

## Production use and original arrangements

`PipelineStageExecutor` selects and stages music through the existing audio
stage. `VideoAssemblyManager.resolveBackgroundMusic` consumes the registered
background asset, with narration ducking and the existing mixing safeguards.
Existing staged assets are retained; adding a new library track does not
rewrite a project's music or its frozen regeneration record.

`scripts/compose-original-music.ts` creates the five `atolye-original-02.wav`
arrangements from `src/lib/audio/music/OriginalMusicComposer.ts`: chords,
arpeggios, bass and a light rhythm, with entrance and exit fades. They use no
external samples, download or paid call. The compositions are contributed
under CC0-1.0; matching sidecars include source provenance and file SHA-256.
The generator refuses to overwrite existing files.

Optional sidecar `priority` is an integer from 0 to 100. New arrangements use
10; old tracks default to 0. Selection chooses the highest-priority available
group within the mood, then uses the existing stable project seed. Invalid
priorities are ignored. Library selection does not authorize uploading,
purchase, account linking or changing provider budgets.
