import crypto from "node:crypto";

import type { AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";
import { validAyasReviewedExactPatch, type AyasReviewedExactPatch } from "../selfheal/AyasExactPatchSafety";

/**
 * Stage 8 — the CLOSED, server-owned registry behind research-driven
 * improvement experiments. Research findings are data: none of them can name
 * a benchmark, an experiment strategy, a file, a command or a mutation kind.
 * Every one of those comes from this module, which only a reviewed commit can
 * change — the same posture as `AyasMutationRegistry`.
 *
 * The production strategy list contains only owner-reviewed, bounded code
 * change generators. A research finding cannot register one. If no registered
 * strategy matches a measured local gap, the finding stops at
 * `NEEDS_EXPERIMENT_DESIGN` and cannot run an experiment.
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
  /** Optional, owner-reviewed exact replacement; never changes the path classifier itself. */
  readonly reviewedExactPatch?: AyasReviewedExactPatch;
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

const RENDER_TOOL_SOURCE = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
const RENDER_TOOL_SOURCE_SHA256 = "eba4907c9f69df03188f708abe5ffe20c68a214c3d47eaac0c7bb6e3c23fdfec";

/** Fixed, source-hash-bound sandbox patch. The live source is never written here. */
export function generateAyasRenderToolSupersessionPatch(source: string): string {
  if (crypto.createHash("sha256").update(source, "utf8").digest("hex") !== RENDER_TOOL_SOURCE_SHA256) throw new Error("render-tool strategy source mismatch");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const once = (input: string, before: string, after: string): string => {
    if (input.split(before).length !== 2) throw new Error("render-tool strategy anchor mismatch");
    return input.replace(before, after);
  };
  let content = once(source,
    '  "user.decision.computer-purchase-plan",' + eol,
    '  "user.decision.computer-purchase-plan",' + eol + '  "user.decision.render-tool",' + eol);
  content = once(content,
    '    return isAyasMemoryFactKey(factKey) && typeof factValue === "string" ? { key: factKey, value: factValue } : null;' + eol,
    '    if (isAyasMemoryFactKey(factKey) && typeof factValue === "string") {' + eol +
    '      if (factKey !== "user.decision.render-tool") return { key: factKey, value: factValue };' + eol +
    '      const derived = deriveAyasMemoryFact(record);' + eol +
    '      return isAuthoritative(record) && derived?.key === factKey && derived.value === factValue ? derived : null;' + eol +
    '    }' + eol +
    '    if (factKey !== undefined || factValue !== undefined) return null;' + eol +
    '    const derived = deriveAyasMemoryFact(record);' + eol +
    '    return derived?.key === "user.decision.render-tool" && isAuthoritative(record) ? derived : null;' + eol);
  content = once(content,
    '    const value = fold(input.body).replace(/\\s+/g, " ").trim();' + eol +
    '    const computer = /\\b(?:bilgisayar|masaustu|dizustu|laptop|notebook|pc)\\b/.test(value);' + eol,
    '    const value = fold(input.body).replace(/\\s+/g, " ").trim();' + eol +
    '    const render = /^(?:artik )?render icin ([a-z][a-z0-9]{1,39}) kullanacagiz$/.exec(value);' + eol +
    '    if (render) return { fact: { key: "user.decision.render-tool", value: render[1]! }, clause: null };' + eol +
    '    const computer = /\\b(?:bilgisayar|masaustu|dizustu|laptop|notebook|pc)\\b/.test(value);' + eol);
  content = once(content,
    '  const evidence = deriveFactEvidence(input);' + eol,
    '  const derived = deriveFactEvidence(input);' + eol +
    '  const evidence = input.source === "ayas-inferred" && derived?.fact.key === "user.decision.render-tool" ? null : derived;' + eol);
  return content;
}

export const AYAS_IMPROVEMENT_STRATEGIES: readonly AyasImprovementStrategy[] = Object.freeze([{
  strategyId: "exp-memory-render-tool-supersession", version: 1,
  capability: "conversation-memory-context", benchmarkId: "cognitive-quality",
  dimensions: ["STALE_CONTEXT_LEAKAGE"], component: "AyasMemoryTemporal",
  summary: "Read-side supersession for explicit user render-tool decisions only",
  exactFiles: [RENDER_TOOL_SOURCE], maxChangedLines: 80,
  regressionSuites: ["scripts/smoke-ayas-memory-temporal.ts", "scripts/smoke-ayas-memory.ts", "scripts/smoke-ayas-retrieval-evaluation.ts", "scripts/smoke-ayas-conversation-quality-master.ts"],
  reviewedExactPatch: {
    effectClass: "READ_SIDE_DERIVATION", operationType: "REPLACE_EXISTING_SOURCE", exactFiles: [RENDER_TOOL_SOURCE],
    beforeSha256: RENDER_TOOL_SOURCE_SHA256,
    afterSha256: "ba8de8096f42e8c4de0d712cd48394ef6b587f835c97c9afd1a512e21e46bace",
    normalizedDiffSha256: "d87c40fd1164eb6c2c687472b0dd906d08d669997acbe6fb0871cb0a707e8a73",
    changedLines: 15,
    effects: { persistentWrite: false, externalIo: false, network: false, dependency: false, provider: false,
      spend: false, publish: false, ownerAuthority: false, securityAuthority: false },
  },
  generate: ({ readFile }) => {
    const source = readFile(RENDER_TOOL_SOURCE);
    if (source === null) throw new Error("render-tool source missing");
    return [{ filePath: RENDER_TOOL_SOURCE, content: generateAyasRenderToolSupersessionPatch(source) }];
  },
}]);

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
  if (strategy.reviewedExactPatch && (!validAyasReviewedExactPatch(strategy.reviewedExactPatch)
    || JSON.stringify(strategy.reviewedExactPatch.exactFiles) !== JSON.stringify(strategy.exactFiles)
    || strategy.reviewedExactPatch.changedLines > strategy.maxChangedLines)) violations.push("STRATEGY_EXACT_PATCH_INVALID");
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
    strategies: registry.strategies.map((s) => [s.strategyId, s.version, s.capability, s.benchmarkId, s.dimensions, s.exactFiles, s.maxChangedLines, s.regressionSuites, s.component, s.summary, ...(s.reviewedExactPatch ? [s.reviewedExactPatch] : [])]),
    capabilityMap: Object.entries(registry.capabilityMap).sort(([a], [b]) => a.localeCompare(b)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
