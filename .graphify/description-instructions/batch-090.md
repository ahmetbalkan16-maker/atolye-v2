# Node Description Batch 91 of 166

Graphify is running in assistant/skill mode (no API key). You are the host
assistant (Claude Code / Codex / Gemini CLI). Read the prompt below and write
your JSON answer to the answer file.

## Prompt

You are documenting nodes in a knowledge graph.
For each entry below, write ONE concise factual plain-language sentence
describing what it is or does. Use only the provided context.
For a code symbol (kind=code-symbol — a function, class, or constant),
describe what the function/symbol does based on its name, source location
and neighbors — e.g. "Resolves the configured ontology profile from graphify.yaml.".
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "pipeline_pipelinejobmanager_pipelinejobmanager_listjobsreadonly": ".listJobsReadOnly()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L88 | neighbors=[PipelineJobManager, .readJobList()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_persistprojectcompletion": ".persistProjectCompletion()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L340 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_persiststagefailure": ".persistStageFailure()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L304 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_persiststagesuccess": ".persistStageSuccess()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L233 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_preparejobretry": ".prepareJobRetry()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L131 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_retryjob": ".retryJob()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L442 | neighbors=[PipelineJobManager, .prepareJobRetryUnderLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_startstage": ".startStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L268 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmutationlock_assertcanonicalpipelinejobmutationlock": "assertCanonicalPipelineJobMutationLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L184 | neighbors=[PipelineJobManager.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_assertnestedscope": "assertNestedScope()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L539 | neighbors=[PipelineJobMutationLock.ts, withCanonicalPipelineJobMutationLock()]
- "pipeline_pipelinejobmutationlock_canonicalfilesystemmutationtestevent": "CanonicalFilesystemMutationTestEvent" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L56 | neighbors=[sprint-129-33-path-race-child.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_hascanonicalpipelinejobmutationlock": "hasCanonicalPipelineJobMutationLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L190 | neighbors=[PipelineJobManager.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_installcanonicalfilesystemmutationtesthook": "installCanonicalFilesystemMutationTestHook()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L121 | neighbors=[sprint-129-33-path-race-child.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_installcanonicalmutationbarriertesthook": "installCanonicalMutationBarrierTestHook()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L93 | neighbors=[sprint-129-33-path-race-child.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_installcanonicalmutationinvocationtesthook": "installCanonicalMutationInvocationTestHook()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L106 | neighbors=[PipelineJobMutationLock.ts, smoke-sprint-129-33-exhausted-retry-adm…]
- "pipeline_pipelinejobmutationlock_installcanonicalreleasefailuretesthook": "installCanonicalReleaseFailureTestHook()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L81 | neighbors=[PipelineJobMutationLock.ts, smoke-sprint-129-33-exhausted-retry-adm…]
- "pipeline_pipelinejobmutationlock_installcanonicalstaleobservationtesthook": "installCanonicalStaleObservationTestHook()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L70 | neighbors=[sprint-129-33-pipeline-job-lock-child.ts, PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_isalreadyexists": "isAlreadyExists()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L818 | neighbors=[PipelineJobMutationLock.ts, withAcquisitionGate()]
- "pipeline_pipelinejobmutationlock_ismutationlockbusy": "isMutationLockBusy()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L194 | neighbors=[PipelineJobMutationLock.ts, withCanonicalPipelineJobMutationLock()]
- "pipeline_pipelinejobmutationlock_matchesquarantinedproof": "matchesQuarantinedProof()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L714 | neighbors=[PipelineJobMutationLock.ts, quarantineAndRemove()]
- "pipeline_pipelinejobmutationlock_syncdirectory": "syncDirectory()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L534 | neighbors=[PipelineJobMutationLock.ts, publishOwnedLock()]
- "pipeline_pipelinerecoveryplanner_getstagesfrom": "getStagesFrom()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L335 | neighbors=[PipelineRecoveryPlanner.ts, .createResumePlan()]
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner_getnextincompletestage": ".getNextIncompleteStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L65 | neighbors=[PipelineRecoveryPlanner, getNextIncompleteOrUnreadyStage()]
- "pipeline_pipelinerecoveryplanner_readstagedata": "readStageData()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L286 | neighbors=[PipelineRecoveryPlanner.ts, isStageFileReady()]
- "pipeline_pipelineretryadmission_buildidentity": "buildIdentity()" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L175 | neighbors=[PipelineRetryAdmission.ts, assertCanonicalPipelineRetryAdmission()]
- "pipeline_pipelineretryadmission_pipelineretryreconciledlineagebinding": "PipelineRetryReconciledLineageBinding" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L18 | neighbors=[PipelineRetryAdmission.ts, ProductionPipelineRetryReconciliation.ts]
- "pipeline_pipelineretryadmission_runtypefromoperation": "runTypeFromOperation()" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L168 | neighbors=[PipelineRetryAdmission.ts, assertCanonicalPipelineRetryAdmission()]
- "pipeline_pipelinerunner_canonicalerrorcode": "canonicalErrorCode()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1165 | neighbors=[PipelineRunner.ts, .runStageLegacy()]
- "pipeline_pipelinerunner_getretrystagefromjobid": "getRetryStageFromJobId()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1172 | neighbors=[PipelineRunner.ts, .executeJobRetryOnce()]
- "pipeline_pipelinerunner_isprovencontinuationcontenderloss": "isProvenContinuationContenderLoss()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1103 | neighbors=[PipelineRunner.ts, .continueProjectOnce()]
- "pipeline_pipelinerunner_parseconsumedretrybudgetauthorityid": "parseConsumedRetryBudgetAuthorityId()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L84 | neighbors=[PipelineRunner.ts, .resumeOnce()]
- "pipeline_pipelinerunner_pipelinecontinuationresult": "PipelineContinuationResult" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1135 | neighbors=[PipelineRunner.ts, smoke-pipeline-retry-continuation-harde…]
- "pipeline_pipelinerunner_pipelinerunner_dispatchprojectcontinuationonce": ".dispatchProjectContinuationOnce()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L487 | neighbors=[PipelineRunner, .continueProject()]
- "pipeline_pipelinerunner_pipelinerunner_isstagecompleted": ".isStageCompleted()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1069 | neighbors=[PipelineRunner, .resumeOnce()]
- "pipeline_pipelinerunner_pipelinerunner_resume": ".resume()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L205 | neighbors=[PipelineRunner, .withRuntimeOperation()]
- "pipeline_pipelinerunner_pipelinerunner_retrystage": ".retryStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L418 | neighbors=[PipelineRunner, .withRuntimeOperation()]
- "pipeline_pipelinerunner_pipelinerunner_retrystageonce": ".retryStageOnce()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L428 | neighbors=[PipelineRunner, .executeJobRetry()]
- "pipeline_pipelinerunner_pipelinerunner_run": ".run()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L141 | neighbors=[PipelineRunner, .withRuntimeOperation()]
- "pipeline_pipelinerunner_pipelinerunner_runonce": ".runOnce()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L151 | neighbors=[PipelineRunner, .runScheduledStages()]
- "pipeline_pipelinerunner_pipelinerunner_runstage": ".runStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L962 | neighbors=[PipelineRunner, .runPipelineStage()]
- "pipeline_pipelinerunner_pipelinerunner_runstagelegacy": ".runStageLegacy()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1005 | neighbors=[PipelineRunner, canonicalErrorCode()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-090.json

Keep each description factual and concise (one sentence). No markdown, no prose
outside the JSON object. It is acceptable to omit a node if context is
insufficient — but include every node you can ground confidently.

Example answer format:
```json
{
  "node_id_1": "Resolves the configured ontology profile from graphify.yaml.",
  "node_id_2": "Colonel James Barclay, an antagonist in The Crooked Man."
}
```
