import { ayasLocalCodingCandidatePins } from "../../brain/autonomy/AyasLocalCodingPins";
import type { AyasLifecycleEntry, AyasLifecycleEvidence, AyasLifecycleRecord } from "./AyasLifecycle";

/**
 * Stage 15E — the lifecycle registry of record.
 *
 * A reviewed constant, not configuration: an entry changes only through a
 * source change on the existing owner approval path. Each entry states what
 * the thing is (an immutable identity where one exists), which state it has
 * earned, and the record that state rests on. Where nothing was measured the
 * entry says so. No number here is an estimate.
 *
 * Most of what AYAS uses today was chosen by the owner before this lifecycle
 * existed. Those entries are `OWNER_SELECTED`: in use by the owner's
 * decision, pinned where a digest could be read, and not promoted. The
 * lifecycle gates what happens from here: no entry becomes QUALIFIED or
 * later without the six checks on record.
 */
const STAGE15 = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE";
const CODING_CLOSURE = `${STAGE15}/hardening/15A/QUALIFICATION_CLOSURE.json`;
const STAGE15_7 = `${STAGE15}/STAGE15_7_OWNER_REVIEW_PACKET.md`;
const CHECKPOINT = "docs/ayas-execution/2026-09-27-master/ACTIVE_CHECKPOINT.json";

const notMeasured = (summary: string): AyasLifecycleEvidence => ({ result: "NOT_MEASURED", ref: "", summary });
const evidence = (result: "PASS" | "PARTIAL" | "FAIL", ref: string, summary: string, measuredBy?: string): AyasLifecycleEvidence => ({ result, ref, summary, ...(measuredBy ? { measuredBy } : {}) });
const COGNITIVE = "evaluator.cognitive-quality.2026-10-01";
/** An entry nobody benchmarked under this lifecycle. */
const unmeasured = (what: string, resourceUse: AyasLifecycleEvidence = notMeasured("not recorded")): AyasLifecycleRecord => ({
  capability: notMeasured(`${what}: no frozen benchmark under this lifecycle`),
  regression: notMeasured("no comparison against an incumbent"),
  security: notMeasured("no provenance or security review on record"),
  hardwareFit: notMeasured("no recorded hardware-fit measurement"),
  consistency: notMeasured("no repeated-run measurement"),
  heldOut: notMeasured("no held-out set"),
  resourceUse,
});
const OPENED = "2026-10-01";
const recordedAtOpening = (pinnedBasis?: string) => [
  { state: "DISCOVERED" as const, on: OPENED, basis: "recorded when Stage 15E opened; in use by owner selection before the lifecycle existed" },
  ...(pinnedBasis ? [{ state: "PINNED" as const, on: OPENED, basis: pinnedBasis }] : []),
];

const coding = ayasLocalCodingCandidatePins.model;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export const AYAS_LIFECYCLE_REGISTRY: readonly AyasLifecycleEntry[] = deepFreeze([
  /* ------------------------------------------------------------------ llm --- */
  {
    id: "llm.local-text.qwen2.5-3b", kind: "llm", role: "local-text-generation", label: "qwen2.5:3b (Ollama)",
    identity: { type: "ollama-digest", tag: "qwen2.5:3b", digest: "357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "Ollama on loopback; the pipeline default (OLLAMA_MODEL) and AYAS chat when AYAS_OLLAMA_MODEL is unset or names it. 3.1B parameters, Q4_K_M, 1.93 GB.",
    record: unmeasured("pipeline and chat text"), rollbackTarget: null,
    history: recordedAtOpening("digest read from the local Ollama runtime (GET /api/tags on loopback)"),
    notes: "The tag is a label: Ollama can serve different bytes under it after a pull. The digest is the identity, and the chat router reports when the served digest differs.",
  },
  {
    id: "llm.local-text.qwen2.5-7b", kind: "llm", role: "local-text-generation", label: "qwen2.5:7b (Ollama)",
    identity: { type: "ollama-digest", tag: "qwen2.5:7b", digest: "845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "Ollama on loopback; AYAS chat only, when the owner sets AYAS_OLLAMA_MODEL to it. 7.6B parameters, Q4_K_M, 4.68 GB.",
    record: unmeasured("AYAS chat"), rollbackTarget: "llm.local-text.qwen2.5-3b",
    history: recordedAtOpening("digest read from the local Ollama runtime (GET /api/tags on loopback)"),
    notes: "An earlier informal comparison preferred it to the 3b model for AYAS chat (docs/AYAS_ACTIVATION.md). That was not a frozen benchmark and is not counted as qualification evidence.",
  },

  /* --------------------------------------------------------- coding model --- */
  {
    id: "coding-model.local-coding.qwen2.5-coder-14b-q4km", kind: "coding-model", role: "local-coding", label: "Qwen2.5-Coder-14B-Instruct Q4_K_M (llama.cpp)",
    identity: { type: "hf-revision", repository: coding.repository, revision: coding.ref, file: coding.file, sha256: coding.sha256 },
    state: "DEGRADED", admission: "NONE",
    compatibility: `llama.cpp ${ayasLocalCodingCandidatePins.engine.binaryRelease} (commit ${ayasLocalCodingCandidatePins.engine.commit}), CPU only, inside the rootless Podman sandbox image; ${ayasLocalCodingCandidatePins.base.platform}.`,
    record: {
      capability: evidence("FAIL", CODING_CLOSURE, "0 of 1 executed historical cases passed: the tool-call protocol returned invalid output twice, the structured-output protocol failed the baseline assertion; 4 evaluable cases were not executed"),
      regression: notMeasured("no incumbent local coding model exists to compare against"),
      security: evidence("PASS", `${STAGE15}/hardening/15A/HARD_SANDBOX_EVIDENCE.json`, "hard sandbox isolation matrix 23/23, OOM kill, timeout stop and unexpected-mount refusal; model and engine bytes verified against their pins"),
      hardwareFit: evidence("PARTIAL", `${STAGE15}/hardening/15A/HOST_RESOURCE_GUARD_EVIDENCE.json`, "CPU-only inference fits under the host guard, with host RAM peaking at 84.8 to 87.9 percent; there is no GPU path in the sandbox, so GPU fit is unmeasured"),
      consistency: notMeasured("no repeat matrix: pass^k was not measured"),
      heldOut: notMeasured("the held-out case was not executed"),
      resourceUse: evidence("PASS", `${STAGE15}/hardening/15A/LOCAL_MODEL_RUN_EVIDENCE.json`, "12.5 GiB container limit, 8 CPUs, zero resource aborts and zero host-protection pauses"),
    },
    rollbackTarget: null,
    history: [
      { state: "DISCOVERED", on: OPENED, basis: "owner-selected candidate for local coding (Stage 15A.3h)" },
      { state: "PINNED", on: OPENED, basis: "model and engine bytes verified locally against the recorded SHA-256 pins" },
      { state: "DEGRADED", on: OPENED, basis: "Stage 15A.3 closed LOCAL_INDEPENDENCE_DEGRADED: the real qualification run did not pass" },
    ],
    notes: "Not registered as an engine and not used by any AYAS surface; the operator CLI is the only way to run it. Re-qualification needs an owner decision first: a numeric threshold, a different model or engine, or GPU passthrough.",
  },

  /* --------------------------------------------------------- speech models --- */
  {
    id: "speech-model.stt.whisper-large-v3-turbo", kind: "speech-model", role: "speech-to-text", label: "whisper.cpp ggml-large-v3-turbo",
    identity: { type: "sha256-file", sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69", sizeBytes: 1_624_555_275, locator: "bin/whisper/ggml-large-v3-turbo.bin" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "whisper.cpp CLI (prebuilt Windows cuBLAS build) behind POST /api/ayas/stt; selected by AYAS_WHISPER_MODEL.",
    record: unmeasured("Turkish command transcription"), rollbackTarget: null,
    history: recordedAtOpening("SHA-256 and size of the local model file recorded"),
    notes: "A local, untracked artifact. Earlier spot checks transcribed a few Turkish commands correctly; no test set was frozen.",
  },
  {
    id: "speech-model.wake-word.ayas-openwakeword", kind: "speech-model", role: "wake-word", label: "openWakeWord \"AYAS\" classifier",
    identity: { type: "sha256-file", sha256: "37aaab151f88fbd2fe795593176718aa10067a5526b8e41c94784aa08a80539c", sizeBytes: 870_176, locator: "public/wake/ayas.onnx" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "onnxruntime-web in the browser, with the openWakeWord melspectrogram and embedding models beside it.",
    record: {
      ...unmeasured("wake-word detection"),
      capability: evidence("PARTIAL", "scripts/wake/train_ayas_wake.py", "the training run's local report (public/wake/ayas.report.json, untracked) gives recall 1.0 and 0.39 false positives per hour at threshold 0.5 on synthetic positives from one TTS voice; real-speaker recall is an operator device test that has not been run"),
      heldOut: evidence("PARTIAL", "scripts/wake/train_ayas_wake.py", "held-out clip recall 1.0 at threshold 0.5, on synthetic clips only"),
    },
    rollbackTarget: null,
    history: recordedAtOpening("SHA-256 and size of the trained model file recorded"),
    notes: "A local, untracked artifact trained in this repository's own procedure. The threshold is still to be tuned on a real device.",
  },
  {
    id: "speech-model.narration-tts.piper-tr-dfki-medium", kind: "speech-model", role: "narration-tts", label: "Piper tr_TR-dfki-medium",
    identity: { type: "sha256-file", sha256: "2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb", sizeBytes: 63_201_294, locator: "bin/piper/tr_TR-dfki-medium.onnx" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "piper executable under bin/piper; the Atölye audio stage when AUDIO_PROVIDER selects it; also the voice that generated the wake-word training positives.",
    record: unmeasured("Turkish narration"), rollbackTarget: null,
    history: recordedAtOpening("SHA-256 and size of the local voice file recorded"),
    notes: "A local, untracked artifact. The canonical spec asks for a bake-off before any new local voice engine is adopted; none has been run for this one.",
  },
  {
    id: "speech-model.narration-tts.hosted-provider", kind: "speech-model", role: "narration-tts", label: "hosted narration voice (AUDIO_PROVIDER=openai)",
    identity: { type: "UNPINNED", reason: "a vendor-hosted voice has no digest the caller can pin; the vendor can change it without notice" },
    state: "DISCOVERED", admission: "OWNER_SELECTED", compatibility: "the Atölye audio stage when the owner's AUDIO_PROVIDER selects the hosted provider; a paid, metered service.",
    record: unmeasured("Turkish narration"), rollbackTarget: null,
    history: recordedAtOpening(),
    notes: "Reached only from the owner's production pipeline, never from an AYAS surface. It cannot leave DISCOVERED while it has no immutable identity.",
  },
  {
    id: "speech-model.assistant-tts.browser-speech-synthesis", kind: "speech-model", role: "assistant-voice-tts", label: "browser speechSynthesis voice",
    identity: { type: "UNPINNED", reason: "the device and browser choose the voice; nothing fixes which one speaks" },
    state: "DISCOVERED", admission: "OWNER_SELECTED", compatibility: "the Brain console and the phone PWA speak AYAS replies with the platform voice.",
    record: unmeasured("spoken replies"), rollbackTarget: null,
    history: recordedAtOpening(),
    notes: "Voice quality and language coverage differ per device and are not controlled by this repository.",
  },

  /* ---------------------------------------------------------- media helper --- */
  {
    id: "media-helper.ffmpeg.9.0-gyan-full", kind: "media-helper", role: "video-audio-processing", label: "FFmpeg 9.0 full build (gyan.dev, winget)",
    identity: { type: "sha256-file", sha256: "05f4251bce9293c2ab492cb17ca7724a0ffd0d06c881ba2ee83b82a89c2fc740", sizeBytes: 222_248_960, locator: "env:FFMPEG_PATH" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "the Atölye video, assembly and export stages (FFMPEG_PATH) and speech-to-text audio conversion (AYAS_FFMPEG_PATH).",
    record: unmeasured("production rendering"), rollbackTarget: null,
    history: recordedAtOpening("SHA-256 and size of the installed binary recorded on the current workstation"),
    notes: "Installed outside the repository; another machine will have a different build and must be recorded as its own entry (Stage 15S). The image generation provider the owner selects with IMAGE_PROVIDER is not recorded here: a hosted model has no identity the caller can pin.",
  },

  /* ----------------------------------------------------------------- prompt --- */
  {
    id: "prompt.ayas-reasoning.2026-10-01", kind: "prompt", role: "ayas-reasoning-prompt", label: "AYAS reasoning prompt builder",
    identity: { type: "source-digest", files: ["src/lib/ayas/reasoning/AyasReasoningPrompt.ts"], sha256: "5212ff568f51e43e9e140be3b2185ece391fd076f244be6ef617868daaf66a51" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "the AYAS reasoning core with the local text model; validated output schema in the same module family.",
    record: {
      ...unmeasured("structured reasoning"),
      capability: evidence("PARTIAL", CHECKPOINT, "cognitive quality 54/55 with one known limitation, measured on the whole reasoning stack and not on the prompt alone", COGNITIVE),
      heldOut: evidence("PARTIAL", CHECKPOINT, "held-out 4/5 on the whole reasoning stack", COGNITIVE),
    },
    rollbackTarget: null,
    history: recordedAtOpening("source digest recorded at the Stage 15E packet"),
    notes: "Editing the prompt changes this digest. A changed prompt is a new version: record it as a new entry and keep this one as its rollback target.",
  },

  /* --------------------------------------------------- improvement strategy --- */
  {
    id: "improvement-strategy.discovery.second-safe-smoke-coverage-v1", kind: "improvement-strategy", role: "safe-candidate-discovery", label: "second-safe-smoke-coverage-v1",
    identity: { type: "source-digest", files: ["src/lib/brain/autonomy/AyasDiscoveryRegistry.ts"], sha256: "df8bc834fb8d89d211023ff9d1bf15be625dcf263fb3be905bbadbae4247ddc2" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "the observer's discovery run (capability discovery.proposal-inbox); it only drafts a proposal for the owner.",
    record: unmeasured("candidate discovery"), rollbackTarget: null,
    history: recordedAtOpening("source digest of the closed discovery registry recorded"),
    notes: "The one entry of the closed discovery registry. It proposes; execution needs the owner's approval and an admitted owner lease.",
  },
  {
    id: "improvement-strategy.research-experiment.exp-memory-render-tool-supersession", kind: "improvement-strategy", role: "registered-research-experiment", label: "exp-memory-render-tool-supersession",
    identity: { type: "source-digest", files: ["src/lib/brain/autonomy/AyasResearchExperimentRegistry.ts"], sha256: "214204bcf365ed7e1cd9b5d724867b1b879b5c534c2b8b18fbedd327bd45a143" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "the research improvement cycle in a TEMP sandbox; the frozen cognitive-quality evaluator.",
    record: {
      ...unmeasured("the registered experiment"),
      capability: evidence("PASS", CHECKPOINT, "the governed run improved cognitive quality from 53/55 to 54/55 and resolved the targeted stale-seed case", COGNITIVE),
      regression: evidence("PASS", CHECKPOINT, "the four declared regression suites passed before and after"),
      security: evidence("PASS", STAGE15_7, "exact-diff safety proof; executed only after the owner approved the frozen patch artifact"),
      heldOut: evidence("PARTIAL", CHECKPOINT, "held-out stayed at 4/5: not worse, not improved", COGNITIVE),
    },
    rollbackTarget: null,
    history: recordedAtOpening("source digest of the experiment registry recorded"),
    notes: "Its one run is complete and was applied through the owner approval path. It stays PINNED: repeated consistency and hardware fit were never measured as lifecycle checks.",
  },

  /* -------------------------------------------------------------- evaluator --- */
  {
    id: "evaluator.cognitive-quality.2026-10-01", kind: "evaluator", role: "cognitive-quality-evaluator", label: "smoke-ayas-cognitive-quality",
    identity: { type: "source-digest", files: ["scripts/smoke-ayas-cognitive-quality.ts"], sha256: "a46db05431345e463e5044d94937a03d9fceda2afe38cbd0983bc22bc1d69271" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "deterministic; primary and held-out fixtures inside the script; the baseline every reasoning change is measured against.",
    record: unmeasured("an evaluator is the measure, not the measured"), rollbackTarget: null,
    history: recordedAtOpening("source digest recorded"),
    notes: "An evaluator must not change to make a candidate pass. Editing it changes this digest and needs a new entry with the reason.",
  },
  {
    id: "evaluator.research-improvement.2026-10-01", kind: "evaluator", role: "research-improvement-evaluator", label: "smoke-ayas-research-improvement-loop (Stage 8)",
    identity: { type: "source-digest", files: ["scripts/smoke-ayas-research-improvement-loop.ts"], sha256: "32f6fdb2262781a38d6609c41aba2b16b2c9c5725af7eadfd3c92920bbb092ab", revision: "76aa4b1f0238e1cbaf3accef0558ee78325961b3" },
    state: "PINNED", admission: "NONE", compatibility: "archived pre-15F.4 evaluator; preserved in Git as a rollback artifact, never admitted as current source.",
    record: unmeasured("an evaluator is the measure, not the measured"), rollbackTarget: null,
    history: recordedAtOpening("source digest recorded"),
    notes: "Original identity retained. 15F.4 found its HEAD-derived historical-gap fixture stale after Stage 15.7. This version remains a pinned rollback artifact; human calibration is pending for its replacement.",
  },
  {
    id: "evaluator.research-improvement.15f4-v2", kind: "evaluator", role: "research-improvement-evaluator", label: "smoke-ayas-research-improvement-loop (frozen historical gap)",
    identity: { type: "source-digest", files: ["scripts/smoke-ayas-research-improvement-loop.ts"], sha256: "5d1901da1169cab5d2b496ed26522c4df0526ea9e47ae094b898f281572e66a9" },
    state: "PINNED", admission: "NONE", compatibility: "developer TEMP baseline only; current loop and grader with the independently hashed pre-repair temporal input; every assertion retained.",
    record: unmeasured("new evaluator identity; owner/human calibration pending"), rollbackTarget: "evaluator.research-improvement.2026-10-01",
    history: [{ state: "DISCOVERED", on: OPENED, basis: "15F.4 baseline exposed a stale historical-gap fixture" },
      { state: "PINNED", on: OPENED, basis: "fixture input pinned to immutable history; assertions and held-out expectations unchanged" }],
    notes: "No qualification, promotion or serving admission. Old bytes and their digest are preserved at the rollback target; the cognitive and retrieval graders did not change.",
  },
  {
    id: "evaluator.retrieval.2026-10-01", kind: "evaluator", role: "retrieval-evaluator", label: "smoke-ayas-retrieval-evaluation",
    identity: { type: "source-digest", files: ["scripts/smoke-ayas-retrieval-evaluation.ts", "scripts/lib/AyasRetrievalEvaluation.ts"], sha256: "b4c454a68d36977012b97e2df6755d7ed66e7788d4e6500aff86a7e7c1f5e5d5" },
    state: "PINNED", admission: "OWNER_SELECTED", compatibility: "deterministic; 74 cases with recorded known limitations.",
    record: unmeasured("an evaluator is the measure, not the measured"), rollbackTarget: null,
    history: recordedAtOpening("source digest recorded"),
    notes: "Known limitations are part of the evaluator's recorded output and must not be relaxed to pass a candidate.",
  },
] satisfies readonly AyasLifecycleEntry[]);

export function findAyasLifecycleEntry(id: string): AyasLifecycleEntry | undefined {
  return AYAS_LIFECYCLE_REGISTRY.find((entry) => entry.id === id);
}

/** The entry that pins a local model tag, if one exists. A tag with no entry is unregistered, not unknown-good. */
export function findAyasLifecycleEntryForOllamaTag(tag: string): AyasLifecycleEntry | undefined {
  return AYAS_LIFECYCLE_REGISTRY.find((entry) => entry.identity.type === "ollama-digest" && entry.identity.tag === tag);
}
