import { createHash } from "node:crypto";
import type { ProductionAcceptanceComponentFingerprintsV2 } from
  "./ProductionAcceptanceConfigurationFingerprint";

export const legacyReauthorizationSchemaVersion =
  "production-acceptance-legacy-reauthorization-v1" as const;
export const legacyReauthorizationPolicyVersion =
  "legacy-marker-reauthorization-v1" as const;
export const legacyReauthorizationReason =
  "legacy-environment-unrecoverable" as const;
export const legacyReauthorizationAuthorityFile =
  "production-acceptance-reauthorization.json" as const;
export const legacyReauthorizationPublicationReceiptFile =
  "legacy-reauthorization-publication-receipt.json" as const;
export const legacyReauthorizationReceiptPolicyVersion =
  "legacy-reauthorization-publication-receipt-v1" as const;

export const legacyReauthorizationErrorCodes = [
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIRMATION_REQUIRED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARGUMENT_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_MARKER_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_HASH_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_NOT_LEGACY",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_BINDING_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIGURATION_UNAVAILABLE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_STORAGE_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ARTIFACT_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ENVIRONMENT_DRIFT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_AUTHORITY_CONFLICT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_REQUIRED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_PERSISTENCE_FAILED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_FAILED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ID_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_STORAGE_DRIFT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARTIFACT_DRIFT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_RECOVERY_DRIFT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONFIGURATION_DRIFT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARCHIVE_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CONCURRENT_CHANGE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_DURABLE_RECOVERY_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ACTIVE_EXECUTION",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_CLAIM_OR_LEASE_CONFLICT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_GENERATION_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDENTITY_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REQUEST_ID_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_IDEMPOTENCY_KEY_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_OPERATION_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_LEASE_ID_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_STALE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_REPLAYED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_CONCURRENT_CONSUMPTION",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEGACY_CAPABILITY_INVALIDATED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_CONFLICT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_WORKER_LIFECYCLE_UNAVAILABLE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_BOOTSTRAP_INVALID",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_AUTHORITY_UNAVAILABLE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_IDENTITY_CHANGED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_RECORD_CORRUPT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ACTIVE_RESERVATION_CONFLICT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_DURABLE_STORE_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_RESERVATION_STORE_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_IDEMPOTENCY_STORE_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_CLAIM_STORE_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_REQUIRED_ATTEMPT_STORE_MISSING",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_CLAIM_BINDING_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_ATTEMPT_BINDING_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RESERVATION_IDEMPOTENCY_BINDING_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CLAIM_ATTEMPT_BINDING_MISMATCH",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_UNAVAILABLE",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_CORRUPT",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_DURABLE_STORE_IDENTITY_CHANGED",
  "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_LEASE_STATE_INVALID",
] as const;

export type ProductionAcceptanceLegacyReauthorizationErrorCode =
  (typeof legacyReauthorizationErrorCodes)[number];

export class ProductionAcceptanceLegacyReauthorizationError extends Error {
  constructor(
    readonly code: ProductionAcceptanceLegacyReauthorizationErrorCode,
    readonly projectSlug?: string,
    readonly category?: "marker" | "configuration" | "storage" | "artifacts" |
      "recovery" | "concurrency" | "persistence",
  ) {
    super("Production acceptance legacy re-authorization failed.");
    this.name = "ProductionAcceptanceLegacyReauthorizationError";
    this.stack = undefined;
  }
}

export interface ProductionAcceptanceEffectiveMarkerV3Profile2 {
  readonly schemaVersion: "3";
  readonly componentFingerprintProfile: "2";
  readonly runId: string;
  readonly topic: string;
  readonly topicFingerprint: string;
  readonly requestFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprintsV2;
  readonly createdAt: string;
  readonly acceptanceStatus: "prepared" | "validated";
  readonly productionReady: boolean;
  readonly published: false;
  readonly validatedAt?: string;
}

export interface ProductionAcceptanceLegacyReauthorizationV1 {
  readonly schemaVersion: typeof legacyReauthorizationSchemaVersion;
  readonly policyVersion: typeof legacyReauthorizationPolicyVersion;
  readonly reauthorizationId: string;
  readonly reason: typeof legacyReauthorizationReason;
  readonly projectSlug: string;
  readonly runId: string;
  readonly topicFingerprint: string;
  readonly sourceMarker: {
    readonly schemaVersion: "2";
    readonly sha256: string;
    readonly byteLength: number;
    readonly deviceIdentity: string;
    readonly inodeIdentity: string;
    readonly identityPolicyVersion: string;
    readonly legacyConfigurationFingerprint: string;
    readonly archiveLocator: string;
    readonly archiveSha256: string;
    readonly archiveDeviceIdentity: string;
    readonly archiveInodeIdentity: string;
    readonly archiveIdentityPolicyVersion: string;
  };
  readonly effectiveMarker: ProductionAcceptanceEffectiveMarkerV3Profile2;
  readonly configurationFingerprint: string;
  readonly componentFingerprints: ProductionAcceptanceComponentFingerprintsV2;
  readonly storageAuthorityFingerprint: string;
  readonly artifactInventoryFingerprint: string;
  readonly recoveryStateFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly productionExecutionAuthorized: false;
  readonly publicationReceiptPolicyVersion: typeof legacyReauthorizationReceiptPolicyVersion;
  readonly publicationGenerationId: string;
  readonly integrity: string;
}

export interface ProductionAcceptanceLegacyPublicationReceiptV1 {
  readonly receiptSchemaVersion: "production-acceptance-legacy-publication-receipt-v1";
  readonly receiptPolicyVersion: typeof legacyReauthorizationReceiptPolicyVersion;
  readonly protocolVersion: typeof legacyReauthorizationSchemaVersion;
  readonly projectSlug: string;
  readonly sourceMarker: { readonly sha256: string; readonly byteLength: number; readonly deviceIdentity: string; readonly inodeIdentity: string };
  readonly archive: { readonly locator: string; readonly sha256: string; readonly byteLength: number; readonly deviceIdentity: string; readonly inodeIdentity: string };
  readonly authoritySidecar: { readonly locator: typeof legacyReauthorizationAuthorityFile; readonly sha256: string; readonly byteLength: number; readonly deviceIdentity: string; readonly inodeIdentity: string };
  readonly reauthorizationId: string;
  readonly publicationGenerationId: string;
  readonly storageAuthorityFingerprint: string;
  readonly artifactInventoryFingerprint: string;
  readonly recoveryStateFingerprint: string;
  readonly configurationFingerprint: string;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly integrity: string;
}

export type ReauthorizationDecision = "reauthorized" | "replayed";

export function canonicalJson(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" ||
    (typeof value === "number" && !Number.isFinite(value))) throw new Error("CANONICAL_JSON_VALUE_INVALID");
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function integrityFor(value: Record<string, unknown>): string {
  return sha256Bytes(canonicalJson(value));
}

export function safeSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function deriveLegacyReauthorizationId(input: {
  readonly protocolVersion: typeof legacyReauthorizationSchemaVersion;
  readonly projectSlug: string;
  readonly sourceMarkerSha256: string;
  readonly sourceMarkerByteLength: number;
  readonly sourceMarkerDeviceIdentity: string;
  readonly sourceMarkerInodeIdentity: string;
  readonly sourceLegacyConfigurationFingerprint: string;
  readonly runId: string;
  readonly topicFingerprint: string;
  readonly currentProfile2ConfigurationFingerprint: string;
  readonly storageAuthorityFingerprint: string;
  readonly artifactInventoryFingerprint: string;
  readonly recoveryStateFingerprint: string;
  readonly reason: typeof legacyReauthorizationReason;
  readonly strictProductionAcceptance: true;
  readonly publishMode: "package-only";
  readonly archiveLocator: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly archiveDeviceIdentity: string;
  readonly archiveInodeIdentity: string;
  readonly archiveIdentityPolicyVersion: string;
  readonly publicationReceiptPolicyVersion: typeof legacyReauthorizationReceiptPolicyVersion;
  readonly publicationGenerationId: string;
}): string {
  return sha256Bytes(canonicalJson({
    policyVersion: "legacy-marker-reauthorization-id-v3",
    ...input,
  }));
}

export function deriveLegacyReauthorizationChallengeId(input: Omit<Parameters<typeof deriveLegacyReauthorizationId>[0],
  "archiveLocator" | "archiveSha256" | "archiveByteLength" | "archiveDeviceIdentity" |
  "archiveInodeIdentity" | "archiveIdentityPolicyVersion" | "publicationReceiptPolicyVersion" |
  "publicationGenerationId">): string {
  return sha256Bytes(canonicalJson({ policyVersion: "legacy-marker-reauthorization-challenge-v1", ...input }));
}
