# Stage 15L — Autonomous Production Fault Repair + Resume

Started from exact repository HEAD `d5efa35b3cfe05e8dffe771120a6403682d8369b` on 2026-10-02. The preceding `b95a71b` source packet and `d5efa35` documentation descendant are complete; neither is repeated. The untracked `AyasProductionFaultRepair.ts` draft was preserved and completed.

Authority: the STAGE 15L sections of `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md` and `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md`; post-freeze sections 0 and 1, with global section 9. The attached addendum and the canonical repository copy have the same SHA-256, `83000846508d32529918b00464c33d6a4fed4f1b1b25a3d67849baa2a584b9fa`. Their design requirements were applied within the owner's current continuation request; external text creates no execution authority.

## Existing seams (15L.0)

- Stage 15I already classifies structured pipeline failures, binds a request and HEAD, holds for code defects, and proposes four safe operations. Its collector returns the underlying facts. Both are reused unchanged.
- `PipelineRetryAdmission` already binds a failed job, its exact durable lineage, attempt ordinal, budget and admission identity before queue mutation. Its base retry limit is 3; extensions need separate owner authority. A repair report does not issue admission proof.
- `PipelineRecoveryPlanner.pipelineStageDependencies` is the dependency authority. `PipelineRunner.resume(projectSlug, { stopAfterStage })` is the existing bounded execution path. The report cannot skip its admission or dependency checks.
- `YouTubePublishPipeline` recognizes a persisted publishing intent and calls `reconcilePublishingIntent` instead of starting another upload. Reconciliation uses the marker and channel binding, accepts only a matched result, and remains indeterminate otherwise. No second uploader or scanner is added.
- The Runtime Stability Guard supervises an operation supplied by the existing authorized caller; it does not approve or dispatch. Reports list it as a required execution seam, never claim it ran.
- AYAS `resume-stage` stays disabled. No browser session executor is introduced; the addendum watchdog remains not applicable until a real executor exists.

## Implementation (15L.1)

`AyasProductionFaultRepair` wraps the existing director with the twelve canonical classes and six repair plans. Transient retries carry an attempt, bound and explicit backoff policy (60 seconds, doubling to 900; rate limits use 900 because Retry-After is not collected). This is a policy, not a measured provider guarantee. Fallback is only the zero-cost alternative already allowed by the collector's policy. Missing/corrupt local packages use the stage's regeneration path; video/assembly use the deterministic rerun plan. Every ordinary repair declares idempotency, bounded stage execution, retry budget and Stability Guard; durable resume and publication reconciliation also declare durable recovery.

Additional refusal checks close gaps in the inherited plan: invalid/missing/duplicate stage inventory, substituted dependency lists, malformed retry/cost numbers, an unready dependency, unreadable rights/quality evidence, exhausted/unknown retry budget on fallback or regeneration, any unverified running owner, contradictory pipeline records, unknown failures, and a publication side effect whose result cannot be proven. Publishing-in-flight permits only the owner's reconciliation plan, never a simultaneous stage resume.

CODE_DEFECT creates a route record with exact HEAD, defect, last complete stage and mandatory sandbox/tests/Graphify/proposal/owner-promotion/resume steps. The production holds. `buildAyasProductionRepairCodingTask` converts that route into the existing Stage 15A task contract only after localization supplies 1–2 exact files and a 1–80 line budget. Task identity is deterministic over the bound route and scope. Nothing is enqueued or promoted.

`scripts/ayas-production-fault-repair.ts --project <slug> [--owner-request file.json]` reads through the existing collector and prints the report. It has no apply option and writes nothing. Storage classification is printed so a legacy repository read is distinguishable from the external live root.

## Boundaries and pending work

All dispatch descriptors have `executableByAyas: false`; the report has authority NONE. No provider, model, container, live stage, upload, source promotion or paid call was started. An execution binding needs the owner's existing write activation and exact operation authority. A report is not execution evidence. Numeric retry extensions stay the owner's; the report uses the base limit conservatively.

## Validation

Focused suite: 24 scenarios. Negative controls: 24/25 caught; one explicitly equivalent safety mutation (removing the first publish-record admission predicate is still refused by the independent uncertain-record gate). The first audit identified that redundancy and its failed audit was not called GREEN. The first focused run used a nonexistent internal phase in its fixture; it was corrected to the existing `asset-registration` classifier seam without changing production classification.

Eval manifest `15F.4-v15` adds these two suites, now 86 declared suites; v14 is retained byte-for-byte. Complete baseline, TypeScript, lint and Graphify outcomes are recorded in the stage result/evidence when finished. Heavy operations run serially; >=90% RAM blocks admission. Local commits only; NO PUSH.

Final validation: complete v16 baseline, 86 suites, no unexpected failure; cognitive 54/55 and held-out 4/5 unchanged. TypeScript and changed-file lint PASS; full lint 0 errors/13 existing warnings; diff check PASS. Host RAM peak 56.8221%. The bridge fixture fix passed 8/8 standalone trials (12 scenarios each); failed v15 evidence and both grader identities are retained. Precommit Graphify: 17,066 nodes / 48,886 links, all integrity anomalies zero, no uncovered dirty source; PARTIAL 9 known files and semantic pending. Source commit and checkpoint/next-stage closure follow.
