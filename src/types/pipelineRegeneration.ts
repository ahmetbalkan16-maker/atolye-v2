import type { PipelineRecoveryStageKey } from "./pipelineRecovery";

/**
 * Marker-free counterpart to `productionRegeneration.ts`, for projects that were
 * created through the ordinary (non-acceptance-gated) pipeline and therefore never
 * have — and can never legitimately obtain — a `production-acceptance.json` marker
 * (see `ProductionAcceptancePolicy.createProductionAcceptanceMarkerV3Profile2`, which
 * requires the slug to be a deterministic function of a freshly minted `runId` and
 * always `mkdir`s a brand-new project folder — both structurally unsatisfiable for an
 * already-existing, plainly-slugged project).
 *
 * This schema is deliberately a sibling of `ProductionRegenerationPlan`/`Intent`, not a
 * reuse of it: the acceptance-side types carry fields (`acceptanceMarkerFingerprint`,
 * `providerProfileFingerprint`) that only make sense bound to a marker, and the
 * acceptance-side storage directory (`production-regeneration/`) is also consumed by
 * the durable production-execution admission layer
 * (`ProductionCompletedStageRegenerationStore.requireRegenerationExecutionAdmission`),
 * which the plain `PipelineStageExecutor`/`PipelineRunner` dispatch path does not use
 * and must not be made to depend on.
 */
export const pipelineRegenerationSchemaVersion = "pipeline-regeneration-v1" as const;

/**
 * The only `fromStage` values the plain-pipeline regeneration path accepts.
 * `"assembly"` was the original, narrowly-scoped entry point; `"animation"` was added
 * to remediate a real project where `visuals` was regenerated out-of-band (bypassing
 * `PipelineStageExecutor`'s own attempt/history bookkeeping) after `animation`/`video`
 * had already consumed an earlier, narrower snapshot of it — see the corresponding
 * forensic report. Both are deliberate, reviewed extensions; do not widen this list
 * without equivalent scrutiny (each new entry point changes which stages
 * `getProductionRegenerationClosure` invalidates and must be re-verified against
 * `pipelineStageDependencies`).
 */
export const supportedPipelineRegenerationFromStages = ["assembly", "animation"] as const;
export type SupportedPipelineRegenerationFromStage =
  typeof supportedPipelineRegenerationFromStages[number];

export interface PipelineRegenerationFileFingerprint {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface PipelineRegenerationPlan {
  readonly schemaVersion: typeof pipelineRegenerationSchemaVersion;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly fromStage: PipelineRecoveryStageKey;
  readonly currentGeneration: number;
  readonly proposedGeneration: number;
  readonly preservedStages: readonly PipelineRecoveryStageKey[];
  readonly regeneratedStages: readonly PipelineRecoveryStageKey[];
  readonly invalidatedStages: readonly PipelineRecoveryStageKey[];
  readonly effectiveSequence: readonly PipelineRecoveryStageKey[];
  readonly projectAggregateFingerprint: string;
  readonly manifestFingerprint: string;
  readonly jobsFingerprint: string;
  readonly artifactRegistryFingerprint: string;
  readonly audioFingerprint: string;
  readonly runtimeStorageIdentity: string;
  readonly planFingerprint: string;
}

export interface PipelineRegenerationIntent {
  readonly schemaVersion: typeof pipelineRegenerationSchemaVersion;
  readonly regenerationId: string;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly fromStage: PipelineRecoveryStageKey;
  readonly generationOrdinal: number;
  readonly planFingerprint: string;
  readonly reasonCode: string;
  readonly backupId: string;
  readonly backupManifestFingerprint: string;
  readonly exactPrestateFingerprint: string;
  readonly preservedStages: readonly PipelineRecoveryStageKey[];
  readonly affectedStages: readonly PipelineRecoveryStageKey[];
  readonly createdAt: string;
  readonly mutations: readonly {
    readonly relativePath: string;
    readonly preSha256: string | null;
    readonly postSha256: string;
    readonly postBase64: string;
    readonly writeOnce: boolean;
  }[];
}

export interface PipelineRegenerationPreparedReceipt {
  readonly schemaVersion: typeof pipelineRegenerationSchemaVersion;
  readonly regenerationId: string;
  readonly projectSlug: string;
  readonly generationOrdinal: number;
  readonly planFingerprint: string;
  readonly preparedAt: string;
  readonly mutationFingerprints: readonly string[];
  readonly fingerprint: string;
}
