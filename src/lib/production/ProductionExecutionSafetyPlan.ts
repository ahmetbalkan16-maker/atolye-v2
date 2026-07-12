import type {
  ProductionActionRiskProfile,
  ProductionCapability,
  ProductionExecutionInvariant,
  ProductionExecutionRoadmapItem,
  ProductionExecutionThreat,
} from "@/types/productionExecutionSafety";

export const productionCapabilityMatrix: readonly ProductionCapability[] = [
  capability("snapshot", "ready", "stable", true, [], "Canonical read-only production state projection."),
  capability("health", "ready", "stable", true, ["snapshot"], "Deterministic health evaluation."),
  capability("evidence", "ready", "stable", true, ["health"], "Finding evidence carried without mutation."),
  capability("actions", "ready", "stable", true, ["health", "evidence"], "Deterministic recommendations, not commands."),
  capability("dependency-graph", "ready", "stable", true, ["snapshot", "health", "actions"], "Canonical stage dependency projection."),
  capability("planner", "ready", "stable", true, ["snapshot", "actions", "dependency-graph"], "Read-only ready/blocked/complete/unknown plan."),
  capability("execution-contract", "ready", "stable", true, ["planner"], "Validated deterministic dry-run request contract."),
  capability("dry-run-gateway", "preview-only", "stable", true, ["execution-contract"], "Allowlisted operation metadata; execute mode rejected."),
  capability("job-preview", "preview-only", "stable", true, ["dry-run-gateway"], "Small non-persisted job preview."),
  capability("consumer-versioning", "ready", "stable", true, ["actions", "dependency-graph", "planner"], "Schema version 1 parser and health-only fallback."),
  capability("api-integration", "ready", "stable", true, ["health", "consumer-versioning"], "Optional additive intelligence on the existing GET response."),
  capability("passive-ui", "ready", "stable", true, ["api-integration"], "Validated passive summary; no execution control."),
  capability("real-execution", "blocked", "not-defined", false, ["authorization", "confirmation", "persistent-idempotency", "audit-trail", "controlled-rollout"], "No Production Intelligence execute entrypoint exists."),
  capability("queue-dispatch", "blocked", "not-defined", false, ["real-execution", "persistent-idempotency"], "No Production Intelligence job is enqueued."),
  capability("authorization", "planned", "not-defined", true, ["consumer-versioning"], "Actor, project and operation scopes must be defined."),
  capability("confirmation", "planned", "not-defined", true, ["authorization", "execution-contract"], "Bound, expiring and auditable confirmation is required."),
  capability("persistent-idempotency", "planned", "not-defined", false, ["execution-contract"], "Deterministic keys are not yet reserved persistently."),
  capability("audit-trail", "planned", "not-defined", false, ["authorization", "persistent-idempotency"], "Execution lifecycle audit persistence is absent."),
  capability("cancellation", "planned", "not-defined", false, ["queue-dispatch", "audit-trail"], "Production Intelligence cancellation semantics are undefined."),
  capability("retry-policy", "planned", "not-defined", false, ["audit-trail", "recovery"], "Failure classification and safe retry rules are undefined."),
  capability("rollback", "unsupported", "not-defined", true, ["recovery"], "Rollback support must be declared per operation; none is promised."),
  capability("recovery", "planned", "not-defined", false, ["audit-trail", "persistent-idempotency"], "Partial-success recovery and journals are not implemented."),
  capability("controlled-rollout", "planned", "not-defined", true, ["authorization", "confirmation", "persistent-idempotency", "audit-trail"], "Real execution remains default-off until policy gates pass."),
];

export const productionExecutionThreats: readonly ProductionExecutionThreat[] = [
  threat("duplicate-execution", "identity", "critical", "Same logical request executes twice.", "Persistently reserve the idempotency key before enqueue.", "Detect duplicate reservations and execution IDs.", "Return the existing execution; never enqueue another.", ["persistent-idempotency", "queue-dispatch"]),
  threat("stale-request", "compatibility", "critical", "Request targets an obsolete snapshot.", "Perform a final fingerprint check before reservation and enqueue.", "Record stale validation failures.", "Reject and require a new plan.", ["execution-contract", "real-execution"]),
  threat("unauthorized-execution", "authorization", "critical", "Actor lacks project or operation permission.", "Require actor, project and operation scopes.", "Audit denied and accepted actor decisions.", "Reject without side effects.", ["authorization", "audit-trail"]),
  threat("missing-confirmation", "authorization", "high", "A confirmation-required action proceeds without proof.", "Bind confirmation to request, project, fingerprint and expiry.", "Validate single-use confirmation before reservation.", "Reject and request fresh confirmation.", ["confirmation"]),
  threat("wrong-project-slug", "identity", "critical", "Mutation targets an invalid or different project.", "Use canonical slug validation and bind every contract to one project.", "Compare request, job and worker project scopes.", "Reject and emit a security audit event.", ["authorization", "real-execution"]),
  threat("action-stage-mismatch", "identity", "high", "Operation runs against an incompatible stage.", "Validate registry action-stage compatibility.", "Worker revalidates immutable job metadata.", "Reject before provider or filesystem work.", ["execution-contract", "real-execution"]),
  threat("missing-prerequisite", "consistency", "high", "A downstream operation runs before dependencies.", "Final dependency and output readiness check before enqueue.", "Record blocked prerequisite references.", "Return blocked; do not reserve as running.", ["dependency-graph", "planner"]),
  threat("queue-duplication", "queue", "critical", "Equivalent jobs are enqueued multiple times.", "Enqueue only after atomic idempotency reservation.", "Unique queue/idempotency constraint.", "Keep one canonical job reference.", ["queue-dispatch", "persistent-idempotency"]),
  threat("worker-retry-duplication", "queue", "critical", "Worker retry repeats committed side effects.", "Classify retryability and check journal state.", "Compare attempt and committed output markers.", "Resume only from a verified recovery point.", ["retry-policy", "recovery"]),
  threat("partial-filesystem-write", "consistency", "critical", "Only part of a logical write commits.", "Temp write, validate, atomic rename, manifest last and journal.", "Consistency verification after each commit boundary.", "Recover from journal or mark partially-succeeded.", ["recovery"]),
  threat("manifest-output-inconsistency", "consistency", "critical", "Manifest and outputs disagree.", "Commit output first and manifest last after validation.", "Post-write manifest/output verification.", "Repair from operation journal; never claim full success.", ["recovery"]),
  threat("process-crash", "recovery", "high", "Process stops during execution.", "Persist state transitions and recovery markers atomically.", "Find non-terminal reservations on startup.", "Resume or fail through explicit recovery policy.", ["persistent-idempotency", "recovery"]),
  threat("provider-timeout", "provider", "high", "Provider result is unknown after timeout.", "Use provider idempotency where available and classify ambiguity.", "Store provider request reference without secrets.", "Do not blindly retry ambiguous outcomes.", ["retry-policy", "audit-trail"]),
  threat("provider-save-failure", "provider", "critical", "Provider succeeded but local save failed.", "Journal provider result reference before local commit.", "Detect provider-success/local-failure transition.", "Recover save without repeating provider side effect.", ["recovery", "audit-trail"]),
  threat("cancellation-race", "queue", "high", "Completion races with cancellation.", "Check cancellation at defined commit boundaries.", "Record ordered transition sequence.", "Use authoritative terminal-state policy.", ["cancellation", "audit-trail"]),
  threat("retry-after-partial-success", "recovery", "critical", "Retry overwrites or duplicates partial output.", "Partially-succeeded is non-auto-retryable.", "Journal committed outputs and effects.", "Require operator recovery decision.", ["retry-policy", "recovery"]),
  threat("unsupported-rollback", "recovery", "high", "UI or API implies rollback where none exists.", "Declare rollback support per operation.", "Contract validation rejects unsupported rollback.", "Expose unsupported status explicitly.", ["rollback"]),
  threat("audit-event-loss", "audit", "high", "Execution transition lacks an audit record.", "Define audit write as a required lifecycle boundary.", "Reconcile execution and audit sequences.", "Mark audit-incomplete and block higher-risk rollout.", ["audit-trail"]),
  threat("secret-or-path-leakage", "security", "critical", "Public output exposes secrets or absolute paths.", "Allowlist public fields and sanitize errors.", "Leakage tests scan responses and audit payloads.", "Suppress response and retain safe internal reference.", ["api-integration", "audit-trail"]),
  threat("cross-project-mutation", "authorization", "critical", "Worker writes outside the bound project.", "Resolve all resources from validated job project scope.", "Verify project on every write and audit event.", "Stop worker and flag security incident.", ["authorization", "real-execution"]),
  threat("consumer-producer-mismatch", "compatibility", "high", "Old consumer misreads a new producer contract.", "Use schema versioning and safe unsupported fallback.", "Track unsupported parser results.", "Fall back to health-only behavior.", ["consumer-versioning"]),
];

export const productionExecutionInvariants: readonly ProductionExecutionInvariant[] = [
  "Validation completes before execution starts.", "Stale requests never execute.", "Unsupported actions never execute.",
  "Action and stage must match.", "Required confirmation must be verified.", "One idempotency key represents one logical execution.",
  "Only prepared jobs may be enqueued.", "Queued job contracts are immutable.", "Workers execute only allowlisted operations.",
  "Project slugs pass canonical validation.", "Workers cannot write to another project.", "Output and manifest changes use a defined consistency boundary.",
  "Partial success is represented explicitly.", "Retries are limited to declared retryable failures.", "Unsupported rollback is never represented as available.",
  "Every execution has an audit trail.", "Secrets and absolute paths never enter public responses.", "Real execution is default-off.",
  "Rollout is enabled only by central policy.", "UI controls depend on server-confirmed capability.",
].map((statement, index) => ({ id: `execution-invariant-${String(index + 1).padStart(2, "0")}`, statement }));

export const productionActionRiskProfiles: readonly ProductionActionRiskProfile[] = [
  actionRisk("inspect-source", "unsupported", "read-only", false, [], [], false, "production:read"),
  actionRisk("review-metric", "unsupported", "read-only", false, [], [], false, "production:read"),
  actionRisk("reconcile-state", "unresolved", "medium", false, [], [], "unresolved", "production:execute:reconcile"),
  actionRisk("retry-stage", "preview-only", "high", true, ["manifest", "stage-output", "pipeline-job", "pipeline-history"], ["stage-status-transition"], "unresolved", "production:execute:retry"),
  actionRisk("resume-stage", "preview-only", "high", true, ["manifest", "stage-output", "pipeline-job", "pipeline-history"], ["stage-status-transition", "downstream-stage-enqueue"], "unresolved", "production:execute:resume"),
];

export const firstRealExecutionCandidate = "not-selected" as const;

export const productionExecutionRoadmap: readonly ProductionExecutionRoadmapItem[] = [
  roadmap("97.1", "Execution authorization contract", ["capability matrix", "project slug policy"], ["actor/project/operation decision contract"], ["middleware", "login"], ["scope and cross-project smoke"], ["97.0"]),
  roadmap("97.2", "Confirmation contract", ["authorization decision", "execution request"], ["bound confirmation preview contract"], ["token issuing", "UI modal"], ["expiry, stale and single-use model smoke"], ["97.1"]),
  roadmap("97.3", "Persistent idempotency contract", ["execution request", "confirmation decision"], ["reservation state machine contract"], ["database adapter", "enqueue"], ["duplicate state transition smoke"], ["97.2"]),
  roadmap("97.4", "Queue adapter foundation", ["prepared job", "idempotency reservation"], ["immutable queue payload adapter"], ["worker execution"], ["duplicate enqueue and stale preflight smoke"], ["97.3"]),
  roadmap("97.5", "Execution audit contract", ["queue payload", "actor decision"], ["safe lifecycle audit event contract"], ["audit persistence"], ["secret/path and transition smoke"], ["97.1", "97.4"]),
  roadmap("97.6", "Transactional write and recovery foundation", ["audit contract", "ProjectWriter behavior"], ["journal and commit-boundary contract"], ["provider execution"], ["partial-write recovery smoke"], ["97.5"]),
  roadmap("97.7", "Controlled single-action execution", ["authorization", "confirmation", "idempotency", "queue", "audit", "recovery"], ["one allowlisted local execution path"], ["multi-stage execution", "hosted rollout"], ["default-off and end-to-end safety smoke"], ["97.6"]),
  roadmap("97.8", "Cancellation and retry safety", ["single-action execution", "audit journal"], ["cancellation checkpoints and retry classifier"], ["automatic partial-success retry"], ["race and ambiguous-provider smoke"], ["97.7"]),
  roadmap("97.9", "Execution phase review", ["97.1-97.8 contracts"], ["risk closure report and rollout decision"], ["new execution features"], ["full regression, lint, type and build"], ["97.8"]),
];

function capability(id: ProductionCapability["id"], status: ProductionCapability["status"], publicContract: ProductionCapability["publicContract"], readOnly: boolean, dependencies: ProductionCapability["dependencies"], description: string): ProductionCapability { return { id, status, publicContract, readOnly, usesPersistence: false, producesSideEffects: false, dependencies, description }; }
function threat(id: string, category: ProductionExecutionThreat["category"], severity: ProductionExecutionThreat["severity"], description: string, prevention: string, detection: string, recovery: string, relatedCapabilities: ProductionExecutionThreat["relatedCapabilities"]): ProductionExecutionThreat { return { id, category, severity, description, prevention, detection, recovery, requiredBeforeExecution: true, relatedCapabilities }; }
function actionRisk(actionType: ProductionActionRiskProfile["actionType"], executionSupport: ProductionActionRiskProfile["executionSupport"], riskLevel: ProductionActionRiskProfile["riskLevel"], confirmationRequired: boolean, possibleWrites: string[], possibleManifestChanges: string[], externalProviderSideEffect: ProductionActionRiskProfile["externalProviderSideEffect"], requiredAuthorizationScope: string): ProductionActionRiskProfile { return { actionType, executionSupport, riskLevel, confirmationRequired, supportsRetry: "unresolved", supportsCancellation: "unresolved", supportsRollback: "unresolved", possibleWrites, possibleManifestChanges, externalProviderSideEffect, requiredAuthorizationScope }; }
function roadmap(sprint: string, purpose: string, inputContracts: string[], outputContracts: string[], exclusions: string[], testGates: string[], dependencies: string[]): ProductionExecutionRoadmapItem { return { sprint, purpose, inputContracts, outputContracts, exclusions, testGates, dependencies }; }
