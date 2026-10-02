import type { AyasIndependenceRequirement } from "./AyasIndependenceCertification";

/**
 * Stage 15H — where each fault of the matrix, each link of the maintenance task and the cloud-off condition is proven.
 *
 * Every proof names a suite of the eval manifest and a scenario of that suite by its exact name. The collector checks
 * that the suite's pinned bytes hold that name; the baseline says whether the suite passed at this commit. Nothing
 * here is a result: a name that is no longer in its suite, or a suite that did not pass, leaves the requirement
 * unproven.
 *
 * `limit` says what the proofs do not cover. It is part of the record.
 */
const fault = (id: string, claim: string, proofs: AyasIndependenceRequirement["proofs"], limit?: string): AyasIndependenceRequirement => ({ kind: "FAULT", id, claim, proofs, ...(limit ? { limit } : {}) });
const link = (id: string, claim: string, proofs: AyasIndependenceRequirement["proofs"], limit?: string): AyasIndependenceRequirement => ({ kind: "CHAIN", id, claim, proofs, ...(limit ? { limit } : {}) });

export const AYAS_INDEPENDENCE_EVIDENCE: readonly AyasIndependenceRequirement[] = Object.freeze([
  fault("PROCESS_KILL", "A killed process leaves a closed attempt and a durable receipt: a read is retried within its bound, a side effect is reread before anything else and never repeated.", [
    { suite: "durable-task-recovery", scenario: "process crash: the attempt is closed first, retried on a later tick, within the bound" },
    { suite: "durable-task-runtime", scenario: "crash during a side effect that landed: reread proves it, the effect is not repeated" },
    { suite: "proposal-approval-service", scenario: "an interruption after mutation but before commit leaves a recovery-required durable receipt and never records terminal success" },
  ]),
  fault("REBOOT", "After every owner is gone at once, recovery runs first, durable approvals and reservations are read back as they were, and nothing is produced twice.", [
    { suite: "durable-task-recovery", scenario: "reboot: every owner is gone at once, recovery runs first and nothing is produced twice" },
    { suite: "authorization-reservation", scenario: "reservation restarts across process boundaries — a fresh store instance sees the same RESERVED state" },
    { suite: "autonomy-daemon", scenario: "restart preserves pending approval and corrupt daemon state fails loudly" },
  ]),
  fault("MODEL_DEATH", "A local model that is down is reported as unavailable, the answer says so, a task waits out its retry delay and stops at its bound, and no paid model takes over.", [
    { suite: "model-router", scenario: "ollama provider — health down (connection refused) → available:false" },
    { suite: "model-router", scenario: "router — neither provider → null provider + honest message, no config/secret detail" },
    { suite: "durable-task-runtime", scenario: "model restart: retryable failures wait out the delay and stop at the bound" },
  ]),
  fault("NETWORK_LOSS", "A lost connection records nothing as a result: the task waits where it is, the source failure is classed transient, and the other sources are still checked.", [
    { suite: "durable-task-runtime", scenario: "network loss during a reread: nothing recorded, the task waits where it is" },
    { suite: "research-source-resilience", scenario: "a connection cut mid-body IS a transient network failure — the classification the oversize case was wrongly borrowing" },
    { suite: "research-source-resilience", scenario: "one dead source never prevents the healthy ones in the same scan from being checked" },
  ]),
  fault("DNS_FAILURE", "A host that does not resolve is a typed failure within the timeout, not a hang.", [
    { suite: "safe-public-fetch", scenario: "a DNS-unresolvable host fails as a network error, not a hang" },
  ], "The scenario asks the machine's resolver for a reserved .invalid name; it accepts either the DNS or the generic network failure code."),
  fault("HTTP_429_500", "A rate-limit answer is its own class and is never retried inline; a 5xx answer is an endpoint failure with one request and no retry; a local model server answering 5xx is unavailable and no paid model takes over.", [
    { suite: "research-source-resilience", scenario: "an explicit rate-limit answer is its own class, carries the endpoint's own Retry-After, and is never retried inline", marker: "res.writeHead(429" },
    { suite: "independence-certification", scenario: "a source answering 500 or 503 is an endpoint failure: one request each, never retried inline" },
    { suite: "model-router", scenario: "router — Ollama down + unknown-cost cloud configured → denied, no paid fallback", marker: "status: 503" },
  ]),
  fault("DISK_EXHAUSTION", "A write that fails for lack of space is a reported fault for that one task or record: nothing is issued or admitted on an unwritten journal, and the other tasks go on.", [
    { suite: "durable-task-recovery", scenario: "corrupt journal: reported for that task, untouched, and the sweep goes on", marker: 'code: "ENOSPC"' },
    { suite: "owner-capability-firewall", scenario: "journal IO failure prevents issue" },
    { suite: "operation-telemetry", scenario: "real evidence directory and day IO failures cannot become zero telemetry" },
  ], "An injected ENOSPC on the journal write, and injected write failures. No real volume is filled."),
  fault("CORRUPT_STATE", "Corrupt durable state is loud on read, fails closed for a decision, is never overwritten and never read as a shorter history.", [
    { suite: "execution-gate", scenario: "store — corrupt gate.json: loud on read(), fail-closed for a decision, never overwritten" },
    { suite: "execution-journal", scenario: "a corrupt journal entry fails closed on read (not silently reinterpreted)" },
    { suite: "durable-task-recovery", scenario: "corrupt journal: reported for that task, untouched, and the sweep goes on" },
  ]),
  fault("CLOCK_BACKWARD_FUTURE", "A clock that went backwards or a time that cannot be read fails admission closed; a future-dated fact or measurement is not current evidence.", [
    { suite: "action-firewall", scenario: "backwards and invalid admission clocks fail closed" },
    { suite: "action-firewall", scenario: "malformed persisted time fails closed instead of a NaN immortal grant" },
    { suite: "open-ended-evolution", scenario: "54 old-HEAD measurements and future-dated observations are not current evidence" },
    { suite: "memory", scenario: "retrieval — a future-dated fact is quarantined" },
  ]),
  fault("DUPLICATE_DAEMON", "Two daemons share one lock: one sweeps, one executes, one occurrence is reserved.", [
    { suite: "durable-task-recovery", scenario: "duplicate daemon: one sweeper at a time, a crashed sweeper's lock is reclaimed" },
    { suite: "durable-task-runtime", scenario: "duplicate daemon: two runtimes, one execution" },
    { suite: "research-scheduler", scenario: "two daemon ticks use the same lock and reserve only one occurrence" },
  ]),
  fault("STALE_GRAPHIFY", "A stale graph promotes no candidate, touches no store and closes no publication.", [
    { suite: "autonomy-daemon", scenario: "stale Graphify never promotes a candidate into a new owner-actionable PENDING proposal" },
    { suite: "controlled-self-evolution-cycle", scenario: "stale Graphify touches no store" },
    { suite: "proposal-approval-service", scenario: "stale Graphify metadata and unhealthy health are independently fail-closed by the canonical closure" },
  ]),
  fault("GRAPHIFY_NEEDS_UPDATE", "The needs_update marker makes the graph stale: discovery produces no proposal, recovery does not loop, and the recorded graph state is not bound to the commit.", [
    { suite: "graphify-integration", scenario: "Stage 10 recovery: needs_update is stale; a never-indexed dirty file does not loop GRAPHIFY_REFRESH" },
    { suite: "graphify-integration", scenario: "proposal-producing discovery honors the needs_update lifecycle marker" },
    { suite: "durable-task-recovery", scenario: "first activity set: one read-only Graphify state read, recorded once per commit", marker: "needsUpdateFlag: true" },
  ]),
  fault("DELAYED_OWNER", "A task that waits for the owner waits for days without expiring and is never taken over; an approval that expired while waiting is not renewed.", [
    { suite: "durable-task-runtime", scenario: "owner delay of days: the task waits without expiring, then follows the signal" },
    { suite: "durable-task-recovery", scenario: "owner delay and stale tasks: waiting is not stale, a stuck step is reported and never taken over" },
    { suite: "owner-capability-firewall", scenario: "expired reservation cannot issue a fresh TTL" },
  ]),
  fault("REJECTED_PROPOSAL", "A rejection is durable and is not replayed: the same opportunity comes back only through the owner.", [
    { suite: "autonomy-daemon", scenario: "reject and defer persist distinct decisions" },
    { suite: "controlled-self-evolution-cycle", scenario: "owner rejected opportunity not replayed" },
    { suite: "open-ended-evolution", scenario: "49 duplicate of a rejected opportunity needs the owner" },
  ]),
  fault("STALE_PROPOSAL_AFTER_NEW_HEAD", "A proposal whose base commit is no longer HEAD is refused, marked STALE, and reserves and mutates nothing.", [
    { suite: "proposal-execution-service", scenario: "M16: stale baseHead (repo advanced) is blocked, durably marked STALE, and no reservation is ever created" },
    { suite: "proposal-approval-service", scenario: "HEAD drift since the proposal's baseHead invalidates the authorization — refused, proposal reconciled to STALE" },
    { suite: "patch-artifact-execution-integration", scenario: "stale baseHead: the repo moved on since the proposal's baseHead — execution refuses (fail closed, no replay)" },
  ]),
  fault("FAILED_REGRESSION", "A change that fails its validators after it was applied is rolled back to the original bytes and recorded as recovery-required, never as a success.", [
    { suite: "patch-artifact-execution-integration", scenario: "real execution-time validator failure rolls back the write and leaves the proposal RECOVERY_REQUIRED, never a false success" },
    { suite: "proposal-approval-service", scenario: "an edit to a pre-existing file that fails post-execution validation is reverted to its ORIGINAL content, never deleted (the M19 revertToHead fix)" },
    { suite: "guarded-publication", scenario: "a post-execution validation failure is ROLLED_BACK with its ORIGINAL code and stage preserved — the guard reports the lane's truth, it does not relabel it" },
  ]),
  fault("MEMORY_POISONING", "Poisoned memory is quarantined, cannot write a protected key as authority, and gains nothing from being short or lexically close.", [
    { suite: "memory-integrity", scenario: "real persisted chat provenance and poisoned memory after context reset" },
    { suite: "memory-integrity", scenario: "protected keys cannot be written as instruction authority" },
    { suite: "context-budget", scenario: "quarantine excluded; low trust cannot promote itself to protected authority; a shorter low-trust entry gains nothing" },
  ]),
  fault("MALICIOUS_REPO_CONTENT", "Hostile content is data: shell-shaped text in a request is refused, a redirected or junctioned repository is not the leased resource, and a change to runtime configuration, a scheduler or an authority module is not publishable.", [
    { suite: "action-runtime", scenario: "shell-like content anywhere in the request is rejected (no arbitrary shell escape)", marker: "rm -rf" },
    { suite: "durable-task-recovery", scenario: "durable native read refuses unknown or redirected physical repository" },
    { suite: "repair-approval-proof", scenario: "junction scope is rejected before foreign read/write" },
    { suite: "guarded-publication", scenario: "runtime config, scheduler, service entry and storage/execution authority each classify to their own non-publishable class" },
    { suite: "technology-watch", scenario: "P24 instruction-shaped source text blocks the candidate and never becomes an action" },
  ], "No suite gives a model a repository file with instructions written into it: no local coding model is qualified to read one (Stage 15A)."),
  fault("DEPENDENCY_INSTALL_REQUEST", "A request to install a dependency is never executed: AYAS has no install path, the opportunity needs an approval AYAS cannot give itself, and package.json is not a publishable target.", [
    { suite: "open-ended-evolution", scenario: "28 no install authority" },
    { suite: "open-ended-evolution", scenario: "H5 research-derived capability containing malicious instruction text", marker: "npm install evil-codec" },
    { suite: "technology-watch", scenario: "P15 install scripts or elevated privilege require security review" },
    { suite: "guarded-publication", scenario: "runtime config, scheduler, service entry and storage/execution authority each classify to their own non-publishable class", marker: '["package.json", "RUNTIME_CONFIG"]' },
  ]),
  fault("INVALID_TOOL_SCHEMA", "An unknown tool, a request without its required input and a malformed or self-widened request are refused before anything is dispatched or recorded.", [
    { suite: "action-runtime", scenario: "unknown tool is denied, never dispatched" },
    { suite: "action-runtime", scenario: "missing required input (inspect-project with no projectSlug) is rejected" },
    { suite: "discovery-run-firewall", scenario: "a malformed, unknown or self-widened request is refused before any record" },
    { suite: "execution-bridge", scenario: "policy — malformed request / plan → DENY" },
    { suite: "action-firewall-closure", scenario: "product context reads the catalogue through the guarded tool; no MCP client exists" },
  ], "AYAS has no MCP client, so there is no MCP schema to be invalid; the closure audit pins that absence. An MCP client added later must bring its own invalid-schema proof."),
  fault("EXTERNAL_AUTH_EXPIRY", "A credential the other side no longer accepts gives a status-only error with no secret in it; an expired owner session approves nothing; an expired grant is denied and marked expired.", [
    { suite: "model-router", scenario: "cloud provider — a non-200 throws a status-only error (never the body)", marker: "status: 401" },
    { suite: "owner-session-admission", scenario: "expired session cannot approve" },
    { suite: "access-gate", scenario: "session fails once expired" },
    { suite: "execution-bridge", scenario: "authz — an expired grant is DENIED and marked expired" },
  ], "The phone gateway's key handling is proven by the phone runtime suite, which is outside the declared baseline. Git push credentials are the owner's and are not held by AYAS."),

  link("DETECT", "A gap counts only when it is measured at the current commit with the same evaluator; observing is read-only and a dirty repository pauses it.", [
    { suite: "open-ended-evolution", scenario: "50 Stage 8 gap must reproduce at the current HEAD with the same evaluator" },
    { suite: "autonomy-daemon", scenario: "default observation is read-only and dirty repositories pause" },
  ]),
  link("PLAN", "The planner turns a measured, registered opportunity into one plan and touches no store for anything else.", [
    { suite: "controlled-self-evolution-cycle", scenario: "measured register really is eligible" },
    { suite: "controlled-self-evolution-cycle", scenario: "unregistered strategy touches no store" },
  ]),
  link("LOCAL_PATCH", "The patch is made on this machine and frozen as an immutable artifact with its own hash.", [
    { suite: "controlled-self-evolution-cycle", scenario: "real TEMP experiment yields verified candidate" },
    { suite: "patch-artifact", scenario: "freeze computes a patchHash and persists the artifact to disk" },
  ], "The patch comes from a registered deterministic strategy. No local coding model writes it: none is qualified, which is the LOCAL_CODING_BACKEND_NOT_QUALIFIED gap."),
  link("TESTS", "The candidate is validated in a TEMP sandbox before it is proposed, and the artifact's own validators run again at execution and are recorded.", [
    { suite: "controlled-self-evolution-cycle", scenario: "real TEMP experiment yields verified candidate" },
    { suite: "patch-artifact-execution-integration", scenario: "execution runs the artifact's own declared validators and records their PASS result durably" },
  ]),
  link("GRAPHIFY", "A stale graph blocks the proposal, and a publication closes only after the graph is refreshed and verified at the new commit.", [
    { suite: "autonomy-daemon", scenario: "stale Graphify never promotes a candidate into a new owner-actionable PENDING proposal" },
    { suite: "proposal-approval-service", scenario: "real publication order closes only after the new pushed HEAD: refresh, fresh metadata, integrity, then HEALTHY health" },
  ]),
  link("PROPOSAL", "A safe candidate becomes exactly one durable pending proposal.", [
    { suite: "autonomy-daemon", scenario: "safe candidate becomes one durable pending proposal" },
    { suite: "controlled-self-evolution-cycle", scenario: "existing owner-flow proposal blocks duplicate" },
  ]),
  link("OWNER_PATH", "Only the owner's decision, bound to the proposal's hash, base commit and exact files, lets it run, and only once.", [
    { suite: "autonomy-daemon", scenario: "approval binds hash, HEAD and exact files and is one-shot" },
    { suite: "owner-session-admission", scenario: "expired session cannot approve" },
    { suite: "proposal-approval-service", scenario: "one authorization binds decide + Package C execution + Git publication: a single call produces ONE pushed commit" },
  ]),
  link("EXECUTE", "The approved change is applied inside its exact files, through the execution gate, and durably completed.", [
    { suite: "patch-artifact-execution-integration", scenario: "full happy path: APPROVE -> execute -> real mutation applied -> durable testResults -> EXECUTED -> gate closed" },
    { suite: "proposal-execution-service", scenario: "successful execution stays within exactFiles and is durably completed" },
  ]),
  link("POST_VERIFY", "After the change, success is recorded only when the validators, the graph and the health check agree; a failed closure is recovery-required.", [
    { suite: "proposal-approval-service", scenario: "real publication order closes only after the new pushed HEAD: refresh, fresh metadata, integrity, then HEALTHY health" },
    { suite: "proposal-approval-service", scenario: "a post-push Graphify closure failure preserves the published commit and becomes recovery-required, never a false success" },
  ]),
  link("RECOVER_ROLLBACK", "A failed change is rolled back to the original bytes, and an interrupted finalization resumes its own receipt without repeating the result.", [
    { suite: "patch-artifact-execution-integration", scenario: "real execution-time validator failure rolls back the write and leaves the proposal RECOVERY_REQUIRED, never a false success" },
    { suite: "proposal-approval-service", scenario: "an edit to a pre-existing file that fails post-execution validation is reverted to its ORIGINAL content, never deleted (the M19 revertToHead fix)" },
    { suite: "proposal-approval-service", scenario: "a crash after result persistence during finalization resumes the same receipt without replaying or duplicating the result" },
  ]),

  {
    kind: "CONDITION", id: "CLOUD_CODING_OFF",
    claim: "No AYAS surface reaches a paid or cloud model: the router never selects the cloud provider, whatever is configured or down.",
    limit: "AYAS has no adapter that hands a coding task to Claude or Codex; a hand-over to those agents is a person's act and is outside this record.",
    proofs: [
      { suite: "action-firewall-closure", scenario: "the model router never selects the cloud provider, whatever is configured or down" },
      { suite: "action-firewall-closure", scenario: "no AYAS surface reaches a production provider, a paid model, the pipeline runner, a publisher or the dormant write bridge" },
      { suite: "model-router", scenario: "router — Ollama down + unknown-cost cloud configured → denied, no paid fallback" },
    ],
  },
]);
