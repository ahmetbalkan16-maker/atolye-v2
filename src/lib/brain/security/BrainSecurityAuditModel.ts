/**
 * Atölye Brain — security posture evaluator (pure).
 *
 * Takes a structured, deterministic set of facts about the repo
 * (`BrainSecurityPostureInput` — gathered by a later, read-only adapter) and
 * grades it against `BRAIN_SECURITY_CATALOG`, producing findings and an ordered
 * backlog for a safe internet-facing deployment.
 *
 * It never changes anything. Every finding that touches auth / policy / data is
 * flagged `requiresUserApproval: true`.
 */

import { BRAIN_SECURITY_CATALOG } from "./BrainSecurityCatalog";
import {
  brainSecuritySchemaVersion,
  type BrainSecurityControlId,
  type BrainSecurityFinding,
  type BrainSecurityPosture,
  type BrainSecurityPostureInput,
  type BrainSecuritySeverity,
} from "@/types/brainSecurity";

const SEVERITY_RANK: Readonly<Record<BrainSecuritySeverity, number>> = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
});

function worst(a: BrainSecuritySeverity, b: BrainSecuritySeverity): BrainSecuritySeverity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

function finding(
  controlId: BrainSecurityControlId,
  severity: BrainSecuritySeverity,
  statement: string,
  recommendation: string,
  evidence: readonly string[],
): BrainSecurityFinding {
  const requiresUserApproval = (
    [
      "authentication",
      "authorization",
      "admin-access",
      "secret-management",
      "session-cookie-safety",
      "backup-recovery",
      "intrusion-anomaly-detection",
    ] as BrainSecurityControlId[]
  ).includes(controlId);
  return { controlId, severity, statement, evidence: [...evidence], recommendation, requiresUserApproval };
}

/**
 * Evaluate the posture. Deterministic. When `internetFacing` is false (the
 * default local studio), missing web-perimeter controls are `medium`/`low`
 * "needed before exposure"; when true, they become `critical`/`high`.
 */
export function evaluateBrainSecurityPosture(
  input: BrainSecurityPostureInput,
): BrainSecurityPosture {
  const findings: BrainSecurityFinding[] = [];
  const exposed = input.internetFacing;
  const perimeter = (base: BrainSecuritySeverity): BrainSecuritySeverity =>
    exposed ? worst(base, "high") : base;

  if (!input.hasAuthMiddleware) {
    findings.push(
      finding(
        "authentication",
        exposed ? "critical" : "medium",
        exposed
          ? "Internet-facing with no authentication middleware — anyone can drive the pipeline."
          : "No authentication middleware. Required before any remote exposure.",
        "Add a single auth middleware that 401s unauthenticated requests to every non-public route.",
        [`hasAuthMiddleware=${input.hasAuthMiddleware}`, `internetFacing=${exposed}`],
      ),
    );
  }
  if (!input.hasAuthorizationChecks) {
    findings.push(
      finding(
        "authorization",
        exposed ? "high" : "low",
        "No table-driven authorization checks on mutating routes.",
        "Declare a required capability per mutating route; enforce it in middleware, not per-handler.",
        [`hasAuthorizationChecks=${input.hasAuthorizationChecks}`],
      ),
    );
  }
  if (!input.hasRateLimiting) {
    findings.push(
      finding(
        "rate-limiting",
        perimeter("medium"),
        "No request-rate limiting (the $1 cost guard limits spend, not request rate).",
        "Add a fixed-window/token-bucket limiter in middleware keyed by session+route with constant limits.",
        [`hasRateLimiting=${input.hasRateLimiting}`],
      ),
    );
    findings.push(
      finding(
        "brute-force-protection",
        perimeter("medium"),
        "No brute-force protection on auth-bearing endpoints.",
        "Persisted failed-attempt counter per IP+account with exponential backoff and lockout.",
        [],
      ),
    );
  }
  if (!input.secretsOnlyInEnv || !input.envFilesGitIgnored) {
    findings.push(
      finding(
        "secret-management",
        "high",
        "Secrets may live outside `.env*` or `.env*` is not git-ignored.",
        "Keep secrets only in git-ignored `.env*`; keep `BrainRedaction` on every Brain-written string; add a CI check.",
        [
          `secretsOnlyInEnv=${input.secretsOnlyInEnv}`,
          `envFilesGitIgnored=${input.envFilesGitIgnored}`,
        ],
      ),
    );
  }
  if (!input.hasAuditLog) {
    findings.push(
      finding(
        "audit-log",
        perimeter("medium"),
        "No append-only, tamper-evident audit log for privileged actions.",
        "Reuse the `ProductionOperationJournal` integrity-fingerprint pattern for an auth/admin audit log.",
        [`hasAuditLog=${input.hasAuditLog}`],
      ),
    );
  }
  if (exposed) {
    findings.push(
      finding(
        "session-cookie-safety",
        "high",
        "Internet-facing: session/cookie hardening (HttpOnly/Secure/SameSite, rotation, idle TTL) must be verified.",
        "Set cookie flags explicitly; rotate session id on privilege change; short idle TTL.",
        [],
      ),
      finding(
        "csrf",
        "high",
        "Internet-facing: no CSRF protection verified on state-changing routes.",
        "Double-submit token or strict `Sec-Fetch-Site`/`Origin` allowlist in middleware for every non-GET.",
        [],
      ),
    );
  }
  if (!input.hasDependencyAuditScript) {
    findings.push(
      finding(
        "dependency-audit",
        "low",
        "No scheduled dependency/security audit.",
        "Add `npm audit --production` (or osv-scanner) to CI and a Brain task that summarises new advisories.",
        [`hasDependencyAuditScript=${input.hasDependencyAuditScript}`],
      ),
    );
  }
  if (!input.hasBackupTooling) {
    findings.push(
      finding(
        "backup-recovery",
        "medium",
        "No backup/recovery tooling detected.",
        "Schedule `runtime:backup:*` (inventory/create/verify/restore-verify) with an off-box copy.",
        [`hasBackupTooling=${input.hasBackupTooling}`],
      ),
    );
  }
  if (!input.pathContainmentEnforced) {
    findings.push(
      finding(
        "path-traversal",
        "high",
        "Path containment not verified on asset/file routes.",
        "Enforce `isInsideDirectory`/`isSafeFileName` + reparse rejection on every segment.",
        [`pathContainmentEnforced=${input.pathContainmentEnforced}`],
      ),
    );
  }
  if (!input.shellExecutionAllowlisted) {
    findings.push(
      finding(
        "command-execution-isolation",
        "medium",
        "Shell/command execution is not allowlisted.",
        "Route every spawn through `checkBrainShellCommand`; argv arrays only; timeout + process-tree kill.",
        [`shellExecutionAllowlisted=${input.shellExecutionAllowlisted}`],
      ),
    );
  }
  if (!input.hasHealthEndpoint) {
    findings.push(
      finding(
        "health-checks",
        "low",
        "No structured health endpoint for the worker to poll.",
        "Expose `/api/runtime/health`; have the Brain worker poll it each cycle.",
        [`hasHealthEndpoint=${input.hasHealthEndpoint}`],
      ),
    );
  }
  if (exposed) {
    findings.push(
      finding(
        "intrusion-anomaly-detection",
        "medium",
        "Internet-facing with no anomaly detection over access logs.",
        "Deterministic rules over the audit log (new IP + admin action, 401 burst, off-hours mutation) → alert.",
        [],
      ),
    );
  }

  const overall = findings.reduce<BrainSecuritySeverity>(
    (acc, item) => worst(acc, item.severity),
    "info",
  );

  const catalogOrder = BRAIN_SECURITY_CATALOG.map((control) => control.id);
  const prioritizedBacklog = [...new Set(findings.map((item) => item.controlId))].sort(
    (left, right) => {
      const leftFinding = findings.find((item) => item.controlId === left)!;
      const rightFinding = findings.find((item) => item.controlId === right)!;
      return (
        SEVERITY_RANK[leftFinding.severity] - SEVERITY_RANK[rightFinding.severity] ||
        catalogOrder.indexOf(left) - catalogOrder.indexOf(right)
      );
    },
  );

  return {
    schemaVersion: brainSecuritySchemaVersion,
    observedAt: input.observedAt,
    overall,
    readyForInternetExposure:
      !exposed
        ? false
        : findings.every((item) => SEVERITY_RANK[item.severity] >= SEVERITY_RANK.medium),
    findings: [...findings].sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        left.controlId.localeCompare(right.controlId),
    ),
    prioritizedBacklog,
  };
}

/** Human-readable posture summary. */
export function describeBrainSecurityPosture(posture: BrainSecurityPosture): string {
  const lines = [
    `Security posture: ${posture.overall.toUpperCase()} (as of ${posture.observedAt})`,
    `Ready for internet exposure: ${posture.readyForInternetExposure ? "yes" : "NO"}`,
    "",
    "Findings (most severe first):",
    ...posture.findings.map(
      (item) =>
        `  [${item.severity}] ${item.controlId}: ${item.statement}` +
        (item.requiresUserApproval ? " (needs your approval)" : ""),
    ),
    "",
    `Backlog: ${posture.prioritizedBacklog.join(" → ")}`,
  ];
  return lines.join("\n");
}
