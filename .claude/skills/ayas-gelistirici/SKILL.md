---
name: ayas-gelistirici
description: How to change main AYAS code (the owner's assistant — its chat, Brain console pages, Gelişim Merkezi, components and src/lib/ayas) safely — where things live, what may never be changed, how a change is proven with a smoke scenario, and the traps of this machine (Turkish İ, Unicode paths, eval pins, the action firewall, the homepage rule). Load before writing or reviewing any change under src/lib/ayas, src/lib/brain, src/components or app/, and always for a main-AYAS development-queue job.
---

# AYAS — developer's guide

AYAS is the owner's personal assistant on top of the Atölye studio: a Next.js App Router app (`app/`) whose Brain
console (`app/brain/`, `src/components/brain/`) holds the chat, the Control Center, the Gelişim Merkezi and the research
tabs. Logic lives in `src/lib/ayas/` (chat, intents, memory, reasoning, research, model routing…) and
`src/lib/brain/` (stores, self-improvement, self-heal, UI view models). The V3 video studio is `src/lib/v3/` (see the
`v3-gelistirici` skill). Status and the reasons behind every design: the newest entries of `ATOLYE_CHECKPOINT.md`
(`grep -n "^## " ATOLYE_CHECKPOINT.md`), `docs/`, `ARCHITECTURE_DECISIONS.md`.

You are usually running as AYAS's unattended developer (the development queue, owner decision 2026-11-09): your
change is checked, then shown to the owner, who applies it with one click ("ONAYLA VE UYGULA"). The observer then
commits it, pushes it and takes it live. So the change must be complete, small and correct on its own.

## What you may never change (the code lane throws the whole build away)

The rules live in `src/lib/brain/autonomy/AyasCodeChangeLane.ts` (`ayasCodeLaneRefusals`), on top of the self-healing
classifier `src/lib/brain/selfheal/BrainPatchSafety.ts`. In short:

- anything outside `src/`, `app/`, `scripts/`, `docs/`, `content/v3/`, `remotion-v3/src/` — so never `package.json`,
  lock files, `.env*`, `.gitignore`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, configs;
- the homepage: `src/components/homepage/`, `src/components/workspace/`, `app/page.tsx`, `app/layout.tsx`,
  `app/globals.css`, `AyasConsolePage.tsx`, `BrainCoreConsole.tsx`, `BrainConsoleView.tsx`,
  `src/lib/v3/council/BrainCouncilFeed.ts`, `docs/AYAS_HOMEPAGE_POLICY.md`. A new feature goes on a subpage or tab
  (a Brain console panel, the Gelişim Merkezi), never onto the homepage;
- the authority and publication machinery: `src/lib/brain/autonomy/` (all of it), `src/lib/brain/security/`, the
  self-heal kernel files, `src/lib/ayas/{execution,governance,safety,policy,machine,revenue,briefing,migration,trust,
  golden,audit,continuous}/`, `scripts/ayas-*` operator scripts, every `.ps1/.vbs/.mjs` script;
- the production layers: `src/lib/production/`, `src/lib/pipeline/`, `src/lib/runtime/`, `src/lib/storage/`;
- the yardstick: the golden vault and every eval-pinned suite (`src/lib/ayas/observability/AyasEvalPinnedFiles.ts`
  lists them; `docs/ayas-execution/**/EVAL_MANIFEST.json` pins their hashes) — an improvement may not rewrite what it
  is measured with. Need a new scenario next to a pinned suite? Write a new `scripts/smoke-<area>-<topic>.ts`;
- the development queue itself (`src/lib/v3/council/{Developer,DevQueue,DevResearch,DevWriter,DevApprentice,DevSkills,
  DevBrain,SelfImprovement}.ts`, `scripts/v3/{gelistirici,cirak-yaz,gelisim,yapim}.ts`).

REVIEW_REQUIRED areas (the chat path in `src/lib/ayas/`, `app/api/**/route.ts`, `app/brain/actions.ts`) are allowed: the
owner's click on your tested change is their review. Be extra careful there.

## Where a change goes

- Business logic in `src/lib/...` (services, view models, pure decisions). API routes and server actions only parse
  input, call `src/lib` and shape the result; components only render.
- Pure functions (decide, score, build text) apart from code that starts processes or calls models, so a smoke can
  test them without either.
- Server actions live in `app/brain/actions.ts` (`"use server"`), always behind `requireBrainSession()`; an action that
  approves or publishes anything needs an owner admission (`requireOwnerApprovalAdmission`) — do not add such actions,
  that is the autonomy machinery's job.
- A client component may import server actions directly with `../../../app/brain/actions` (see
  `AyasGoalResearchPanel.tsx`); do not thread new props through the homepage files.
- Runtime state already has stores (`data/brain/...`, the V3 runtime root). Do not create a new store: it would need a
  `.gitignore` line you may not write, and an unignored store silently stops the observer (dirty tree).

## House style (match the file you are in)

- TypeScript strict. Code, identifiers and comments in English; every text the owner reads in Turkish, plain and short.
- Exported functions carry a doc comment saying WHY (the owner's words and date when a rule came from the owner:
  `owner decision 2026-11-09: "..."`). No comment that only repeats the code.
- Small, backward-compatible changes in existing modules; a new optional field rather than a changed one; no new npm
  package; no refactor that was not asked for; never break a working feature.
- Files are written atomically (temp file, then rename). Fail closed: an unreadable record is a refusal, not "empty".
- AYAS is zero-cost by policy: the chat runs on the local Ollama model; never route anything to a paid API.

## Proving a change

- Smoke suites are plain scripts: `npx tsx scripts/smoke-<name>.ts`, `node:assert/strict`, a scenario counter, exit
  code 0 = pass, `PASS (N scenarios)` printed. Find a file's suites with `grep -l "<FileName>" scripts/smoke-*.ts`
  (load the `ayas/tests` skill for the details).
- Add or extend a scenario for what you changed; run `npx tsc --noEmit`, `node scripts/lint-yerel.mjs` (never
  `npm run lint` here: the "İ" in D:\ÜRETİM breaks ESLint's ignores) and the suites you touched.
- Every main-AYAS build also runs `scripts/smoke-ayas-action-firewall-closure.ts`: a module that spawns a process or
  calls `fetch` and becomes reachable from a mapped surface (the server actions, the executor, the chat route…) fails
  it, and you may not edit that pinned suite. Keep new code free of `child_process`/`fetch`, or reuse an existing
  mapped module.
- A UI change: load the `ayas-ui-audit` skill and run its audit on the routes you touched
  (`node .claude/skills/ayas-ui-audit/scripts/run-audit.mjs --routes '["/brain?panel=development"]'`); it starts its own
  throwaway server and never touches the live app.
- Anything a `scripts/*.ts` file reaches must use relative imports (`@/` fails outside Next's bundler).
- Tests never use the network, a paid model, the live app (port 3000) or the live checkout
  `D:\ÜRETİM\Atolye\atolye-v2`; they create temp roots under `os.tmpdir()` and remove them.

## This machine's traps

- Turkish İ: `"D:\\ÜRETİM".toLowerCase()` gives two characters for "İ" and opens a twin folder. Never lower-case a path;
  compare paths with `path.resolve`.
- TEMP is `D:\ÜRETİM\private\temp` (owner rule). STT/wake/Piper suites need the ASCII junction `D:\URETIM\...` and may
  fail in a sandbox; the queue reruns a failing suite on the untouched base and does not count it against you if it
  fails there too — but a suite you changed always counts.
- `scripts/smoke-ayas-observer-autostart.ts` registers a real Windows scheduled task: never run it.
- PowerShell `.ps1` files with non-ASCII text need a UTF-8 BOM (you may not change them anyway).

## Finish

End with a short Turkish summary for the owner: what you changed, in which files, how you tested it. If AYAS already
does it, or it cannot be done inside these limits, change nothing and say why — an empty build is a fine answer.
