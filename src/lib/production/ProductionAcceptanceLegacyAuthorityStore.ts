import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  integrityFor,
  legacyReauthorizationAuthorityFile,
  legacyReauthorizationPolicyVersion,
  legacyReauthorizationReason,
  legacyReauthorizationSchemaVersion,
  ProductionAcceptanceLegacyReauthorizationError,
  safeSha256,
  sha256Bytes,
  type ProductionAcceptanceEffectiveMarkerV3Profile2,
  type ProductionAcceptanceLegacyReauthorizationV1,
  type ReauthorizationDecision,
} from "./ProductionAcceptanceLegacyReauthorization";
import {
  productionAcceptancePortableConfigurationFingerprintV2,
  validProductionAcceptanceComponentFingerprintsV2,
} from "./ProductionAcceptanceConfigurationFingerprint";

const AUTHORITY_DIRECTORY = "production-acceptance-authority";
const LEGACY_DIRECTORY = "legacy";
const VALIDATION_FILE = "production-acceptance-validation.json";

export function legacyArchiveLocator(sourceMarkerSha256: string) {
  if (!safeSha256(sourceMarkerSha256)) throw conflict();
  return `${AUTHORITY_DIRECTORY}/${LEGACY_DIRECTORY}/${sourceMarkerSha256}.json`;
}

export function publishLegacyArchive(input: {
  readonly projectFolder: string;
  readonly markerBytes: Buffer;
  readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
}): void {
  const authorityRoot = ensureDirectory(input.projectFolder, AUTHORITY_DIRECTORY);
  const legacyRoot = ensureDirectory(authorityRoot, LEGACY_DIRECTORY);
  const archivePath = path.join(legacyRoot, `${input.authority.sourceMarker.sha256}.json`);
  publishExactNoClobber(
    archivePath,
    input.markerBytes,
    `.archive-${input.authority.reauthorizationId}.partial`,
  );
  verifyArchive(input.projectFolder, input.authority, input.markerBytes);
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

export function readLegacyReauthorizationAuthority(input: {
  readonly projectFolder: string;
  readonly projectSlug: string;
  readonly markerBytes: Buffer;
  readonly markerValue: Record<string, unknown>;
}): { readonly status: "absent" } | {
  readonly status: "valid";
  readonly authority: ProductionAcceptanceLegacyReauthorizationV1;
  readonly effectiveMarker: ProductionAcceptanceEffectiveMarkerV3Profile2;
} {
  const authorityPath = path.join(input.projectFolder, legacyReauthorizationAuthorityFile);
  if (!fs.existsSync(authorityPath)) return { status: "absent" };
  try {
    const authority = readAuthorityFile(authorityPath);
    if (
      authority.projectSlug !== input.projectSlug ||
      authority.runId !== input.markerValue.runId ||
      authority.topicFingerprint !== input.markerValue.topicFingerprint ||
      authority.sourceMarker.sha256 !== sha256Bytes(input.markerBytes) ||
      authority.sourceMarker.byteLength !== input.markerBytes.length ||
      authority.sourceMarker.legacyConfigurationFingerprint !== input.markerValue.configurationFingerprint ||
      authority.effectiveMarker.runId !== input.markerValue.runId ||
      authority.effectiveMarker.topic !== input.markerValue.topic ||
      authority.effectiveMarker.topicFingerprint !== input.markerValue.topicFingerprint ||
      authority.effectiveMarker.createdAt !== input.markerValue.createdAt ||
      authority.configurationFingerprint !== authority.effectiveMarker.configurationFingerprint ||
      canonicalJson(authority.componentFingerprints) !== canonicalJson(authority.effectiveMarker.componentFingerprints)
    ) throw new Error("binding");
    verifyArchive(input.projectFolder, authority, input.markerBytes);
    const validation = readLegacyValidation(input.projectFolder, authority.reauthorizationId);
    const effectiveMarker = validation
      ? Object.freeze({
          ...authority.effectiveMarker,
          acceptanceStatus: "validated" as const,
          productionReady: true as const,
          validatedAt: validation.validatedAt,
        })
      : authority.effectiveMarker;
    return { status: "valid", authority, effectiveMarker: effectiveMarker as ProductionAcceptanceEffectiveMarkerV3Profile2 };
  } catch {
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
    !safeSha256(source.legacyConfigurationFingerprint) ||
    source.archiveLocator !== legacyArchiveLocator(source.sha256) ||
    source.archiveSha256 !== source.sha256 || !marker ||
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
    candidate.productionExecutionAuthorized !== false || !safeSha256(candidate.integrity)
  ) return false;
  const { integrity, ...body } = candidate as ProductionAcceptanceLegacyReauthorizationV1;
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
) {
  const archivePath = path.join(projectFolder, ...authority.sourceMarker.archiveLocator.split("/"));
  const bytes = readExact(archivePath);
  if (!bytes.equals(markerBytes) || sha256Bytes(bytes) !== authority.sourceMarker.archiveSha256) throw conflict();
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
  const link = fs.lstatSync(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw conflict();
  const descriptor = fs.openSync(filePath, "r");
  try {
    const before = fs.fstatSync(descriptor);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const final = fs.lstatSync(filePath);
    if (!before.isFile() || !reliable(before.dev, before.ino) ||
      before.dev !== link.dev || before.ino !== link.ino || before.size !== link.size ||
      after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
      final.dev !== before.dev || final.ino !== before.ino || final.size !== before.size ||
      bytes.length !== before.size) throw conflict();
    return bytes;
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

function reliable(device: number, inode: number) {
  return Number.isFinite(device) && Number.isInteger(device) && device > 0 &&
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
