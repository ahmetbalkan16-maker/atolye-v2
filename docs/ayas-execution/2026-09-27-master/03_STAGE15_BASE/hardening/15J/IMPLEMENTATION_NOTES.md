# Stage 15J — Historical Storytelling + Character / Stick-Figure Engine

Opened 2026-10-02 at `ebc373c`. Canonical section: master order STAGE 15J; `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md` STAGE 15J; directive V3.2 section 11. Post-freeze addendum: section 0 was applied (no autonomous spend; unknown rights and unknown state fail closed; a design document is not evidence).

## What the stage asks for, and where each item stands

| Canonical item | State | Where |
|---|---|---|
| Historical fact pack: claims, dates, people, locations, uncertainty, source refs, claim-to-scene map | Built as a contract and a check | `src/lib/storytelling/HistoricalFactPack.ts` |
| A factual claim without evidence cannot silently enter narration | Built as a deterministic check; not wired into the script stage | `checkNarrationEvidence` |
| Narrative structure, eight beats | Built | `NARRATIVE_BEATS` in `src/lib/storytelling/NarrativeContract.ts` |
| Seven narrative checks | Built, on top of the Stage 12 review | `reviewNarrative` |
| Media classes, with synthetic reenactment classified and labelled | The six real-media classes already exist in the Stage 12 review; the character class is new | `CharacterSceneManifest.ts` |
| Stick-figure engine, nine parts | Built | `src/lib/character/` |
| Reuse the motion plan and FFmpeg; no heavy framework | Kept | `CameraBeat.ts` maps to the motion plan's own motion types |
| Media sourcing rules (Wikimedia, no scraping, unknown rights blocked, NC blocked) | Already in place | `MediaRightsPolicy`, `WikimediaCommonsClient`, Stage 12 `RIGHTS_UNKNOWN` / `RIGHTS_RESTRICTED` blockers |
| Openverse and Pexels adapters | Not built | See below |
| Voice: Piper stays; a new voice only after a Stage 15E bake-off | Already in place; nothing changed | `AUDIO_PROVIDER=piper`, lifecycle registry |
| Music and SFX: local first, licence and attribution, ducking, loudness | Already in place as code; not re-verified by a run in this stage | `MusicLibrary`, `AudioMusicSelection`, sidechain ducking in `FFmpegVideoAssemblyProvider`; loudness is named in the Brain render probe and quality model |

## 15J.0 — what already existed

- The Stage 12 review reports, per scene: chronology break, missing transition, beat order, adjacent repetition, missing factual source, an unlabelled synthetic image, a still held too long, and the rights findings. It works on scenes and their media.
- `MediaRightsPolicy` classifies a licence as public domain, open, restricted or unknown, and only the first two and an explicit verification are admissible. Non-commercial and no-derivatives licences are restricted.
- A local music and SFX library with licence sidecars, selection through the rights policy, and ducking in the assembly filter graph.
- A local image provider that draws a placeholder with FFmpeg filters. No SVG and no character drawing existed.
- `research.json` holds lists of strings (timeline, characters, locations, key events, sources). It has no claims, no certainty and no claim-to-scene mapping.
- The image library `sharp` is installed with the framework (lockfile, version 0.34.5). It can turn SVG into PNG. Whether the configured FFmpeg can read SVG was not probed.

## Design

### Fact pack

A pack is a topic, sources (primary or secondary, with a reference) and claims. A claim has a statement, its dates, people and locations, a certainty (`ESTABLISHED`, `PROBABLE`, `DISPUTED`, `LEGENDARY`, `UNKNOWN`), the sources it rests on and the scenes that narrate it. `validateHistoricalFactPack` names every problem and repairs nothing.

A claim may be narrated only with a source that is in the pack. A disputed or legendary claim is supported only as what it is. A claim of unknown certainty is unsupported whatever it cites.

`checkNarrationEvidence` reads each stretch of narration against the claims mapped to its scenes:

- a mapped claim that is unsupported: blocker;
- a year in the narration that no supported claim holds: blocker; a year held by a claim mapped to another scene: review;
- a disputed or legendary claim narrated without a word that says so: major;
- a name the pack does not know: review.

It is a text check. It finds years as three- and four-digit numbers that are not counts, and names as capitalized words that do not open a sentence. It over-reports names and cannot see a claim stated without a year or a name.

### Narrative contract

Eight beats in order. Units carry their beat, narration, length, year, transition, the claims they state, the setups they open and pay off, and how long they sit on a still image. A unit without a declared beat is reported and is not assigned one.

The seven checks: repeated fact (a claim stated twice, or a sentence said twice); long exposition (more time on context than on escalation and turning point together); unresolved setup (and a payoff with no setup); chronology break (unless the unit says it leaves the timeline); abrupt transition (a step over a beat with nothing said about it); unsupported dramatic claim (a superlative in a unit with no supported claim; a blocker when a fact pack is given); excessive static visual time (more than 25 seconds on one still image, or more of the story still than moving).

Numbers: the 10–15 minute target is the design's; 25 seconds is Stage 12's existing limit. The other rules are relative and invent no threshold. All of it is advisory.

### Character engine

Nine modules, the design's nine names. One rig of plain bone lengths; ten poses as joint angles; six expressions; eight costume hints; seven hand props and eight stage props; six backdrops at three times of day; five camera beats.

`renderCharacterSceneSvg` draws one 1920×1080 SVG from lines, circles, polygons and text. No image file, no font file, no external reference. The same blocking gives the same bytes. A blocking is a closed vocabulary with bounded sizes; one with a problem is refused, never drawn as far as it goes. A caption is written as escaped text.

`buildCharacterScene` returns the SVG and a manifest. The manifest fixes what a character scene is: media class `LOCAL_CHARACTER_REENACTMENT`, origin `GENERATED`, synthetic, evidence value `NONE`, zero cost, no third-party media. These are not options of the request. A documentary scene always carries a visible label in the image (`CANLANDIRMA` or `REENACTMENT`); a general scene carries it as soon as it has a caption or illustrates a claim. `verifyCharacterScene` refuses a manifest edited to say otherwise, an image that is not the one the blocking draws, and an unlabelled documentary scene.

A costume hint says what kind of figure this is. It is not a depiction of historical dress.

`rasterizeCharacterSceneSvg` turns the SVG into a PNG with the already-installed `sharp`. It accepts only an SVG of the renderer's own shape and refuses anything that could reach outside the document. Without the library it answers `RASTERIZER_UNAVAILABLE`; nothing else is tried.

`scripts/ayas-character-scene.ts` draws one scene from a request file, for the operator. It writes new files only.

## What is not built, and why

- **Nothing is wired into the pipeline.** The research stage does not produce a fact pack, the script stage does not run the narration check, and the visuals stage does not use the character engine. Each of those changes what a real production makes, and whether the result is good can only be judged in a real production run, which is the owner's. The contracts and the engine are ready for that wiring.
- **No Openverse or Pexels adapter.** Each needs a review of its current API terms and a network call to prove. The Wikimedia path remains the only real-media source.
- **`sharp` is used as it is installed, as an optional dependency of the framework.** It is not declared in `package.json`. Declaring it is a dependency change and the owner's decision.
- **Text in the image is drawn with the host's default sans-serif font** when the SVG is rasterized. The SVG bytes are the same everywhere; the PNG's letter shapes can differ between machines.
- **No animation inside a scene.** A character scene is one still image; its movement is the motion plan's pan or zoom.

## Verification

- `scripts/smoke-ayas-historical-storytelling.ts`: 14 scenarios on fixture data. The design's own lists are read out of the master order and compared.
- `scripts/smoke-ayas-historical-storytelling-mutations.ts`: 47 of 47 negative controls caught, in a TEMP overlay.
- Two sample scenes were rendered and looked at during the work (not kept in the repository). One fault was found that way and fixed: with the sea backdrop, figures stood on water.
- Rasterization was measured on this workstation with `sharp` 0.34.5: a 1920×1080 PNG.
- Eval manifest `15F.4-v13`: 82 suites (two added); v12 kept.
