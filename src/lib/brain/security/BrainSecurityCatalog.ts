/**
 * Atölye Brain — security control catalog (data, not logic).
 *
 * The deterministic reference for what a safe, internet-facing Atölye server
 * needs. Each entry says what the control protects, how it must be enforced
 * (code-level, allowlist/denylist/sandbox/…), a concrete deterministic check,
 * where it sits in the roadmap (`PHASE 7 — Platform`), and its current status.
 *
 * Today Atölye is a personal, local studio (`ADR-014`/`ADR-015`) — most of
 * these are `not-implemented` / `not-applicable-yet`, and that is expected. The
 * catalog exists so the Brain's security audit has a fixed rubric to grade
 * against instead of improvising.
 */

import {
  brainSecuritySchemaVersion,
  type BrainSecurityControl,
  type BrainSecurityControlId,
} from "@/types/brainSecurity";

export const BRAIN_SECURITY_CATALOG_VERSION = brainSecuritySchemaVersion;

export const BRAIN_SECURITY_CATALOG: readonly BrainSecurityControl[] = Object.freeze([
  {
    id: "authentication",
    title: "Authentication",
    whatItProtects: "Only the director can reach the studio once it is on the internet.",
    enforcement: ["deterministic-validator", "minimum-privilege"],
    deterministicCheck:
      "Every non-public route passes through a single auth middleware; a request with no valid session is 401 before any handler runs.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["Local-only today; no login exists. Required before any remote exposure."],
  },
  {
    id: "authorization",
    title: "Authorization",
    whatItProtects: "An authenticated session can only do what its role allows.",
    enforcement: ["allowlist", "deterministic-validator", "minimum-privilege"],
    deterministicCheck:
      "Each mutating route declares a required capability; the check is table-driven, not ad-hoc per handler.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["Single-user model today — one role (director)."],
  },
  {
    id: "admin-access",
    title: "Admin access",
    whatItProtects: "Operator CLIs and durable-state actions are not reachable from the web session.",
    enforcement: ["sandbox", "minimum-privilege", "immutable-policy"],
    deterministicCheck:
      "`production:acceptance:*` and runtime-backup tooling are CLI-only; no API route invokes them.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "partial",
    notes: ["Already CLI-gated (`scripts/run-production-acceptance.ts`); no admin web surface exists."],
  },
  {
    id: "rate-limiting",
    title: "Rate limiting",
    whatItProtects: "A single client cannot flood the pipeline or the LLM providers.",
    enforcement: ["deterministic-validator", "denylist"],
    deterministicCheck:
      "A fixed-window / token-bucket limiter runs in middleware keyed by session+route; limits are constants, not model-decided.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["The $1 AI cost guard is a spend limiter, not a request-rate limiter."],
  },
  {
    id: "brute-force-protection",
    title: "Brute-force protection",
    whatItProtects: "Login and any secret-bearing endpoint against credential stuffing.",
    enforcement: ["denylist", "deterministic-validator"],
    deterministicCheck:
      "Failed-auth counter per IP+account with exponential backoff and lockout; counters persisted, not in memory only.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["Depends on authentication landing first."],
  },
  {
    id: "secret-management",
    title: "Secret management",
    whatItProtects: "API keys / tokens never reach logs, memory, git, or a report.",
    enforcement: ["denylist", "immutable-policy", "deterministic-validator"],
    deterministicCheck:
      "Secrets only in `.env*` (git-ignored); `BrainRedaction` scrubs every Brain-written string; a smoke test asserts no key pattern survives.",
    roadmapPhase: "PHASE 7 — Platform (partial now)",
    currentStatus: "partial",
    notes: [
      "`.env*` is git-ignored today.",
      "`BrainRedaction` + `BrainMemoryModel` enforce the no-secret rule for Brain output.",
    ],
  },
  {
    id: "audit-log",
    title: "Audit log",
    whatItProtects: "Every privileged action is attributable and tamper-evident.",
    enforcement: ["signed-audit-log", "immutable-policy"],
    deterministicCheck:
      "Append-only log with a per-entry integrity fingerprint (same pattern as `ProductionOperationJournal`); no in-place edits.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "partial",
    notes: [
      "`ProductionOperationJournal` is the existing pattern for durable ops.",
      "`BrainDecisionJournal` is the Brain-side analogue.",
    ],
  },
  {
    id: "session-cookie-safety",
    title: "Session / cookie safety",
    whatItProtects: "Session theft and fixation.",
    enforcement: ["deterministic-validator", "immutable-policy"],
    deterministicCheck:
      "Cookies are `HttpOnly`, `Secure`, `SameSite=Lax|Strict`; session id rotates on privilege change; short idle TTL.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: [],
  },
  {
    id: "csrf",
    title: "CSRF",
    whatItProtects: "State-changing requests must originate from the studio UI.",
    enforcement: ["deterministic-validator", "allowlist"],
    deterministicCheck:
      "Double-submit token or `Origin`/`Sec-Fetch-Site` allowlist checked in middleware for every non-GET.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: [],
  },
  {
    id: "xss",
    title: "XSS",
    whatItProtects: "Rendered research / script / SEO text cannot execute in the browser.",
    enforcement: ["deterministic-validator", "denylist"],
    deterministicCheck:
      "No `dangerouslySetInnerHTML` on model output; a strict CSP header; output encoded by default (React does this).",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "partial",
    notes: ["React auto-escaping already covers the common case; CSP header not set yet."],
  },
  {
    id: "injection",
    title: "Injection (SQL / command / template)",
    whatItProtects: "Model or user text cannot become a query or a shell command.",
    enforcement: ["allowlist", "sandbox", "deterministic-validator"],
    deterministicCheck:
      "No string-built shell commands; JSON storage today (no SQL); `checkBrainShellCommand` allowlist for any spawn.",
    roadmapPhase: "PHASE 7 — Platform (partial now)",
    currentStatus: "partial",
    notes: ["JSON-file storage removes SQL surface; FFmpeg calls are argv arrays, not shell strings."],
  },
  {
    id: "file-upload-safety",
    title: "File upload safety",
    whatItProtects: "Uploaded assets cannot be executable, oversized, or mistyped.",
    enforcement: ["allowlist", "deterministic-validator", "sandbox"],
    deterministicCheck:
      "MIME + magic-byte allowlist, size cap, random stored name, served with `Content-Disposition: attachment` and a non-exec content type.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "partial",
    notes: [
      "`VideoMediaIngestion` (ADR-020) already does host allowlist + size cap + ffprobe verification for real media.",
    ],
  },
  {
    id: "path-traversal",
    title: "Path traversal",
    whatItProtects: "Asset routes cannot read outside the project storage root.",
    enforcement: ["deterministic-validator", "sandbox"],
    deterministicCheck:
      "`isInsideDirectory` / `isSafeFileName` on every path segment; reparse/junction rejection; `isBrainPathContained` for Brain writes.",
    roadmapPhase: "In place",
    currentStatus: "enforced-in-code",
    notes: [
      "`src/lib/assets/storage/StoragePathSecurity.ts` + asset route guards already enforce this.",
      "`FileStorage` rejects symlink/junction escape.",
    ],
  },
  {
    id: "command-execution-isolation",
    title: "Command execution isolation",
    whatItProtects: "FFmpeg / Piper / graphify run with least privilege and bounded.",
    enforcement: ["sandbox", "allowlist", "minimum-privilege"],
    deterministicCheck:
      "argv arrays (never shell strings), fixed executable paths, timeout + process-tree kill, no inherited secret env beyond what the tool needs.",
    roadmapPhase: "PHASE 7 — Platform (partial now)",
    currentStatus: "partial",
    notes: [
      "FFmpeg invoked via argv with a resolved path.",
      "GPU watchdog + process-tree kill + cooldown is a Brain-owned requirement for any inference task.",
    ],
  },
  {
    id: "dependency-audit",
    title: "Dependency / security audit",
    whatItProtects: "Known-vulnerable packages are caught before deploy.",
    enforcement: ["deterministic-validator"],
    deterministicCheck:
      "`npm audit --production` (or `osv-scanner`) in CI; lockfile pinned; a Brain task summarises new advisories.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["`package-lock.json` is committed; no scheduled audit yet."],
  },
  {
    id: "backup-recovery",
    title: "Backup / recovery",
    whatItProtects: "Project data survives disk loss or a bad migration.",
    enforcement: ["immutable-policy", "deterministic-validator"],
    deterministicCheck:
      "`runtime:backup:*` inventory/create/verify/restore-verify run on a schedule; restore is tested, not assumed.",
    roadmapPhase: "In place (tooling) — schedule pending",
    currentStatus: "partial",
    notes: ["`scripts/runtime-backup.ts` exists; no scheduled/off-box copy yet."],
  },
  {
    id: "health-checks",
    title: "Health checks",
    whatItProtects: "The operator (and the worker) know when the studio is degraded.",
    enforcement: ["deterministic-validator"],
    deterministicCheck:
      "`/api/runtime/health` + `/api/production/health/[slug]` return structured status; the Brain worker polls them each cycle.",
    roadmapPhase: "In place",
    currentStatus: "enforced-in-code",
    notes: ["`ProductionHealthEngine` + runtime health route already exist."],
  },
  {
    id: "intrusion-anomaly-detection",
    title: "Intrusion / anomaly detection",
    whatItProtects: "Unusual access patterns are surfaced early.",
    enforcement: ["denylist", "deterministic-validator", "signed-audit-log"],
    deterministicCheck:
      "Deterministic rules over the audit log (new IP + admin action, burst of 401s, off-hours mutation); alerts, not auto-blocks, first.",
    roadmapPhase: "PHASE 7 — Platform",
    currentStatus: "not-implemented",
    notes: ["Depends on audit-log + auth."],
  },
]);

export function findBrainSecurityControl(
  id: BrainSecurityControlId,
): BrainSecurityControl | undefined {
  return BRAIN_SECURITY_CATALOG.find((control) => control.id === id);
}
