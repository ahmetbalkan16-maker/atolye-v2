import type { AyasExecutionJournalEntry } from "./AyasExecutionJournal";

export type AyasRestartRecoveryClass = "NEVER_STARTED" | "RESERVED_ONLY" | "PRE_MUTATION_GATE" | "MUTATION_UNCERTAIN" | "MUTATION_COMPLETED_UNFINALIZED" | "COMPLETED" | "FAILED" | "RECOVERY_REQUIRED";
export interface AyasRestartRecoveryDecision { readonly classification: AyasRestartRecoveryClass; readonly mutationPossible: boolean; readonly autoReplayAllowed: false; readonly humanReviewRequired: boolean; }
export function classifyAyasRestartRecovery(entry?: AyasExecutionJournalEntry): AyasRestartRecoveryDecision {
  const result = (classification: AyasRestartRecoveryClass, mutationPossible: boolean, humanReviewRequired: boolean): AyasRestartRecoveryDecision => ({ classification, mutationPossible, autoReplayAllowed: false, humanReviewRequired });
  if (!entry || entry.phase === "APPROVED_NOT_STARTED") return result("NEVER_STARTED", false, false);
  if (entry.phase === "AUTHORIZATION_RESERVED") return result("RESERVED_ONLY", false, true);
  if (["GATE_ARMED", "GATE_READY", "GATE_OPEN"].includes(entry.phase)) return result("PRE_MUTATION_GATE", false, true);
  if (entry.phase === "EXECUTING" || entry.phase === "PARTIAL_UNKNOWN") return result("MUTATION_UNCERTAIN", true, true);
  if (["MUTATION_COMPLETED", "GATE_COMPLETED", "GATE_SETTLED", "GATE_CLOSED"].includes(entry.phase)) return result("MUTATION_COMPLETED_UNFINALIZED", true, true);
  if (entry.phase === "RESULT_RECORDED") return result("COMPLETED", false, false);
  if (entry.phase === "FAILED") return result("FAILED", true, true);
  return result("RECOVERY_REQUIRED", true, true);
}
