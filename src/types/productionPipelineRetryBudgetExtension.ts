export interface RetryBudgetExtensionDurableBinding {
  readonly schemaVersion: "1";
  readonly authorityId: string;
  readonly authorityIntegrityFingerprint: string;
  readonly consumptionReceiptFingerprint: string;
  readonly authorizedDurableOrdinal: 4;
  readonly effectiveMaxAttempts: 4;
  readonly authorizedRunType: "resume";
  readonly authorizedOperation: "pipeline.stage.resume";
  readonly projectSlug: string;
  readonly stage: string;
  readonly jobId: string;
  readonly identityFingerprint: string;
  readonly reservationBinding: string;
  readonly durableAttemptOrdinal: 4;
}
