import { stableProductionId } from "./ProductionDeterminism";
import type {
  ProductionExecutionAttemptJournalEntry,
  ProductionExecutionAttemptIdentity,
  ProductionExecutionDurableAttemptRecord,
  ProductionExecutionOutcomeProposal,
} from "@/types/productionExecutionDurableAttempt";

/** @internal Canonical production attempt-binding fingerprint builder. */
export function buildProductionExecutionAttemptBindingFingerprint(
  identity: ProductionExecutionAttemptIdentity,
): string {
  return stableProductionId("attempt-binding", identity);
}

/** @internal Canonical production integrity builders. Pure, deterministic and I/O-free. */
export function buildProductionExecutionAttemptJournalEntryIntegrity(
  entry: Omit<ProductionExecutionAttemptJournalEntry, "integrity">,
): ProductionExecutionAttemptJournalEntry {
  return {
    ...entry,
    integrity: {
      algorithm: "stable-production-id-v1",
      fingerprint: stableProductionId("attempt-journal-entry-integrity", entry),
    },
  };
}

/** @internal Canonical production outcome fingerprint builder. */
export function buildProductionExecutionOutcomeProposalFingerprint(
  proposal: Omit<ProductionExecutionOutcomeProposal, "fingerprint">,
): ProductionExecutionOutcomeProposal {
  return {
    ...proposal,
    fingerprint: stableProductionId("attempt-outcome", proposal),
  };
}

/** @internal Canonical production durable-attempt integrity builder. */
export function buildProductionExecutionDurableAttemptIntegrity(
  value: Omit<ProductionExecutionDurableAttemptRecord, "integrity"> |
    ProductionExecutionDurableAttemptRecord,
): ProductionExecutionDurableAttemptRecord {
  const { integrity: _unused, ...body } = value as ProductionExecutionDurableAttemptRecord;
  void _unused;
  return {
    ...body,
    integrity: {
      algorithm: "stable-production-id-v1",
      fingerprint: stableProductionId("durable-attempt-integrity", body),
    },
  };
}
