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

## Before you finish

Summarise in Turkish what changed, in which files, and how it was tested, followed by the `Ders-…` lines above. Keep
the change to the task.
