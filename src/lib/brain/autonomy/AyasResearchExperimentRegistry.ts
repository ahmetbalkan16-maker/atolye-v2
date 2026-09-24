import crypto from "node:crypto";

import type { AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";

/**
 * Stage 8 — the CLOSED, server-owned registry behind research-driven
 * improvement experiments. Research findings are data: none of them can name
 * a benchmark, an experiment strategy, a file, a command or a mutation kind.
 * Every one of those comes from this module, which only a reviewed commit can
 * change — the same posture as `AyasMutationRegistry`.
 *
 * The production strategy list is intentionally EMPTY. A strategy is a
 * pre-reviewed, bounded code change generator; writing one per research
 * finding would be the controlled self-evolution of a later roadmap stage.
 * Until a strategy is registered, a finding that maps to a measured local gap
 * stops at `NEEDS_EXPERIMENT_DESIGN` evidence and never runs an experiment.
 */
export interface AyasImprovementBenchmark {
  readonly benchmarkId: string;
  /** Repo-relative evaluator script; must emit the standard advisory report shape. */
  readonly script: string;
  readonly args: readonly string[];
  readonly reportFlag: string;
  readonly timeoutMs: number;
  readonly dimensions: readonly string[];
}

export interface AyasImprovementStrategyContext {
  /** Reads a repo-relative file from the sandbox copy; `null` when absent. */
  readonly readFile: (relativePath: string) => string | null;
}

export interface AyasImprovementStrategyChange {
  readonly filePath: string;
  readonly content: string;
}

export interface AyasImprovementStrategy {
  readonly strategyId: string;
  readonly version: number;
  readonly capability: string;
  readonly benchmarkId: string;
  readonly dimensions: readonly string[];
  readonly component: string;
  /** Server-owned description of the bounded change; never external text. */
  readonly summary: string;
  readonly exactFiles: readonly string[];
  readonly maxChangedLines: number;
  readonly regressionSuites: readonly string[];
  generate(context: AyasImprovementStrategyContext): readonly AyasImprovementStrategyChange[];
}

export interface AyasResearchCapabilityTarget {
  readonly capability: string;
  readonly component: string;
  readonly benchmarks: readonly { readonly benchmarkId: string; readonly dimensions: readonly string[] }[];
}

export interface AyasImprovementRegistry {
  readonly benchmarks: readonly AyasImprovementBenchmark[];
  readonly strategies: readonly AyasImprovementStrategy[];
  readonly capabilityMap: Readonly<Record<AyasCapabilityCategory, AyasResearchCapabilityTarget | null>>;
}

const COGNITIVE_DIMENSIONS = [
  "INTENT_ACCURACY", "CONTEXT_CONTINUITY", "REFERENCE_RESOLUTION", "MEMORY_RELEVANCE", "TEMPORAL_CORRECTNESS",
  "RETRIEVAL_USEFULNESS", "STALE_CONTEXT_LEAKAGE", "CLARIFICATION_QUALITY", "REASONING_CONSISTENCY", "ANSWER_RELEVANCE",
  "ANSWER_COMPLETENESS", "INSTRUCTION_FOLLOWING", "TURKISH_NATURALNESS", "CONTRADICTION_AVOIDANCE", "UNCERTAINTY_CALIBRATION",
  "TOOL_DECISION_CORRECTNESS", "VERBOSITY_CALIBRATION",
] as const;

/** Stage 6's deterministic evaluator is reused as-is; no new benchmark is invented for a gap it already measures. */
export const AYAS_IMPROVEMENT_BENCHMARKS: readonly AyasImprovementBenchmark[] = Object.freeze([
  { benchmarkId: "cognitive-quality", script: "scripts/smoke-ayas-cognitive-quality.ts", args: ["--baseline"], reportFlag: "--report", timeoutMs: 120_000, dimensions: COGNITIVE_DIMENSIONS },
]);

export const AYAS_IMPROVEMENT_STRATEGIES: readonly AyasImprovementStrategy[] = Object.freeze([]);

const cognitive = (dimensions: readonly (typeof COGNITIVE_DIMENSIONS)[number][]) => [{ benchmarkId: "cognitive-quality", dimensions }];
const unmeasured = (capability: string, component: string): AyasResearchCapabilityTarget => ({ capability, component, benchmarks: [] });

/**
 * Category → the AYAS/Atölye capability it could affect. `null` means no local
 * capability exists at all (irrelevant). An empty benchmark list means the
 * capability is real but has no deterministic local evaluator yet, so no
 * experiment can be justified by a measured gap.
 */
export const AYAS_RESEARCH_CAPABILITY_MAP: Readonly<Record<AyasCapabilityCategory, AyasResearchCapabilityTarget | null>> = Object.freeze({
  MEMORY_CONTEXT: { capability: "conversation-memory-context", component: "AyasContextAssembly/AyasMemoryRetrieval/AyasMemoryTemporal", benchmarks: cognitive(["CONTEXT_CONTINUITY", "REFERENCE_RESOLUTION", "MEMORY_RELEVANCE", "TEMPORAL_CORRECTNESS", "RETRIEVAL_USEFULNESS", "STALE_CONTEXT_LEAKAGE"]) },
  AI_ASSISTANTS: { capability: "assistant-answer-quality", component: "AyasChatStream/AyasIntentRouting/AyasReasoningCore", benchmarks: cognitive(["INTENT_ACCURACY", "CLARIFICATION_QUALITY", "REASONING_CONSISTENCY", "ANSWER_RELEVANCE", "ANSWER_COMPLETENESS", "INSTRUCTION_FOLLOWING", "TURKISH_NATURALNESS", "CONTRADICTION_AVOIDANCE", "UNCERTAINTY_CALIBRATION", "VERBOSITY_CALIBRATION"]) },
  TOOL_USE: { capability: "tool-and-agent-selection", component: "AyasChatStream/AyasAgenticRouting", benchmarks: cognitive(["TOOL_DECISION_CORRECTNESS"]) },
  AGENT_ORCHESTRATION: { capability: "tool-and-agent-selection", component: "AyasChatStream/AyasAgenticRouting", benchmarks: cognitive(["TOOL_DECISION_CORRECTNESS"]) },
  CODING_AGENTS: { capability: "tool-and-agent-selection", component: "AyasChatStream/AyasAgenticRouting", benchmarks: cognitive(["TOOL_DECISION_CORRECTNESS"]) },
  RESEARCH_AGENTS: unmeasured("external-research", "AyasResearchScheduler/AyasDeepResearchEngine"),
  MULTIMODAL_AI: unmeasured("multimodal-generation", "src/lib/ai"),
  VOICE_AI: unmeasured("voice-interaction", "AyasSpeechToText/voice"),
  VOICE_CONTROL: unmeasured("voice-interaction", "AyasSpeechToText/voice"),
  TRANSCRIPTION: unmeasured("voice-interaction", "AyasSpeechToText"),
  AUDIO_AI: unmeasured("atolye-audio", "src/lib/audio"),
  TTS: unmeasured("atolye-audio", "src/lib/audio"),
  AUDIO_CLEANUP: unmeasured("atolye-audio", "src/lib/audio"),
  VIDEO_AI: unmeasured("atolye-video", "src/lib/video"),
  VIDEO_EDITING: unmeasured("atolye-video", "src/lib/assembly"),
  SCENE_ASSEMBLY: unmeasured("atolye-video", "src/lib/assembly"),
  MOTION: unmeasured("atolye-video", "src/lib/animation"),
  TRANSITIONS: unmeasured("atolye-video", "src/lib/assembly"),
  BROLL: unmeasured("atolye-media", "none"),
  MEDIA_DISCOVERY: unmeasured("atolye-media", "none"),
  IMAGE_AI: unmeasured("atolye-visuals", "src/lib/visuals"),
  THUMBNAILS: unmeasured("atolye-visuals", "src/lib/thumbnail"),
  SUBTITLES: unmeasured("atolye-export", "src/lib/export"),
  EXPORT: unmeasured("atolye-export", "src/lib/export"),
  QUALITY_ASSURANCE: unmeasured("production-quality", "src/lib/production"),
  WORKFLOW_RESILIENCE: unmeasured("pipeline-resilience", "src/lib/pipeline"),
  AUTOMATION_WORKFLOW: unmeasured("pipeline-resilience", "src/lib/pipeline"),
  DIAGNOSTICS: unmeasured("diagnostics", "src/lib/brain/probe"),
  SECURITY_RELIABILITY: unmeasured("security-reliability", "src/lib/brain/selfheal"),
  PERFORMANCE: unmeasured("runtime-performance", "none"),
  OPEN_SOURCE_AI: unmeasured("model-providers", "src/lib/ai/providers"),
  UI_UX: unmeasured("studio-ui", "src/components"),
  DEVELOPER_PLATFORMS: null,
});

export const AYAS_DEFAULT_IMPROVEMENT_REGISTRY: AyasImprovementRegistry = Object.freeze({
  benchmarks: AYAS_IMPROVEMENT_BENCHMARKS,
  strategies: AYAS_IMPROVEMENT_STRATEGIES,
  capabilityMap: AYAS_RESEARCH_CAPABILITY_MAP,
});

/** Global ceilings; a strategy may declare less, never more. */
export const AYAS_EXPERIMENT_MAX_CHANGED_LINES = 400;
export const AYAS_EXPERIMENT_MAX_FILES = 3;

/**
 * Paths an experimental change may never touch, whatever a strategy declares:
 * evaluators, tests and fixtures (benchmark gaming), dependency/config files
 * (hidden installs, config widening), live data, and every approval, gate,
 * mutation, publication or experiment-loop module (authority or self-change).
 */
const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /^scripts\//,
  /^(package|package-lock)\.json$/,
  /^(tsconfig[^/]*|next\.config\.[^/]+|eslint\.config\.[^/]+|\.npmrc|\.gitignore)$/,
  /(^|\/)(\.env[^/]*|\.git|\.graphify|\.claude|node_modules|data|secrets)(\/|$)/,
  /^src\/lib\/brain\/autonomy\/Ayas(Approval|Autonomous|Autonomy|BatchGraphify|Bounded|Deferred|Execution|Guarded|IsolatedGate|MicroBatch|Mutation|Owner|PatchArtifact|PatchSandbox|PostPublication|Proposal|ResearchExperiment|ResearchImprovement|ResearchProposalBridge|VerifiedGate)/,
  /^src\/lib\/ayas\/execution\//,
  /^src\/lib\/brain\/selfheal\/BrainPatchSafety/,
  /^src\/lib\/production\//,
];

export function isAyasExperimentProtectedPath(filePath: string): boolean {
  const normalized = String(filePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

const SAFE_RELATIVE_SOURCE = /^src\/[A-Za-z0-9_./-]+\.(ts|tsx)$/;

/** Structural validation of a strategy's declared scope, independent of what it generates. */
export function validateAyasImprovementStrategy(strategy: AyasImprovementStrategy): readonly string[] {
  const violations: string[] = [];
  if (!/^exp-[a-z0-9-]{3,80}$/.test(strategy.strategyId)) violations.push("STRATEGY_ID_INVALID");
  if (!Number.isSafeInteger(strategy.version) || strategy.version < 1) violations.push("STRATEGY_VERSION_INVALID");
  if (strategy.exactFiles.length === 0 || strategy.exactFiles.length > AYAS_EXPERIMENT_MAX_FILES) violations.push("STRATEGY_FILE_COUNT_INVALID");
  for (const file of strategy.exactFiles) {
    if (!SAFE_RELATIVE_SOURCE.test(file) || file.includes("..")) violations.push("STRATEGY_FILE_OUTSIDE_SOURCE");
    else if (isAyasExperimentProtectedPath(file)) violations.push("STRATEGY_FILE_PROTECTED");
  }
  if (!Number.isSafeInteger(strategy.maxChangedLines) || strategy.maxChangedLines < 1 || strategy.maxChangedLines > AYAS_EXPERIMENT_MAX_CHANGED_LINES) violations.push("STRATEGY_LINE_BUDGET_INVALID");
  for (const suite of strategy.regressionSuites) if (!/^scripts\/smoke-[a-z0-9-]+\.ts$/.test(suite)) violations.push("STRATEGY_REGRESSION_SUITE_INVALID");
  return [...new Set(violations)];
}

export function findAyasImprovementBenchmark(registry: AyasImprovementRegistry, benchmarkId: string): AyasImprovementBenchmark | undefined {
  return registry.benchmarks.find((benchmark) => benchmark.benchmarkId === benchmarkId);
}

/** Deterministic selection: the lowest strategy id that targets this capability, benchmark and dimension and passes validation. */
export function selectAyasImprovementStrategy(registry: AyasImprovementRegistry, capability: string, benchmarkId: string, dimension: string): AyasImprovementStrategy | undefined {
  return [...registry.strategies]
    .filter((strategy) => strategy.capability === capability && strategy.benchmarkId === benchmarkId && strategy.dimensions.includes(dimension))
    .filter((strategy) => validateAyasImprovementStrategy(strategy).length === 0)
    .sort((a, b) => a.strategyId.localeCompare(b.strategyId) || a.version - b.version)[0];
}

/** Changes whenever a benchmark or strategy identity changes, so parked findings are re-evaluated only then. */
export function ayasImprovementRegistryDigest(registry: AyasImprovementRegistry): string {
  const material = {
    benchmarks: registry.benchmarks.map((b) => [b.benchmarkId, b.script, b.args, b.reportFlag]),
    strategies: registry.strategies.map((s) => [s.strategyId, s.version, s.capability, s.benchmarkId, s.dimensions, s.exactFiles, s.maxChangedLines, s.regressionSuites, s.component, s.summary]),
    capabilityMap: Object.entries(registry.capabilityMap).sort(([a], [b]) => a.localeCompare(b)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
