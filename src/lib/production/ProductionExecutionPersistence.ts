import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy, evaluateProductionExecutionIdempotencyReplay, validateProductionExecutionIdempotencyReservation } from "./ProductionExecutionIdempotency";
import { buildProductionExecutionTransactionPlan, defaultProductionExecutionTransactionPolicy, validateProductionExecutionTransactionPlan } from "./ProductionExecutionTransaction";
import { buildProductionOperationJournalEvent, defaultProductionOperationJournalPolicy, validateProductionOperationJournalSequence } from "./ProductionOperationJournal";
import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionExecutionIdempotencyIdentity, ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionAuthorizationResult } from "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "@/types/productionExecutionConfirmation";
import type { ProductionExecutionTransactionPlan } from "@/types/productionExecutionTransaction";
import type { ProductionOperationJournalEvent } from "@/types/productionOperationJournal";
import type { ProductionExecutionPersistenceAdapter, ProductionExecutionPersistenceDiagnostic, ProductionExecutionPersistenceErrorCode, ProductionExecutionPersistenceListResult, ProductionExecutionPersistencePayloadByKind, ProductionExecutionPersistenceReadResult, ProductionExecutionPersistenceRecordKind, ProductionExecutionPersistenceWriteResult } from "@/types/productionExecutionPersistence";
import { productionExecutionDurableRecoverySchemaVersion, productionExecutionDerivedIndexVersion, type ProductionExecutionDerivedLookupEntry, type ProductionExecutionDerivedLookupIndex, type ProductionExecutionDirectoryDurabilityResult, type ProductionExecutionIndexResult, type ProductionExecutionRecoveryApplyRequest, type ProductionExecutionRecoveryApplyResult, type ProductionExecutionRecoveryFinding, type ProductionExecutionRecoveryReasonCode, type ProductionExecutionRecoveryScanResult } from "@/types/productionExecutionDurableRecovery";

export interface TrustedProductionExecutionPersistenceFileOperations {
  access(filePath: string): Promise<void>;
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  readdir(directoryPath: string): Promise<string[]>;
  writeFile(filePath: string, data: string, options: { encoding: "utf8"; flag: "wx" }): Promise<unknown>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
}

export interface ProductionExecutionDurableRecoveryOptions {
  /** Trusted composition-root storage location; never pass request-controlled input. */
  trustedRootDirectory: string;
  trustedFileOperations?: TrustedProductionExecutionPersistenceFileOperations;
  trustedAttemptIdFactory?: () => string;
}

export interface ProductionExecutionFilePersistenceOptions {
  /** Trusted composition-root storage location; never pass user-controlled input. */
  trustedRootDirectory: string;
  createRootDirectory?: boolean;
  /** Trusted internal test/composition dependency, not request-controlled configuration. */
  trustedFileOperations?: TrustedProductionExecutionPersistenceFileOperations;
  trustedAttemptIdFactory?: () => string;
}

const defaultFileOperations: TrustedProductionExecutionPersistenceFileOperations = fs;
const keyPattern = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const reservedDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const kinds: Readonly<Record<ProductionExecutionPersistenceRecordKind, string>> = { transaction: "transactions", journal: "journals", idempotency: "idempotency", reservation: "reservations", claim: "claims", attempt: "attempts" };

export class ProductionExecutionFilePersistenceAdapter implements ProductionExecutionPersistenceAdapter {
  private readonly root: string;
  private readonly createDirectory: boolean;
  private readonly operations: TrustedProductionExecutionPersistenceFileOperations;
  private readonly attemptId: () => string;

  constructor(options: ProductionExecutionFilePersistenceOptions) {
    this.root = path.resolve(options.trustedRootDirectory);
    this.createDirectory = options.createRootDirectory ?? true;
    this.operations = options.trustedFileOperations ?? defaultFileOperations;
    this.attemptId = options.trustedAttemptIdFactory ?? randomUUID;
  }

  async write<K extends ProductionExecutionPersistenceRecordKind>(kind: K, key: string, value: ProductionExecutionPersistencePayloadByKind[K]): Promise<ProductionExecutionPersistenceWriteResult<K>> {
    if (!validKey(kind, key)) return failure(kind, key, "PERSISTENCE_INVALID_INPUT");
    const canonical = canonicalJson(value);
    if (!canonical.ok) return failure(kind, key, "PERSISTENCE_SERIALIZATION_FAILED");
    const validation = validatePayload(kind, canonical.value);
    if (!validation.valid) return failure(kind, key, validation.schemaUnsupported ? "PERSISTENCE_SCHEMA_UNSUPPORTED" : "PERSISTENCE_INVALID_INPUT");
    const directory = this.directory(kind);
    const directoryResult = await this.ensureDirectory(directory);
    if (directoryResult) return failure(kind, key, directoryResult.errorCode, [directoryResult.diagnostic]);
    const target = this.target(kind, key);
    const existing = await this.readCanonical(kind, key, target);
    if (existing.status !== "not-found") return writeFromExisting(kind, key, canonical.text, existing);

    let attempt: string;
    try { attempt = this.attemptId(); } catch (error) { return failure(kind, key, "PERSISTENCE_TEMP_WRITE_FAILED", [diagnostic("temp-write", error, false)]); }
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(attempt)) return failure(kind, key, "PERSISTENCE_TEMP_WRITE_FAILED");
    const temporary = `${target}.${attempt}.tmp`;
    let ownsTemporary = false;
    try {
      await this.operations.writeFile(temporary, `${canonical.text}\n`, { encoding: "utf8", flag: "wx" });
      ownsTemporary = true;
    } catch (error) {
      return failure(kind, key, "PERSISTENCE_TEMP_WRITE_FAILED", [diagnostic("temp-write", error, errorCode(error) !== "EEXIST")]);
    }

    const temporaryRead = await this.readCanonical(kind, key, temporary, "temp-read");
    if (temporaryRead.status !== "found" || temporaryRead.text !== canonical.text) {
      const cleanupDiagnostic = ownsTemporary ? await cleanup(this.operations, temporary) : undefined;
      return failure(kind, key, "PERSISTENCE_TEMP_VALIDATION_FAILED", diagnostics(...temporaryRead.diagnostics, cleanupDiagnostic));
    }

    try {
      await this.operations.link(temporary, target);
    } catch (error) {
      const cleanupDiagnostic = ownsTemporary ? await cleanup(this.operations, temporary) : undefined;
      if (errorCode(error) === "EEXIST") {
        const winner = await this.readCanonical(kind, key, target);
        const result = writeFromExisting(kind, key, canonical.text, winner);
        return withDiagnostics(result, cleanupDiagnostic);
      }
      return failure(kind, key, "PERSISTENCE_COMMIT_FAILED", diagnostics(diagnostic("commit", error, false), cleanupDiagnostic));
    }
    const cleanupDiagnostic = ownsTemporary ? await cleanup(this.operations, temporary) : undefined;
    return cleanupDiagnostic ? { ok: true, status: "created", kind, key, diagnostics: [cleanupDiagnostic] } : { ok: true, status: "created", kind, key };
  }

  async read<K extends ProductionExecutionPersistenceRecordKind>(kind: K, key: string): Promise<ProductionExecutionPersistenceReadResult<K>> {
    if (!validKey(kind, key)) return { ok: false, status: "failed", kind, key, errorCode: "PERSISTENCE_INVALID_INPUT" };
    const result = await this.readCanonical(kind, key, this.target(kind, key));
    if (result.status === "not-found") return { ok: false, status: "not-found", kind, key, errorCode: "PERSISTENCE_NOT_FOUND" };
    if (result.status === "failed") return { ok: false, status: "failed", kind, key, errorCode: result.errorCode, diagnostics: result.diagnostics };
    return { ok: true, status: "found", kind, key, value: result.value as ProductionExecutionPersistencePayloadByKind[K] };
  }

  async listKeys<K extends ProductionExecutionPersistenceRecordKind>(kind: K): Promise<ProductionExecutionPersistenceListResult<K>> {
    try {
      const names = await this.operations.readdir(this.directory(kind));
      return { ok: true, status: "listed", kind, keys: names.filter((name) => name.endsWith(".json") && !name.includes(".tmp")).map((name) => name.slice(0, -5)).sort() };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { ok: true, status: "listed", kind, keys: [] };
      return { ok: false, status: "failed", kind, errorCode: "PERSISTENCE_READ_FAILED", diagnostics: [diagnostic("read", error, false)] };
    }
  }

  private async ensureDirectory(directory: string): Promise<{ errorCode: "PERSISTENCE_DIRECTORY_MISSING" | "PERSISTENCE_READ_FAILED"; diagnostic: ProductionExecutionPersistenceDiagnostic } | undefined> {
    try { if (this.createDirectory) await this.operations.mkdir(directory, { recursive: true }); else await this.operations.access(directory); return undefined; }
    catch (error) { return { errorCode: errorCode(error) === "ENOENT" ? "PERSISTENCE_DIRECTORY_MISSING" : "PERSISTENCE_READ_FAILED", diagnostic: diagnostic("directory", error, false) }; }
  }

  private async readCanonical<K extends ProductionExecutionPersistenceRecordKind>(kind: K, key: string, filePath: string, operation: "read" | "temp-read" = "read"): Promise<CanonicalRead<K>> {
    try {
      const text = await this.operations.readFile(filePath, "utf8");
      let value: unknown;
      try { value = JSON.parse(text); } catch { return { status: "failed", errorCode: "PERSISTENCE_RECORD_CORRUPT", diagnostics: [] }; }
      const canonical = canonicalJson(value);
      if (!canonical.ok || !validatePayload(kind, canonical.value).valid) return { status: "failed", errorCode: "PERSISTENCE_RECORD_CORRUPT", diagnostics: [] };
      return { status: "found", value: canonical.value as ProductionExecutionPersistencePayloadByKind[K], text: canonical.text, diagnostics: [] };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { status: "not-found", diagnostics: [] };
      return { status: "failed", errorCode: operation === "temp-read" ? "PERSISTENCE_TEMP_VALIDATION_FAILED" : "PERSISTENCE_READ_FAILED", diagnostics: [diagnostic(operation, error, false)] };
    }
  }

  private directory(kind: ProductionExecutionPersistenceRecordKind) { return path.join(this.root, kinds[kind]); }
  private target(kind: ProductionExecutionPersistenceRecordKind, key: string) { return path.join(this.directory(kind), `${key}.json`); }
}

/** Explicit, caller-driven recovery/index boundary. No startup hook, timer, execution or queue integration. */
export class ProductionExecutionDurableRecoveryService {
  private readonly root: string;
  private readonly operations: TrustedProductionExecutionPersistenceFileOperations;
  private readonly attemptId: () => string;

  constructor(options: ProductionExecutionDurableRecoveryOptions) {
    this.root = path.resolve(options.trustedRootDirectory);
    this.operations = options.trustedFileOperations ?? defaultFileOperations;
    this.attemptId = options.trustedAttemptIdFactory ?? randomUUID;
  }

  async scan(): Promise<ProductionExecutionRecoveryScanResult> {
    const findings: ProductionExecutionRecoveryFinding[] = [];
    try {
      for (const [kind, directoryName] of [["idempotency", "idempotency"], ["reservation", "reservations"]] as const) {
        const directory = path.join(this.root, directoryName);
        let names: string[];
        try { names = (await this.operations.readdir(directory)).sort(); }
        catch (error) {
          if (errorCode(error) === "ENOENT") continue;
          return recoveryScan("indeterminate", "RECOVERY_RECORD_UNREADABLE", findings, [diagnostic("read", error, false)]);
        }
        const nameSet = new Set(names);
        for (const name of names) {
          const canonicalMatch = /^([a-z0-9][a-z0-9_-]{0,127})\.json$/.exec(name);
          const tempMatch = /^([a-z0-9][a-z0-9_-]{0,127}\.json)\.([a-zA-Z0-9-]{1,80})\.tmp$/.exec(name);
          if (canonicalMatch) {
            const artifactId = artifactIdentity(directoryName, name);
            const read = await this.readRecoveryArtifact(kind, path.join(directory, name));
            const canonicalReason = read.reasonCode === "RECOVERY_PARTIAL_ARTIFACT" ? "RECOVERY_RECORD_MALFORMED" : read.reasonCode;
            findings.push(recoveryFinding(artifactId, "canonical-record", read.classification, canonicalReason, canonicalReason !== "RECOVERY_RECORD_VALID", false, true));
          } else if (tempMatch) {
            const targetPresent = nameSet.has(tempMatch[1]);
            const read = await this.readRecoveryArtifact(kind, path.join(directory, name));
            const valid = read.reasonCode === "RECOVERY_RECORD_VALID";
            findings.push(recoveryFinding(artifactIdentity(directoryName, name), valid ? "orphan-temp" : "partial-artifact", valid ? "orphan" : read.classification, valid ? "RECOVERY_ORPHAN_TEMP" : read.reasonCode, !valid, valid, targetPresent));
          } else if (name.endsWith(".tmp") || name.includes(".json.")) {
            findings.push(recoveryFinding(artifactIdentity(directoryName, name), "partial-artifact", "ambiguous", "RECOVERY_ARTIFACT_AMBIGUOUS", true, false, false));
          }
        }
      }
      const canonical = await this.collectCanonicalRecords();
      if (canonical.error) return recoveryScan("indeterminate", canonical.error, findings, canonical.diagnostics);
      if (canonical.records.length || canonical.reservations.length) findings.push(...await this.inspectIndex(canonical.index));
      const required = findings.some((finding) => finding.recoveryRequired);
      return recoveryScan(required ? "recovery-required" : "clean", required ? "RECOVERY_REQUIRED" : "RECOVERY_STORAGE_CLEAN", findings);
    } catch {
      return recoveryScan("indeterminate", "RECOVERY_INDETERMINATE", findings);
    }
  }

  async rebuildIndex(): Promise<ProductionExecutionIndexResult> {
    const canonical = await this.collectCanonicalRecords();
    if (canonical.error) return indexResult(false, canonical.error, undefined, canonical.diagnostics);
    const scan = await this.scan();
    if (scan.findings.some((finding) => finding.artifactKind === "canonical-record" && finding.recoveryRequired)) return indexResult(false, "RECOVERY_REQUIRED");
    const index = canonical.index;
    const directory = path.join(this.root, "indexes");
    try { await this.operations.mkdir(directory, { recursive: true }); }
    catch (error) { return indexResult(false, "RECOVERY_APPLY_FAILED", undefined, [diagnostic("directory", error, false)]); }
    const target = path.join(directory, indexFile(index.sourceFingerprint));
    const existing = await this.readIndex(target);
    if (existing?.valid && existing.index && existing.index.integrity.fingerprint === index.integrity.fingerprint) return indexResult(true, "RECOVERY_RECORD_VALID", existing.index, undefined, false);
    if (existing && !existing.valid) return indexResult(false, existing.reasonCode);
    const attempt = this.safeAttempt();
    if (!attempt) return indexResult(false, "RECOVERY_APPLY_FAILED");
    const temporary = `${target}.${attempt}.tmp`;
    try {
      await this.operations.writeFile(temporary, `${JSON.stringify(index)}\n`, { encoding: "utf8", flag: "wx" });
      const verified = await this.readIndex(temporary);
      if (!verified?.valid) { await cleanup(this.operations, temporary); return indexResult(false, "RECOVERY_INDEX_INTEGRITY_MISMATCH"); }
      await this.operations.link(temporary, target);
      await cleanup(this.operations, temporary);
      return indexResult(true, "RECOVERY_RECORD_VALID", index, undefined, true);
    } catch (error) {
      const cleanupDiagnostic = await cleanup(this.operations, temporary);
      if (errorCode(error) === "EEXIST") {
        const winner = await this.readIndex(target);
        if (winner?.valid && winner.index?.integrity.fingerprint === index.integrity.fingerprint) return indexResult(true, "RECOVERY_RECORD_VALID", winner.index, cleanupDiagnostic ? [cleanupDiagnostic] : undefined, false);
      }
      return indexResult(false, "RECOVERY_APPLY_FAILED", undefined, diagnostics(diagnostic("commit", error, false), cleanupDiagnostic));
    }
  }

  async lookup(type: "reservation" | "idempotency-key" | "request-id", value: string): Promise<ProductionExecutionIndexResult> {
    if (!validLookup(value)) return indexResult(false, value.includes("..") ? "RECOVERY_TRAVERSAL_DENIED" : "RECOVERY_PATH_INVALID");
    const canonical = await this.collectCanonicalRecords();
    if (canonical.error) return indexResult(false, canonical.error, undefined, canonical.diagnostics);
    const read = await this.readIndex(path.join(this.root, "indexes", indexFile(canonical.index.sourceFingerprint)));
    if (!read) return indexResult(false, "RECOVERY_INDEX_MISSING");
    if (!read.valid || !read.index) return indexResult(false, read.reasonCode);
    const entries = type === "reservation" ? read.index.reservations : type === "idempotency-key" ? read.index.idempotencyKeys : read.index.requestIds;
    return indexResult(true, "RECOVERY_RECORD_VALID", read.index, undefined, false, entries.find((entry) => entry.key === value));
  }

  async apply(request: ProductionExecutionRecoveryApplyRequest): Promise<ProductionExecutionRecoveryApplyResult> {
    const finding = request.scan.findings.find((item) => item.artifactId === request.artifactId);
    if (!finding?.applyAllowed || finding.artifactKind !== "orphan-temp") return applyResult(false, "RECOVERY_APPLY_NOT_ALLOWED", false);
    const located = await this.locateArtifact(request.artifactId);
    if (!located) return applyResult(false, "RECOVERY_APPLY_NOT_ALLOWED", false);
    const parsed = await this.readRecoveryArtifact(located.kind, located.filePath);
    if (parsed.reasonCode !== "RECOVERY_RECORD_VALID") return applyResult(false, "RECOVERY_APPLY_NOT_ALLOWED", false);
    try {
      if (request.operation === "cleanup") await this.operations.unlink(located.filePath);
      else {
        if (!this.operations.rename) return applyResult(false, "RECOVERY_APPLY_NOT_ALLOWED", false);
        const quarantine = path.join(this.root, "quarantine");
        await this.operations.mkdir(quarantine, { recursive: true });
        await this.operations.rename(located.filePath, path.join(quarantine, `${request.artifactId}.quarantined`));
      }
      return applyResult(true, "RECOVERY_STORAGE_CLEAN", true);
    } catch (error) { return applyResult(false, "RECOVERY_APPLY_FAILED", false, [diagnostic("cleanup", error, true)]); }
  }

  private async collectCanonicalRecords(): Promise<{ records: ProductionExecutionDerivedLookupEntry[]; requestIds: ProductionExecutionDerivedLookupEntry[]; reservations: ProductionExecutionDerivedLookupEntry[]; index: ProductionExecutionDerivedLookupIndex; error?: ProductionExecutionRecoveryReasonCode; diagnostics?: ProductionExecutionPersistenceDiagnostic[] }> {
    const records: ProductionExecutionDerivedLookupEntry[] = [];
    const requestIds: ProductionExecutionDerivedLookupEntry[] = [];
    const reservations: ProductionExecutionDerivedLookupEntry[] = [];
    for (const [kind, directoryName] of [["idempotency", "idempotency"], ["reservation", "reservations"]] as const) {
      let names: string[];
      try { names = (await this.operations.readdir(path.join(this.root, directoryName))).filter((name) => /^[a-z0-9][a-z0-9_-]{0,127}\.json$/.test(name)).sort(); }
      catch (error) { if (errorCode(error) === "ENOENT") continue; return { records, requestIds, reservations, index: buildIndex(records, requestIds, reservations), error: "RECOVERY_RECORD_UNREADABLE", diagnostics: [diagnostic("read", error, false)] }; }
      for (const name of names) {
        const filePath = path.join(this.root, directoryName, name);
        const read = await this.readRecoveryArtifact(kind, filePath);
        if (read.reasonCode !== "RECOVERY_RECORD_VALID" || !isRecord(read.value)) continue;
        const canonicalKey = name.slice(0, -5);
        if (kind === "reservation") {
          const identity = read.value.identity;
          if (isRecord(identity)) reservations.push({ key: String(identity.idempotencyKey), recordId: String(identity.identityFingerprint), recordVersion: 1, canonicalKey });
        } else {
          const entry = { recordId: String(read.value.recordId), recordVersion: Number(read.value.recordVersion ?? (read.value.integrity as Record<string, unknown>)?.version), canonicalKey };
          records.push({ ...entry, key: String(read.value.idempotencyKey) });
          requestIds.push({ ...entry, key: String(read.value.requestId) });
        }
      }
    }
    const latest = [...new Map(records.sort((a, b) => a.recordId.localeCompare(b.recordId) || a.recordVersion - b.recordVersion).map((entry) => [entry.recordId, entry])).values()];
    const latestRequests = requestIds.filter((entry) => latest.some((record) => record.canonicalKey === entry.canonicalKey));
    return { records: latest, requestIds: latestRequests, reservations, index: buildIndex(latest, latestRequests, reservations) };
  }

  private async inspectIndex(expected: ProductionExecutionDerivedLookupIndex): Promise<ProductionExecutionRecoveryFinding[]> {
    const directory = path.join(this.root, "indexes");
    let names: string[];
    try { names = (await this.operations.readdir(directory)).filter((name) => name.endsWith(".json")).sort(); }
    catch (error) { return errorCode(error) === "ENOENT" ? [recoveryFinding(artifactIdentity("indexes", indexFile(expected.sourceFingerprint)), "derived-index", "missing", "RECOVERY_INDEX_MISSING", true, false, false)] : [recoveryFinding(artifactIdentity("indexes", "unreadable"), "derived-index", "unreadable", "RECOVERY_RECORD_UNREADABLE", true, false, false)]; }
    if (!names.includes(indexFile(expected.sourceFingerprint))) return [recoveryFinding(artifactIdentity("indexes", indexFile(expected.sourceFingerprint)), "derived-index", names.length ? "stale" : "missing", names.length ? "RECOVERY_INDEX_STALE" : "RECOVERY_INDEX_MISSING", true, false, false)];
    const read = await this.readIndex(path.join(directory, indexFile(expected.sourceFingerprint)));
    if (!read?.valid) return [recoveryFinding(artifactIdentity("indexes", indexFile(expected.sourceFingerprint)), "derived-index", read?.reasonCode === "RECOVERY_INDEX_INTEGRITY_MISMATCH" ? "integrity-mismatch" : "malformed", read?.reasonCode ?? "RECOVERY_INDEX_MALFORMED", true, false, true)];
    return [recoveryFinding(artifactIdentity("indexes", indexFile(expected.sourceFingerprint)), "derived-index", "valid", "RECOVERY_RECORD_VALID", false, false, true)];
  }

  private async readRecoveryArtifact(kind: "idempotency" | "reservation", filePath: string): Promise<{ classification: ProductionExecutionRecoveryFinding["classification"]; reasonCode: ProductionExecutionRecoveryReasonCode; value?: unknown }> {
    try {
      const text = await this.operations.readFile(filePath, "utf8");
      let value: unknown;
      try { value = JSON.parse(text); } catch { return { classification: "malformed", reasonCode: "RECOVERY_PARTIAL_ARTIFACT" }; }
      if (!isRecord(value)) return { classification: "malformed", reasonCode: "RECOVERY_RECORD_MALFORMED" };
      if (value.schemaVersion !== "1") return { classification: "unsupported-version", reasonCode: "RECOVERY_SCHEMA_UNSUPPORTED", value };
      if (kind === "idempotency" && "storageVersion" in value && value.storageVersion !== "1") return { classification: "unsupported-version", reasonCode: "RECOVERY_STORAGE_VERSION_UNSUPPORTED", value };
      if (!validatePayload(kind, value).valid) return { classification: "integrity-mismatch", reasonCode: "RECOVERY_INTEGRITY_MISMATCH", value };
      if (kind === "idempotency" && (value.storageVersion !== "1" || value.lifecycleState !== value.state || value.recordVersion !== (value.integrity as Record<string, unknown>).version)) return { classification: "integrity-mismatch", reasonCode: "RECOVERY_INTEGRITY_MISMATCH", value };
      return { classification: "valid", reasonCode: "RECOVERY_RECORD_VALID", value };
    } catch (error) { return { classification: errorCode(error) === "ENOENT" ? "missing" : "unreadable", reasonCode: errorCode(error) === "ENOENT" ? "RECOVERY_RECORD_MISSING" : "RECOVERY_RECORD_UNREADABLE" }; }
  }

  private async readIndex(filePath: string): Promise<{ valid: boolean; reasonCode: ProductionExecutionRecoveryReasonCode; index?: ProductionExecutionDerivedLookupIndex } | undefined> {
    try {
      const value = JSON.parse(await this.operations.readFile(filePath, "utf8")) as unknown;
      if (!indexShape(value)) return { valid: false, reasonCode: "RECOVERY_INDEX_MALFORMED" };
      const { integrity, ...body } = value;
      if (integrity.fingerprint !== digest(body)) return { valid: false, reasonCode: "RECOVERY_INDEX_INTEGRITY_MISMATCH" };
      return { valid: true, reasonCode: "RECOVERY_RECORD_VALID", index: value };
    } catch (error) { return errorCode(error) === "ENOENT" ? undefined : { valid: false, reasonCode: errorCode(error) === "UNKNOWN" ? "RECOVERY_INDEX_MALFORMED" : "RECOVERY_RECORD_UNREADABLE" }; }
  }

  private async locateArtifact(artifactId: string): Promise<{ kind: "idempotency" | "reservation"; filePath: string } | undefined> {
    for (const [kind, directoryName] of [["idempotency", "idempotency"], ["reservation", "reservations"]] as const) {
      let names: string[]; try { names = await this.operations.readdir(path.join(this.root, directoryName)); } catch { continue; }
      for (const name of names) if (/\.json\.[a-zA-Z0-9-]{1,80}\.tmp$/.test(name) && artifactIdentity(directoryName, name) === artifactId) return { kind, filePath: path.join(this.root, directoryName, name) };
    }
    return undefined;
  }

  private safeAttempt() { try { const value = this.attemptId(); return /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : undefined; } catch { return undefined; } }
}

export function evaluateProductionExecutionDirectoryDurability(input: { platform: string; directorySyncSupported: boolean; syncOutcome?: "succeeded" | "failed" | "indeterminate" }): ProductionExecutionDirectoryDurabilityResult {
  if (!input.platform || typeof input.directorySyncSupported !== "boolean") return directoryDurability("indeterminate");
  if (!input.directorySyncSupported) return directoryDurability("unsupported");
  if (input.syncOutcome === "succeeded") return directoryDurability("supported");
  if (input.syncOutcome === "failed") return directoryDurability("failed");
  return directoryDurability("indeterminate");
}

type CanonicalRead<K extends ProductionExecutionPersistenceRecordKind> =
  | { status: "found"; value: ProductionExecutionPersistencePayloadByKind[K]; text: string; diagnostics: ProductionExecutionPersistenceDiagnostic[] }
  | { status: "not-found"; diagnostics: ProductionExecutionPersistenceDiagnostic[] }
  | { status: "failed"; errorCode: Exclude<ProductionExecutionPersistenceErrorCode, "PERSISTENCE_NOT_FOUND">; diagnostics: ProductionExecutionPersistenceDiagnostic[] };

function validatePayload(kind: ProductionExecutionPersistenceRecordKind, value: unknown): { valid: boolean; schemaUnsupported: boolean } {
  const schemaUnsupported = schemaOf(kind, value) !== "1";
  if (schemaUnsupported) return { valid: false, schemaUnsupported };
  try {
    if (kind === "journal") {
      if (!Array.isArray(value) || value.length === 0 || !value.every(journalShape)) return { valid: false, schemaUnsupported: false };
      const policy = { ...defaultProductionOperationJournalPolicy, enabled: true, policyVersion: (value[0] as ProductionOperationJournalEvent).correlation.policyVersion };
      return { valid: value.every((event) => journalIntegrityValid(event as ProductionOperationJournalEvent, policy)) && validateProductionOperationJournalSequence(value as ProductionOperationJournalEvent[], { policy }).valid, schemaUnsupported: false };
    }
    if (!isRecord(value)) return { valid: false, schemaUnsupported: false };
    if (kind === "transaction") {
      if (!transactionShape(value)) return { valid: false, schemaUnsupported: false };
      const policy = { ...defaultProductionExecutionTransactionPolicy, enabled: true, policyVersion: value.policyVersion as string };
      const plan = value as unknown as ProductionExecutionTransactionPlan;
      return { valid: validateProductionExecutionTransactionPlan(plan, { evaluatedAt: plan.plannedAt, policy }).valid && transactionIntegrityValid(plan, policy), schemaUnsupported: false };
    }
    if (kind === "idempotency") return { valid: idempotencyRecordValid(value), schemaUnsupported: false };
    if (kind === "claim") return { valid: durableClaimValid(value), schemaUnsupported: false };
    if (kind === "attempt") return { valid: durableAttemptValid(value), schemaUnsupported: false };
    return { valid: reservationValid(value), schemaUnsupported: false };
  } catch { return { valid: false, schemaUnsupported: false }; }
}

export function validateProductionExecutionPersistencePayload(kind: ProductionExecutionPersistenceRecordKind, value: unknown): boolean {
  return validatePayload(kind, value).valid;
}

function transactionShape(v: Record<string, unknown>) { return strings(v, ["transactionId","operationId","idempotencyRecordId","requestId","idempotencyKey","executionFingerprint","actorId","projectSlug","operation","action","policyVersion","plannedAt"]) && integer(v.attempt) && Array.isArray(v.steps) && v.steps.length > 0 && v.steps.every((s) => isRecord(s) && strings(s,["stepId","type","resource","expectedOutcome","failureMode","journalEventType","status"]) && integer(s.sequence) && arrays(s,["dependsOn","preconditions"])) && arrays(v,["resources","preconditions","postconditions"]) && isRecord(v.rollbackPlan) && typeof v.rollbackPlan.required === "boolean" && Array.isArray(v.rollbackPlan.steps) && isRecord(v.consistencyPlan) && typeof v.consistencyPlan.required === "boolean" && Array.isArray(v.consistencyPlan.checks) && isRecord(v.journalPlan) && typeof v.journalPlan.required === "boolean" && Array.isArray(v.journalPlan.eventTypes) && integrity(v.integrity); }
function journalShape(v: unknown): boolean { return isRecord(v) && v.schemaVersion === "1" && strings(v,["eventId","eventType","occurredAt","operationId","transactionId","idempotencyRecordId","requestId","idempotencyKey","actorId","projectSlug","operation","action"]) && integer(v.sequence) && integer(v.attempt) && Array.isArray(v.evidence) && isRecord(v.correlation) && strings(v.correlation,["correlationId","authorizationDecisionId","confirmationId","executionFingerprint","bindingFingerprint","policyVersion"]) && integrity(v.integrity); }
function idempotencyRecordValid(v: Record<string, unknown>): boolean { if (!strings(v,["recordId","identityFingerprint","idempotencyKey","requestId","executionFingerprint","bindingFingerprint","actorId","projectSlug","operation","action","authorizationDecisionId","confirmationRequestId","confirmationId","policyVersion","riskLevel","state","createdAt","updatedAt"]) || !integer(v.attempt) || !integer(v.maxAttempts) || !Array.isArray(v.evidence) || !integrity(v.integrity) || ("durableLease" in v && !durableLeaseValid(v.durableLease))) return false; const identity = identityFromRecord(v); const policy = idempotencyPolicy(v.action as string, v.maxAttempts as number, v.policyVersion as string); const rebuilt = rebuildIdempotencyIdentity(v, policy); if (!rebuilt || canonicalJson(rebuilt).text !== canonicalJson(identity).text || (v.integrity as Record<string,unknown>).fingerprint !== rebuilt.identityFingerprint) return false; const replay = evaluateProductionExecutionIdempotencyReplay(v as unknown as ProductionExecutionIdempotencyRecord, rebuilt, { evaluatedAt: v.updatedAt as string, policy }); return replay.reasonCode !== "RECORD_STATE_UNKNOWN" && replay.decision !== "indeterminate"; }
function durableLeaseValid(value:unknown){if(!isRecord(value)||value.schemaVersion!=="1"||!isRecord(value.identity)||!strings(value.identity,["leaseId","workerId","workerSessionId","recordId","idempotencyKey","requestId","executionFingerprint"])||!["active","released","cancelled"].includes(value.status as string)||!strings(value,["acquiredAt","heartbeatAt","expiresAt"])||!integer(value.version)||!isRecord(value.ownership)||!strings(value.ownership,["ownerFingerprint","workerEvidence","sessionEvidence"])||!isRecord(value.integrity)||value.integrity.algorithm!=="stable-production-id-v1"||typeof value.integrity.fingerprint!=="string")return false;const acquired=Date.parse(value.acquiredAt as string),heartbeat=Date.parse(value.heartbeatAt as string),expires=Date.parse(value.expiresAt as string);if(!Number.isFinite(acquired)||!Number.isFinite(heartbeat)||!Number.isFinite(expires)||acquired>heartbeat||heartbeat>=expires)return false;if(value.status==="released"&&typeof value.releasedAt!=="string"||value.status==="cancelled"&&typeof value.cancelledAt!=="string")return false;const{integrity:unused,...body}=value;void unused;return value.integrity.fingerprint===stableProductionId("durable-lease-integrity",body);}
function durableClaimValid(value:Record<string,unknown>){if(value.storageVersion!=="1"||!isRecord(value.identity)||!strings(value.identity,["claimId","recordId","reservationId","requestId","idempotencyKey","executionFingerprint","workerId","workerSessionId","leaseId"])||!isRecord(value.binding)||!integer(value.binding.reservationVersion)||!integer(value.binding.idempotencyVersion)||!integer(value.binding.leaseVersion)||typeof value.binding.bindingFingerprint!=="string"||!isRecord(value.ownership)||!strings(value.ownership,["ownerFingerprint","reservationEvidence","idempotencyEvidence","leaseEvidence"])||!["active","released","abandoned"].includes(value.state as string)||!integer(value.claimVersion)||!strings(value,["acquiredAt","updatedAt"])||!Array.isArray(value.evidence)||!isRecord(value.integrity)||value.integrity.algorithm!=="stable-production-id-v1"||typeof value.integrity.fingerprint!=="string")return false;if(value.state==="released"&&typeof value.releasedAt!=="string"||value.state==="abandoned"&&typeof value.abandonedAt!=="string")return false;const{integrity:unused,...body}=value;void unused;return value.integrity.fingerprint===stableProductionId("durable-claim-integrity",body);}
function durableAttemptValid(value:Record<string,unknown>){if(value.storageVersion!=="1"||!isRecord(value.identity)||!strings(value.identity,["attemptId","claimId","reservationId","recordId","requestId","idempotencyKey","executionFingerprint","workerId","workerSessionId","leaseId"])||!isRecord(value.binding)||!integer(value.binding.claimVersion)||!integer(value.binding.leaseVersion)||!integer(value.binding.reservationVersion)||typeof value.binding.bindingFingerprint!=="string"||!["opened","active","outcome-proposed","succeeded","failed","cancelled","abandoned"].includes(value.state as string)||!integer(value.attemptVersion)||!strings(value,["openedAt","updatedAt"])||!Array.isArray(value.journal)||!Array.isArray(value.evidence)||!isRecord(value.integrity)||value.integrity.algorithm!=="stable-production-id-v1"||typeof value.integrity.fingerprint!=="string")return false;for(let index=0;index<value.journal.length;index++){const entry=value.journal[index];if(!isRecord(entry)||!strings(entry,["entryId","attemptId","entryType","recordedAt"])||entry.attemptId!==value.identity.attemptId||entry.sequence!==index+1||!isRecord(entry.payload)||!strings(entry.payload,["code","category","summary"])||!Array.isArray(entry.evidence)||!isRecord(entry.integrity))return false;const{integrity:entryIntegrity,...entryBody}=entry;if(entryIntegrity.algorithm!=="stable-production-id-v1"||entryIntegrity.fingerprint!==stableProductionId("attempt-journal-entry-integrity",entryBody))return false}const{integrity:unused,...body}=value;void unused;return value.integrity.fingerprint===stableProductionId("durable-attempt-integrity",body);}
function reservationValid(v: Record<string, unknown>): boolean { if (!isRecord(v.identity) || !authorizationShape(v.authorization) || !confirmationShape(v.confirmation) || !reservationBindingsMatch(v.identity,v.authorization,v.confirmation) || !strings(v,["requestedAt","expectedInitialState"]) || !integer(v.attempt) || !integer(v.maxAttempts) || !integer(v.reservationTtlSeconds) || !isRecord(v.policyContext) || v.policyContext.source !== "server" || !isRecord(v.metadata) || v.metadata.source !== "server") return false; const policy = idempotencyPolicy(v.identity.action as string, v.maxAttempts as number, v.identity.policyVersion as string, v.reservationTtlSeconds as number); const request = v as unknown as ProductionExecutionIdempotencyReservationRequest; if (!validateProductionExecutionIdempotencyReservation(request, policy).valid) return false; const rebuilt = buildProductionExecutionIdempotencyIdentity({ authorization: request.authorization, confirmation: request.confirmation }, { evaluatedAt: request.identity.createdAt, policy }); return rebuilt.ok && canonicalJson(rebuilt.identity).ok && canonicalJson(rebuilt.identity).text === canonicalJson(request.identity).text; }
function authorizationShape(v: unknown): v is ProductionExecutionIdempotencyReservationRequest["authorization"] { return isRecord(v) && v.schemaVersion === "1" && v.decision === "allow" && v.authorized === true && strings(v,["decisionId","reasonCode","reason","evaluatedAt","requestId","idempotencyKey","executionFingerprint","actorId","actorType","projectSlug","operation","action","policyVersion","risk","requiredConfirmationLevel"]) && arrays(v,["requiredCapabilities","grantedCapabilities","missingCapabilities","evidence"]) && typeof v.requiresConfirmation === "boolean"; }
function confirmationShape(v: unknown): v is ProductionExecutionIdempotencyReservationRequest["confirmation"] { return isRecord(v) && v.schemaVersion === "1" && v.decision === "valid" && v.valid === true && strings(v,["reasonCode","reason","evaluatedAt","confirmationId","confirmationRequestId","authorizationDecisionId","requestId","idempotencyKey","actorId","projectSlug","operation","action","riskLevel","requiredConfirmationLevel","providedConfirmationLevel","bindingFingerprint","policyVersion"]) && typeof v.bindingMatches === "boolean" && typeof v.expired === "boolean" && typeof v.singleUse === "boolean" && typeof v.consumed === "boolean" && Array.isArray(v.evidence); }
function reservationBindingsMatch(identity:Record<string,unknown>,authorization:ProductionExecutionIdempotencyReservationRequest["authorization"],confirmation:ProductionExecutionIdempotencyReservationRequest["confirmation"]){const shared=["requestId","idempotencyKey","actorId","projectSlug","operation","action","stage"] as const;return shared.every(key=>identity[key]===authorization[key]&&authorization[key]===confirmation[key])&&identity.authorizationDecisionId===authorization.decisionId&&authorization.decisionId===confirmation.authorizationDecisionId&&identity.confirmationRequestId===confirmation.confirmationRequestId&&identity.confirmationId===confirmation.confirmationId&&identity.executionFingerprint===authorization.executionFingerprint&&identity.bindingFingerprint===confirmation.bindingFingerprint&&identity.riskLevel===authorization.risk&&authorization.risk===confirmation.riskLevel;}
function journalIntegrityValid(event:ProductionOperationJournalEvent,policy:typeof defaultProductionOperationJournalPolicy){const {schemaVersion:unusedSchema,eventId,integrity:storedIntegrity,...input}=event;void unusedSchema;const rebuilt=buildProductionOperationJournalEvent(input,{policy});return rebuilt.ok&&rebuilt.event?.eventId===eventId&&rebuilt.event.integrity.fingerprint===storedIntegrity.fingerprint;}
function transactionIntegrityValid(plan:ProductionExecutionTransactionPlan,policy:typeof defaultProductionExecutionTransactionPolicy){const record:ProductionExecutionIdempotencyRecord={schemaVersion:"1",recordId:plan.idempotencyRecordId,identityFingerprint:plan.executionFingerprint,idempotencyKey:plan.idempotencyKey,requestId:plan.requestId,executionFingerprint:plan.executionFingerprint,bindingFingerprint:"persistence-transaction-validation",actorId:plan.actorId,projectSlug:plan.projectSlug,operation:plan.operation,action:plan.action,...(plan.stage?{stage:plan.stage}:{}),authorizationDecisionId:"persistence-transaction-validation",confirmationRequestId:"persistence-transaction-validation",confirmationId:"persistence-transaction-validation",policyVersion:plan.policyVersion,riskLevel:plan.riskLevel,state:"reserved",attempt:plan.attempt,maxAttempts:plan.attempt,createdAt:plan.plannedAt,updatedAt:plan.plannedAt,evidence:[],integrity:{algorithm:"stable-production-id-v1",fingerprint:plan.executionFingerprint,version:1}};const rebuilt=buildProductionExecutionTransactionPlan({record,authorizationValid:true,confirmationValid:true,reservationValid:true,resources:plan.resources},{plannedAt:plan.plannedAt,policy});return rebuilt.ok&&canonicalJson(rebuilt.plan).text===canonicalJson(plan).text;}
function rebuildIdempotencyIdentity(v:Record<string,unknown>,policy:ProductionExecutionIdempotencyPolicy){const authorization:ProductionExecutionAuthorizationResult={schemaVersion:"1",decisionId:v.authorizationDecisionId as string,decision:"allow",authorized:true,reasonCode:"AUTHORIZED",reason:"persistence-validation",evaluatedAt:v.createdAt as string,requestId:v.requestId as string,idempotencyKey:v.idempotencyKey as string,executionFingerprint:v.executionFingerprint as string,actorId:v.actorId as string,actorType:"system",projectSlug:v.projectSlug as string,operation:v.operation as string,action:v.action as string,...(typeof v.stage==="string"?{stage:v.stage}:{}),requiredCapabilities:[],grantedCapabilities:[],missingCapabilities:[],policyVersion:v.policyVersion as string,risk:v.riskLevel as ProductionExecutionAuthorizationResult["risk"],requiresConfirmation:true,requiredConfirmationLevel:"high",evidence:[]};const confirmation:ProductionExecutionConfirmationValidationResult={schemaVersion:"1",decision:"valid",valid:true,reasonCode:"CONFIRMATION_VALID",reason:"persistence-validation",evaluatedAt:v.createdAt as string,confirmationId:v.confirmationId as string,confirmationRequestId:v.confirmationRequestId as string,authorizationDecisionId:v.authorizationDecisionId as string,requestId:v.requestId as string,idempotencyKey:v.idempotencyKey as string,actorId:v.actorId as string,projectSlug:v.projectSlug as string,operation:v.operation as string,action:v.action as string,...(typeof v.stage==="string"?{stage:v.stage}:{}),riskLevel:v.riskLevel as string,requiredConfirmationLevel:"high",providedConfirmationLevel:"high",bindingMatches:true,bindingFingerprint:v.bindingFingerprint as string,expired:false,singleUse:true,consumed:false,policyVersion:v.policyVersion as string,evidence:[]};const rebuilt=buildProductionExecutionIdempotencyIdentity({authorization,confirmation},{evaluatedAt:v.createdAt as string,policy});return rebuilt.ok?rebuilt.identity:undefined;}
function identityFromRecord(v: Record<string, unknown>): ProductionExecutionIdempotencyIdentity { return { schemaVersion:"1",identityFingerprint:v.identityFingerprint as string,idempotencyKey:v.idempotencyKey as string,requestId:v.requestId as string,executionFingerprint:v.executionFingerprint as string,bindingFingerprint:v.bindingFingerprint as string,authorizationDecisionId:v.authorizationDecisionId as string,confirmationRequestId:v.confirmationRequestId as string,confirmationId:v.confirmationId as string,actorId:v.actorId as string,projectSlug:v.projectSlug as string,operation:v.operation as string,action:v.action as string,...(typeof v.stage === "string"?{stage:v.stage}:{}),policyVersion:v.policyVersion as string,riskLevel:v.riskLevel as ProductionExecutionIdempotencyIdentity["riskLevel"],createdAt:v.createdAt as string }; }
function idempotencyPolicy(action:string,max:number,version:string,ttl=300):ProductionExecutionIdempotencyPolicy { return {...defaultProductionExecutionIdempotencyPolicy,enabled:true,policyVersion:version,reservationTtlSeconds:ttl,maximumAttemptsByAction:{...defaultProductionExecutionIdempotencyPolicy.maximumAttemptsByAction,[action]:max}}; }

function canonicalJson(value: unknown): { ok: true; value: unknown; text: string } | { ok: false; text: "" } { try { const normalized=normalize(value,new Set()); return {ok:true,value:normalized,text:JSON.stringify(normalized)}; } catch { return {ok:false,text:""}; } }
function normalize(value:unknown,stack:Set<object>):unknown { if(value===undefined)return undefined;if(value===null||typeof value==="string"||typeof value==="boolean")return value;if(typeof value==="number"){if(!Number.isFinite(value))throw new Error("non-finite");return value}if(typeof value!=="object")throw new Error("unsupported");if(stack.has(value))throw new Error("circular");stack.add(value);let result:unknown;if(Array.isArray(value)){result=value.map((item)=>{const normalized=normalize(item,stack);if(normalized===undefined)throw new Error("undefined-array");return normalized})}else{if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw new Error("non-plain");const output:Record<string,unknown>={};for(const key of Object.keys(value).sort()){const normalized=normalize((value as Record<string,unknown>)[key],stack);if(normalized!==undefined)output[key]=normalized}result=output}stack.delete(value);return result;}
function schemaOf(kind:ProductionExecutionPersistenceRecordKind,value:unknown):unknown { return kind==="journal"&&Array.isArray(value)?(value[0] as Record<string,unknown>|undefined)?.schemaVersion:isRecord(value)?value.schemaVersion:undefined; }
function validKey(kind:ProductionExecutionPersistenceRecordKind,key:string){return Object.hasOwn(kinds,kind)&&keyPattern.test(key)&&!reservedDeviceName.test(key)&&!key.includes("..");}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value)}
function strings(v:Record<string,unknown>,keys:string[]){return keys.every(k=>typeof v[k]==="string"&&(v[k] as string).length>0)}function arrays(v:Record<string,unknown>,keys:string[]){return keys.every(k=>Array.isArray(v[k]))}function integer(v:unknown){return Number.isInteger(v)&&(v as number)>0}function integrity(v:unknown){return isRecord(v)&&v.algorithm==="stable-production-id-v1"&&typeof v.fingerprint==="string"&&v.fingerprint.length>0}
function errorCode(error:unknown){const code=isRecord(error)&&typeof error.code==="string"?error.code:"UNKNOWN";return/^[A-Z0-9_-]{1,40}$/.test(code)?code:"UNKNOWN"}function diagnostic(operation:ProductionExecutionPersistenceDiagnostic["operation"],error:unknown,tempArtifactPossible:boolean):ProductionExecutionPersistenceDiagnostic{return{operation,causeCode:errorCode(error),tempArtifactPossible}}
function diagnostics(...values:(ProductionExecutionPersistenceDiagnostic|undefined)[]){return values.filter((v):v is ProductionExecutionPersistenceDiagnostic=>Boolean(v))}
async function cleanup(operations:TrustedProductionExecutionPersistenceFileOperations,filePath:string){try{await operations.unlink(filePath);return undefined}catch(error){if(errorCode(error)==="ENOENT")return undefined;return diagnostic("cleanup",error,true)}}
function failure<K extends ProductionExecutionPersistenceRecordKind>(kind:K,key:string,errorCode:ProductionExecutionPersistenceErrorCode,items?:ProductionExecutionPersistenceDiagnostic[]):ProductionExecutionPersistenceWriteResult<K>{return{ok:false,status:"failed",kind,key,errorCode,...(items?.length?{diagnostics:items}:{})}}
function writeFromExisting<K extends ProductionExecutionPersistenceRecordKind>(kind:K,key:string,text:string,existing:CanonicalRead<K>):ProductionExecutionPersistenceWriteResult<K>{if(existing.status==="found")return existing.text===text?{ok:true,status:"idempotent-replay",kind,key}:failure(kind,key,"PERSISTENCE_EXISTING_RECORD_CONFLICT");if(existing.status==="not-found")return failure(kind,key,"PERSISTENCE_COMMIT_FAILED");return failure(kind,key,existing.errorCode,existing.diagnostics)}
function withDiagnostics<K extends ProductionExecutionPersistenceRecordKind>(result:ProductionExecutionPersistenceWriteResult<K>,item?:ProductionExecutionPersistenceDiagnostic):ProductionExecutionPersistenceWriteResult<K>{if(!item)return result;return{...result,diagnostics:[...(result.diagnostics??[]),item]}}

function digest(value: unknown) { return createHash("sha256").update(canonicalJson(value).text).digest("hex"); }
function artifactIdentity(directory: string, name: string) { return `artifact-${digest({ directory, name }).slice(0, 24)}`; }
function indexFile(sourceFingerprint: string) { return `lookup-${sourceFingerprint}.json`; }
function validLookup(value: string) { return /^[a-z0-9](?:[a-z0-9_.:-]{0,198}[a-z0-9])?$/.test(value) && !value.includes("..") && !path.isAbsolute(value); }
function recoveryFinding(artifactId: string, artifactKind: ProductionExecutionRecoveryFinding["artifactKind"], classification: ProductionExecutionRecoveryFinding["classification"], reasonCode: ProductionExecutionRecoveryReasonCode, recoveryRequired: boolean, applyAllowed: boolean, canonicalTargetPresent: boolean): ProductionExecutionRecoveryFinding { return { artifactId, artifactKind, classification, reasonCode, recoveryRequired, applyAllowed, canonicalTargetPresent, evidence: [`reason:${reasonCode}`, `artifact:${artifactKind}`] }; }
function recoveryScan(decision: ProductionExecutionRecoveryScanResult["decision"], reasonCode: ProductionExecutionRecoveryReasonCode, findings: ProductionExecutionRecoveryFinding[], items?: ProductionExecutionPersistenceDiagnostic[]): ProductionExecutionRecoveryScanResult { return { schemaVersion: productionExecutionDurableRecoverySchemaVersion, decision, reasonCode, writeFree: true, findings: [...findings].sort((a,b) => a.artifactId.localeCompare(b.artifactId)), evidence: [`reason:${reasonCode}`], ...(items?.length ? { diagnostics: items } : {}) }; }
function buildIndex(idempotencyKeys: ProductionExecutionDerivedLookupEntry[], requestIds: ProductionExecutionDerivedLookupEntry[], reservations: ProductionExecutionDerivedLookupEntry[]): ProductionExecutionDerivedLookupIndex {
  const sorted = (values: ProductionExecutionDerivedLookupEntry[]) => [...values].sort((a,b) => a.key.localeCompare(b.key) || a.recordId.localeCompare(b.recordId) || a.recordVersion - b.recordVersion);
  const body = { schemaVersion: productionExecutionDurableRecoverySchemaVersion, indexVersion: productionExecutionDerivedIndexVersion, sourceFingerprint: digest({ idempotencyKeys: sorted(idempotencyKeys), requestIds: sorted(requestIds), reservations: sorted(reservations) }), reservations: sorted(reservations), idempotencyKeys: sorted(idempotencyKeys), requestIds: sorted(requestIds) };
  return { ...body, integrity: { algorithm: "sha256", fingerprint: digest(body) } };
}
function indexShape(value: unknown): value is ProductionExecutionDerivedLookupIndex { return isRecord(value) && value.schemaVersion === "1" && value.indexVersion === "1" && typeof value.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.sourceFingerprint) && Array.isArray(value.reservations) && Array.isArray(value.idempotencyKeys) && Array.isArray(value.requestIds) && [...value.reservations, ...value.idempotencyKeys, ...value.requestIds].every((entry) => isRecord(entry) && typeof entry.key === "string" && typeof entry.recordId === "string" && Number.isInteger(entry.recordVersion) && typeof entry.canonicalKey === "string") && isRecord(value.integrity) && value.integrity.algorithm === "sha256" && typeof value.integrity.fingerprint === "string"; }
function indexResult(ok: boolean, reasonCode: ProductionExecutionRecoveryReasonCode, index?: ProductionExecutionDerivedLookupIndex, items?: ProductionExecutionPersistenceDiagnostic[], created?: boolean, match?: ProductionExecutionDerivedLookupEntry): ProductionExecutionIndexResult { return { ok, reasonCode, ...(index ? { index } : {}), ...(match ? { match } : {}), ...(created !== undefined ? { created } : {}), evidence: [`reason:${reasonCode}`], ...(items?.length ? { diagnostics: items } : {}) }; }
function applyResult(ok: boolean, reasonCode: ProductionExecutionRecoveryReasonCode, applied: boolean, items?: ProductionExecutionPersistenceDiagnostic[]): ProductionExecutionRecoveryApplyResult { return { ok, reasonCode, applied, evidence: [`reason:${reasonCode}`], ...(items?.length ? { diagnostics: items } : {}) }; }
function directoryDurability(status: ProductionExecutionDirectoryDurabilityResult["status"]): ProductionExecutionDirectoryDurabilityResult { const upper = status.toUpperCase() as "SUPPORTED"|"UNSUPPORTED"|"FAILED"|"INDETERMINATE"; return { status, reasonCode: `DIRECTORY_DURABILITY_${upper}`, durable: status === "supported", evidence: [`directory-durability:${status}`] }; }
