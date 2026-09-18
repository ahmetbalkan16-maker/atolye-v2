/**
 * AYAS RUNTIME STABILITY GUARD — the runtime-impact declaration for an
 * owner-approved publication.
 *
 * `AyasProposalImpact.ts` already models one axis of impact: cost,
 * dependency and licensing. This module models the OTHER axis the Runtime
 * Stability Guard needs and that one deliberately does not cover — what a
 * change can do to the RUNNING system: its services, its runtime config, its
 * storage/execution authority, its research scheduler.
 *
 * Derived exclusively from `exactFiles`, which is the one piece of
 * publication metadata already cryptographically bound into the artifact the
 * human approved (`proposalHash` / `batchHash` transitively cover
 * `exactFiles`, `patchArtifactId` and `patchHash` — see
 * `AyasApprovalInboxStore`). Free-text, owner-facing fields (`objective`,
 * `risk`, `productionImpact`, `rationale`) are NEVER read here: they are
 * prose written for a human, a generator can put anything in them, and a
 * regex over them is exactly the text-pattern heuristic
 * `AyasProposalImpact.ts` was created to replace.
 *
 * Fail-closed in three separate ways:
 *   1. The per-file rule table is ordered MOST RESTRICTIVE FIRST and the
 *      first match wins, so a file that is both "under src/" and "under
 *      src/lib/runtime/" is classified by the second, never the first.
 *   2. A path that matches no rule is `UNKNOWN`, the most restrictive class —
 *      an unrecognised path is never quietly treated as ordinary source.
 *   3. A combined classification is the MAXIMUM severity across every file,
 *      never an average and never the first file's class.
 */

import { declareAyasRuntimeImpactScope, type AyasRuntimeImpactDimension, type AyasRuntimeImpactScope } from "./AyasRuntimeStabilityScope";

export type AyasRuntimeImpactClass =
  | "TEST_ONLY"
  | "SOURCE_ONLY"
  | "RUNTIME_CONFIG"
  | "SCHEDULER"
  | "SERVICE_RUNTIME"
  | "AUTHORITY_OR_STORAGE"
  | "UNKNOWN";

/** Severity order. The index is the rank used to combine per-file classes; a higher rank always wins. */
export const AYAS_RUNTIME_IMPACT_CLASS_SEVERITY: readonly AyasRuntimeImpactClass[] = Object.freeze([
  "TEST_ONLY",
  "SOURCE_ONLY",
  "RUNTIME_CONFIG",
  "SCHEDULER",
  "SERVICE_RUNTIME",
  "AUTHORITY_OR_STORAGE",
  "UNKNOWN",
]);

/**
 * The only classes the one-click publication lanes may carry to a real
 * mutation. Everything heavier is refused rather than handled, because this
 * publication path structurally cannot do what a heavier class needs: it
 * never stops a process, never proves process ownership, never writes a
 * config file and never restarts a service. A change that requires those
 * belongs to a deliberate, separately-authorised operation supplying its own
 * `apply`/`rollback` to `runAyasControlledOperation` — not to a lane whose
 * whole contract is "apply a patch, test it, commit it, push it".
 */
export const AYAS_PUBLISHABLE_RUNTIME_IMPACT_CLASSES: readonly AyasRuntimeImpactClass[] = Object.freeze(["TEST_ONLY", "SOURCE_ONLY"]);

export interface AyasRuntimeImpactFileClassification {
  readonly file: string;
  readonly impactClass: AyasRuntimeImpactClass;
  readonly rule: string;
}

export interface AyasRuntimeImpactDecision {
  readonly impactClass: AyasRuntimeImpactClass;
  readonly files: readonly AyasRuntimeImpactFileClassification[];
  /** True only for a class in `AYAS_PUBLISHABLE_RUNTIME_IMPACT_CLASSES`. */
  readonly publishable: boolean;
  /** Why, in one sentence, for an owner-facing refusal message. Never echoes a full path list for a large change. */
  readonly summary: string;
  /**
   * Whether this class can restart or otherwise re-identify a service
   * process. False for every publishable class — which is what makes
   * "restart checks are NOT APPLICABLE" a derived property rather than an
   * assumption a caller could forget to state.
   */
  readonly serviceRestartApplicable: boolean;
  /** Plain-language record of the heavy checks this class rules out, persisted onto the guard transaction so their absence is visible rather than silent. */
  readonly notApplicable: readonly string[];
}

interface Rule {
  readonly impactClass: AyasRuntimeImpactClass;
  readonly name: string;
  readonly match: (normalized: string) => boolean;
}

const startsWithAny = (...prefixes: readonly string[]) => (p: string): boolean => prefixes.some((value) => p.startsWith(value));
const isOneOf = (...paths: readonly string[]) => (p: string): boolean => paths.includes(p);

/**
 * Ordered most restrictive first; first match wins per file. Every entry is
 * lower-cased, forward-slashed and repo-relative, matching `normalize()`.
 */
const RULES: readonly Rule[] = Object.freeze([
  {
    impactClass: "AUTHORITY_OR_STORAGE",
    name: "durable state / storage / execution authority",
    match: (p) =>
      // `data/` is the durable runtime state authority; the runtime + storage
      // libraries resolve and own it; `src/lib/production/` is the audited,
      // fail-closed production execution layer.
      startsWithAny("data/", "src/lib/runtime/", "src/lib/storage/", "src/lib/assets/storage/", "src/lib/production/")(p)
      // The AYAS authority surface itself: the gate, the durable approval
      // ledger, the execution locks/journal, the publication services and
      // every part of the Stability Guard. A patch that rewrites the thing
      // deciding whether patches may be applied is never a routine publish.
      || startsWithAny("src/lib/brain/autonomy/ayasruntimestability", "src/lib/brain/autonomy/ayasruntimeservicerestart")(p)
      || isOneOf(
        "src/lib/brain/autonomy/ayasautonomousexecutiongate.ts",
        "src/lib/brain/autonomy/ayasapprovalinboxstore.ts",
        "src/lib/brain/autonomy/ayasexecutionauthoritylock.ts",
        "src/lib/brain/autonomy/ayasexecutionjournal.ts",
        "src/lib/brain/autonomy/ayasexecutionrecoverypolicy.ts",
        "src/lib/brain/autonomy/ayasisolatedgateroot.ts",
        "src/lib/brain/autonomy/ayasautonomydaemon.ts",
        "src/lib/brain/autonomy/ayasproposalapprovalservice.ts",
        "src/lib/brain/autonomy/ayasproposalexecutionservice.ts",
        "src/lib/brain/autonomy/ayasmicrobatchapprovalservice.ts",
        "src/lib/brain/autonomy/ayasmicrobatchexecutionservice.ts",
        "src/lib/brain/autonomy/ayasguardedpublication.ts",
        "src/lib/brain/autonomy/ayasproposalruntimeimpact.ts",
      )(p),
  },
  {
    impactClass: "SCHEDULER",
    name: "research scheduler / autonomy loop",
    match: (p) =>
      startsWithAny("src/lib/brain/autonomy/ayasresearchscheduler", "scripts/ayas-research", "scripts/ayas-discovery-daemon", "scripts/ayas-owner-approval-resume")(p)
      || isOneOf("src/lib/brain/autonomy/ayasautonomousloop.ts", "src/lib/brain/autonomy/ayasautonomyobserver.ts", "src/lib/brain/autonomy/ayasobserversingletonlock.ts")(p),
  },
  {
    impactClass: "SERVICE_RUNTIME",
    name: "service process entry",
    // Loaded once when the Next.js process starts — a change here only takes
    // effect on a restart, which is precisely what this lane may not do.
    match: isOneOf("middleware.ts", "instrumentation.ts", "server.ts", "server.js", "src/middleware.ts", "src/instrumentation.ts"),
  },
  {
    impactClass: "RUNTIME_CONFIG",
    name: "environment / build configuration",
    match: (p) =>
      basename(p).startsWith(".env")
      || isOneOf("package.json", "package-lock.json", ".npmrc", "next-env.d.ts")(p)
      || (!p.includes("/") && (p.startsWith("next.config.") || p.startsWith("eslint.config.") || p.startsWith(".eslintrc") || p.startsWith("postcss.config.") || p.startsWith("tailwind.config.") || (p.startsWith("tsconfig") && p.endsWith(".json")))),
  },
  {
    impactClass: "TEST_ONLY",
    name: "smoke test script",
    // Exactly the predicate `AyasProposalApprovalService.commitMessageFor`
    // already uses to choose the `test(...)` commit subject, so the commit
    // type and the declared impact class can never disagree.
    match: (p) => p.startsWith("scripts/smoke-") && p.endsWith(".ts"),
  },
  {
    impactClass: "SOURCE_ONLY",
    name: "ordinary source / docs",
    match: (p) => startsWithAny("src/", "app/", "scripts/", "docs/")(p) || (!p.includes("/") && p.endsWith(".md")),
  },
]);

function basename(normalized: string): string {
  const cut = normalized.lastIndexOf("/");
  return cut < 0 ? normalized : normalized.slice(cut + 1);
}

/**
 * Repo-relative, forward-slashed, lower-cased. Returns undefined for
 * anything that is not a plain relative path inside the repository —
 * absolute paths, drive letters, `..` traversal, empty segments and NUL
 * bytes all fail here rather than being "cleaned up", because a path this
 * function cannot understand must become `UNKNOWN`, not a best guess.
 */
function normalize(file: string): string | undefined {
  if (typeof file !== "string" || file.trim().length === 0) return undefined;
  if (file.includes("\0")) return undefined;
  const slashed = file.replace(/\\/g, "/").trim();
  if (slashed.startsWith("/") || /^[a-zA-Z]:\//.test(slashed)) return undefined;
  const segments = slashed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
  return slashed.toLowerCase();
}

export function classifyAyasRuntimeImpactFile(file: string): AyasRuntimeImpactFileClassification {
  const normalized = normalize(file);
  if (normalized === undefined) return { file, impactClass: "UNKNOWN", rule: "path is not a plain repo-relative path" };
  for (const rule of RULES) {
    if (rule.match(normalized)) return { file, impactClass: rule.impactClass, rule: rule.name };
  }
  return { file, impactClass: "UNKNOWN", rule: "matches no known impact rule" };
}

function severity(impactClass: AyasRuntimeImpactClass): number {
  return AYAS_RUNTIME_IMPACT_CLASS_SEVERITY.indexOf(impactClass);
}

/**
 * The combined declaration for a whole publication. An empty file list is
 * `UNKNOWN`, not "harmless": a publication that claims to change nothing has
 * nothing for the scope diff to be checked against, which is the one case
 * where the guard could certify a mutation it never looked at.
 */
export function classifyAyasRuntimeImpact(exactFiles: readonly string[]): AyasRuntimeImpactDecision {
  const files = (exactFiles ?? []).map(classifyAyasRuntimeImpactFile);
  const impactClass: AyasRuntimeImpactClass = files.length === 0
    ? "UNKNOWN"
    : files.reduce<AyasRuntimeImpactClass>((worst, entry) => (severity(entry.impactClass) > severity(worst) ? entry.impactClass : worst), "TEST_ONLY");

  const publishable = AYAS_PUBLISHABLE_RUNTIME_IMPACT_CLASSES.includes(impactClass);
  const driver = files.find((entry) => entry.impactClass === impactClass);

  return Object.freeze({
    impactClass,
    files: Object.freeze(files),
    publishable,
    // Only a class this lane refuses could ever need a restart, so for every
    // class it accepts the answer is structurally "not applicable".
    serviceRestartApplicable: !publishable,
    summary: files.length === 0
      ? "the publication declares no files, so its runtime impact cannot be established"
      : `${impactClass} across ${files.length} file(s); most restrictive file matched "${driver?.rule ?? "no rule"}"`,
    notApplicable: Object.freeze(publishable
      ? [
        "service-restart: the declared impact class cannot affect a running service — no process is stopped, started or signalled by this operation",
        "runtime-config-reload: the declared impact class writes no environment or build-configuration file, so nothing needs reloading",
        "process-identity-fingerprint: not captured — an operation that may not restart a service is proven by port+pid continuity instead",
      ]
      : []),
  });
}

/** Dimensions an owner-approved publication is allowed to move. See `deriveAyasPublicationScope` for why each one is here. */
export const AYAS_PUBLICATION_ALLOWED_DIMENSIONS: readonly AyasRuntimeImpactDimension[] = Object.freeze([
  // The mutation writes the approved files.
  "source",
  // The publication's whole purpose is ONE commit.
  "git-history",
  // Deciding, executing and recording the result all move the approval ledger.
  "proposal-state",
  // The research scheduler is an INDEPENDENT concurrent actor: its cadence
  // legitimately advances on its own timer while a publication runs, so
  // treating any movement as a violation would roll back sound publications
  // at random. Movement is therefore allowed here and the scheduler is
  // protected by a health check instead (it must not lose its state or
  // record a new failure) — a real disturbance is still caught, an ordinary
  // tick is not.
  "research-scheduler",
]);

/**
 * `service`, `runtime-config` and `runtime-root` are deliberately ABSENT
 * from the allowed list, and `allowedPorts` is deliberately empty: this lane
 * may not restart anything, may not rewrite configuration and may not move
 * the storage authority, so any observed movement in those dimensions is a
 * violation — which is what turns ":3000 was never touched" from a claim
 * into a checked property.
 */
export function deriveAyasPublicationScope(operation: string, decision: AyasRuntimeImpactDecision): AyasRuntimeImpactScope {
  return declareAyasRuntimeImpactScope(operation, AYAS_PUBLICATION_ALLOWED_DIMENSIONS, [], {
    impactClass: decision.impactClass,
    notApplicable: decision.notApplicable,
  });
}
