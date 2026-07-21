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
    readonly legacyConfigurationFingerprint: string;
    readonly archiveLocator: string;
    readonly archiveSha256: string;
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
  readonly integrity: string;
}

export type ReauthorizationDecision = "reauthorized" | "replayed";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
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
