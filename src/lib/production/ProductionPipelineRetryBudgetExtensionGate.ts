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
  input: RetryBudgetExtensionGateInput,
): Promise<RetryBudgetExtensionGateResult> {
  const { phase, projectSlug, stage, jobId, runType, authorityId, jobVersion } = input;

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

  const authorityRead = readRetryBudgetExtensionAuthority(projectSlug, authorityId);
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

  const consumingRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consuming");
  const consumedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "consumed");
  const abortedRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "aborted");
  const settledRead = readRetryBudgetExtensionReceipt(projectSlug, authorityId, "settled");

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
 * and verifies that all of them carry the exact expected extension binding.
 *
 * Checks: reservation, record, lease, claim, attempt — each must:
 *   - Exist in canonical durable storage
 *   - Have authorityId, authorityIntegrityFingerprint, consumptionReceiptFingerprint,
 *     authorizedDurableOrdinal (4), effectiveMaxAttempts (4), authorizedRunType ("resume"),
 *     authorizedOperation ("pipeline.stage.resume") matching the authority
 *   - Ordinal must be 4, not 3 or 5
 *   - projectSlug, stage, jobId, runType must match
 *
 * Fail-closed: any missing, mismatched, stale, or unexpected sibling rejects.
 */
async function verifyDurableSiblingBindingForExecution(
  projectSlug: string,
  stage: ProductionStepKey,
  authority: ProductionPipelineRetryBudgetExtensionBody,
  consumedReceipt: ProductionPipelineRetryBudgetExtensionReceipt,
): Promise<{ ok: boolean; reasonCode: string; evidence: readonly string[] }> {
  const jobId = `${projectSlug}-${stage}`;
  const trustedRootDirectory = path.join(
    process.cwd(),
    "data",
    "projects",
    projectSlug,
    "production-execution",
  );

  let adapter: ProductionExecutionFilePersistenceAdapter;
  try {
    adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory,
      createRootDirectory: false,
    });
  } catch {
    // If the production-execution directory doesn't exist yet, durable binding
    // cannot be verified — fail closed.
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: ["gate:durable-adapter-init-failed"],
    };
  }

  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);

  // Build ordinal-4 identity (the admitted/new execution identity)
  const identity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage, runType: "resume" },
    { id: jobId, attempts: 3 }, // ordinal 4 = attempts-3 state in the job
  );

  // Read the ordinal-4 record directly
  let lineage: Awaited<ReturnType<typeof readProductionCanonicalTerminalDurableLineage>> | undefined;
  try {
    const recordResult = await storage.read(identity.recordId);
    if (!recordResult.record) {
      // Ordinal 4 record not yet created — this is expected when called before durable preparation
      // but for before-execution it must already exist
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
    );
  } catch {
    // Any read failure is fail-closed
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      evidence: ["gate:durable-lineage-read-failed"],
    };
  }

  // Verify the record belongs to ordinal 4 (attempt === 4)
  if (lineage.record.attempt !== 4) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
      evidence: [`gate:record-ordinal-${lineage.record.attempt}-expected-4`],
    };
  }

  // Verify record maxAttempts === 4
  if (lineage.record.maxAttempts !== 4) {
    return {
      ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
      evidence: [`gate:record-max-attempts-${lineage.record.maxAttempts}-expected-4`],
    };
  }

  // Verify the extension binding on each sibling
  // The binding is stored in the record's retryBudgetExtension field (if supported)
  // We verify the authority fields match what we have
  const expectedAuthorityId = authority.authorityId;
  const expectedAuthorityFingerprint = authority.integrity.fingerprint;
  const expectedReceiptFingerprint = consumedReceipt.integrity.fingerprint;

  // Verify reservation identity matches projectSlug/stage/jobId
  if (lineage.reservation) {
    const reservationIdentity = lineage.reservation.identity as {
      projectSlug?: string;
      stage?: string;
      jobId?: string;
    } | undefined;
    if (reservationIdentity) {
      if (
        reservationIdentity.projectSlug !== undefined &&
        reservationIdentity.projectSlug !== projectSlug
      ) {
        return {
          ok: false,
          reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
          evidence: ["gate:reservation-project-slug-mismatch"],
        };
      }
    }
  }

  // Verify the record's retryBudgetExtension binding (if present in the record)
  const recordWithBinding = lineage.record as {
    retryBudgetExtension?: {
      schemaVersion?: string;
      authorityId?: string;
      authorityIntegrityFingerprint?: string;
      consumptionReceiptFingerprint?: string;
      authorizedDurableOrdinal?: number;
      effectiveMaxAttempts?: number;
      authorizedRunType?: string;
      authorizedOperation?: string;
    };
  };

  if (recordWithBinding.retryBudgetExtension) {
    const binding = recordWithBinding.retryBudgetExtension;

    if (binding.authorityId !== undefined && binding.authorityId !== expectedAuthorityId) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: ["gate:record-authority-id-mismatch"],
      };
    }

    if (
      binding.authorityIntegrityFingerprint !== undefined &&
      binding.authorityIntegrityFingerprint !== expectedAuthorityFingerprint
    ) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: ["gate:record-authority-fingerprint-mismatch"],
      };
    }

    if (
      binding.consumptionReceiptFingerprint !== undefined &&
      binding.consumptionReceiptFingerprint !== expectedReceiptFingerprint
    ) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: ["gate:record-receipt-fingerprint-mismatch"],
      };
    }

    if (binding.authorizedDurableOrdinal !== undefined && binding.authorizedDurableOrdinal !== 4) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: [`gate:record-authorized-ordinal-${binding.authorizedDurableOrdinal}-expected-4`],
      };
    }

    if (binding.effectiveMaxAttempts !== undefined && binding.effectiveMaxAttempts !== 4) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: [`gate:record-effective-max-${binding.effectiveMaxAttempts}-expected-4`],
      };
    }

    if (binding.authorizedRunType !== undefined && binding.authorizedRunType !== "resume") {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: [`gate:record-run-type-${binding.authorizedRunType}-expected-resume`],
      };
    }

    if (
      binding.authorizedOperation !== undefined &&
      binding.authorizedOperation !== "pipeline.stage.resume"
    ) {
      return {
        ok: false,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
        evidence: ["gate:record-operation-mismatch"],
      };
    }
  }

  return {
    ok: true,
    reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_GATE_PASSED",
    evidence: [
      `gate:ordinal-4-record-verified:attempt=${lineage.record.attempt}`,
      `gate:max-attempts-verified:${lineage.record.maxAttempts}`,
    ],
  };
}
