# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project Overview

Atölye V2 is a Turkish-first, AI-powered personal documentary production studio built on Next.js
(App Router). A user submits a single topic; the platform pipelines it through
`research → script → scenes → visuals → animation → audio → assembly → thumbnail → seo → youtube → export`
to produce a publish-ready video. It's designed as a personal, self-hosted "Secure Remote Personal
Studio," not a multi-tenant SaaS product — the user is the director, Atölye is the production crew.
See `ATOLYE_CONTEXT.md`, `VISION.md`, and `PROJECT_PHILOSOPHY.md` for the product framing behind
architectural decisions.

## Commands

- `npm run dev` / `npm run build` / `npm run start` — Next.js dev/build/start.
- `npm run lint` — ESLint. Full-repo lint is expected to pass with 0 warnings before a sprint is
  considered done.
- `npx tsc --noEmit` — required after any change; a change is not considered complete until this
  passes.
- Smoke tests are plain scripts, not a test framework: `npx tsx scripts/smoke-<name>.ts` runs one
  suite and prints e.g. `PASS (N scenarios)` to stdout. There's no jest/vitest — everything is
  `node:assert/strict` driven. There are ~110 `scripts/smoke-*.ts` files, roughly one per
  sprint/feature area. When changing a `src/lib/...` file, `grep` `scripts/` for the filename to
  find its smoke script(s) and any scripts that exercise it transitively, and run those — the
  matching entry in `ATOLYE_CHECKPOINT.md` (see below) usually lists the exact regression set a
  prior sprint validated for that area.
- `npm run production:acceptance:*` (readiness-only, diagnose, reprepare, execute, resume, legacy
  reauthorization, retry-budget extension) — operator CLI for gated durable production execution,
  backed by `scripts/run-production-acceptance.ts`. These touch real durable/production state and
  are not routine dev commands.
- `npm run production:acceptance:regeneration-plan` / `:prepare-regeneration` —
  `scripts/run-production-regeneration.ts`, for regenerating already-completed pipeline stages.
- `npm run runtime:backup:inventory|create|verify|restore-verify` — runtime storage backup tooling
  (`scripts/runtime-backup.ts`).

## Architecture

### Layout

- `app/` — Next.js App Router pages and API routes (`app/api/**/route.ts`). Routes only
  orchestrate: parse the request, call into `src/lib` services, shape the response. Business logic
  does not belong here.
- `src/components/` — UI components (`dashboard/`, `projects/`, `studio/`, `assets/`).
- `src/lib/` — all business logic, organized by pipeline stage/concern (see below).
- `src/types/` — shared types; `src/types/project.ts` defines the canonical `ProductionStepKey` /
  `ProjectStatus` stage enum and the project package manifest shape.
- `data/projects/` — JSON-file-backed project records (one project = one manifest of pipeline
  stage state).
- `scripts/` — smoke tests and operator CLI entry points.
- `docs/` — supplementary notes: `Architecture.md`, `Decisions.md`, `CodingStandards.md`, and deep
  audit docs (`PRODUCTION_STORAGE_RELOCATION_AUDIT.md`, `PRODUCTION_EXECUTION_SAFETY.md`,
  `PRODUCTION_EXECUTION_PHASE_REVIEW.md`).

### Pipeline execution layer (`src/lib/pipeline/`)

The stage order above is centrally defined and must not be reordered or forked into a second
orchestrator:
- `PipelineRunner.ts` — top-level entry for starting/resuming/retrying a project's pipeline.
- `PipelineStageExecutor.ts`, `PipelineQueueScheduler.ts`, `PipelineRecoveryPlanner.ts`,
  `PipelineFailedStageRetry.ts`, `PipelineRetryAdmission.ts` — dispatch, scheduling, crash-recovery
  planning, and retry admission around the fixed stage order. Continuation is bounded and
  non-recursive: one dispatch call advances at most one stage.
- `PipelineJobManager.ts` / `PipelineJobMutationLock.ts` — persisted job/attempt records and
  mutation locking. The lock is **process-local**, not distributed — concurrent multi-process
  writers to the same project are a known open risk, not a solved problem.

### Production execution layer (`src/lib/production/`, ~100 files)

Sits on top of the pipeline as the durable/production-grade execution path: acceptance gating
(`ProductionAcceptance*`), durable claim/lease/attempt/recovery (`ProductionExecutionDurable*`),
the stage dependency graph (`ProductionDependencyGraph.ts`), health/intelligence reporting
(`ProductionHealth*`, `ProductionIntelligence*`), and completed-stage regeneration
(`ProductionCompletedStageRegeneration*`). This is the most heavily audited, fail-closed part of
the codebase (see the ADR-016/017/018 entries in `ARCHITECTURE_DECISIONS.md`) — before modifying
anything here, read the corresponding sprint entry in `ATOLYE_CHECKPOINT.md` for the invariants it
verified.

### Per-stage modules

Each pipeline stage has its own `src/lib/<stage>/` folder, and each generation-capable stage
follows the same provider trio: a `<Stage>Provider` interface, a `Mock<Stage>Provider` (safe
default, deterministic), a real provider (e.g. `OpenAI<Stage>Provider`, `FFmpeg<Stage>Provider`),
and a `<Stage>ProviderRouter`/`ProviderConfig` that resolves which one to use from env. Prompt
construction lives in `<stage>/prompts/`. Stages: `ai/` (research/script/scenes via
`src/lib/ai/steps/`), `visuals/`, `animation/`, `audio/`, `video/` (per-scene video, e.g.
`FFmpegSceneVideoProvider`), `assembly/` (final video assembly, distinct from `video/`),
`thumbnail/`, `seo/`, `youtube/` (package build + `publish/` for the YouTube Data API upload), and
`export/`.

### Provider / AI Router pattern

No stage is hard-wired to one AI vendor. Each capability is selected via an env var
(`AI_PROVIDER`, `IMAGE_PROVIDER`, `ANIMATION_PROVIDER`, `AUDIO_PROVIDER`, `VIDEO_PROVIDER`,
`VIDEO_ASSEMBLY_PROVIDER`, `THUMBNAIL_PROVIDER`, `YOUTUBE_PROVIDER`, ...) and resolved through a
router (`src/lib/ai/router/AIRouter.ts` for text AI; a per-domain `*ProviderRouter.ts` elsewhere)
against a common interface for that domain. A `mock` provider is always the safe default; real
providers require explicit activation and unknown/misconfigured provider names fail closed rather
than silently falling back to mock mid-pipeline.

### Runtime storage & asset model

- `src/lib/runtime/RuntimeStoragePaths.ts` resolves the runtime storage root (`ATOLYE_RUNTIME_ROOT`
  env var, else a legacy in-repo default) into an explicit `RuntimeStorageContext`. Storage
  reads/writes bind to this context rather than assuming an ambient filesystem root — this is what
  lets two runtime roots (e.g. two projects, or a migration source/target) be proven not to
  cross-influence each other.
- `src/lib/storage/FileStorage.ts` and `src/lib/assets/storage/` handle atomic writes (temp file +
  fsync + rename), path containment, and symlink/junction-escape rejection.
- Assets are append-only: regenerating a stage never deletes or overwrites a prior asset in place;
  old assets and their manifest entries are retained.
- Project manifests (`data/projects/*.json`, via `src/lib/projects/ProjectManager.ts` /
  `ProjectReader.ts` / `ProjectWriter.ts`) are the authoritative record of pipeline/production
  state. New pipeline stages should extend the manifest rather than inventing a parallel state
  store.

## Working conventions

This project is developed across many sequential AI sessions under strict, checked-in rules in
`AGENTS.md` (imported above) and `ATOLYE_AI_RULES.md` — the highlights that matter day-to-day:

- Preserve existing architecture; don't introduce a second orchestrator, a second provider-routing
  mechanism, or a parallel storage root alongside an existing one.
- Prefer small, backward-compatible changes over large refactors; don't move files or restructure
  folders without a concrete reason.
- Business logic belongs in `src/lib` (service/manager/pipeline layers), never in API routes or
  components.
- `ATOLYE_CHECKPOINT.md` is the authoritative, continuously updated log of what's actually done, in
  progress, blocked, or risky, prepended with the newest sprint first. It's very large — use
  `grep -n "^## Sprint" ATOLYE_CHECKPOINT.md` or `grep -n "^### Sprint" ATOLYE_CHECKPOINT.md` to
  jump to entries rather than reading it start to end. Check it before assuming a feature is
  unimplemented, and before starting work in `src/lib/production/`.
- Don't `git commit` or `git push` without explicit user approval, even after a change is verified
  — this holds regardless of how confident the change is.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Before modifying or removing a symbol, run `graphify affected "<symbol>" --depth 2` to see what depends on it (reverse traversal over calls/imports/inherits/etc.) — surfaces real fan-in before you touch shared code, especially anything in `src/lib/pipeline/` or `src/lib/production/`.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
