# Stage 15J — closure

2026-10-02. Source `4e458f41a2a50cdd6daac795109b1a97f26f6edd`. State: **CLOSED GREEN as contracts and a local engine. Nothing is wired into the production pipeline yet.** Notes: `IMPLEMENTATION_NOTES.md`. Summary: `15J_RESULT.json`.

## What exists

- **Historical fact pack.** Claims with their dates, people, places, certainty, sources and the scenes that narrate them. A check reads narration against the mapped claims: an unsupported claim, or a year no supported claim holds, is a blocker; a legend told as fact is reported; an unknown name is reported for review.
- **Narrative contract.** Eight beats in order and the seven checks of the design, on top of the scene-level review that Stage 12 already does.
- **Character scene engine.** The nine parts of the design. It draws one deterministic 1920×1080 SVG from primitives: ten poses, six expressions, eight costume hints, fifteen props, six backdrops at three times of day. No image generation, no model, no network, no cost.
- **What a character scene is, fixed in its manifest.** Synthetic, a reenactment, evidence of nothing, and in a documentary always labelled in the image itself. A manifest edited to say otherwise is refused.
- **A rasterizer** that turns the SVG into the PNG the FFmpeg scene pipeline reads, using the image library that is already installed, and an operator script that draws one scene.

## What it does not do yet

Nothing in the pipeline calls any of this. The research stage does not produce a fact pack, the script stage does not run the narration check, and the visuals stage does not draw character scenes. Wiring each of them changes what a real production makes, and whether the result is good can only be judged in a real production run. That run is the owner's; none was made here.

So today the owner can draw a character scene by hand with the operator script and check a fact pack and a story in code. A production still renders exactly as before.

## Every canonical item

Eleven items; the table is in `IMPLEMENTATION_NOTES.md`. Four are new code, six were already in place (media rights rules, the Wikimedia path, Piper, the music and SFX library with licences and ducking, the motion plan and FFmpeg reuse), and one is not built: the Openverse and Pexels adapters.

## Not built, and who decides

| Not built | Why | Who |
|---|---|---|
| Pipeline wiring (fact pack from research, narration check in script, character scenes in visuals) | Changes what a real production makes; quality needs a real run | The owner starts that run |
| Openverse and Pexels adapters | Each needs a terms review and a network call to prove | A later reviewed adapter |
| `sharp` as a declared dependency | It is used as installed with the framework | The owner, if it should be declared |

## Tests

14 scenarios, 47 of 47 negative controls in a TEMP overlay, and the declared 82-suite baseline at the commit with no failure (cognitive 54/55 and held-out 4/5 unchanged). Two sample scenes were rendered and looked at; one fault was found that way (figures standing on water with the sea backdrop) and fixed. Rasterization was measured on this workstation. No provider call, model or push.

## Known limits

- The narration check is a text check. It sees years, capitalized names and the claims the pack maps. It over-reports names and cannot see a claim stated without a year or a name.
- The narrative checks need declared beats, setups and static times. A script that declares none gets "not declared" findings, not a pass.
- The drawings are simple. A costume hint says what kind of figure this is; it is not a depiction of historical dress.
- Text in a rasterized image uses the host's default sans-serif font, so letter shapes can differ between machines. The SVG bytes do not.
- A character scene is one still image; its movement is the motion plan's pan or zoom.

## Owner actions (none blocks the master order)

Decide when to wire the fact pack and the character scenes into a production, and look at a scene drawn by `scripts/ayas-character-scene.ts` before that.

## Next

Canonical Stage 15K — Production Cost Governor.
