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

/**
 * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — the per-source acquisition
 * policy. Kept as declarative registry DATA rather than as branching inside
 * the scan engines, so adding a source with unusual characteristics (a very
 * large feed, a provider that wants to be polled gently) never means
 * touching the scheduler, the fetch layer, or the analysis step.
 */
export interface AyasResearchSourcePolicy {
  /** Floor on how often this source may be contacted, regardless of how often a scan runs. Respects the provider's endpoint rather than assuming the scan cadence is always polite enough. */
  readonly minCheckIntervalMs: number;
  /** Size bound for the LIGHT scan's cheap change check. */
  readonly lightMaxBodyBytes: number;
  /** Size bound for the DEEP scan's full read. */
  readonly deepMaxBodyBytes: number;
  /** Bounded, TRANSIENT-only retries handed to `ayasSafePublicFetch`. */
  readonly maxRetries: number;
  /** Consecutive failures at which this source is reported FAILED rather than merely DEGRADED. */
  readonly failedAfterConsecutiveFailures: number;
}

/**
 * The default every source uses unless it declares otherwise.
 *
 * `lightMaxBodyBytes` is generous ON PURPOSE. The scan engines read a
 * bounded PREFIX (`acceptTruncatedBody`) rather than demanding a complete
 * body, because an official release feed's size reflects how verbose its
 * release notes are — not whether it is trustworthy. Treating a big feed as
 * a failure is what previously blinded AYAS to four of the most active
 * projects it watches.
 */
export const AYAS_RESEARCH_SOURCE_DEFAULT_POLICY: AyasResearchSourcePolicy = {
  minCheckIntervalMs: 60 * 60_000, // at most once an hour per source, well under the 6h LIGHT cadence
  lightMaxBodyBytes: 750_000,
  deepMaxBodyBytes: 2_000_000,
  maxRetries: 2,
  failedAfterConsecutiveFailures: 3,
};

export interface AyasResearchSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly category: AyasCapabilityCategory;
  readonly kind: AyasResearchSourceKind;
  readonly url: string;
  /** Every registry entry today is an official, first-party source (the project's own GitHub org). Kept as an explicit field, not a hardcoded `true`, so a future non-official entry (e.g. a well-regarded aggregator) stays possible without changing the type. */
  readonly officialSource: boolean;
  /** Why THIS source earns a place in the registry — the relevance rationale, in the registry itself rather than in a sprint document that drifts away from the code. */
  readonly notes: string;
  /** The content types this source is expected to answer with. A source answering something else is refused by the fetch layer rather than mis-parsed. */
  readonly expectedContentTypes: readonly string[];
  /** Omitted means `AYAS_RESEARCH_SOURCE_DEFAULT_POLICY`. */
  readonly policy?: Partial<AyasResearchSourcePolicy>;
}

export function resolveAyasResearchSourcePolicy(source: AyasResearchSource): AyasResearchSourcePolicy {
  return { ...AYAS_RESEARCH_SOURCE_DEFAULT_POLICY, ...(source.policy ?? {}) };
}

const ATOM_CONTENT_TYPES = ["application/atom+xml", "text/xml", "application/xml"] as const;

function ghReleases(sourceId: string, provider: string, category: AyasCapabilityCategory, org: string, repo: string, notes: string, policy?: Partial<AyasResearchSourcePolicy>): AyasResearchSource {
  return { sourceId, provider, category, kind: "github-releases-atom", url: `https://github.com/${org}/${repo}/releases.atom`, officialSource: true, notes, expectedContentTypes: ATOM_CONTENT_TYPES, ...(policy ? { policy } : {}) };
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

  // ===================================================================
  // AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — coverage expansion.
  //
  // Every entry below was live-validated before being added (reachable,
  // HTTP 200, parseable Atom, at least one extractable entry). Two
  // otherwise-plausible candidates were deliberately REJECTED rather than
  // listed: a TTS project whose feed is real but carries zero releases (a
  // source that can never yield a finding is registry noise, not coverage),
  // and FFmpeg's `tags.atom`, which returns the same content as the
  // `releases.atom` entry already listed here. Source count is not the
  // goal; a source that can actually answer "what changed?" is.
  // ===================================================================

  // --- AI assistants / foundation-model SDKs (TypeScript side) ---------
  // The registry already watched the Python SDKs. This project is
  // TypeScript end to end, so the TS SDKs are the ones whose releases
  // actually translate into work here.
  ghReleases("openai-node", "OpenAI", "AI_ASSISTANTS", "openai", "openai-node", "Official OpenAI Node/TypeScript SDK — the SDK surface this project would actually consume, unlike the Python one."),
  ghReleases("anthropic-sdk-typescript", "Anthropic", "AI_ASSISTANTS", "anthropics", "anthropic-sdk-typescript", "Official Anthropic TypeScript SDK — same reasoning as the OpenAI Node SDK."),

  // --- coding agents ---------------------------------------------------
  ghReleases("claude-code", "Anthropic", "CODING_AGENTS", "anthropics", "claude-code", "Official Claude Code agent — directly comparable to AYAS's own governed self-improvement loop."),
  ghReleases("gemini-cli", "Google", "CODING_AGENTS", "google-gemini", "gemini-cli", "Official Google coding-agent CLI — a second reference point for agent UX and tool-use design."),
  ghReleases("opencode", "OpenCode", "CODING_AGENTS", "sst", "opencode", "Open-source terminal coding agent — an openly inspectable implementation of the agent loop AYAS also runs."),

  // --- tool use / MCP --------------------------------------------------
  ghReleases("mcp-typescript-sdk", "Model Context Protocol", "TOOL_USE", "modelcontextprotocol", "typescript-sdk", "Official MCP TypeScript SDK — the emerging standard for how an agent reaches tools, in this project's own language."),
  ghReleases("mcp-servers", "Model Context Protocol", "TOOL_USE", "modelcontextprotocol", "servers", "Official reference MCP servers — concrete tool-integration patterns AYAS can learn from."),

  // --- agent orchestration / workflow ----------------------------------
  ghReleases("langgraph", "LangChain", "AGENT_ORCHESTRATION", "langchain-ai", "langgraph", "Official stateful agent-graph orchestration framework — directly comparable to this project's own pipeline/stage orchestration."),
  ghReleases("crewai", "CrewAI", "AGENT_ORCHESTRATION", "crewAIInc", "crewAI", "Multi-agent orchestration framework — role/delegation patterns relevant to AYAS's own multi-step reasoning."),

  // --- retrieval / research agents -------------------------------------
  ghReleases("haystack", "deepset", "RESEARCH_AGENTS", "deepset-ai", "haystack", "Official retrieval/RAG orchestration framework — comparable to AYAS's own research pipeline."),

  // --- memory / context architectures ----------------------------------
  ghReleases("chroma", "Chroma", "MEMORY_CONTEXT", "chroma-core", "chroma", "Official embedding/vector store — memory-architecture reference for AYAS's own context layer."),
  ghReleases("qdrant", "Qdrant", "MEMORY_CONTEXT", "qdrant", "qdrant", "Official vector database — a second, independent memory-architecture reference."),

  // --- evaluation / testing --------------------------------------------
  ghReleases("promptfoo", "promptfoo", "QUALITY_ASSURANCE", "promptfoo", "promptfoo", "Official LLM evaluation/red-teaming harness — relevant to how AYAS validates its own model-driven steps."),
  ghReleases("ragas", "Ragas", "QUALITY_ASSURANCE", "explodinggradients", "ragas", "Official RAG/agent evaluation metrics library — evaluation methodology for research-style pipelines."),

  // --- agent safety / reliability --------------------------------------
  ghReleases("nemo-guardrails", "NVIDIA", "SECURITY_RELIABILITY", "NVIDIA", "NeMo-Guardrails", "Official programmable guardrails toolkit — directly relevant to AYAS's own untrusted-content and policy boundaries."),

  // --- open-source AI runtimes / model tooling -------------------------
  ghReleases("vllm", "vLLM", "OPEN_SOURCE_AI", "vllm-project", "vllm", "Official high-throughput local inference engine — a self-hosting alternative comparable to the `ollama` runtime AYAS already uses."),
  ghReleases("transformers-js", "Hugging Face", "OPEN_SOURCE_AI", "huggingface", "transformers.js", "Official Transformers.js — an ACTUAL runtime dependency of this project (`@huggingface/transformers`), unlike the Python library already listed."),
  ghReleases("onnxruntime", "Microsoft", "OPEN_SOURCE_AI", "microsoft", "onnxruntime", "Official ONNX Runtime — an ACTUAL runtime dependency of this project (`onnxruntime-web`)."),

  // --- image / video generation ----------------------------------------
  ghReleases("diffusers", "Hugging Face", "IMAGE_AI", "huggingface", "diffusers", "Official diffusion-model library — the reference implementation for the image/video generation Atölye's visuals stage depends on.", { lightMaxBodyBytes: 2_000_000 }),
  ghReleases("comfyui", "ComfyUI", "IMAGE_AI", "comfyanonymous", "ComfyUI", "Official node-based generative image/video workflow engine — closest open equivalent to Atölye's own visuals pipeline."),

  // --- media processing / codecs / editing ------------------------------
  ghReleases("ffmpeg", "FFmpeg", "VIDEO_EDITING", "FFmpeg", "FFmpeg", "Official FFmpeg releases — Atölye's assembly, video, audio and export stages are built directly on FFmpeg, so its releases are first-order relevant."),
  ghReleases("obs-studio", "OBS Project", "VIDEO_EDITING", "obsproject", "obs-studio", "Official OBS Studio — reference implementation for real-time video capture/encoding pipelines."),
  ghReleases("shotcut", "Shotcut", "VIDEO_EDITING", "mltframework", "shotcut", "Official open-source non-linear editor built on MLT — editing-model reference for Atölye's assembly stage."),
  ghReleases("mlt", "MLT Framework", "SCENE_ASSEMBLY", "mltframework", "mlt", "Official MLT multimedia framework — a mature timeline/compositing model directly comparable to Atölye's scene assembly."),
  ghReleases("handbrake", "HandBrake", "EXPORT", "HandBrake", "HandBrake", "Official transcoder — encoding/preset practice relevant to Atölye's export stage."),

  // --- animation / motion ----------------------------------------------
  ghReleases("remotion", "Remotion", "MOTION", "remotion-dev", "remotion", "Official programmatic video framework (React) — the closest existing analogue to Atölye's own code-driven video generation, in this project's own stack."),
  ghReleases("manim", "Manim Community", "MOTION", "ManimCommunity", "manim", "Official community Manim — programmatic motion-graphics/animation reference for Atölye's animation stage."),
  ghReleases("lottie-web", "Airbnb", "MOTION", "airbnb", "lottie-web", "Official Lottie web renderer — vector-animation delivery format relevant to Atölye's animation/overlay work."),

  // --- transcription / speech ------------------------------------------
  ghReleases("whisper-cpp", "whisper.cpp", "TRANSCRIPTION", "ggerganov", "whisper.cpp", "Official local Whisper inference in C++ — directly comparable to the Whisper executable AYAS's own STT already runs."),
  ghReleases("faster-whisper", "SYSTRAN", "TRANSCRIPTION", "SYSTRAN", "faster-whisper", "Official CTranslate2-based Whisper — the performance-oriented alternative for the same STT capability."),

  // --- audio / music ----------------------------------------------------
  ghReleases("audiocraft", "Meta AI", "AUDIO_AI", "facebookresearch", "audiocraft", "Official generative audio/music research code — relevant to Atölye's soundtrack/audio stage."),
  ghReleases("demucs", "Meta AI", "AUDIO_CLEANUP", "adefossez", "demucs", "Official music source separation — stem isolation/cleanup relevant to Atölye's audio stage. Low release frequency by design; watched, not expected to be noisy."),

  // --- publishing / media discovery -------------------------------------
  ghReleases("yt-dlp", "yt-dlp", "MEDIA_DISCOVERY", "yt-dlp", "yt-dlp", "Official yt-dlp — tracks YouTube platform/extractor changes, the most reliable public signal that YouTube-side behavior shifted under Atölye's publishing stage."),

  // --- platform / runtime dependencies this project actually ships on ---
  ghReleases("nextjs", "Vercel", "DEVELOPER_PLATFORMS", "vercel", "next.js", "Next.js — the App Router framework this entire application is built on."),
  ghReleases("typescript", "Microsoft", "DEVELOPER_PLATFORMS", "microsoft", "TypeScript", "TypeScript — the language every line of this project is written in; `npx tsc --noEmit` gates every change."),
  ghReleases("react", "Meta", "UI_UX", "facebook", "react", "React — the UI runtime behind every Atölye/Gelişim Merkezi component."),
  ghReleases("tailwindcss", "Tailwind Labs", "UI_UX", "tailwindlabs", "tailwindcss", "Tailwind CSS — this project's actual styling layer."),
  ghReleases("eslint", "ESLint", "DEVELOPER_PLATFORMS", "eslint", "eslint", "ESLint — part of this project's own definition-of-done (`npm run lint`, zero warnings)."),
  ghReleases("workers-sdk", "Cloudflare", "DEVELOPER_PLATFORMS", "cloudflare", "workers-sdk", "Cloudflare Workers SDK — `wrangler` is an actual dev dependency of this project's remote-access path."),
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
