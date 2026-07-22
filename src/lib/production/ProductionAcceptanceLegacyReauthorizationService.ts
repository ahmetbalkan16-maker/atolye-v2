import {
  acquireProjectWriteAuthority,
  type RuntimeStorageAuthorityLease,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  integrityFor,
  canonicalJson,
  deriveLegacyReauthorizationId,
  legacyReauthorizationPolicyVersion,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  legacyReauthorizationReceiptPolicyVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  type ProductionAcceptanceLegacyReauthorizationV1,
  type ProductionAcceptanceLegacyPublicationReceiptV1,
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
  publishLegacyPublicationReceipt,
  publishLegacyReauthorizationAuthority,
  readLegacyArchiveDescriptorBound,
  readLegacyReauthorizationAuthorityDescriptorBound,
} from "./ProductionAcceptanceLegacyAuthorityStore";
import { sha256Bytes } from "./ProductionAcceptanceLegacyReauthorization";
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
    const archiveIdentity = publishLegacyArchive({
      projectFolder: first.projectFolder,
      markerBytes: first.markerBytes,
      sourceMarkerSha256: first.sourceMarkerSha256,
      reauthorizationId: first.reauthorizationId,
    });
    const second = await createLegacyReauthorizationPreflight(
      input.projectSlug,
      input.sourceMarkerSha256,
      dependencies,
    );
    if (
      second.reauthorizationId !== first.reauthorizationId ||
      second.markerDeviceIdentity !== first.markerDeviceIdentity ||
      second.markerInodeIdentity !== first.markerInodeIdentity
    ) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE",
        input.projectSlug,
        "concurrency",
      );
    }
    const archiveLocator = legacyArchiveLocator(second.sourceMarkerSha256);
    const archiveSnapshot = readLegacyArchiveDescriptorBound(second.projectFolder, archiveLocator);
    const publicationGenerationId = sha256Bytes(canonicalJson({
      policyVersion: "legacy-reauthorization-publication-generation-v1",
      challengeId: second.reauthorizationId, archiveLocator, archiveSha256: archiveSnapshot.sha256,
      archiveByteLength: archiveSnapshot.byteLength, archiveDeviceIdentity: archiveSnapshot.deviceIdentity,
      archiveInodeIdentity: archiveSnapshot.inodeIdentity,
    }));
    const finalReauthorizationId = deriveLegacyReauthorizationId({
      protocolVersion: legacyReauthorizationSchemaVersion, projectSlug: second.projectSlug,
      sourceMarkerSha256: second.sourceMarkerSha256, sourceMarkerByteLength: second.markerBytes.length,
      sourceMarkerDeviceIdentity: second.markerDeviceIdentity, sourceMarkerInodeIdentity: second.markerInodeIdentity,
      sourceLegacyConfigurationFingerprint: second.marker.configurationFingerprint, runId: second.marker.runId,
      topicFingerprint: second.marker.topicFingerprint,
      currentProfile2ConfigurationFingerprint: second.configuration.configurationFingerprint,
      storageAuthorityFingerprint: second.storageAuthorityFingerprint,
      artifactInventoryFingerprint: second.artifactInventoryFingerprint,
      recoveryStateFingerprint: second.recoveryStateFingerprint, reason: legacyReauthorizationReason,
      strictProductionAcceptance: true, publishMode: "package-only", archiveLocator,
      archiveSha256: archiveSnapshot.sha256, archiveByteLength: archiveSnapshot.byteLength,
      archiveDeviceIdentity: archiveSnapshot.deviceIdentity, archiveInodeIdentity: archiveSnapshot.inodeIdentity,
      archiveIdentityPolicyVersion: archiveSnapshot.identityPolicyVersion,
      publicationReceiptPolicyVersion: legacyReauthorizationReceiptPolicyVersion, publicationGenerationId,
    });
    const authority = buildAuthority(second, archiveIdentity, finalReauthorizationId, publicationGenerationId);
    const decision = publishLegacyReauthorizationAuthority({
      projectFolder: second.projectFolder,
      markerBytes: second.markerBytes,
      authority,
    });
    const sidecarSnapshot = readLegacyReauthorizationAuthorityDescriptorBound(second.projectFolder);
    const receipt = buildReceipt(second, authority, archiveSnapshot, sidecarSnapshot);
    publishLegacyPublicationReceipt({ projectFolder: second.projectFolder, receipt });
    return Object.freeze({
      projectSlug: input.projectSlug,
      sourceMarkerSha256: input.sourceMarkerSha256,
      reauthorizationId: finalReauthorizationId,
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
  archiveIdentity: { readonly deviceIdentity: string; readonly inodeIdentity: string },
  reauthorizationId: string,
  publicationGenerationId: string,
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
    reauthorizationId,
    reason: legacyReauthorizationReason,
    projectSlug: snapshot.projectSlug,
    runId: snapshot.marker.runId,
    topicFingerprint: snapshot.marker.topicFingerprint,
    sourceMarker: {
      schemaVersion: "2" as const,
      sha256: snapshot.sourceMarkerSha256,
      byteLength: snapshot.markerBytes.length,
      deviceIdentity: snapshot.markerDeviceIdentity,
      inodeIdentity: snapshot.markerInodeIdentity,
      identityPolicyVersion: "production-acceptance-marker-identity-v1",
      legacyConfigurationFingerprint: snapshot.marker.configurationFingerprint,
      archiveLocator: legacyArchiveLocator(snapshot.sourceMarkerSha256),
      archiveSha256: snapshot.sourceMarkerSha256,
      archiveDeviceIdentity: archiveIdentity.deviceIdentity,
      archiveInodeIdentity: archiveIdentity.inodeIdentity,
      archiveIdentityPolicyVersion: "production-acceptance-marker-identity-v1",
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
    publicationReceiptPolicyVersion: legacyReauthorizationReceiptPolicyVersion,
    publicationGenerationId,
  };
  return Object.freeze({
    ...body,
    integrity: integrityFor(body as unknown as Record<string, unknown>),
  });
}

function buildReceipt(snapshot: ProductionAcceptanceLegacyReauthorizationSnapshot,
  authority: ProductionAcceptanceLegacyReauthorizationV1,
  archive: ReturnType<typeof readLegacyArchiveDescriptorBound>,
  sidecar: ReturnType<typeof readLegacyReauthorizationAuthorityDescriptorBound>): ProductionAcceptanceLegacyPublicationReceiptV1 {
  const body = {
    receiptSchemaVersion: "production-acceptance-legacy-publication-receipt-v1" as const,
    receiptPolicyVersion: legacyReauthorizationReceiptPolicyVersion,
    protocolVersion: legacyReauthorizationSchemaVersion, projectSlug: snapshot.projectSlug,
    sourceMarker: { sha256: snapshot.sourceMarkerSha256, byteLength: snapshot.markerBytes.length,
      deviceIdentity: snapshot.markerDeviceIdentity, inodeIdentity: snapshot.markerInodeIdentity },
    archive: { locator: authority.sourceMarker.archiveLocator, sha256: archive.sha256,
      byteLength: archive.byteLength, deviceIdentity: archive.deviceIdentity, inodeIdentity: archive.inodeIdentity },
    authoritySidecar: { locator: "production-acceptance-reauthorization.json" as const, sha256: sidecar.sha256,
      byteLength: sidecar.byteLength, deviceIdentity: sidecar.deviceIdentity, inodeIdentity: sidecar.inodeIdentity },
    reauthorizationId: authority.reauthorizationId, publicationGenerationId: authority.publicationGenerationId,
    storageAuthorityFingerprint: authority.storageAuthorityFingerprint,
    artifactInventoryFingerprint: authority.artifactInventoryFingerprint,
    recoveryStateFingerprint: authority.recoveryStateFingerprint,
    configurationFingerprint: authority.configurationFingerprint,
    strictProductionAcceptance: true as const, publishMode: "package-only" as const,
  };
  return Object.freeze({ ...body, integrity: integrityFor(body as unknown as Record<string, unknown>) });
}
