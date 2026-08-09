import type { PipelineRecoveryStageKey } from "./pipelineRecovery";

export const productionRegenerationSchemaVersion = "production-regeneration-v1" as const;

export interface ProductionRegenerationBinding {
  readonly regenerationId: string;
  readonly generationOrdinal: number;
  readonly planFingerprint: string;
  readonly fromStage: PipelineRecoveryStageKey;
  readonly reasonCode: string;
}

export interface ProductionRegenerationFileFingerprint {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface ProductionRegenerationPlan {
  readonly schemaVersion: typeof productionRegenerationSchemaVersion;
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
  readonly fileFingerprints: readonly ProductionRegenerationFileFingerprint[];
  readonly manifestFingerprint: string;
  readonly jobsFingerprint: string;
  readonly historyFingerprint: string;
  readonly artifactRegistryFingerprint: string;
  readonly audioPreservationFingerprint: string;
  readonly audioFiles: readonly ProductionRegenerationFileFingerprint[];
  readonly runtimeAuthorityId: string;
  readonly runtimeStorageIdentity: string;
  readonly acceptanceMarkerFingerprint: string;
  readonly providerProfileFingerprint: string;
  readonly durableQuiescent: true;
  readonly planFingerprint: string;
}

export interface ProductionRegenerationIntent extends ProductionRegenerationBinding {
  readonly schemaVersion: typeof productionRegenerationSchemaVersion;
  readonly projectSlug: string;
  readonly projectId: string;
  readonly runtimeAuthorityId: string;
  readonly runtimeStorageIdentity: string;
  readonly backupId: string;
  readonly backupManifestFingerprint: string;
  readonly exactPrestateFingerprint: string;
  readonly audioPreservationFingerprint: string;
  readonly audioFiles: readonly ProductionRegenerationFileFingerprint[];
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

export interface ProductionRegenerationPreparedReceipt {
  readonly schemaVersion: typeof productionRegenerationSchemaVersion;
  readonly regenerationId: string;
  readonly projectSlug: string;
  readonly generationOrdinal: number;
  readonly planFingerprint: string;
  readonly preparedAt: string;
  readonly mutationFingerprints: readonly string[];
  readonly fingerprint: string;
}
