# Background music library

`src/lib/audio/music/MusicLibrary.ts` selects a background-music bed for a
project from license-cleared audio files placed here. It performs **no
download and no paid API call** - it only picks from files that already exist
on disk.

## Layout

```
public/music/<mood>/<track>.mp3
public/music/<mood>/<track>.mp3.license.json   (optional metadata sidecar)
```

`<mood>` must be one of: `epic`, `dramatic`, `tense`, `calm`, `historical`
(see `MUSIC_MOODS`). A free-text mood from the script/audio plan is mapped onto
one of these buckets by `normalizeMusicMood`; if the preferred bucket is empty
the selector falls back across the other buckets, and returns `null` when the
whole library is empty (the current state - the assembly stage then renders
narration-only, exactly as before).

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

## Not yet wired

As of the V2 Faz-1 change the selector is implemented and tested
(`scripts/smoke-music-library.ts`) but **not yet called from the audio /
assembly stage**. Wiring point: the audio stage should, when
`selectMusicTrack(audio.music.mood, project.slug)` returns a track, copy it
into the project's `audio/` directory as `bgm.<ext>` and register it as an
asset whose id contains `bgm` - `VideoAssemblyManager.resolveBackgroundMusic`
already consumes such an asset (volume 0.15, ducking on).
