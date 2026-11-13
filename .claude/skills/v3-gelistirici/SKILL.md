---
name: v3-gelistirici
description: How to change Atölye V3 (the stick-figure history video studio) code — where things live, the house style, how a change is proven with a smoke scenario, and the traps of this machine (Turkish İ, Unicode paths, the GPU stop, the live server's import firewall). Load before writing or reviewing any change under src/lib/v3, scripts/v3, remotion-v3/src or content/v3.
---

# Atölye V3 — developer's guide

The studio turns one topic into an animated history video (OverSimplified-like, American English by default):
research → script (`script/ScriptEngine`, `ScriptPrompts`) → episode JSON (`episode/EpisodeTypes`, validated by
`EpisodeValidator`) → scenes and maps (`director/Director`, `maps/MapBuilder`) → voices (`tts/`), lip sync (`lipsync/`),
music and effects (`mix/`) → Remotion render (`render/`, `remotion-v3/src`) → quality brains and retouch rounds
(`council/`) → YouTube package (`thumbnail/`, `publish/`). Orders come from AYAS (`orders/ProductionOrders`), the order
watcher is `scripts/v3/yapim.ts`, one production is `scripts/atolye-v3.ts`. Status and decisions: `docs/v3/FAZ_RAPORLARI.md`.

## Where a change goes

- `src/lib/v3/<area>/` — all logic. Pure functions (decide, score, build text) are kept apart from the code that
  starts processes or calls models, so they can be tested without either.
- `scripts/v3/*.ts` — command lines only: parse arguments, call `src/lib/v3`, print Turkish lines.
- `remotion-v3/src/` — the renderer, its own npm package (React 19, Remotion 4). The root `tsconfig.json` excludes it:
  prove a change there with `node remotion-v3/node_modules/typescript/bin/tsc --noEmit -p remotion-v3`.
- `content/v3/*.json` — studio data (owner rules, searches, channel goals). Data the studio writes at run time lives
  under the runtime root (`resolveV3Paths().workRoot`, `_kutuphane/...`), never in the repo.
- Allowed for the unattended developer: `src/lib/v3/`, `scripts/v3/`, `scripts/smoke-v3-*.ts`, `remotion-v3/src/`,
  `content/v3/`, `docs/v3/`. Never `package.json`, lock files, `.env*`, `app/`, `src/lib/ayas/`, or
  `src/lib/v3/council/BrainCouncilFeed.ts` (it feeds AYAS's homepage; only the owner changes the homepage).

## The close battle map (any battle, anywhere)

Built 12 Nov 2026 for the owner's "more realistic close battles, bigger-looking armies"; every battle uses it from the
writer's data alone, so improve these files rather than adding a second path:
- Writer data → map: `src/lib/v3/maps/Tactics.ts` (orders of battle, moves), `NarratedMoves.ts` (each move on the word that
  names the unit), `MapBuilder.ts` (`buildGeoMap`; `fitLossDelaysS` keeps a fight's falls inside its scene — the Mixer
  uses the same function so every sword lands on a fall).
- Units: `remotion-v3/src/scene/MapUnits.tsx` (`placeTokens` = positions and motion — never change it for looks; the
  meter `scripts/v3/hareket-olcer.ts` must stay ≤ 28.6 px/frame on Cannae), `unitCrowd.ts` (soldiers inside a block,
  density from the strength label, per-block facing), archer volleys `volleysAt`, the fallen `lostTokens`/`fallenRest`.
- Ground: `scripts/v3/terrain_close.py` bakes the painted relief once per place (bump `Relief.CLOSE_RELIEF_VERSION`
  after a change); `MapCloseGround.tsx` + `mapNature.ts` draw woods, fields, hills, rivers' banks and cloud shadows.
- Anything that moves is a pure function of the frame (Remotion renders frames in any order, in parallel); no per-frame
  blur filters. Proof: `smoke-v3-motion` (J–U), `smoke-v3-episode-director`, `smoke-v3-mix`, and stills from
  `npx tsx scripts/v3/harita-onizleme.ts --bolum <episode.json> --sahne <id> --kare 4,10` looked at before and after.
- Tilted camera (2.5D, on for every close map since 13 Nov 2026; `ATOLYE_V3_EGIK_HARITA=0` at plan time draws it flat,
  bit for bit as before — prove "off" with md5 of stills rendered from HEAD first). Plan: `MapBuilder.closeMapTilt` sets
  `V3GeoMap.tilt` (30°) and a world 1.5× each view (`TILT_WORLD_SPAN`; coast, rivers, relief and castles ask the same
  switch). Geometry: `remotion-v3/src/scene/tilt.ts` — `tiltAt` frames each camera key's action (`tiltItems`: blocks,
  speaking badges, battles and their names) so the armies look at least as large as flat, everything kept stays inside
  the pushed frame (or as near the edge as flat had it) and off the atlas corner, the picture pans if needed, the ground
  never shows past the world; MapView and ShotView's bubbles (`badgeAnchor`) must ask the same `tiltAt`. Upright things
  (names, badges, flags, swords, unit labels) go through `U(x, y, node)` with `node` in absolute world px — never inside a
  translated group (the swords landed off their place) — at `uprightScale` (≤ 1); label avoidance stays in world px but
  every upright box is its flat box × `tiltRoom` (taller up the far ground), placeCloseLabels' screen offsets go through
  `spotAt`, and edge slides use the row's own strip (`viewAt`). The upright layer draws only upright things (`layer`
  props of CloseGround, UnitTokens, MapMarks; `G()` in MapView) — ground drawn twice cost +45 %. A coast assembled for a
  bigger box must drop stray coast pieces (CloseCoast `assembleLand`, `COAST_VERSION`); a flat map keeps its library coast.
  Proof: `smoke-v3-motion` T–U, `smoke-v3-episode-director` (tilt and coast scenarios), stills flat vs tilted measured
  with token boxes, and `--dikey` once (a Short is the 16:9 turned 90°).
- Period photos move only as one flat picture (Ken Burns); the depth warp is off (`ATOLYE_V3_DERINLIK=1` to try).

## House style (match the file you are in)

- TypeScript, strict. Code, identifiers and comments in English; every log line and text for the owner in Turkish;
  data keys are often Turkish (`durum`, `baslik`, `neden`, `kaynak`, `sure`).
- Exported functions and interfaces carry a doc comment saying WHY (the owner's words and date when a rule came from
  the owner: `owner, 3 Nov 2026: "..."`). No comment that only repeats the code.
- Small, backward-compatible changes inside existing modules; a new optional field rather than a changed one; no new
  npm package; no refactor that was not asked for.
- Files are written atomically (`${file}.tmp` then `fs.rename`). JSONL stores append one JSON per line.
- Money: model calls go through `V3Budget.generate(step, choice, prompt, { maxTokens })` with a cap; models come from
  `council/BrainModels.brainBudget` (gpt-4.1 / gpt-4.1-mini when OpenAI is chosen, gemma4 on Ollama otherwise).
- GPU: one shared stop `A2000_GPU_HARD_STOP_C` (85 °C). Local GPU work waits through `util/Gpu`
  (`waitForCoolGpu`, `coolGpuProvider`); never hard-code a temperature.

## Prove it: smoke scenarios

There is no jest/vitest. Each area has `scripts/smoke-v3-<area>.ts`: `node:assert/strict`, a local
`scenario(name, fn)` helper, temp folders from `mkdtempSync(path.join(os.tmpdir(), "v3-..."))`, fake models
(`new V3Budget({ providers: { mock: { generate: async (prompt) => ({ content, finishReason: "stop", refused: false,
complete: true, truncated: false }) } }, capUsd: 0 })` with `{ provider: "mock" }`), no network, and it ends with
`console.log(\`PASS (${scenarios} scenarios)\`)`. Add a new scenario (or extend the closest one) that fails without
your change. Run: `npx tsc --noEmit`, `npx tsx scripts/smoke-v3-<area>.ts`, and `node scripts/lint-yerel.mjs`
(never `npm run lint` on this machine).

## Traps of this machine

- The repo lives under `D:\ÜRETİM`. `"ÜRETİM".toLowerCase()` becomes a different folder name (dotted i): never
  lower-case a path. Fold Turkish text for comparison the way `taskWords` does (`ı→i`, `İ→I`, NFD, drop marks).
- Python tools and some native ones fail on Unicode paths: they get the ASCII junction `D:\URETIM\...`
  (`paths.asciiTemp`, `ATOLYE_V3_*` settings), not `D:\ÜRETİM`.
- The live AYAS server (app/, src/lib/ayas) imports some V3 modules (BrainsReport, SelfImprovement, DevBrain,
  ProductionOrders). Those must not import `util/Proc`, `ExperienceMemory` or anything that starts processes or
  reaches the network (`scripts/smoke-ayas-action-firewall-closure.ts` checks it). Put such code in a separate module
  used only by the watcher's processes (DevResearch, MeaningCache, ProposalMerge are examples).
- A new store under `data/` must be git-ignored, or the observer sees a dirty tree and pauses.
- Windows paths: compare repo paths with forward slashes (`f.replace(/\\/g, "/")`).

## Teach the brains (every change, no exceptions)

The developer brain reads every commit's code by itself (Git only: files, functions, added code, tests — the
development branch too, before it goes live). What it cannot read from code is *why*, and what the other brains must
do differently. Put that in the commit message as lesson lines — the brains' idle cycle writes each into that brain's
memory once, without a model (`src/lib/v3/council/CommitLessons.ts`):

```
Ders-<beyin>[<konu: a few English words the lesson is about>]: <one English sentence, at most 300 characters>
```

- `kurgu` — the writer/story critic (map data, scene rules, pacing); `arastirma` — facts and sources; `mizah` —
  jokes; `kalite` — what a viewer would see as a fault (the critic; a frame example still needs
  `scripts/v3/kalite-sinavi.ts ogret`); `kostum` — costumes and likeness; `gelistirici` — how such code is written
  here (which file, which function, which smoke). `ses` and `sef` are read by no code: don't use them.
- General, not episode-specific ("a plane route ends where its target ship is drawn"), never a person's private data.
- One line per thing a brain must learn; none when nothing changes for any brain. In an unattended build, end your
  summary with these lines: the summary becomes the commit message.

### Every fix is a whole case (owner's standing order, 13 Nov 2026)

Every fix, improvement or error handled also goes in as a case — what was seen, why, how it was solved and proven, how
to catch it next time — so a brain meeting a similar problem gets the path that worked. Beside the `Ders-` lines:

```
Vaka[<konu: a few English words>]: <symptom: what was seen, where — which video, which scene>
Vaka-neden: <root cause>
Vaka-cozum: <how it was solved: files, functions, data>
Vaka-kanit: <how it was proven: smoke scenario, stills, a rerun>
Vaka-yakala: <how to catch it next time>
Vaka-beyin: <comma list of the brains above it concerns; none: gelistirici>
Vaka-bolum: <video id, optional>
```

- English, each field one line of at most ~600 characters (an editor-wrapped line continues the field above; a blank
  line ends it). Several `Vaka[...]` blocks per commit are fine; each opens a new case.
- The idle cycle ("ogren", `CommitLessons.learnCommitLessons`) records each into the case library
  (`DevBrain` `vakalar.jsonl`, under the developer brain's folder) once, with the commit's sha, date and changed files.
  A `fix(...)` commit without a block still leaves a case derived from its subject and body (marked `turetilmis`) —
  a fallback, not a substitute: write the block.
- A fix with no commit (a patched episode, a stopped and resumed order) is recorded by hand:
  `npx tsx scripts/v3/vaka.ts ekle --konu … --belirti … --neden … --cozum … --kanit … --yakala … --beyin kurgu,kalite
  [--bolum <video id>] [--dosya a,b]`; `liste` and `ara "<problem>"` look the library up.
- Used automatically, without a model (`DevBrain.similarCases`, word overlap): a development job's packet carries the
  nearest 3 (`DevQueue.pastCasesSection`), and the repair brain's prompt the nearest 3 for a failed step's error
  (`RepairContext.vakalar`). Write the symptom and the cause in the words the next error or fault will use.

## Before you finish

Summarise in Turkish what changed, in which files, and how it was tested, followed by the `Ders-…` lines and, for a
fix, the `Vaka` block above. Keep
the change to the task.
