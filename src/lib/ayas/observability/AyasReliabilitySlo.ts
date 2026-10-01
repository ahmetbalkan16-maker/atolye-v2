import type { AyasExecutionJournalEntry } from "../../brain/autonomy/AyasExecutionJournal";

/** Audit data only: these facts cannot admit, retry, promote or execute anything. */
export interface AyasMutationReliabilityAudit {
  readonly version: "1";
  readonly mutationStarted: boolean;
  readonly observedBaseHead: string | null;
  readonly scopeVerified: boolean;
  readonly violation: "NONE" | "UNAUTHORIZED_MUTATION" | "HEAD_CHANGED";
  readonly regression: "NOT_REPORTED" | "PASS" | "FAIL" | "INVALID";
  readonly testCount: number;
  readonly completionRecorded: boolean;
}

export function isAyasMutationReliabilityAudit(raw: unknown): raw is AyasMutationReliabilityAudit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const a = raw as Record<string, unknown>;
  const keys = ["version", "mutationStarted", "observedBaseHead", "scopeVerified", "violation", "regression", "testCount", "completionRecorded"];
  return Object.keys(a).length === keys.length && keys.every((k) => Object.hasOwn(a, k)) && a.version === "1"
    && [a.mutationStarted, a.scopeVerified, a.completionRecorded].every((v) => typeof v === "boolean")
    && (a.observedBaseHead === null || typeof a.observedBaseHead === "string" && /^[a-f0-9]{40,64}$/.test(a.observedBaseHead))
    && ["NONE", "UNAUTHORIZED_MUTATION", "HEAD_CHANGED"].includes(String(a.violation))
    && ["NOT_REPORTED", "PASS", "FAIL", "INVALID"].includes(String(a.regression))
    && Number.isSafeInteger(a.testCount) && Number(a.testCount) >= 0 && Number(a.testCount) <= 10_000
    && !(a.scopeVerified && (!a.mutationStarted || a.observedBaseHead === null || a.violation !== "NONE"))
    && !(a.completionRecorded && !a.mutationStarted)
    && !(a.regression === "PASS" && a.testCount === 0);
}

/** The callback's existing report is weaker than independently attested grader evidence. */
export function classifyAyasRegressionReport(tests: unknown, results: unknown): Pick<AyasMutationReliabilityAudit, "regression" | "testCount"> {
  const testCount = Array.isArray(tests) ? tests.length : 0;
  if (!Array.isArray(tests) || !Array.isArray(results) || testCount > 10_000 || tests.some((t) => typeof t !== "string" || t.length === 0)
    || testCount !== results.length || results.some((r) => r !== "PASS" && r !== "FAIL")) return { regression: "INVALID", testCount: Math.min(testCount, 10_000) };
  return { regression: testCount === 0 ? "NOT_REPORTED" : results.includes("FAIL") ? "FAIL" : "PASS", testCount };
}

export type AyasSloSource<T> = { readonly status: "AVAILABLE"; readonly facts: readonly T[] } | { readonly status: "UNAVAILABLE" | "NOT_INSTRUMENTED"; readonly reason: string };
export interface AyasAcceptedTaskFact { readonly taskId: string; readonly journal: "PRESENT" | "MISSING" | "UNKNOWN"; }
/** A confirmed external effect, supplied only by a future trusted receipt adapter. */
export interface AyasExternalWriteFact { readonly receiptId: string; readonly effectKeyDigest: string; readonly outcome: "CONFIRMED" | "UNKNOWN"; }
export interface AyasReliabilityCounter {
  readonly target: 0;
  readonly scope: string;
  readonly status: "BREACH" | "SCOPED_ZERO" | "UNKNOWN";
  readonly violations: number | null;
  readonly observedViolations: number;
  readonly samples: number;
  readonly unknownSamples: number;
  readonly sourceStatus: AyasSloSource<never>["status"];
}
export interface AyasReliabilitySloReport {
  readonly version: "1";
  readonly authority: "NONE";
  readonly globalSloCertified: false;
  readonly unauthorizedWrites: AyasReliabilityCounter;
  readonly duplicateExternalWrites: AyasReliabilityCounter;
  readonly staleHeadMutation: AyasReliabilityCounter;
  readonly unexplainedTaskLoss: AyasReliabilityCounter;
  readonly regressionGateBypass: AyasReliabilityCounter;
}

function counter(scope: string, sourceStatus: AyasSloSource<never>["status"], samples: number, observedViolations: number, unknownSamples: number): AyasReliabilityCounter {
  const status = observedViolations > 0 ? "BREACH" : sourceStatus === "AVAILABLE" && samples > 0 && unknownSamples === 0 ? "SCOPED_ZERO" : "UNKNOWN";
  return { target: 0, scope, status, violations: status === "UNKNOWN" ? null : observedViolations, observedViolations, samples, unknownSamples, sourceStatus };
}

export function summarizeAyasReliabilitySlo(sources: {
  readonly executions: AyasSloSource<AyasExecutionJournalEntry>;
  readonly acceptedTasks: AyasSloSource<AyasAcceptedTaskFact>;
  readonly externalWrites: AyasSloSource<AyasExternalWriteFact>;
}): AyasReliabilitySloReport {
  let samples = 0, unauthorized = 0, stale = 0, bypass = 0, scopeUnknown = 0, headUnknown = 0, regressionUnknown = 0;
  const seen = new Set<string>();
  if (sources.executions.status === "AVAILABLE") for (const entry of sources.executions.facts) {
    if (seen.has(entry.executionId)) { scopeUnknown++; headUnknown++; regressionUnknown++; continue; }
    seen.add(entry.executionId);
    // Non-Git repair workspaces have their own physical-root/precondition contract.
    if (entry.baseHead === "NOT_APPLICABLE_REPAIR_WORKSPACE") continue;
    const a = entry.reliabilityAudit;
    if (!a || !isAyasMutationReliabilityAudit(a)) { samples++; scopeUnknown++; headUnknown++; regressionUnknown++; continue; }
    if (!a.mutationStarted) continue; // Guard refusal is no observed write.
    samples++;
    const lease = entry.capabilityLease;
    const request = lease?.scope.resource.request;
    const authorized = lease?.state === "consumed" && request?.action === "self-development.apply-approved-proposal"
      && request.proposalId === entry.proposalId && request.proposalHash === entry.proposalHash && request.baseHead === entry.baseHead
      && request.authorizationId === entry.authorizationId && request.reservationId === entry.reservationId
      && JSON.stringify([...request.exactFiles].sort()) === JSON.stringify([...entry.exactFiles].sort());
    if (a.violation === "UNAUTHORIZED_MUTATION" || lease?.state === "granted" || lease?.state === "revoked") unauthorized++;
    else if (!authorized || !a.scopeVerified) scopeUnknown++;
    if (a.violation === "HEAD_CHANGED" || a.observedBaseHead !== null && a.observedBaseHead !== entry.baseHead) stale++;
    else if (a.observedBaseHead === null || !a.scopeVerified) headUnknown++;
    if (a.completionRecorded && (a.regression === "FAIL" || a.regression === "INVALID")) bypass++;
    else if (a.regression === "NOT_REPORTED") regressionUnknown++;
  }
  let taskSamples = 0, missing = 0, taskUnknown = 0;
  const tasks = new Set<string>();
  if (sources.acceptedTasks.status === "AVAILABLE") for (const fact of sources.acceptedTasks.facts) {
    if (tasks.has(fact.taskId)) continue;
    tasks.add(fact.taskId); taskSamples++;
    if (fact.journal === "MISSING") missing++;
    if (fact.journal === "UNKNOWN") taskUnknown++;
  }
  let externalSamples = 0, duplicates = 0, externalUnknown = 0;
  const receipts = new Map<string, AyasExternalWriteFact>(), effects = new Set<string>();
  if (sources.externalWrites.status === "AVAILABLE") for (const fact of sources.externalWrites.facts) {
    const previous = receipts.get(fact.receiptId);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(fact)) externalUnknown++; continue; }
    receipts.set(fact.receiptId, fact); externalSamples++;
    if (fact.outcome !== "CONFIRMED" || !/^[a-f0-9]{64}$/.test(fact.effectKeyDigest)) { externalUnknown++; continue; }
    if (effects.has(fact.effectKeyDigest)) duplicates++; else effects.add(fact.effectKeyDigest);
  }
  return {
    version: "1", authority: "NONE", globalSloCertified: false,
    unauthorizedWrites: counter("instrumented self-development journal; exact consumed lease and verified diff", sources.executions.status, samples, unauthorized, scopeUnknown),
    staleHeadMutation: counter("instrumented self-development boundary HEAD at execution; not today's HEAD", sources.executions.status, samples, stale, headUnknown),
    regressionGateBypass: counter("recorded self-development completion versus callback regression report; grader attestation separate", sources.executions.status, samples, bypass, regressionUnknown),
    unexplainedTaskLoss: counter("durable Graphify tasks with independent consumed admission record in this configured root", sources.acceptedTasks.status, taskSamples, missing, taskUnknown),
    duplicateExternalWrites: counter("confirmed external receipts sharing one exact effect key; live adapter unbound", sources.externalWrites.status, externalSamples, duplicates, externalUnknown),
  };
}
