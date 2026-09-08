/**
 * Atölye Brain — security governance model.
 *
 * The Brain helps run the security of the (future, internet-facing) Atölye
 * server, but "the Brain protects itself" is NOT an excuse to hand security to a
 * model. Every control here is meant to be enforced **deterministically, in
 * code**: allowlist / denylist, sandbox, minimum privilege, immutable auditable
 * policy. The Brain's job is to *check* that these controls exist and are
 * correct, *find* gaps, and *propose* fixes for user approval — not to be the
 * control.
 *
 * This file is types only. `BrainSecurityCatalog.ts` carries the deterministic
 * catalog; `BrainSecurityPolicy.ts` the pure checks; `BrainSecurityAuditModel.ts`
 * the posture evaluator.
 */

export const brainSecuritySchemaVersion = "1" as const;

export type BrainSecurityControlId =
  | "authentication"
  | "authorization"
  | "admin-access"
  | "rate-limiting"
  | "brute-force-protection"
  | "secret-management"
  | "audit-log"
  | "session-cookie-safety"
  | "csrf"
  | "xss"
  | "injection"
  | "file-upload-safety"
  | "path-traversal"
  | "command-execution-isolation"
  | "dependency-audit"
  | "backup-recovery"
  | "health-checks"
  | "intrusion-anomaly-detection";

export type BrainSecurityControlStatus =
  | "enforced-in-code"
  | "partial"
  | "not-implemented"
  | "not-applicable-yet"
  | "unknown";

export type BrainSecuritySeverity = "info" | "low" | "medium" | "high" | "critical";

export type BrainSecurityEnforcementStyle =
  | "allowlist"
  | "denylist"
  | "sandbox"
  | "minimum-privilege"
  | "immutable-policy"
  | "signed-audit-log"
  | "deterministic-validator";

export interface BrainSecurityControl {
  readonly id: BrainSecurityControlId;
  readonly title: string;
  readonly whatItProtects: string;
  /** How it should be enforced — deterministic, code-level. */
  readonly enforcement: readonly BrainSecurityEnforcementStyle[];
  /** A concrete deterministic check the Brain (or a test) can run. */
  readonly deterministicCheck: string;
  /** Where in the roadmap this belongs (mostly PHASE 7 — Platform). */
  readonly roadmapPhase: string;
  readonly currentStatus: BrainSecurityControlStatus;
  readonly notes: readonly string[];
}

export interface BrainSecurityFinding {
  readonly controlId: BrainSecurityControlId;
  readonly severity: BrainSecuritySeverity;
  readonly statement: string;
  readonly evidence: readonly string[];
  readonly recommendation: string;
  /** Always true for anything touching auth/policy/data — never auto-applied. */
  readonly requiresUserApproval: boolean;
}

export interface BrainSecurityPostureInput {
  /** Deterministic, structured facts a gatherer (later phase) collects about the repo. */
  readonly hasAuthMiddleware: boolean;
  readonly hasAuthorizationChecks: boolean;
  readonly hasRateLimiting: boolean;
  readonly secretsOnlyInEnv: boolean;
  readonly envFilesGitIgnored: boolean;
  readonly hasAuditLog: boolean;
  readonly hasHealthEndpoint: boolean;
  readonly hasDependencyAuditScript: boolean;
  readonly hasBackupTooling: boolean;
  readonly pathContainmentEnforced: boolean;
  readonly shellExecutionAllowlisted: boolean;
  readonly internetFacing: boolean;
  readonly observedAt: string;
}

export interface BrainSecurityPosture {
  readonly schemaVersion: typeof brainSecuritySchemaVersion;
  readonly observedAt: string;
  readonly overall: BrainSecuritySeverity;
  readonly readyForInternetExposure: boolean;
  readonly findings: readonly BrainSecurityFinding[];
  /** Ordered backlog: what to build first for a safe public deployment. */
  readonly prioritizedBacklog: readonly BrainSecurityControlId[];
}

export type BrainRequestRisk = "safe" | "review" | "block";

export interface BrainRequestClassification {
  readonly risk: BrainRequestRisk;
  readonly reasons: readonly string[];
}
