import type { AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part C — the extensible
 * registry of public sources AYAS's research scheduler checks. Every entry
 * here is a real, publicly reachable, machine-readable feed AYAS can fetch
 * through `AyasSafePublicFetch` with no login, no paywall, and no anti-bot
 * bypass — deliberately NOT a hand-scraped marketing page (those routinely
 * require a real browser to render and would be brittle/adversarial to
 * parse). A GitHub repository's `/releases.atom` feed is this registry's
 * primary source kind: it exists for every public repository (even one with
 * zero releases, which simply returns an empty, still-valid Atom feed),
 * requires no authentication, and is the project's own official release
 * record — exactly the "official public documentation / changelog / GitHub
 * releases" category the sprint's research scope calls for.
 *
 * Several vendors this sprint's watchlist names by product (CapCut,
 * ElevenLabs, Runway, Adobe, Descript, Canva, DaVinci Resolve) are
 * closed-source consumer products with no known public, unauthenticated,
 * machine-readable release feed — their marketing/blog pages are
 * JS-rendered and not reliably parseable without a real browser, which this
 * research system deliberately does not run (no anti-bot bypass, no login).
 * They are therefore NOT hardcoded here with a guessed URL. This registry
 * is explicitly extensible (`AyasResearchSourceRegistryOptions.extra`): once
 * a specific, confirmed-reachable public feed for one of them is found, it
 * can be added as one more entry, following the exact same shape, with zero
 * change to the scheduler/fetch/analysis code that consumes it.
 */
export type AyasResearchSourceKind = "github-releases-atom" | "rss" | "atom" | "json";

export interface AyasResearchSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly category: AyasCapabilityCategory;
  readonly kind: AyasResearchSourceKind;
  readonly url: string;
  /** Every registry entry today is an official, first-party source (the project's own GitHub org). Kept as an explicit field, not a hardcoded `true`, so a future non-official entry (e.g. a well-regarded aggregator) stays possible without changing the type. */
  readonly officialSource: boolean;
  readonly notes: string;
}

function ghReleases(sourceId: string, provider: string, category: AyasCapabilityCategory, org: string, repo: string, notes: string): AyasResearchSource {
  return { sourceId, provider, category, kind: "github-releases-atom", url: `https://github.com/${org}/${repo}/releases.atom`, officialSource: true, notes };
}

/**
 * The initial seed — a real, working, extensible starting set, not an
 * exhaustive vendor list. Covers both halves of the sprint's research scope
 * (Part J: AYAS/AI-ecosystem self-improvement; Part K: Atölye video/audio
 * production) with sources from the sprint's own named watchlist categories
 * wherever a genuine public feed exists for that category today.
 */
export const AYAS_RESEARCH_SOURCE_REGISTRY: readonly AyasResearchSource[] = [
  // --- AI assistants / coding & research agents / agent orchestration / open-source AI ---
  ghReleases("openai-python-sdk", "OpenAI", "AI_ASSISTANTS", "openai", "openai-python", "Official OpenAI Python SDK — release notes track new API/model capabilities."),
  ghReleases("anthropic-python-sdk", "Anthropic", "AI_ASSISTANTS", "anthropics", "anthropic-sdk-python", "Official Anthropic Python SDK — release notes track new API/model capabilities."),
  ghReleases("aider", "Aider", "CODING_AGENTS", "Aider-AI", "aider", "Open-source AI pair-programming coding agent."),
  ghReleases("llama-index", "LlamaIndex", "RESEARCH_AGENTS", "run-llama", "llama_index", "Open-source retrieval/research-agent framework."),
  ghReleases("langchain", "LangChain", "AGENT_ORCHESTRATION", "langchain-ai", "langchain", "Open-source agent/tool-orchestration framework."),
  ghReleases("ollama", "Ollama", "OPEN_SOURCE_AI", "ollama", "ollama", "Local, self-hosted LLM runtime — the same provider this project's own AYAS chat already runs on ($0, no vendor lock-in)."),
  ghReleases("llama-cpp", "llama.cpp", "OPEN_SOURCE_AI", "ggerganov", "llama.cpp", "Major open-source local-inference project."),
  ghReleases("transformers", "Hugging Face Transformers", "OPEN_SOURCE_AI", "huggingface", "transformers", "Major open-source model/tooling library."),

  // --- multimodal / voice / audio / transcription / TTS ---
  ghReleases("whisper", "OpenAI Whisper", "TRANSCRIPTION", "openai", "whisper", "Open-source speech-to-text model — directly comparable to this project's own STT."),
  ghReleases("piper-tts", "Piper", "TTS", "rhasspy", "piper", "Open-source local TTS — directly comparable to this project's own `piper` provider."),

  // --- video/media editing, tooling, developer platforms, automation ---
  ghReleases("openshot", "OpenShot", "VIDEO_EDITING", "OpenShot", "openshot-qt", "Open-source non-linear video editor."),
  ghReleases("losslesscut", "LosslessCut", "VIDEO_EDITING", "mifi", "lossless-cut", "Open-source fast video trim/export tool."),
  ghReleases("playwright", "Playwright", "AUTOMATION_WORKFLOW", "microsoft", "playwright", "Official browser-automation framework — relevant to AYAS's own tool-use/automation capability research."),
  ghReleases("nodejs", "Node.js", "DEVELOPER_PLATFORMS", "nodejs", "node", "The runtime this whole project is built on."),
] as const;

export interface AyasResearchSourceRegistryOptions {
  /** Additional sources layered on top of the built-in seed — the extensibility point this module's own doc comment promises. Never replaces the seed; a caller that truly wants a reduced set can filter the merged result itself. */
  readonly extra?: readonly AyasResearchSource[];
}

export function resolveAyasResearchSourceRegistry(options: AyasResearchSourceRegistryOptions = {}): readonly AyasResearchSource[] {
  const merged = [...AYAS_RESEARCH_SOURCE_REGISTRY, ...(options.extra ?? [])];
  const seen = new Set<string>();
  const out: AyasResearchSource[] = [];
  for (const source of merged) {
    if (seen.has(source.sourceId)) continue; // first registration for a sourceId wins — lets `extra` add new sources without silently shadowing a seed one under the same id
    seen.add(source.sourceId);
    out.push(source);
  }
  return out;
}
