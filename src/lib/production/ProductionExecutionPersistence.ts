import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy, evaluateProductionExecutionIdempotencyReplay, validateProductionExecutionIdempotencyReservation } from "./ProductionExecutionIdempotency";
import { buildProductionExecutionTransactionPlan, defaultProductionExecutionTransactionPolicy, validateProductionExecutionTransactionPlan } from "./ProductionExecutionTransaction";
import { buildProductionOperationJournalEvent, defaultProductionOperationJournalPolicy, validateProductionOperationJournalSequence } from "./ProductionOperationJournal";
import type { ProductionExecutionIdempotencyIdentity, ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionAuthorizationResult } from "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "@/types/productionExecutionConfirmation";
import type { ProductionExecutionTransactionPlan } from "@/types/productionExecutionTransaction";
import type { ProductionOperationJournalEvent } from "@/types/productionOperationJournal";
import type { ProductionExecutionPersistenceAdapter, ProductionExecutionPersistenceDiagnostic, ProductionExecutionPersistenceErrorCode, ProductionExecutionPersistencePayloadByKind, ProductionExecutionPersistenceReadResult, ProductionExecutionPersistenceRecordKind, ProductionExecutionPersistenceWriteResult } from "@/types/productionExecutionPersistence";

export interface TrustedProductionExecutionPersistenceFileOperations {
  access(filePath: string): Promise<void>;
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  readFile(filePath: string, encoding: "utf8"): Promise<string>;
  writeFile(filePath: string, data: string, options: { encoding: "utf8"; flag: "wx" }): Promise<unknown>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
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
const kinds: Readonly<Record<ProductionExecutionPersistenceRecordKind, string>> = { transaction: "transactions", journal: "journals", idempotency: "idempotency", reservation: "reservations" };

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
    return { valid: reservationValid(value), schemaUnsupported: false };
  } catch { return { valid: false, schemaUnsupported: false }; }
}

function transactionShape(v: Record<string, unknown>) { return strings(v, ["transactionId","operationId","idempotencyRecordId","requestId","idempotencyKey","executionFingerprint","actorId","projectSlug","operation","action","policyVersion","plannedAt"]) && integer(v.attempt) && Array.isArray(v.steps) && v.steps.length > 0 && v.steps.every((s) => isRecord(s) && strings(s,["stepId","type","resource","expectedOutcome","failureMode","journalEventType","status"]) && integer(s.sequence) && arrays(s,["dependsOn","preconditions"])) && arrays(v,["resources","preconditions","postconditions"]) && isRecord(v.rollbackPlan) && typeof v.rollbackPlan.required === "boolean" && Array.isArray(v.rollbackPlan.steps) && isRecord(v.consistencyPlan) && typeof v.consistencyPlan.required === "boolean" && Array.isArray(v.consistencyPlan.checks) && isRecord(v.journalPlan) && typeof v.journalPlan.required === "boolean" && Array.isArray(v.journalPlan.eventTypes) && integrity(v.integrity); }
function journalShape(v: unknown): boolean { return isRecord(v) && v.schemaVersion === "1" && strings(v,["eventId","eventType","occurredAt","operationId","transactionId","idempotencyRecordId","requestId","idempotencyKey","actorId","projectSlug","operation","action"]) && integer(v.sequence) && integer(v.attempt) && Array.isArray(v.evidence) && isRecord(v.correlation) && strings(v.correlation,["correlationId","authorizationDecisionId","confirmationId","executionFingerprint","bindingFingerprint","policyVersion"]) && integrity(v.integrity); }
function idempotencyRecordValid(v: Record<string, unknown>): boolean { if (!strings(v,["recordId","identityFingerprint","idempotencyKey","requestId","executionFingerprint","bindingFingerprint","actorId","projectSlug","operation","action","authorizationDecisionId","confirmationRequestId","confirmationId","policyVersion","riskLevel","state","createdAt","updatedAt"]) || !integer(v.attempt) || !integer(v.maxAttempts) || !Array.isArray(v.evidence) || !integrity(v.integrity)) return false; const identity = identityFromRecord(v); const policy = idempotencyPolicy(v.action as string, v.maxAttempts as number, v.policyVersion as string); const rebuilt = rebuildIdempotencyIdentity(v, policy); if (!rebuilt || canonicalJson(rebuilt).text !== canonicalJson(identity).text || (v.integrity as Record<string,unknown>).fingerprint !== rebuilt.identityFingerprint) return false; const replay = evaluateProductionExecutionIdempotencyReplay(v as unknown as ProductionExecutionIdempotencyRecord, rebuilt, { evaluatedAt: v.updatedAt as string, policy }); return replay.reasonCode !== "RECORD_STATE_UNKNOWN" && replay.decision !== "indeterminate"; }
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
