import path from "node:path";
import { createAyasExecutionJournal, type AyasExecutionJournalHandle } from "../../brain/autonomy/AyasExecutionJournal";
import { createAyasDurableTaskJournal, type AyasDurableTaskJournal } from "../../brain/autonomy/AyasDurableTaskJournal";
import { AyasExecutionAuthorizationStore } from "../execution/AyasExecutionAuthorization";
import { resolveAyasExecutionAuditRoot } from "../execution/AyasExecutionAuditContext";
import { summarizeAyasReliabilitySlo, type AyasAcceptedTaskFact, type AyasSloSource } from "./AyasReliabilitySlo";

/** Independent read-only snapshots; no task acceptance, append, recovery or execution. */
export interface AyasReliabilityStateOptions {
  readonly rootDir?: string;
  readonly executions?: Pick<AyasExecutionJournalHandle, "list">;
  readonly authorizations?: Pick<AyasExecutionAuthorizationStore, "scan">;
  readonly tasks?: Pick<AyasDurableTaskJournal, "load">;
}

function source<T>(read: () => readonly T[]): AyasSloSource<T> {
  try { return { status: "AVAILABLE", facts: read() }; }
  catch { return { status: "UNAVAILABLE", reason: "SOURCE_READ_FAILED" }; }
}

export function readAyasReliabilityState(options: AyasReliabilityStateOptions = {}) {
  const root = path.resolve(options.rootDir ?? resolveAyasExecutionAuditRoot());
  const executions = options.executions ?? createAyasExecutionJournal({ rootDir: path.join(root, "self-improvement") });
  const authorizations = options.authorizations ?? new AyasExecutionAuthorizationStore({ rootDir: root });
  const tasks = options.tasks ?? createAyasDurableTaskJournal({ rootDir: path.join(root, "autonomy") });
  const acceptedTasks = source((): readonly AyasAcceptedTaskFact[] => {
    const scan = authorizations.scan();
    const facts: AyasAcceptedTaskFact[] = [];
    const seen = new Set<string>();
    for (const record of scan.records) {
      // This activity writes ATTEMPT_STARTED durably before consuming its audit lease.
      // Only the closed task binding is inspected; intent/private plan fields are ignored.
      const plan = record.plan as Record<string, unknown>;
      if (!record.consumedAt || record.requestedBy !== "ayas-durable-runtime" || plan.activity !== "self-development.graphify-state.read"
        || typeof plan.taskId !== "string" || !/^ayas-task-[a-f0-9]{32}$/.test(plan.taskId) || seen.has(plan.taskId)) continue;
      seen.add(plan.taskId);
      try { facts.push({ taskId: plan.taskId, journal: tasks.load(plan.taskId) ? "PRESENT" : "MISSING" }); }
      catch { facts.push({ taskId: plan.taskId, journal: "UNKNOWN" }); }
    }
    // An unreadable admission could hide an accepted task. Never produce a false zero.
    if (scan.unreadable.length > 0) facts.push({ taskId: "UNREADABLE_ADMISSION", journal: "UNKNOWN" });
    return facts;
  });
  return summarizeAyasReliabilitySlo({ executions: source(() => executions.list()), acceptedTasks,
    externalWrites: { status: "NOT_INSTRUMENTED", reason: "EXTERNAL_RECEIPT_ADAPTER_UNBOUND" } });
}
