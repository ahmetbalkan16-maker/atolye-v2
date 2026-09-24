/**
 * Stage 10 test strategy, test-safety classification, failure triage and
 * baseline-comparison decisions. Pure: source text and test indexes are
 * supplied by the caller; nothing here runs a test or touches a root.
 * Permanent rule: no mutating test run until its roots are known — UNKNOWN is
 * never auto-runnable, and a timeout is never a pass.
 */
import { collectAyasChangeAreas, isAyasHighRiskArea, type AyasChangeArea, type AyasDeveloperTask } from "./AyasDeveloperTaskModel";

export type AyasTestSafety = "SAFE_ISOLATED" | "SAFE_READ_ONLY" | "REQUIRES_TEMP_ROOT" | "REQUIRES_OWNER_APPROVAL" | "UNSAFE_KNOWN" | "UNKNOWN";
export type AyasRootExposure = "TEMP" | "NOT_TOUCHED" | "LIVE_POSSIBLE" | "UNKNOWN";

/** Hazards that must survive every new session and handoff until separately fixed. */
export const AYAS_KNOWN_UNSAFE_TESTS: readonly { readonly scriptPath: string; readonly hazard: string; readonly reason: string }[] = Object.freeze([
  {
    scriptPath: "scripts/smoke-ayas-observer-autostart.ts",
    hazard: "SCHEDULED_TASK",
    reason: "its fixture can unregister or replace the real owner Windows Scheduled Task; DO NOT RUN until the fixture is fixed",
  },
]);

export interface AyasTestSourceFacts {
  readonly scriptPath: string;
  readonly tempRootEvidence: boolean;
  readonly canonicalRuntime: boolean;
  readonly setsRuntimeRoot: boolean;
  readonly setsAuthorityRoot: boolean;
  readonly setsWorkspaceRoot: boolean;
  readonly explicitRootDir: boolean;
  readonly writesFiles: boolean;
  readonly importsStorage: boolean;
  readonly importsBrainState: boolean;
  readonly spawnsProcesses: boolean;
  readonly osIntegration: boolean;
  readonly externalNetwork: boolean;
  readonly paidProvider: boolean;
  readonly liveAgentDispatch: boolean;
  readonly declaresNoStorage: boolean;
  readonly pureImportsOnly: boolean;
}

const PURE_IMPORT = /\/src\/lib\/ayas\/(developer|routing|model|context|reasoning)\/|\/src\/lib\/ayas\/trace\/|^node:|^(assert|path|url|util|crypto|perf_hooks)$/;
const IMPORT_SPEC = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const ASSIGN = (name: string) => new RegExp(`(?:process\\.env\\.${name}|["']?${name}["']?\\s*:)\\s*=?(?!=)\\s*[A-Za-z_("'\`]`);

/** Static, conservative signal extraction; transitive effects are handled by the storage/brain import checks. */
export function extractAyasTestSourceFacts(scriptPath: string, source: string): AyasTestSourceFacts {
  const s = String(source ?? "");
  const header = s.slice(0, 600);
  const imports = [...s.matchAll(IMPORT_SPEC)].map((match) => match[1]!);
  const nonLocalUrl = /https?:\/\/(?!(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)[:/"'`])[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i.test(s);
  return {
    scriptPath: scriptPath.replace(/\\/g, "/"),
    tempRootEvidence: /mkdtemp(?:Sync)?\s*\(|os\.tmpdir\s*\(|\btmpdir\s*\(|withCanonicalSmokeRuntime/.test(s),
    canonicalRuntime: /withCanonicalSmokeRuntime\s*\(/.test(s),
    setsRuntimeRoot: ASSIGN("ATOLYE_RUNTIME_ROOT").test(s),
    setsAuthorityRoot: ASSIGN("ATOLYE_RUNTIME_AUTHORITY_ROOT").test(s),
    setsWorkspaceRoot: ASSIGN("ATOLYE_WORKSPACE_ROOT").test(s),
    explicitRootDir: /\brootDir\s*:/.test(s),
    writesFiles: /\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|renameSync|copyFileSync|unlinkSync|cpSync|writeFile|appendFile|mkdir|rename|unlink)\s*\(/.test(s),
    // Identifier signals require usage (`new X`, `X.`, `X(`); a mention in a label or comment is not a write path.
    importsStorage: imports.some((spec) => /\/(?:projects|storage|assets\/storage|runtime|pipeline|production)\//.test(spec))
      || /\bnew\s+(?:ProjectWriter|ProjectManager|AIUsageManager|AIManager)\b|\b(?:ProjectWriter|ProjectManager|AIUsageManager|AIManager)\s*[.(]/.test(s),
    // Any Brain module or AYAS store family can default to the live data/brain root.
    importsBrainState: imports.some((spec) => /\/brain\/|\/ayas\/(?:memory|intake|execution)\//.test(spec))
      || /\b(?:AyasMemoryStore|AyasGoalStore|AyasExternalResearchStore|AyasExecutionGateStore|AyasDeveloperWorkflowStore|AyasGuidedRepairSessionStore)\s*[.(]/.test(s),
    spawnsProcesses: /child_process|\bexecFile(?:Sync)?\s*\(|\bexecSync\s*\(|\bspawn(?:Sync)?\s*\(|\bfork\s*\(/.test(s),
    // Cmdlet/command forms only, so an identifier such as `scheduledTaskFixture` is not an OS action.
    osIntegration: /\b(?:Get|Register|Unregister|New|Set|Enable|Disable|Start|Stop|Export)-ScheduledTask\w*|\bschtasks\b|\bNew-Service\b|\bsc\.exe\b|\breg(?:\.exe)?\s+add\b|HKCU:|HKLM:|shell:startup/i.test(s),
    externalNetwork: nonLocalUrl && /\bfetch\s*\(|https?\.(?:request|get)\s*\(|new\s+WebSocket\s*\(|\baxios\b/.test(s),
    paidProvider: /\b(?:OPENAI|ANTHROPIC|GEMINI|ELEVENLABS|REPLICATE)_API_KEY\b|\b(?:AI|IMAGE|AUDIO|VIDEO)_PROVIDER\s*=\s*["'](?:openai|anthropic|elevenlabs)/i.test(s),
    liveAgentDispatch: /\bcodex\s+exec\b|\bclaude\s+-p\b|["'](?:codex|claude)["']\s*,\s*\[/.test(s),
    declaresNoStorage: /\bno\b[^.\n]{0,40}\bstorage\b/i.test(header),
    pureImportsOnly: imports.every((spec) => PURE_IMPORT.test(spec)),
  };
}

export interface AyasTestSafetyVerdict {
  readonly scriptPath: string;
  readonly safety: AyasTestSafety;
  readonly roots: Readonly<Record<"runtime" | "authority" | "legacy" | "brain", AyasRootExposure>>;
  readonly autoRunAllowed: boolean;
  readonly reasonCodes: readonly string[];
}

export function classifyAyasTestSafety(facts: AyasTestSourceFacts): AyasTestSafetyVerdict {
  const reasons: string[] = [];
  const known = AYAS_KNOWN_UNSAFE_TESTS.find((item) => item.scriptPath === facts.scriptPath);
  const temp = facts.tempRootEvidence;
  const envRoot = (set: boolean, touched: boolean): AyasRootExposure => set ? (temp ? "TEMP" : "UNKNOWN") : touched ? "LIVE_POSSIBLE" : "NOT_TOUCHED";
  const roots = {
    runtime: envRoot(facts.setsRuntimeRoot || facts.canonicalRuntime, facts.importsStorage),
    authority: envRoot(facts.setsAuthorityRoot || facts.canonicalRuntime, facts.importsStorage),
    // The canonical helper deliberately leaves the legacy projects root at the repository.
    legacy: envRoot(facts.setsWorkspaceRoot, facts.importsStorage || facts.canonicalRuntime),
    brain: facts.importsBrainState ? (facts.explicitRootDir && temp ? "TEMP" : "LIVE_POSSIBLE") : "NOT_TOUCHED",
  } as const;
  const verdict = (safety: AyasTestSafety): AyasTestSafetyVerdict => Object.freeze({
    scriptPath: facts.scriptPath, safety, roots, autoRunAllowed: safety === "SAFE_ISOLATED" || safety === "SAFE_READ_ONLY", reasonCodes: Object.freeze(reasons),
  });
  if (known) { reasons.push(`KNOWN_HAZARD_${known.hazard}`); return verdict("UNSAFE_KNOWN"); }
  if (facts.osIntegration) reasons.push("OS_INTEGRATION");
  if (facts.paidProvider) reasons.push("PAID_PROVIDER");
  if (facts.liveAgentDispatch) reasons.push("LIVE_AGENT_DISPATCH");
  if (facts.externalNetwork) reasons.push("EXTERNAL_NETWORK");
  if (reasons.length) return verdict("REQUIRES_OWNER_APPROVAL");
  const exposures = Object.entries(roots);
  const live = exposures.filter(([, exposure]) => exposure === "LIVE_POSSIBLE").map(([root]) => root);
  if (live.length) { reasons.push(...live.map((root) => `${root.toUpperCase()}_ROOT_LIVE_POSSIBLE`)); return verdict("REQUIRES_TEMP_ROOT"); }
  if (exposures.some(([, exposure]) => exposure === "UNKNOWN")) { reasons.push("ROOT_ASSIGNED_WITHOUT_TEMP_EVIDENCE"); return verdict("UNKNOWN"); }
  if (exposures.some(([, exposure]) => exposure === "TEMP")) { reasons.push("ALL_TOUCHED_ROOTS_TEMP"); return verdict("SAFE_ISOLATED"); }
  if (!facts.writesFiles && !facts.spawnsProcesses && (facts.declaresNoStorage || facts.pureImportsOnly)) { reasons.push(facts.pureImportsOnly ? "PURE_IMPORTS_NO_WRITES" : "DECLARED_NO_STORAGE_NO_WRITES"); return verdict("SAFE_READ_ONLY"); }
  if ((facts.writesFiles || facts.spawnsProcesses) && temp) { reasons.push("WRITES_WITH_TEMP_EVIDENCE"); return verdict("SAFE_ISOLATED"); }
  reasons.push("ISOLATION_NOT_ESTABLISHED");
  return verdict("UNKNOWN");
}

export interface AyasTestIndexEntry {
  readonly scriptPath: string;
  /** Repo-relative module paths (no extension) that the script imports. */
  readonly importedModules: readonly string[];
  readonly safety: AyasTestSafetyVerdict;
}
export type AyasTestSelectionReason = "CHANGED_TEST" | "DIRECT" | "DEPENDENT" | "AREA_REGRESSION";
export interface AyasTestSelection { readonly scriptPath: string; readonly reason: AyasTestSelectionReason; readonly safety: AyasTestSafety; readonly autoRun: boolean; }
export interface AyasTestStrategy {
  readonly selected: readonly AyasTestSelection[];
  readonly runnable: readonly string[];
  readonly excludedUnsafe: readonly { readonly scriptPath: string; readonly reason: string }[];
  readonly requiresOwnerApproval: readonly string[];
  readonly requiresTempRoot: readonly string[];
  readonly unknownIsolation: readonly string[];
  readonly missingAreaSuites: readonly string[];
  readonly staticChecks: readonly string[];
  readonly dependentCapApplied: boolean;
}

/** Area suites that a change in that boundary must never skip. Only suites present in the index are selected. */
export const AYAS_AREA_REGRESSION_SUITES: Readonly<Partial<Record<AyasChangeArea, readonly string[]>>> = Object.freeze({
  authority: ["scripts/smoke-ayas-execution-gate.ts", "scripts/smoke-ayas-autonomous-execution-gate.ts", "scripts/smoke-ayas-proposal-approval-service.ts", "scripts/smoke-ayas-isolated-gate-root.ts"],
  "execution-gate": ["scripts/smoke-ayas-execution-gate.ts", "scripts/smoke-ayas-isolated-gate-root.ts", "scripts/smoke-ayas-patch-artifact-execution-integration.ts"],
  security: ["scripts/smoke-ayas-bounded-file-write.ts", "scripts/smoke-ayas-bounded-request-body.ts", "scripts/smoke-ayas-safe-public-fetch.ts"],
  router: ["scripts/smoke-ayas-agentic-routing.ts", "scripts/smoke-ayas-intent-routing.ts"],
  trace: ["scripts/smoke-ayas-unified-trace.ts"],
  memory: ["scripts/smoke-ayas-memory.ts", "scripts/smoke-ayas-memory-temporal.ts"],
  conversational: ["scripts/smoke-ayas-chat-stream.ts", "scripts/smoke-ayas-context.ts"],
  developer: ["scripts/smoke-ayas-developer-intelligence.ts", "scripts/smoke-ayas-developer-actions.ts"],
});
const LOW_RISK_DEPENDENT_CAP = 12;
const moduleOf = (file: string) => file.replace(/\\/g, "/").replace(/\.(ts|tsx|js|mjs|cjs)$/, "");

export function planAyasTestStrategy(input: { readonly task: AyasDeveloperTask; readonly changedFiles: readonly string[]; readonly graphAffectedFiles: readonly string[]; readonly index: readonly AyasTestIndexEntry[] }): AyasTestStrategy {
  const areas = collectAyasChangeAreas(input.changedFiles);
  const highRisk = areas.some(isAyasHighRiskArea);
  const byScript = new Map(input.index.map((entry) => [entry.scriptPath, entry]));
  const chosen = new Map<string, AyasTestSelectionReason>();
  const choose = (script: string, reason: AyasTestSelectionReason) => { if (!chosen.has(script)) chosen.set(script, reason); };
  for (const file of input.changedFiles) if (/^scripts\/smoke-[^/]+\.ts$/.test(file.replace(/\\/g, "/")) && byScript.has(file)) choose(file, "CHANGED_TEST");
  const changedModules = new Set(input.changedFiles.map(moduleOf));
  for (const entry of input.index) if (entry.importedModules.some((m) => changedModules.has(m))) choose(entry.scriptPath, "DIRECT");
  const missingAreaSuites: string[] = [];
  for (const area of areas) for (const suite of AYAS_AREA_REGRESSION_SUITES[area] ?? []) {
    if (byScript.has(suite)) choose(suite, "AREA_REGRESSION"); else missingAreaSuites.push(suite);
  }
  const affectedModules = new Set(input.graphAffectedFiles.map(moduleOf).filter((m) => !changedModules.has(m)));
  const dependents = input.index.filter((entry) => !chosen.has(entry.scriptPath) && entry.importedModules.some((m) => affectedModules.has(m)));
  const dependentCapApplied = !highRisk && dependents.length > LOW_RISK_DEPENDENT_CAP;
  for (const entry of highRisk ? dependents : dependents.slice(0, LOW_RISK_DEPENDENT_CAP)) choose(entry.scriptPath, "DEPENDENT");

  const selected: AyasTestSelection[] = []; const excludedUnsafe: { scriptPath: string; reason: string }[] = [];
  const requiresOwnerApproval: string[] = []; const requiresTempRoot: string[] = []; const unknownIsolation: string[] = [];
  for (const [scriptPath, reason] of chosen) {
    const safety = byScript.get(scriptPath)!.safety;
    selected.push({ scriptPath, reason, safety: safety.safety, autoRun: safety.autoRunAllowed });
    if (safety.safety === "UNSAFE_KNOWN") excludedUnsafe.push({ scriptPath, reason: AYAS_KNOWN_UNSAFE_TESTS.find((item) => item.scriptPath === scriptPath)?.reason ?? "known hazard" });
    else if (safety.safety === "REQUIRES_OWNER_APPROVAL") requiresOwnerApproval.push(scriptPath);
    else if (safety.safety === "REQUIRES_TEMP_ROOT") requiresTempRoot.push(scriptPath);
    else if (safety.safety === "UNKNOWN") unknownIsolation.push(scriptPath);
  }
  const codeFiles = input.changedFiles.filter((file) => /\.(ts|tsx|js|mjs|cjs)$/.test(file));
  const staticChecks = codeFiles.length
    ? ["npx tsc --noEmit --incremental false", `npx eslint --max-warnings 0 ${codeFiles.join(" ")}`, "git diff --check"]
    : ["git diff --check"];
  return Object.freeze({
    selected, runnable: selected.filter((item) => item.autoRun).map((item) => item.scriptPath), excludedUnsafe, requiresOwnerApproval,
    requiresTempRoot, unknownIsolation, missingAreaSuites: [...new Set(missingAreaSuites)], staticChecks, dependentCapApplied,
  });
}

export type AyasFailureClass = "NOT_A_FAILURE" | "PRODUCT_REGRESSION" | "TEST_DEFECT" | "FIXTURE_DEFECT" | "ENVIRONMENTAL_FAILURE" | "PERMISSION_FAILURE" | "PRE_EXISTING" | "TIMEOUT" | "UNKNOWN";
export interface AyasFailureObservation {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Bounded stderr/stdout excerpt. */
  readonly output: string;
  readonly errorKind?: "assertion" | "exception" | null;
  readonly failureFrameInTest?: boolean;
  readonly baseline?: "PASS" | "FAIL_SAME" | "FAIL_DIFFERENT" | "NOT_RUN";
  readonly changedFiles: readonly string[];
}
export interface AyasFailureTriage { readonly failureClass: AyasFailureClass; readonly preExisting: boolean; readonly countsAsPass: boolean; readonly reasonCode: string; }

const PERMISSION_SIGNAL = /EPERM|EACCES|access is denied|eri[sş]im engellendi|permission denied|operation not permitted|\.git[\\/]worktrees|rejected by (?:the )?(?:automatic )?(?:approval|permission)|classifier (?:rejected|denied)|requires (?:owner )?approval|not allowed by (?:the )?sandbox/i;
const ENVIRONMENT_SIGNAL = /spawn \S+ ENOENT|\b(?:ffmpeg|ffprobe)\b[^\n]*(?:not found|ENOENT|not recognized)|is not recognized as an internal or external command|command not found|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENOSPC|EMFILE|out of memory/i;
/** Known, documented pre-existing environment signals (see the checkpoint's deferred list). */
export const AYAS_KNOWN_PRE_EXISTING_SIGNALS: readonly { readonly id: string; readonly pattern: RegExp }[] = Object.freeze([
  // Real Graphify text: "<file>.ps1: tree-sitter-powershell not available".
  { id: "GRAPHIFY_POWERSHELL_PARSER_WARNING", pattern: /\.ps1[^\n]{0,20}tree-sitter-powershell not available|(?:no|missing|unsupported)[^\n]{0,40}parser[^\n]{0,80}\.ps1/i },
  { id: "GRAPHIFY_SEMANTIC_PENDING_MARKER", pattern: /describe_pending|pending semantic updates/i },
]);

export function triageAyasFailure(observation: AyasFailureObservation): AyasFailureTriage {
  const out = String(observation.output ?? "").slice(0, 8_000);
  const result = (failureClass: AyasFailureClass, reasonCode: string, preExisting = false): AyasFailureTriage =>
    Object.freeze({ failureClass, preExisting, countsAsPass: failureClass === "NOT_A_FAILURE", reasonCode });
  if (observation.timedOut) return result("TIMEOUT", "TIMEOUT_IS_NOT_PASS");
  if (observation.exitCode === 0) return result("NOT_A_FAILURE", "EXIT_ZERO");
  if (PERMISSION_SIGNAL.test(out)) return result("PERMISSION_FAILURE", "PERMISSION_OR_APPROVAL_DENIED_NOT_PRODUCT");
  if (ENVIRONMENT_SIGNAL.test(out)) return result("ENVIRONMENTAL_FAILURE", "MISSING_TOOL_OR_RESOURCE");
  const known = AYAS_KNOWN_PRE_EXISTING_SIGNALS.find((signal) => signal.pattern.test(out));
  if (known) return result("PRE_EXISTING", known.id, true);
  const fixtureFrame = observation.failureFrameInTest === true && observation.errorKind === "exception";
  if (observation.baseline === "FAIL_SAME") return fixtureFrame ? result("FIXTURE_DEFECT", "FIXTURE_FAILS_ON_BASELINE", true) : result("PRE_EXISTING", "SAME_FAILURE_ON_BASELINE", true);
  if (observation.baseline === "PASS") {
    const onlyTestFiles = observation.changedFiles.length > 0 && observation.changedFiles.every((file) => /^scripts\/(smoke-[^/]+\.ts|lib\/)/.test(file.replace(/\\/g, "/")));
    if (onlyTestFiles) return fixtureFrame ? result("FIXTURE_DEFECT", "CHANGED_FIXTURE_FAILS") : result("TEST_DEFECT", "CHANGED_TEST_FAILS_PRODUCT_UNCHANGED");
    return result("PRODUCT_REGRESSION", "BASELINE_PASSES_CURRENT_FAILS");
  }
  if (observation.baseline === "FAIL_DIFFERENT") return result("UNKNOWN", "BASELINE_FAILS_DIFFERENTLY");
  return result("UNKNOWN", "BASELINE_COMPARISON_REQUIRED");
}

export type AyasBaselinePurpose = "failing-regression" | "pre-existing-claim" | "improvement-claim" | "scope-drift-question" | "all-pass" | "docs-only";
export interface AyasBaselineDecision { readonly required: boolean; readonly method: "TEMP_GIT_ARCHIVE" | "GIT_DIFF_AGAINST_BASELINE" | "NONE"; readonly reasonCode: string; }

/** Baseline comparison always uses a TEMP `git archive <trusted-head>` copy (or a read-only diff); never a reset of the main worktree. */
export function decideAyasBaselineComparison(input: { readonly purpose: AyasBaselinePurpose; readonly triage?: AyasFailureClass; readonly baselineAlreadyRecorded?: boolean }): AyasBaselineDecision {
  const decision = (required: boolean, method: AyasBaselineDecision["method"], reasonCode: string) => Object.freeze({ required, method, reasonCode });
  if (input.purpose === "scope-drift-question") return decision(true, "GIT_DIFF_AGAINST_BASELINE", "COMPARE_FILE_TO_TRUSTED_BASELINE");
  if (input.purpose === "all-pass" || input.purpose === "docs-only") return decision(false, "NONE", "NOTHING_TO_ATTRIBUTE");
  if (input.baselineAlreadyRecorded) return decision(false, "NONE", "BASELINE_ALREADY_RECORDED_FOR_SAME_EVALUATOR");
  if (input.purpose === "failing-regression" && (input.triage === "PERMISSION_FAILURE" || input.triage === "ENVIRONMENTAL_FAILURE" || input.triage === "TIMEOUT")) {
    return decision(false, "NONE", "RESOLVE_ENVIRONMENT_THEN_RERUN");
  }
  return decision(true, "TEMP_GIT_ARCHIVE", input.purpose === "improvement-claim" ? "IMPROVEMENT_NEEDS_TRUE_BASELINE" : "ATTRIBUTE_FAILURE_AGAINST_BASELINE");
}
