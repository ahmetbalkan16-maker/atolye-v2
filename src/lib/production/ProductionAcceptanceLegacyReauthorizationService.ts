import {
  acquireProjectWriteAuthority,
  type RuntimeStorageAuthorityLease,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  integrityFor,
  legacyReauthorizationPolicyVersion,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  type ProductionAcceptanceLegacyReauthorizationV1,
  type ReauthorizationDecision,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  createLegacyReauthorizationPreflight,
  type LegacyReauthorizationPreflightDependencies,
  type ProductionAcceptanceLegacyReauthorizationSnapshot,
} from "./ProductionAcceptanceLegacyReauthorizationPreflight";
import {
  legacyArchiveLocator,
  publishLegacyArchive,
  publishLegacyReauthorizationAuthority,
} from "./ProductionAcceptanceLegacyAuthorityStore";
import { productionAcceptanceRequestFingerprintV3Profile2 } from
  "./ProductionAcceptancePolicy";

export interface LegacyReauthorizationPlan {
  readonly eligible: true;
  readonly projectSlug: string;
  readonly sourceMarkerSha256: string;
  readonly reauthorizationId: string;
  readonly reason: typeof legacyReauthorizationReason;
  readonly writePerformed: false;
}

export interface LegacyReauthorizationResult {
  readonly projectSlug: string;
  readonly sourceMarkerSha256: string;
  readonly reauthorizationId: string;
  readonly decision: ReauthorizationDecision;
  readonly writePerformed: boolean;
}

export async function planProductionAcceptanceLegacyReauthorization(
  projectSlug: string,
  sourceMarkerSha256: string,
  dependencies: LegacyReauthorizationPreflightDependencies = {},
): Promise<LegacyReauthorizationPlan> {
  const snapshot = await createLegacyReauthorizationPreflight(
    projectSlug,
    sourceMarkerSha256,
    dependencies,
  );
  return Object.freeze({
    eligible: true,
    projectSlug,
    sourceMarkerSha256,
    reauthorizationId: snapshot.reauthorizationId,
    reason: legacyReauthorizationReason,
    writePerformed: false,
  });
}

export async function reauthorizeProductionAcceptanceLegacyMarker(input: {
  readonly projectSlug: string;
  readonly sourceMarkerSha256: string;
  readonly reason: string;
  readonly reauthorizationId: string;
  readonly confirmation: string;
}, dependencies: LegacyReauthorizationPreflightDependencies = {}): Promise<LegacyReauthorizationResult> {
  if (
    input.reason !== legacyReauthorizationReason ||
    input.confirmation !== input.reauthorizationId ||
    !/^[a-f0-9]{64}$/.test(input.reauthorizationId)
  ) {
    throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIRMATION_REQUIRED",
      input.projectSlug,
    );
  }
  const first = await createLegacyReauthorizationPreflight(
    input.projectSlug,
    input.sourceMarkerSha256,
    dependencies,
  );
  if (first.reauthorizationId !== input.reauthorizationId) {
    throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ENVIRONMENT_DRIFT",
      input.projectSlug,
      "configuration",
    );
  }
  let lease: RuntimeStorageAuthorityLease | undefined;
  try {
    lease = acquireProjectWriteAuthority(input.projectSlug, first.context);
    const authority = buildAuthority(first);
    publishLegacyArchive({
      projectFolder: first.projectFolder,
      markerBytes: first.markerBytes,
      authority,
    });
    const second = await createLegacyReauthorizationPreflight(
      input.projectSlug,
      input.sourceMarkerSha256,
      dependencies,
    );
    if (
      second.reauthorizationId !== first.reauthorizationId ||
      second.markerDevice !== first.markerDevice ||
      second.markerInode !== first.markerInode
    ) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE",
        input.projectSlug,
        "concurrency",
      );
    }
    const decision = publishLegacyReauthorizationAuthority({
      projectFolder: second.projectFolder,
      markerBytes: second.markerBytes,
      authority,
    });
    return Object.freeze({
      projectSlug: input.projectSlug,
      sourceMarkerSha256: input.sourceMarkerSha256,
      reauthorizationId: input.reauthorizationId,
      decision,
      writePerformed: decision === "reauthorized",
    });
  } catch (error) {
    if (error instanceof ProductionAcceptanceLegacyReauthorizationError) throw error;
    throw new ProductionAcceptanceLegacyReauthorizationError(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_FAILED",
      input.projectSlug,
    );
  } finally {
    lease?.release();
  }
}

function buildAuthority(
  snapshot: ProductionAcceptanceLegacyReauthorizationSnapshot,
): ProductionAcceptanceLegacyReauthorizationV1 {
  const effectiveMarker = Object.freeze({
    schemaVersion: "3" as const,
    componentFingerprintProfile: "2" as const,
    runId: snapshot.marker.runId,
    topic: snapshot.marker.topic,
    topicFingerprint: snapshot.marker.topicFingerprint,
    requestFingerprint: productionAcceptanceRequestFingerprintV3Profile2({
      topic: snapshot.marker.topic,
      runId: snapshot.marker.runId,
      configurationFingerprint: snapshot.configuration.configurationFingerprint,
    }),
    strictProductionAcceptance: true as const,
    publishMode: "package-only" as const,
    configurationFingerprint: snapshot.configuration.configurationFingerprint,
    componentFingerprints: snapshot.configuration.componentFingerprints,
    createdAt: snapshot.marker.createdAt,
    acceptanceStatus: "prepared" as const,
    productionReady: false as const,
    published: false as const,
  });
  const body = {
    schemaVersion: legacyReauthorizationSchemaVersion,
    policyVersion: legacyReauthorizationPolicyVersion,
    reauthorizationId: snapshot.reauthorizationId,
    reason: legacyReauthorizationReason,
    projectSlug: snapshot.projectSlug,
    runId: snapshot.marker.runId,
    topicFingerprint: snapshot.marker.topicFingerprint,
    sourceMarker: {
      schemaVersion: "2" as const,
      sha256: snapshot.sourceMarkerSha256,
      byteLength: snapshot.markerBytes.length,
      legacyConfigurationFingerprint: snapshot.marker.configurationFingerprint,
      archiveLocator: legacyArchiveLocator(snapshot.sourceMarkerSha256),
      archiveSha256: snapshot.sourceMarkerSha256,
    },
    effectiveMarker,
    configurationFingerprint: snapshot.configuration.configurationFingerprint,
    componentFingerprints: snapshot.configuration.componentFingerprints,
    storageAuthorityFingerprint: snapshot.storageAuthorityFingerprint,
    artifactInventoryFingerprint: snapshot.artifactInventoryFingerprint,
    recoveryStateFingerprint: snapshot.recoveryStateFingerprint,
    strictProductionAcceptance: true as const,
    publishMode: "package-only" as const,
    productionExecutionAuthorized: false as const,
  };
  return Object.freeze({
    ...body,
    integrity: integrityFor(body as unknown as Record<string, unknown>),
  });
}
