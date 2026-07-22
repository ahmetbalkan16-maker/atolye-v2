import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  integrityFor,
  legacyReauthorizationAuthorityFile,
  legacyReauthorizationPolicyVersion,
  legacyReauthorizationPublicationReceiptFile,
  legacyReauthorizationReceiptPolicyVersion,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  safeSha256,
  sha256Bytes,
  type ProductionAcceptanceEffectiveMarkerV3Profile2,
  type ProductionAcceptanceLegacyReauthorizationV1,
  type ProductionAcceptanceLegacyPublicationReceiptV1,
  type ReauthorizationDecision,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  productionAcceptancePortableConfigurationFingerprintV2,
  validProductionAcceptanceComponentFingerprintsV2,
} from "./ProductionAcceptanceConfigurationFingerprint";
import { readProductionAcceptanceFileDescriptorBound, type DescriptorBoundFileSnapshot } from
  "./ProductionAcceptanceMarkerDescriptorReader";

const AUTHORITY_DIRECTORY = "production-acceptance-authority";
const LEGACY_DIRECTORY = "legacy";
const VALIDATION_FILE = "production-acceptance-validation.json";
const MAX_AUTHORITY_BYTES = 1024 * 1024;

export function legacyArchiveLocator(sourceMarkerSha256: string) {
  if (!safeSha256(sourceMarkerSha256)) throw conflict();
  return `${AUTHORITY_DIRECTORY}/${LEGACY_DIRECTORY}/${sourceMarkerSha256}.json`;
}

export function publishLegacyArchive(input: {
  readonly projectFolder: string;
  readonly markerBytes: Buffer;
  readonly sourceMarkerSha256: string;
  readonly reauthorizationId: string;
}): { readonly deviceIdentity: string; readonly inodeIdentity: string } {
  const authorityRoot = ensureDirectory(input.projectFolder, AUTHORITY_DIRECTORY);
  const legacyRoot = ensureDirectory(authorityRoot, LEGACY_DIRECTORY);
  const archivePath = path.join(legacyRoot, `${input.sourceMarkerSha256}.json`);
  publishExactNoClobber(
    archivePath,
    input.markerBytes,
    `.archive-${input.reauthorizationId}.partial`,
  );
  const snapshot = readExactSnapshot(archivePath);
  if (!snapshot.bytes.equals(input.markerBytes) || sha256Bytes(snapshot.bytes) !== input.sourceMarkerSha256) {
    throw conflict();
  }
  return Object.freeze({ deviceIdentity: snapshot.deviceIdentity,
    inodeIdentity: snapshot.inodeIdentity });
}

export function publishLegacyReauthorizationAuthority(input: {
  readonly projectFolder: string;
  readonly markerBytes: Buffer;
  readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
}): ReauthorizationDecision {
  const finalAuthorityPath = path.join(input.projectFolder, legacyReauthorizationAuthorityFile);
  if (fs.existsSync(finalAuthorityPath)) {
    const existing = readAuthorityFile(finalAuthorityPath);
    if (existing.reauthorizationId !== input.authority.reauthorizationId ||
      canonicalJson(existing) !== canonicalJson(input.authority)) throw conflict();
    verifyArchive(input.projectFolder, existing, input.markerBytes);
    return "replayed";
  }
  verifyArchive(input.projectFolder, input.authority, input.markerBytes);
  const authorityBytes = Buffer.from(JSON.stringify(input.authority, null, 2), "utf8");
  publishExactNoClobber(
    finalAuthorityPath,
    authorityBytes,
    `.authority-${input.authority.reauthorizationId}.partial`,
  );
  const readback = readAuthorityFile(finalAuthorityPath);
  if (canonicalJson(readback) !== canonicalJson(input.authority)) throw persistence();
  syncDirectory(input.projectFolder);
  return "reauthorized";
}

export function publishLegacyPublicationReceipt(input: {
  readonly projectFolder: string;
  readonly receipt: ProductionAcceptanceLegacyPublicationReceiptV1;
}): ReauthorizationDecision {
  const finalPath = path.join(input.projectFolder, legacyReauthorizationPublicationReceiptFile);
  const bytes = Buffer.from(JSON.stringify(input.receipt, null, 2), "utf8");
  const existed = fs.existsSync(finalPath);
  publishExactNoClobber(finalPath, bytes, `.receipt-${input.receipt.publicationGenerationId}.partial`);
  const readback = readLegacyPublicationReceiptDescriptorBound(input.projectFolder);
  if (canonicalJson(readback.receipt) !== canonicalJson(input.receipt)) throw persistence();
  syncDirectory(input.projectFolder);
  return existed ? "replayed" : "reauthorized";
}

export function readLegacyReauthorizationAuthorityDescriptorBound(projectFolder: string) {
  const snapshot = readProductionAcceptanceFileDescriptorBound({ projectFolder,
    filePath: path.join(projectFolder, legacyReauthorizationAuthorityFile),
    logicalLocator: legacyReauthorizationAuthorityFile, maxBytes: MAX_AUTHORITY_BYTES });
  const value = JSON.parse(snapshot.bytes.toString("utf8")) as unknown;
  if (!validateLegacyAuthority(value)) throw conflict();
  return Object.freeze({ ...snapshot, authority: value });
}

export function readLegacyArchiveDescriptorBound(projectFolder: string, locator: string) {
  return readProductionAcceptanceFileDescriptorBound({ projectFolder,
    filePath: path.join(projectFolder, ...locator.split("/")), logicalLocator: locator,
    maxBytes: MAX_AUTHORITY_BYTES });
}

export function readLegacyPublicationReceiptDescriptorBound(projectFolder: string) {
  const snapshot = readProductionAcceptanceFileDescriptorBound({ projectFolder,
    filePath: path.join(projectFolder, legacyReauthorizationPublicationReceiptFile),
    logicalLocator: legacyReauthorizationPublicationReceiptFile, maxBytes: MAX_AUTHORITY_BYTES });
  const value = JSON.parse(snapshot.bytes.toString("utf8")) as unknown;
  if (!validateLegacyPublicationReceipt(value)) throw conflict();
  const anchorLocator = `.receipt-${value.publicationGenerationId}.partial`;
  const anchor = readProductionAcceptanceFileDescriptorBound({ projectFolder,
    filePath: path.join(projectFolder, anchorLocator), logicalLocator: anchorLocator,
    maxBytes: MAX_AUTHORITY_BYTES });
  if (anchor.sha256 !== snapshot.sha256 || anchor.byteLength !== snapshot.byteLength ||
    anchor.deviceIdentity !== snapshot.deviceIdentity || anchor.inodeIdentity !== snapshot.inodeIdentity) {
    throw conflict();
  }
  return Object.freeze({ ...snapshot, receipt: value, immutableAnchorSnapshot: anchor });
}

export function readLegacyReauthorizationAuthority(input: {
  readonly projectFolder: string;
  readonly projectSlug: string;
  readonly markerBytes: Buffer;
  readonly markerValue: Record<string, unknown>;
  readonly markerDeviceIdentity?: string;
  readonly markerInodeIdentity?: string;
}): { readonly status: "absent" } | {
  readonly status: "valid";
  readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
  readonly effectiveMarker: ProductionAcceptanceEffectiveMarkerV3Profile2;
  readonly authoritySnapshot: ReturnType<typeof readLegacyReauthorizationAuthorityDescriptorBound>;
  readonly archiveSnapshot: DescriptorBoundFileSnapshot;
  readonly receiptSnapshot: ReturnType<typeof readLegacyPublicationReceiptDescriptorBound>;
} {
  const authorityPath = path.join(input.projectFolder, legacyReauthorizationAuthorityFile);
  if (!fs.existsSync(authorityPath)) return { status: "absent" };
  try {
    const authoritySnapshot = readLegacyReauthorizationAuthorityDescriptorBound(input.projectFolder);
    const authority = authoritySnapshot.authority;
    if (
      authority.sourceMarker.sha256 !== sha256Bytes(input.markerBytes) ||
      authority.sourceMarker.byteLength !== input.markerBytes.length ||
      (input.markerDeviceIdentity !== undefined &&
        authority.sourceMarker.deviceIdentity !== input.markerDeviceIdentity) ||
      (input.markerInodeIdentity !== undefined &&
        authority.sourceMarker.inodeIdentity !== input.markerInodeIdentity)
    ) {
      throw admissionConflict(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_SOURCE_IDENTITY_MISMATCH",
        input.projectSlug,
        "marker",
      );
    }
    if (
      authority.projectSlug !== input.projectSlug ||
      authority.runId !== input.markerValue.runId ||
      authority.topicFingerprint !== input.markerValue.topicFingerprint ||
      authority.sourceMarker.legacyConfigurationFingerprint !== input.markerValue.configurationFingerprint ||
      authority.effectiveMarker.runId !== input.markerValue.runId ||
      authority.effectiveMarker.topic !== input.markerValue.topic ||
      authority.effectiveMarker.topicFingerprint !== input.markerValue.topicFingerprint ||
      authority.effectiveMarker.createdAt !== input.markerValue.createdAt ||
      authority.configurationFingerprint !== authority.effectiveMarker.configurationFingerprint ||
      canonicalJson(authority.componentFingerprints) !== canonicalJson(authority.effectiveMarker.componentFingerprints)
    ) throw new Error("binding");
    const archiveSnapshot = verifyArchive(input.projectFolder, authority, input.markerBytes, true);
    let receiptSnapshot: ReturnType<typeof readLegacyPublicationReceiptDescriptorBound>;
    try { receiptSnapshot = readLegacyPublicationReceiptDescriptorBound(input.projectFolder); }
    catch { throw admissionConflict(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH",
      input.projectSlug, "persistence"); }
    verifyReceipt(authority, authoritySnapshot, archiveSnapshot, receiptSnapshot, input.projectSlug);
    const validation = readLegacyValidation(input.projectFolder, authority.reauthorizationId);
    const effectiveMarker = validation
      ? Object.freeze({
          ...authority.effectiveMarker,
          acceptanceStatus: "validated" as const,
          productionReady: true as const,
          validatedAt: validation.validatedAt,
        })
      : authority.effectiveMarker;
    return { status: "valid", authority, effectiveMarker: effectiveMarker as ProductionAcceptanceEffectiveMarkerV3Profile2,
      authoritySnapshot, archiveSnapshot, receiptSnapshot };
  } catch (error) {
    if (error instanceof ProductionAcceptanceLegacyReauthorizationError) throw error;
    throw conflict();
  }
}

export function markLegacyReauthorizationValidated(input: {
  readonly projectFolder: string;
  readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
  readonly validatedAt: string;
}) {
  const body = {
    schemaVersion: "production-acceptance-legacy-validation-v1",
    reauthorizationId: input.authority.reauthorizationId,
    validatedAt: input.validatedAt,
    productionReady: true,
    published: false,
  } as const;
  const value = { ...body, integrity: integrityFor(body as unknown as Record<string, unknown>) };
  const finalPath = path.join(input.projectFolder, VALIDATION_FILE);
  if (fs.existsSync(finalPath)) {
    const existing = readValidationFile(finalPath);
    if (existing.reauthorizationId !== input.authority.reauthorizationId) throw conflict();
    return;
  }
  publishExactNoClobber(
    finalPath,
    Buffer.from(JSON.stringify(value, null, 2), "utf8"),
    `.validation-${input.authority.reauthorizationId}.partial`,
  );
}

export function validateLegacyAuthority(value: unknown): value is ProductionAcceptanceLegacyReauthorizationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionAcceptanceLegacyReauthorizationV1>;
  const source = candidate.sourceMarker;
  const marker = candidate.effectiveMarker;
  if (
    candidate.schemaVersion !== legacyReauthorizationSchemaVersion ||
    candidate.policyVersion !== legacyReauthorizationPolicyVersion ||
    candidate.reason !== legacyReauthorizationReason ||
    !safeSha256(candidate.reauthorizationId) || !safeSlug(candidate.projectSlug) ||
    typeof candidate.runId !== "string" || !safeSha256(candidate.topicFingerprint) ||
    !source || source.schemaVersion !== "2" || !safeSha256(source.sha256) ||
    !Number.isSafeInteger(source.byteLength) || source.byteLength <= 0 ||
    !safeSha256(source.deviceIdentity) || !safeSha256(source.inodeIdentity) ||
    source.identityPolicyVersion !== "production-acceptance-marker-identity-v1" ||
    !safeSha256(source.legacyConfigurationFingerprint) ||
    source.archiveLocator !== legacyArchiveLocator(source.sha256) ||
    source.archiveSha256 !== source.sha256 ||
    !safeSha256(source.archiveDeviceIdentity) || !safeSha256(source.archiveInodeIdentity) ||
    source.archiveIdentityPolicyVersion !== "production-acceptance-marker-identity-v1" || !marker ||
    marker.schemaVersion !== "3" || marker.componentFingerprintProfile !== "2" ||
    marker.runId !== candidate.runId || marker.topicFingerprint !== candidate.topicFingerprint ||
    marker.strictProductionAcceptance !== true || marker.publishMode !== "package-only" ||
    marker.acceptanceStatus !== "prepared" || marker.productionReady !== false || marker.published !== false ||
    !safeSha256(marker.configurationFingerprint) ||
    !validProductionAcceptanceComponentFingerprintsV2(marker.componentFingerprints) ||
    productionAcceptancePortableConfigurationFingerprintV2(marker.componentFingerprints) !== marker.configurationFingerprint ||
    candidate.configurationFingerprint !== marker.configurationFingerprint ||
    !validProductionAcceptanceComponentFingerprintsV2(candidate.componentFingerprints) ||
    !safeSha256(candidate.storageAuthorityFingerprint) ||
    !safeSha256(candidate.artifactInventoryFingerprint) ||
    !safeSha256(candidate.recoveryStateFingerprint) ||
    candidate.strictProductionAcceptance !== true || candidate.publishMode !== "package-only" ||
    candidate.productionExecutionAuthorized !== false || !safeSha256(candidate.integrity) ||
    candidate.publicationReceiptPolicyVersion !== legacyReauthorizationReceiptPolicyVersion ||
    !safeSha256(candidate.publicationGenerationId)
  ) return false;
  const { integrity, ...body } = candidate as ProductionAcceptanceLegacyReauthorizationV1;
  return integrity === integrityFor(body as unknown as Record<string, unknown>);
}

export function validateLegacyPublicationReceipt(value: unknown): value is ProductionAcceptanceLegacyPublicationReceiptV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProductionAcceptanceLegacyPublicationReceiptV1>;
  const source = candidate.sourceMarker, archive = candidate.archive, sidecar = candidate.authoritySidecar;
  if (candidate.receiptSchemaVersion !== "production-acceptance-legacy-publication-receipt-v1" ||
    candidate.receiptPolicyVersion !== legacyReauthorizationReceiptPolicyVersion ||
    candidate.protocolVersion !== legacyReauthorizationSchemaVersion || !safeSlug(candidate.projectSlug) ||
    !source || !archive || !sidecar || !safeSha256(candidate.reauthorizationId) ||
    !safeSha256(candidate.publicationGenerationId) || !validBoundFile(source) || !validBoundFile(archive) ||
    !validBoundFile(sidecar) || sidecar.locator !== legacyReauthorizationAuthorityFile ||
    archive.locator === undefined || typeof archive.locator !== "string" ||
    candidate.strictProductionAcceptance !== true || candidate.publishMode !== "package-only" ||
    !safeSha256(candidate.storageAuthorityFingerprint) || !safeSha256(candidate.artifactInventoryFingerprint) ||
    !safeSha256(candidate.recoveryStateFingerprint) || !safeSha256(candidate.configurationFingerprint) ||
    !safeSha256(candidate.integrity)) return false;
  const { integrity, ...body } = candidate as ProductionAcceptanceLegacyPublicationReceiptV1;
  return integrity === integrityFor(body as unknown as Record<string, unknown>);
}

function readAuthorityFile(filePath: string) {
  const bytes = readExact(filePath);
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!validateLegacyAuthority(value)) throw conflict();
  return value;
}

function readLegacyValidation(projectFolder: string, reauthorizationId: string) {
  const filePath = path.join(projectFolder, VALIDATION_FILE);
  if (!fs.existsSync(filePath)) return undefined;
  const value = readValidationFile(filePath);
  if (value.reauthorizationId !== reauthorizationId) throw conflict();
  return value;
}

function readValidationFile(filePath: string) {
  const value = JSON.parse(readExact(filePath).toString("utf8")) as Record<string, unknown>;
  const { integrity, ...body } = value;
  if (
    value.schemaVersion !== "production-acceptance-legacy-validation-v1" ||
    !safeSha256(value.reauthorizationId) || typeof value.validatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.validatedAt)) || value.productionReady !== true ||
    value.published !== false || !safeSha256(integrity) ||
    integrity !== integrityFor(body)
  ) throw conflict();
  return value as { reauthorizationId: string; validatedAt: string };
}

function verifyArchive(
  projectFolder: string,
  authority: ProductionAcceptanceLegacyReauthorizationV1,
  markerBytes: Buffer,
  admission = false,
): DescriptorBoundFileSnapshot {
  const snapshot = readLegacyArchiveDescriptorBound(projectFolder, authority.sourceMarker.archiveLocator);
  if (!snapshot.bytes.equals(markerBytes) ||
    sha256Bytes(snapshot.bytes) !== authority.sourceMarker.archiveSha256 ||
    snapshot.deviceIdentity !== authority.sourceMarker.archiveDeviceIdentity ||
    snapshot.inodeIdentity !== authority.sourceMarker.archiveInodeIdentity) {
    if (admission) throw admissionConflict(
      "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_ARCHIVE_MISMATCH",
      authority.projectSlug,
      "persistence",
    );
    throw conflict();
  }
  return snapshot;
}

function verifyReceipt(authority: ProductionAcceptanceLegacyReauthorizationV1,
  sidecar: ReturnType<typeof readLegacyReauthorizationAuthorityDescriptorBound>, archive: DescriptorBoundFileSnapshot,
  receiptSnapshot: ReturnType<typeof readLegacyPublicationReceiptDescriptorBound>, projectSlug: string) {
  const receipt = receiptSnapshot.receipt;
  if (receipt.projectSlug !== projectSlug || receipt.reauthorizationId !== authority.reauthorizationId ||
    receipt.publicationGenerationId !== authority.publicationGenerationId ||
    receipt.sourceMarker.sha256 !== authority.sourceMarker.sha256 ||
    receipt.sourceMarker.byteLength !== authority.sourceMarker.byteLength ||
    receipt.sourceMarker.deviceIdentity !== authority.sourceMarker.deviceIdentity ||
    receipt.sourceMarker.inodeIdentity !== authority.sourceMarker.inodeIdentity ||
    receipt.archive.locator !== authority.sourceMarker.archiveLocator || receipt.archive.sha256 !== archive.sha256 ||
    receipt.archive.byteLength !== archive.byteLength || receipt.archive.deviceIdentity !== archive.deviceIdentity ||
    receipt.archive.inodeIdentity !== archive.inodeIdentity || receipt.authoritySidecar.sha256 !== sidecar.sha256 ||
    receipt.authoritySidecar.byteLength !== sidecar.byteLength ||
    receipt.authoritySidecar.deviceIdentity !== sidecar.deviceIdentity ||
    receipt.authoritySidecar.inodeIdentity !== sidecar.inodeIdentity ||
    receipt.configurationFingerprint !== authority.configurationFingerprint ||
    receipt.storageAuthorityFingerprint !== authority.storageAuthorityFingerprint ||
    receipt.artifactInventoryFingerprint !== authority.artifactInventoryFingerprint ||
    receipt.recoveryStateFingerprint !== authority.recoveryStateFingerprint) {
    throw admissionConflict("PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ADMISSION_PUBLICATION_RECEIPT_MISMATCH",
      projectSlug, "persistence");
  }
}

function validBoundFile(value: { sha256?: unknown; byteLength?: unknown; deviceIdentity?: unknown; inodeIdentity?: unknown }) {
  return safeSha256(value.sha256) && Number.isSafeInteger(value.byteLength) && (value.byteLength as number) > 0 &&
    safeSha256(value.deviceIdentity) && safeSha256(value.inodeIdentity);
}

function publishExactNoClobber(finalPath: string, bytes: Buffer, partialName: string) {
  if (fs.existsSync(finalPath)) {
    if (!readExact(finalPath).equals(bytes)) throw conflict();
    return;
  }
  const partialPath = path.join(path.dirname(finalPath), partialName);
  if (fs.existsSync(partialPath)) {
    if (!readExact(partialPath).equals(bytes)) {
      throw new ProductionAcceptanceLegacyReauthorizationError(
        "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_REQUIRED",
        undefined,
        "persistence",
      );
    }
  } else {
    writeSynced(partialPath, bytes);
  }
  try {
    fs.linkSync(partialPath, finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw persistence();
  }
  if (!readExact(finalPath).equals(bytes)) throw conflict();
  syncDirectory(path.dirname(finalPath));
}

function writeSynced(filePath: string, bytes: Buffer) {
  const descriptor = fs.openSync(filePath, "wx+", 0o600);
  let firstError: unknown;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !reliable(opened.dev, opened.ino)) throw new Error("identity");
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(written) || written <= 0) throw new Error("write");
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const readback = fs.readFileSync(descriptor);
    const verified = fs.fstatSync(descriptor);
    if (verified.dev !== opened.dev || verified.ino !== opened.ino ||
      verified.size !== bytes.length || !readback.equals(bytes)) throw new Error("readback");
  } catch (error) {
    firstError = error;
  }
  try { fs.closeSync(descriptor); } catch (error) { firstError ??= error; }
  if (firstError) throw persistence();
}

function readExact(filePath: string) {
  return readExactSnapshot(filePath).bytes;
}

function readExactSnapshot(filePath: string) {
  const link = fs.lstatSync(filePath, { bigint: true });
  if (!link.isFile() || link.isSymbolicLink()) throw conflict();
  const descriptor = fs.openSync(filePath, "r");
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const final = fs.lstatSync(filePath, { bigint: true });
    if (!before.isFile() || !reliable(before.dev, before.ino) ||
      before.dev !== link.dev || before.ino !== link.ino || before.size !== link.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      final.dev !== before.dev || final.ino !== before.ino || final.size !== before.size ||
      BigInt(bytes.length) !== before.size) throw conflict();
    return { bytes,
      deviceIdentity: sha256Bytes(canonicalJson({ policyVersion: "production-acceptance-marker-identity-v1",
        kind: "device", unsignedDecimalValue: before.dev.toString(10) })),
      inodeIdentity: sha256Bytes(canonicalJson({ policyVersion: "production-acceptance-marker-identity-v1",
        kind: "inode", unsignedDecimalValue: before.ino.toString(10) })) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDirectory(parent: string, name: string) {
  const candidate = path.join(parent, name);
  try { fs.mkdirSync(candidate, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw persistence(); }
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw conflict();
  return candidate;
}

function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function reliable(device: number | bigint, inode: number | bigint) {
  if (typeof device === "bigint" && typeof inode === "bigint") {
    return device > BigInt(0) && inode > BigInt(0);
  }
  return typeof device === "number" && typeof inode === "number" &&
    Number.isFinite(device) && Number.isInteger(device) && device > 0 &&
    Number.isFinite(inode) && Number.isInteger(inode) && inode > 0;
}

function safeSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(value);
}

function conflict() {
  return new ProductionAcceptanceLegacyReauthorizationError(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_AUTHORITY_CONFLICT",
    undefined,
    "persistence",
  );
}

function persistence() {
  return new ProductionAcceptanceLegacyReauthorizationError(
    "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_PERSISTENCE_FAILED",
    undefined,
    "persistence",
  );
}

function admissionConflict(
  code: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[0],
  projectSlug: string,
  category: ConstructorParameters<typeof ProductionAcceptanceLegacyReauthorizationError>[2],
) {
  return new ProductionAcceptanceLegacyReauthorizationError(code, projectSlug, category);
}
