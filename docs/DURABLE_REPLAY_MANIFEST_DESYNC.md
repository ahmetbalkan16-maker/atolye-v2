# Durable replay / project-manifest desync guard

## Incident

`fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...`
(8/12 stages completed research through assembly) got stuck resuming the
`thumbnail` stage: `resumeAndFinalize()` ran for 55+ minutes at ~96-97% CPU
with zero network activity and zero persisted progress, repeatedly
acquiring and releasing the same `${slug}-thumbnail` process-local mutation
lock (new `ownerNonce`/`acquiredAt` each time, same PID).

## Root cause

Two independent state machines exist for a pipeline stage's execution:

1. **Durable execution state** (`production-execution/{idempotency,attempts,
   claims,reservations}/`) -- advanced by `ProductionExecutionWorkerExecutionService`
   / `ProductionPipelineTerminalSettlement`. An attempt here can reach
   `state: "succeeded"` purely from the durable layer's own bookkeeping.
2. **Project-level manifest/job state** (`manifest.json`, `pipeline-jobs.json`)
   -- advanced by `PipelineRunner.runStageLegacy`'s success path
   (`PipelineJobManager.persistStageSuccess` / `ProjectManager.updatePackageStatus`),
   which only runs *inside* the real stage handler.

`ProductionExecutionWorkerExecutionService.execute()`
(`src/lib/production/ProductionExecutionWorker.ts`) checks whether the durable
attempt for the current deterministic identity is already terminal
*before* ever calling the handler, and if so, replays it
(`WORKER_EXECUTION_REPLAYED`) -- by design, so a crash-recovered resume never
repeats real side effects (a second OpenAI call, a second file write, ...).

If a process crashes in the narrow window *after* the durable layer commits
`state: "succeeded"` but *before* `runStageLegacy`'s manifest/job commit
runs, every later resume:

- recomputes the exact same deterministic `(projectSlug, stage, attemptNumber)`
  identity (attemptNumber is derived from `job.attempts`, which never
  advanced),
- finds the same already-`"succeeded"` durable record,
- replays it -- **without ever calling the real handler**, so the project-level
  job never leaves `"queued"`,
- and `PipelineQueueScheduler.getNextRunnableStage()` re-selects the exact
  same stage on every iteration of `PipelineRunner.runScheduledStages()`'s
  `while (true)` loop.

The result: a CPU-bound, network-free, write-free infinite loop with no
persisted error anywhere -- exactly the incident's observed signature. The
production project's actual durable record for `thumbnail` (attempt 1) was
dated `2026-08-18T19:32:39Z`, ten days before the stuck resume attempt.

## The fix

`prepareProductionPipelineExecution` (`src/lib/production/
ProductionPipelineExecutionFactory.ts`) now detects this exact, narrow
signature right after computing `terminalReplay`:

```
terminalReplay === true            // durable record already succeeded + lease released
&& !context.regeneration           // not an explicit, intentional regeneration request
&& !retryAdmission                 // not an explicit, already-vetted retry-admission flow
&& job.attempts === 0              // the project has never even attempted this stage
&& job.status !== "completed"      // ...and does not believe it's done
```

and fails closed with `PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC`
(`durableReplayManifestDesyncCode`) instead of silently replaying.

`PipelineRunner.runStage` catches exactly this reason code (only this one --
every other error keeps its existing behavior unchanged) and persists it as
a normal stage failure via `PipelineJobManager.startStage` +
`persistStageFailure`, the same way `runStageLegacy` would have. This
matters because the throw happens *before* `runStageLegacy` is ever reached
(replay short-circuits ahead of the handler), so without this catch the
failure would never reach `pipeline-jobs.json`/`manifest.json` at all.

No new retry/backoff mechanism was added. Once the job is persisted
`"failed"` with `attempts: 1`, the *existing* retry-budget/admission path
(`prepareFailedStageRetry`) naturally advances the job's attempt counter on
the next resume, which computes a *fresh* durable attempt ordinal that no
longer collides with the stale `"succeeded"` record -- the real handler
runs for real. See `scripts/smoke-durable-replay-manifest-desync-guard.ts`
for an end-to-end proof of both the fail-closed guard and this recovery
path, driven through the real `PipelineRunner.resume()` entry point.
