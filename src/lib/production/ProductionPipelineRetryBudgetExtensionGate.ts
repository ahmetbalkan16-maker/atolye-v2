import path from "node:path";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";
import {
  readRetryBudgetExtensionAuthority,
  readRetryBudgetExtensionReceipt,
} from "./ProductionPipelineRetryBudgetExtensionStore";
import {
  type ProductionPipelineRetryBudgetExtensionBody,
  type ProductionPipelineRetryBudgetExtensionReceipt,
} from "./ProductionPipelineRetryBudgetExtensionSchema";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { AdapterBackedProductionExecutionDurableStorage } from "./ProductionExecutionDurableStorage";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { readProductionCanonicalTerminalDurableLineage } from "./ProductionCanonicalDurableLineage";
import {
  type RuntimeStorageInput,
  getProjectRoot,
} from "@/lib/runtime/RuntimeStoragePaths";
import type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";

export type RetryBudgetExtensionGatePhase =
  | "before-consumption"
  | "before-durable-preparation"
  | "before-execution";

export interface RetryBudgetExtensionGateInput {
  readonly phase: RetryBudgetExtensionGatePhase;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly jobId: string;
  readonly runType: ProjectPackageRunType;
  readonly authorityId: string;
  readonly jobVersion?: string;
  readonly input?: RuntimeStorageInput;
}

export interface RetryBudgetExtensionGateResult {
  readonly ok: boolean;
  readonly phase: RetryBudgetExtensionGatePhase;
  readonly authorityId: string;
  readonly authority?: ProductionPipelineRetryBudgetExtensionBody;
  readonly receipt?: ProductionPipelineRetryBudgetExtensionReceipt;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export async function verifyCanonicalPipelineRetryBudgetExtensionAdmission(
  gateInput: RetryBudgetExtensionGateInput,
): Promise<RetryBudgetExtensionGateResult> {
  const { phase, projectSlug, stage, jobId, runType, authorityId, jobVersion, input = {} } = gateInput;

  if (runType !== "resume") {
    return {
      ok: false,
      phase,
      authorityId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: [`gate:runType-${runType}-forbidden`],
    };
  }

  if (jobId !== `${projectSlug}-${stage}`) {
    return {
      ok: false,
      phase,
      authorityId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      evidence: ["gate:jobId-mismatch"],
    };
  }

  const authorityRead = readRetryBudgetExtensionAuthority(projectSlug, authorityId, input);
  if (!authorityRead.ok || !authorityRead.value) {
    return {
      ok: false,
      phase,
      authorityId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      evidence: ["gate:authority-not-found"],
    };
  }

  const authority = authorityRead.value;
  if (
    authority.projectSlug !== projectSlug ||
    authority.stage !== stage ||
    authority.jobId !== jobId ||
    authority.authorizedRunType !== "resume"
  ) {
    return {
      ok: false,
      phase,
      authorityId,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
      evidence: ["gate:authority-binding-mismatch"],
    };
  }

  const consumingRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consuming", input);
  const consumedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed", input);
  const abortedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "aborted", input);
  const settledRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "settled", input);

  if (phase === "before-consumption") {
    if (consumedRead.ok || consumingRead.ok || abortedRead.ok || settledRead.ok) {
      return {
        ok: false,
        phase,
        authorityId,
        authority,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
        evidence: ["gate:already-consumed-or-in-progress"],
      };
    }
    return {
      ok: true,
      phase,
      authorityId,
      authority,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_GATE_PASSED",
      evidence: ["gate:before-consumption-passed"],
    };
  }

  if (phase === "before-durable-preparation") {
    if (!consumedRead.ok || !consumedRead.value) {
      return {
        ok: false,
        phase,
        authorityId,
        authority,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
        evidence: ["gate:consumed-receipt-missing"],
      };
    }
    if (jobVersion && consumedRead.value.jobVersion !== jobVersion) {
      return {
        ok: false,
        phase,
        authorityId,
        authority,
        receipt: consumedRead.value,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_STATE_DRIFT",
        evidence: ["gate:job-version-receipt-mismatch"],
      };
    }
    return {
      ok: true,
      phase,
      authorityId,
      authority,
      receipt: consumedRead.value,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_GATE_PASSED",
      evidence: ["gate:before-durable-preparation-passed"],
    };
  }

  if (phase === "before-execution") {
    // Step 1: consumed receipt must exist
    if (!consumedRead.ok || !consumedRead.value) {
      return {
        ok: false,
        phase,
        authorityId,
        authority,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
        evidence: ["gate:consumed-receipt-required-for-execution"],
      };
    }

    const consumedReceipt = consumedRead.value;

    // Step 2: Read canonical durable siblings from storage and verify extension binding.
    // This must complete before any execution mutation is allowed.
    const durableVerification = await verifyDurableSiblingBindingForExecution(
      projectSlug,
      stage,
      authority,
      consumedReceipt,
      input,
    );

    if (!durableVerification.ok) {
      return {
        ok: false,
        phase,
        authorityId,
        authority,
        receipt: consumedReceipt,
        reasonCode: durableVerification.reasonCode,
        evidence: durableVerification.evidence,
      };
    }

    return {
      ok: true,
      phase,
      authorityId,
      authority,
      receipt: consumedReceipt,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_GATE_PASSED",
      evidence: [
        "gate:before-execution-passed",
        "gate:durable-sibling-binding-verified",
        ...durableVerification.evidence,
      ],
    };
  }

  return {
    ok: false,
    phase,
    authorityId,
    reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
    evidence: ["gate:unknown-phase"],
  };
}

/**
 * Reads canonical durable storage siblings for the ordinal-4 extension execution
 * and verifies that ALL 5 of them (reservation, record, lease, claim, attempt)
 * carry the exact expected extension binding.
 *
 * Fail-closed: any missing, mismatched, stale, or unexpected sibling rejects.
 */
async function verifyDurableSiblingBindingForExecution(
  projectSlug: string,
  stage: ProductionStepKey,
  authority: ProductionPipelineRetryBudgetExtensionBody,
  consumedReceipt: ProductionPipelineRetryBudgetExtensionReceipt,
  input: RuntimeStorageInput = {},
): Promise<{ ok: boolean; reasonCode: string; evidence: readonly string[] }> {
  const jobId = `${projectSlug}-${stage}`;
  const projectPath = getProjectRoot(projectSlug, input);
  const trustedRootDirectory = path.join(projectPath, "production-execution");

  let adapter: ProductionExecutionFilePersistenceAdapter;
  try {
    adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory,
      createRootDirectory: false,
    });
  } catch {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: ["gate:durable-adapter-init-failed"],
    };
  }

  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);

  const identity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
    { id: jobId, attempts: 3 }, // ordinal 4
  );

  let lineage: Awaited<ReturnType<typeof readProductionCanonicalTerminalDurableLineage>> | undefined;
  try {
    const recordResult = await storage.read(identity.recordId);
    if (!recordResult.record) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
        evidence: ["gate:ordinal-4-record-not-found"],
      };
    }

    lineage = await readProductionCanonicalTerminalDurableLineage(
      adapter,
      identity,
      recordResult.record.identityFingerprint,
      undefined,
      recordResult.record.operation,
      { requireTerminal: false },
    );
  } catch {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: ["gate:durable-lineage-read-failed"],
    };
  }

  // Enforce that ALL 5 siblings MUST exist in canonical durable storage for ordinal 4
  if (!lineage.reservation || !lineage.record || !lineage.lease || !lineage.claim || !lineage.attempt) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: [
        `gate:siblings-presence-check:reservation=${Boolean(lineage.reservation)},record=${Boolean(lineage.record)},lease=${Boolean(lineage.lease)},claim=${Boolean(lineage.claim)},attempt=${Boolean(lineage.attempt)}`,
      ],
    };
  }

  if (lineage.record.attempt !== 4) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
      evidence: [`gate:record-ordinal-${lineage.record.attempt}-expected-4`],
    };
  }

  if (lineage.record.maxAttempts !== 4) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
      evidence: [`gate:record-max-attempts-${lineage.record.maxAttempts}-expected-4`],
    };
  }

  const expectedAuthorityId = authority.authorityId;
  const expectedAuthorityFingerprint = authority.integrity.fingerprint;
  const expectedReceiptFingerprint = consumedReceipt.integrity.fingerprint;
  const expectedIdentityFingerprint = lineage.record.identityFingerprint;
  const expectedReservationId = lineage.reservation.identity.identityFingerprint;

  if (!expectedReservationId) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: ["gate:reservation-id-missing"],
    };
  }

  const checkSiblingBinding = (
    siblingName: string,
    obj: { retryBudgetExtension?: RetryBudgetExtensionDurableBinding },
  ): { ok: boolean; reasonCode?: string; evidence?: string } => {
    const binding = obj.retryBudgetExtension;
    if (!binding || typeof binding !== "object") {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
        evidence: `gate:${siblingName}-extension-binding-missing`,
      };
    }
    if (
      binding.schemaVersion !== "1" ||
      binding.authorityId !== expectedAuthorityId ||
      binding.authorityIntegrityFingerprint !== expectedAuthorityFingerprint ||
      binding.consumptionReceiptFingerprint !== expectedReceiptFingerprint ||
      binding.authorizedDurableOrdinal !== 4 ||
      binding.effectiveMaxAttempts !== 4 ||
      binding.authorizedRunType !== "resume" ||
      binding.authorizedOperation !== "pipeline.stage.resume" ||
      binding.projectSlug !== projectSlug ||
      binding.stage !== stage ||
      binding.jobId !== jobId ||
      binding.identityFingerprint !== expectedIdentityFingerprint ||
      binding.reservationBinding !== expectedReservationId ||
      binding.durableAttemptOrdinal !== 4
    ) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: `gate:${siblingName}-extension-binding-mismatch`,
      };
    }
    return { ok: true };
  };

  const siblings = [
    { name: "reservation", obj: lineage.reservation },
    { name: "record", obj: lineage.record },
    { name: "lease", obj: lineage.lease },
    { name: "claim", obj: lineage.claim },
    { name: "attempt", obj: lineage.attempt },
  ];

  for (const s of siblings) {
    const check = checkSiblingBinding(s.name, s.obj);
    if (!check.ok) {
      return {
        ok: false,
        reasonCode: check.reasonCode ?? "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: [check.evidence!],
      };
    }
  }

  return {
    ok: true,
    reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_GATE_PASSED",
    evidence: [
      `gate:ordinal-4-record-verified:attempt=${lineage.record.attempt}`,
      `gate:max-attempts-verified:${lineage.record.maxAttempts}`,
      "gate:all-5-siblings-extension-binding-verified",
    ],
  };
}
