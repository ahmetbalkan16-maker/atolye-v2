import path from "node:path";
import { createHash } from "node:crypto";
import {
  assertTrustedRuntimeStorageContext,
  runtimeStorageLogicalProjectsRoot,
  runtimeStoragePolicyVersion,
  type RuntimeStorageContext,
} from "./RuntimeStoragePaths";

export const productionRuntimeOperationContextVersion = "production-runtime-operation-context-v1";
export const productionRuntimePolicyIdentity = "production-runtime-operation-policy-v1";
export const initialRuntimeAuthorityGeneration = "runtime-authority-generation-v1";

export type ProductionRuntimeOperationContextErrorCode =
  | "RUNTIME_OPERATION_CONTEXT_INVALID"
  | "RUNTIME_OPERATION_CONTEXT_MISSING"
  | "RUNTIME_OPERATION_CONTEXT_MISMATCH";

export class ProductionRuntimeOperationContextError extends Error {
  constructor(readonly code: ProductionRuntimeOperationContextErrorCode) {
    super(messageFor(code));
    this.name = "ProductionRuntimeOperationContextError";
    this.stack = undefined;
  }
}

export interface ProductionRuntimeAuthorityIdentity {
  readonly authorityIdentity: string;
  readonly authorityGeneration: string;
  readonly storagePolicyIdentity: typeof runtimeStoragePolicyVersion;
  readonly runtimePolicyIdentity: typeof productionRuntimePolicyIdentity;
  readonly logicalProjectsRoot: typeof runtimeStorageLogicalProjectsRoot;
  readonly resolverBindingIdentity: string;
}

export interface ProductionRuntimeOperationContext {
  readonly kind: typeof productionRuntimeOperationContextVersion;
  readonly operationId: string;
  readonly operationType: string;
  readonly authority: ProductionRuntimeAuthorityIdentity;
  readonly bindingFingerprint: string;
}

export interface CreateProductionRuntimeOperationContextOptions {
  readonly operationId: string;
  readonly operationType: string;
  readonly authorityGeneration: string;
  readonly storageContext: RuntimeStorageContext;
}

export interface DeriveProductionRuntimeOperationContextOptions {
  readonly operationId: string;
  readonly operationType: string;
}

const storageBindings = new WeakMap<ProductionRuntimeOperationContext, RuntimeStorageContext>();

export function createProductionRuntimeOperationContext(
  options: CreateProductionRuntimeOperationContextOptions,
): ProductionRuntimeOperationContext {
  requireIdentifier(options.operationId);
  requireOperationType(options.operationType);
  requireIdentifier(options.authorityGeneration);
  requireStorageContext(options.storageContext);

  const authority = createAuthorityIdentity(
    options.storageContext,
    options.authorityGeneration,
  );
  const context = Object.freeze({
    kind: productionRuntimeOperationContextVersion,
    operationId: options.operationId,
    operationType: options.operationType,
    authority,
    bindingFingerprint: digest(JSON.stringify({
      operationId: options.operationId,
      operationType: options.operationType,
      authority,
    })),
  });
  storageBindings.set(context, options.storageContext);
  return context;
}

export function deriveProductionRuntimeOperationContext(
  parent: ProductionRuntimeOperationContext,
  options: DeriveProductionRuntimeOperationContextOptions,
): ProductionRuntimeOperationContext {
  const storageContext = requireProductionRuntimeStorageContext(parent);
  return createProductionRuntimeOperationContext({
    ...options,
    authorityGeneration: parent.authority.authorityGeneration,
    storageContext,
  });
}

export function assertProductionRuntimeOperationContext(
  context: ProductionRuntimeOperationContext,
): void {
  const storageContext = storageBindings.get(context);
  if (!storageContext || !Object.isFrozen(context) || !Object.isFrozen(context.authority)) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
  requireIdentifier(context.operationId);
  requireOperationType(context.operationType);
  requireIdentifier(context.authority.authorityGeneration);
  const expectedAuthority = createAuthorityIdentity(
    storageContext,
    context.authority.authorityGeneration,
  );
  const expectedBinding = digest(JSON.stringify({
    operationId: context.operationId,
    operationType: context.operationType,
    authority: expectedAuthority,
  }));
  if (
    !sameAuthority(context.authority, expectedAuthority) ||
    context.bindingFingerprint !== expectedBinding
  ) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
}

export function assertProductionRuntimeOperationAuthority(
  expected: ProductionRuntimeOperationContext,
  actual: ProductionRuntimeOperationContext,
): void {
  assertProductionRuntimeOperationContext(expected);
  assertProductionRuntimeOperationContext(actual);
  if (
    !sameAuthority(expected.authority, actual.authority) ||
    storageBindings.get(expected) !== storageBindings.get(actual)
  ) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_MISMATCH");
  }
}

export function requireProductionRuntimeStorageContext(
  context: ProductionRuntimeOperationContext,
): RuntimeStorageContext {
  assertProductionRuntimeOperationContext(context);
  return storageBindings.get(context)!;
}

function createAuthorityIdentity(
  storageContext: RuntimeStorageContext,
  authorityGeneration: string,
): ProductionRuntimeAuthorityIdentity {
  const resolverBindingIdentity = digest([
    storageContext.policyVersion,
    storageContext.source,
    storageContext.classification,
    normalizedPath(storageContext.workspaceRoot),
    normalizedPath(storageContext.runtimeRoot),
    normalizedPath(storageContext.projectsRoot),
    normalizedPath(storageContext.legacyProjectsRoot),
    normalizedPath(storageContext.authorityRoot),
  ].join("\0"));
  return Object.freeze({
    authorityIdentity: digest([
      storageContext.policyVersion,
      normalizedPath(storageContext.projectsRoot),
    ].join("\0")),
    authorityGeneration,
    storagePolicyIdentity: runtimeStoragePolicyVersion,
    runtimePolicyIdentity: productionRuntimePolicyIdentity,
    logicalProjectsRoot: runtimeStorageLogicalProjectsRoot,
    resolverBindingIdentity,
  });
}

function requireStorageContext(value: RuntimeStorageContext): void {
  try {
    assertTrustedRuntimeStorageContext(value);
  } catch {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
}

function requireIdentifier(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
}

function requireOperationType(value: string): void {
  if (!/^[a-z][a-z0-9.-]{0,79}$/.test(value)) {
    throw new ProductionRuntimeOperationContextError("RUNTIME_OPERATION_CONTEXT_INVALID");
  }
}

function sameAuthority(
  left: ProductionRuntimeAuthorityIdentity,
  right: ProductionRuntimeAuthorityIdentity,
): boolean {
  return left.authorityIdentity === right.authorityIdentity &&
    left.authorityGeneration === right.authorityGeneration &&
    left.storagePolicyIdentity === right.storagePolicyIdentity &&
    left.runtimePolicyIdentity === right.runtimePolicyIdentity &&
    left.logicalProjectsRoot === right.logicalProjectsRoot &&
    left.resolverBindingIdentity === right.resolverBindingIdentity;
}

function normalizedPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function messageFor(code: ProductionRuntimeOperationContextErrorCode): string {
  switch (code) {
    case "RUNTIME_OPERATION_CONTEXT_MISSING":
      return "Production runtime operation context is required.";
    case "RUNTIME_OPERATION_CONTEXT_MISMATCH":
      return "Production runtime operation authority does not match.";
    default:
      return "Production runtime operation context is invalid.";
  }
}

export {
  getActiveProductionRuntimeOperationContext,
  requireActiveProductionRuntimeOperationContext,
  requireExactActiveProductionRuntimeOperationContext,
  runWithProductionRuntimeOperationContext,
} from "./RuntimeOperationScope";
