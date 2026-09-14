"use client";

/**
 * AYAS PHONE LOCAL LLM — EXPERIMENTAL (Tier 2 prototype, isolated).
 *
 * The actual browser-only implementation — loaded ONLY via `next/dynamic`
 * with `ssr: false` from `page.tsx`, so `@huggingface/transformers`,
 * `window`, and `navigator.gpu` never execute during SSR/prerender. `"use
 * client"` alone does not guarantee that (a client component's first paint is
 * still server-rendered in the App Router unless explicitly opted out) — this
 * file is the opt-out boundary.
 *
 * Not part of production `/brain`. Does not import the AYAS chat path, voice
 * engine, Worker client, Ollama config, Reasoning Core, Memory, Self-Healing,
 * or Tool Registry — and does not import the wake-word engine
 * (`openWakeWordRunner.ts`) either, so it can never affect it. The ONE
 * exception, added in the closure sprint: `useScreenWakeLock` — a small,
 * dependency-free hook (no chat/memory/session imports of its own) already
 * shipped for AYAS's voice flow, reused here because its own header comment
 * independently documents the exact failure class this experiment kept
 * hitting on real iPhones: "the biggest cause of 'the page reloaded itself
 * after a few minutes' is the device screen Auto-Lock ... the backgrounded
 * WebKit page is suspended". Reusing it, rather than re-solving the same
 * problem, is what "gerekirse mimariyi değiştir, ama önce mevcut, çalışan
 * altyapıyı kullan" calls for here.
 *
 * NOTHING here calls the PC, the Cloudflare Worker, or OpenAI, or any
 * `/api/ayas/**` route, or any AYAS session state — there is no `fetch()` to
 * any AYAS endpoint anywhere in this file, and no import of anything that
 * reads a cookie/session. That is not a claim, it is a structural fact you
 * can grep for. Model weights are fetched once, directly from the Hugging
 * Face CDN, only when the operator presses "MODELİ İNDİR" — never
 * automatically, never on mount.
 *
 * Auth: `/brain/voice-lab/phone-llm` is now in `accessGate.ts`'s
 * `OPEN_PREFIXES` — reachable with NO AYAS session, matching the wake-engine
 * assets' precedent (they're open pre-auth for the identical reason: gating
 * a route that must survive a PC/session outage defeats its own purpose).
 *
 * `navigator.onLine` below is DISPLAY-ONLY — it never gates
 * `handleDownload`/`handleGenerate`. A stale/incorrect `onLine` reading (a
 * known browser quirk) must never block a working local model.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useScreenWakeLock } from "@/components/brain/useScreenWakeLock";
import {
  detectAyasPhoneLlmCapability,
  AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE,
  type AyasPhoneLlmCapabilityResult,
} from "@/components/brain/voice/localLlm/phoneLlmCapability";
import {
  clearPhoneLlmCheckpoints,
  readAndClearStalePhoneLlmCheckpoints,
  wasLikelyBackgrounded,
  watchPhoneLlmVisibility,
  type PhoneLlmStaleCheckpoint,
} from "@/components/brain/voice/localLlm/phoneLlmDiagnostics";
import {
  runIdbOnlyDiagnostic,
  runSingleChunkNetworkDiagnostic,
  type IdbOnlyDiagnosticResult,
  type SingleChunkNetworkDiagnosticResult,
} from "@/components/brain/voice/localLlm/phoneLlmDiagnosticTests";
import { setAyasPhoneLlmDownloadActive } from "@/components/brain/voice/localLlm/phoneLlmDownloadGuard";
import { deleteModelFile } from "@/components/brain/voice/localLlm/phoneLlmIdbStorage";
import { buildRemoteResourceUrl, getRequiredModelCacheFiles } from "@/components/brain/voice/localLlm/phoneLlmModelResources";
import { formatRangeDiagnosis, runRangeDiagnosis, type RangeDiagnosisResult } from "@/components/brain/voice/localLlm/phoneLlmRangeDiagnostic";
import {
  precacheModelFiles,
  type AyasPhoneLlmPrecacheOutcome,
} from "@/components/brain/voice/localLlm/phoneLlmPrecacheDownloader";
import {
  AyasPhoneLlmRunner,
  AYAS_PHONE_LLM_MODELS,
  getModelCacheStatus,
  type AyasPhoneLlmCacheStatus,
  type AyasPhoneLlmModelSpec,
  type AyasPhoneLlmLoadProgress,
} from "@/components/brain/voice/localLlm/phoneLlmRunner";

/**
 * Full end-to-end pipeline state machine (closure sprint):
 *
 *   idle → check_storage → downloading → persisting → verifying →
 *   model_ready_to_load → loading_runtime → ready
 *                                        ↘ error (from any state)
 *
 * Each arrow is backed by a REAL bounded operation, not a guess. Storage is
 * chunked IndexedDB (`phoneLlmIdbStorage.ts`) — Cache Storage is retired
 * for model weights entirely after real-device proof that a single
 * `cache.put()` of the ~460MB weight file times out (see
 * `phoneLlmPrecacheDownloader.ts`'s header for the full evidence):
 *  - check_storage:      `getModelCacheStatus()` / per-file IndexedDB meta
 *                         lookup — local, fast, wrapped in try/catch
 *                         (fail → "none").
 *  - downloading:        per-8MB-chunk `fetch()` with an HTTP `Range`
 *                         header, each bounded by `FETCH_TIMEOUT_MS`.
 *  - persisting:         per-chunk `IndexedDB.put()`, each bounded by its
 *                         own write timeout — never one giant write.
 *  - verifying:          summed byte count + a read-back of the final
 *                         chunk; a mismatch deletes the corrupt file's
 *                         records so a retry starts clean.
 *  - loading_runtime:    `pipeline()`, bounded by `RUNTIME_LOAD_TIMEOUT_MS`
 *                         in `phoneLlmRunner.ts` — reads back from
 *                         IndexedDB via `env.customCache`, no network.
 * RETRY = pressing "MODELİ İNDİR" again — safe at any point: CHECK_STORAGE
 * re-runs first and only re-fetches chunks that are missing or were
 * deleted for failing verification; nothing already-good is re-downloaded.
 * RECOVERY = the above, plus: `useScreenWakeLock` holds the screen on for
 * the ENTIRE active pipeline (not just this page's own concern — a real,
 * evidenced root cause of prior stalls) and `watchPhoneLlmVisibility`
 * records every backgrounding transition so a stall's cause is legible on
 * the next visit instead of guessed at again.
 */
type LoadState =
  | "idle"
  | "check_storage"
  | "downloading"
  | "persisting"
  | "verifying"
  | "model_ready_to_load"
  | "loading_runtime"
  | "ready"
  | "error";

const LOAD_STATE_RANK: Record<LoadState, number> = {
  idle: 0,
  check_storage: 1,
  downloading: 2,
  persisting: 3,
  verifying: 4,
  model_ready_to_load: 5,
  loading_runtime: 6,
  ready: 7,
  error: -1,
};

function isPipelineActive(state: LoadState): boolean {
  return state !== "idle" && state !== "ready" && state !== "error";
}

/**
 * Narrows one raw progress event (real Transformers.js statuses, plus the
 * two synthetic "persisting"/"verifying" markers `phoneLlmPrecacheDownloader.ts`
 * emits — see `phoneLlmRunner.ts`'s `AyasPhoneLlmLoadProgress` doc) into the
 * next `LoadState`. Rank-guarded: never regresses a further-along state —
 * this is what makes it safe for `runner.load()`'s OWN cache-hit progress
 * events (fired during the `loading_runtime` phase, using the plain
 * "download"/"progress"/"done" statuses) to flow through the SAME handler
 * the pre-cache phase uses, without ever pulling the UI backward once
 * `loading_runtime` has been explicitly entered by the caller.
 */
function nextLoadStateFromProgress(current: LoadState, progress: AyasPhoneLlmLoadProgress): LoadState {
  const advance = (next: LoadState) => (LOAD_STATE_RANK[next] > LOAD_STATE_RANK[current] ? next : current);
  switch (progress.status) {
    case "initiate":
    case "download":
    case "progress":
    case "progress_total":
      return advance("downloading");
    case "persisting":
      return advance("persisting");
    case "verifying":
      return advance("verifying");
    default:
      // "done"/"ready" don't drive a transition here — the caller
      // (handleDownload / the rehydrate effect) explicitly sets
      // model_ready_to_load / loading_runtime / ready at each real
      // phase boundary; this mapper only needs to track WITHIN-phase
      // progress (which file, how far).
      return current;
  }
}

interface ModelRunRecord {
  readonly downloadedAt: string;
  readonly loadMs: number;
  readonly firstTokenMs: number | null;
  readonly totalMs: number;
  readonly tokenCount: number;
  readonly tokPerSec: number | null;
  readonly lastAnswer: string;
}

const PRESET_PROMPTS = [
  { label: "SIMPLE — Merhaba AYAS", text: "Merhaba AYAS" },
  { label: "NORMAL — Çalışma planı", text: "Bugün için kısa bir çalışma planı oluştur." },
  { label: "Aritmetik — 5 + 7", text: "5 + 7 kaç eder?" },
];

function fmtMs(ms: number | null): string {
  return ms === null ? "—" : `${ms.toFixed(0)} ms`;
}

function fmtMemory(): string {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return "performance.memory desteklenmiyor (yalnızca Chrome'da var)";
  const usedMb = (mem.usedJSHeapSize / 1024 / 1024).toFixed(0);
  const limitMb = (mem.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
  return `${usedMb} MB / ${limitMb} MB (JS heap)`;
}

/** Model Status label — %100 download is never shown as READY; every real phase is its own distinct, honest label. */
const MODEL_STATUS_LABEL: Record<LoadState, string> = {
  idle: "NOT DOWNLOADED",
  check_storage: "KONTROL EDİLİYOR…",
  downloading: "DOWNLOADING",
  persisting: "KAYDEDİLİYOR…",
  verifying: "DOĞRULANIYOR…",
  model_ready_to_load: "İNDİRME TAMAMLANDI — RUNTIME BAŞLIYOR",
  loading_runtime: "MODEL HAZIRLANIYOR…",
  ready: "READY",
  error: "ERROR",
};

/** A specific, technical-but-readable line per failure reason — never a generic "bir şeyler ters gitti". */
const FAILURE_LABEL: Record<string, string> = {
  "offline-no-cache":
    "ÇEVRİMDIŞI ve bu model bu cihazda daha önce hiç indirilmemiş — önce internet varken bir kez indirilmesi gerekiyor.",
  "webgpu-allocation-failed":
    "WebGPU bellek ayırma hatası — GPU bu modeli şu an belleğe sığdıramadı (başka sekmeleri kapatıp tekrar deneyin, veya daha küçük modeli seçin).",
  "load-failed": "Model yüklenemedi.",
  "runtime-timeout":
    "Model çalışma zamanına yüklenirken zaman aşımına uğradı (WebGPU/ONNX oturumu kurulamadı ya da çok uzun sürdü). Tekrar deneyin; sorun sürerse cihaz bu modeli GPU belleğine sığdıramıyor olabilir.",
  "generation-failed": "Üretim (generation) sırasında hata oluştu.",
  disposed: "Bu oturum artık kullanılamıyor (sayfa yenilenmeli).",
  // Pre-cache phase (phoneLlmPrecacheDownloader.ts) failure reasons — IndexedDB, chunked (Cache Storage is retired for model weights):
  "network-error": "İndirme sırasında ağ hatası oluştu.",
  "fetch-timeout": "Ağ isteği yanıt vermedi (zaman aşımı) — bağlantıyı kontrol edip tekrar deneyin.",
  "range-not-supported": "Sunucu parçalı indirmeyi (HTTP Range) beklenmedik şekilde desteklemedi — tekrar deneyin.",
  "storage-write-failed": "Cihaz deposuna (IndexedDB) yazılamadı (depolama alanı dolu olabilir).",
  "storage-write-timeout": "Cihaz deposuna yazma işlemi zaman aşımına uğradı. Tekrar deneyin.",
  "integrity-mismatch": "İndirilen dosya depoda bozuk/eksik bulundu — bozuk kayıt silindi, tekrar denediğinizde yeniden indirilecek.",
  "storage-unavailable":
    "LOCAL_MODEL_STORAGE_UNAVAILABLE — bu tarayıcı/ortamda IndexedDB kullanılamıyor, model kalıcı olarak saklanamaz. Bu deney başka bir depolama yedeğine dönmüyor.",
  "gateway-not-configured":
    "AYAS Gateway bu cihazda henüz yapılandırılmamış — doğrudan Hugging Face isteği bu cihazda Range'i onurlandırmıyor. Önce /brain?ayasPhoneKey=<key> bağlantısını bir kez açın, sonra tekrar deneyin.",
};

function describeFailure(reason: string, detail: string): string {
  return `${FAILURE_LABEL[reason] ?? "Bilinmeyen hata."} (${reason}: ${detail})`;
}

export function PhoneLlmLabClient() {
  const [runner] = useState(() => new AyasPhoneLlmRunner());

  const [capability, setCapability] = useState<AyasPhoneLlmCapabilityResult | "checking">("checking");
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  const [selectedModel, setSelectedModel] = useState<AyasPhoneLlmModelSpec>(AYAS_PHONE_LLM_MODELS[0]);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set([AYAS_PHONE_LLM_MODELS[0].id]));

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadProgress, setLoadProgress] = useState<AyasPhoneLlmLoadProgress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [cacheStatus, setCacheStatus] = useState<AyasPhoneLlmCacheStatus | "checking">("checking");

  // A checkpoint left over from a PRIOR attempt that never reached a clean
  // end ("ready" or a handled "error") is concrete evidence that attempt
  // was terminated abruptly. A lazy initializer (not an effect — avoids
  // react-hooks/set-state-in-effect) reads-and-clears it exactly once, on
  // this component's first render (client-only per this page's own
  // next/dynamic ssr:false boundary).
  const [staleCheckpoint] = useState<PhoneLlmStaleCheckpoint | null>(() => readAndClearStalePhoneLlmCheckpoints());

  const [genStats, setGenStats] = useState<{ firstTokenMs: number | null; totalMs: number; tokenCount: number } | null>(null);
  const [generating, setGenerating] = useState(false);

  // Screen Wake Lock: held for the WHOLE active pipeline (download through
  // runtime init) AND while generating — see file header for why this
  // exists. `wakeLockHeld` surfaces whether it's actually holding (Low
  // Power Mode / an unsupported context silently denies it) so the operator
  // knows whether this protection is actually active on their device.
  const [wakeLockHeld, setWakeLockHeld] = useState(false);
  useScreenWakeLock(isPipelineActive(loadState) || generating, setWakeLockHeld);

  // Every visibility transition becomes its own diagnostics checkpoint —
  // this is what turns a future stall into "stuck WHILE backgrounded" vs.
  // "stuck while foregrounded" instead of another guess.
  useEffect(() => watchPhoneLlmVisibility(selectedModel.id), [selectedModel.id]);

  // Best-effort: ask for persistent storage so the OS is less likely to
  // evict the cached model under storage pressure. Never gates anything —
  // Safari's grant behavior is known to be inconsistent; this is pure
  // hardening, not a dependency.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    navigator.storage
      .persist()
      .then((granted) => console.info(`[ayas phone-llm] navigator.storage.persist(): ${granted ? "granted" : "denied"}`))
      .catch(() => {});
  }, []);

  const handleProgress = useCallback((p: AyasPhoneLlmLoadProgress) => {
    setLoadProgress(p);
    setLoadState((prev) => nextLoadStateFromProgress(prev, p));
  }, []);

  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].text);
  const [output, setOutput] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [records, setRecords] = useState<Record<string, ModelRunRecord>>({});

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    detectAyasPhoneLlmCapability(window as never).then(setCapability);
  }, []);

  // Rehydrate Model Status from the ACTUAL browser cache — not from
  // in-memory `loadState`, which resets to "idle" on every reload. Checks
  // ALL required files, not just the .onnx — a "partial" cache is surfaced
  // distinctly and NEVER auto-loaded/treated as ready; the user presses
  // "MODELİ İNDİR" again to safely resume it. Only "complete" triggers the
  // automatic, no-network runtime load (never a forced re-download).
  useEffect(() => {
    if (capability === "checking" || !(capability as AyasPhoneLlmCapabilityResult).capable) return;
    let cancelled = false;
    getModelCacheStatus(selectedModel).then((status) => {
      if (cancelled) return;
      setCacheStatus(status);
      if (status !== "complete") return;
      setLoadState("loading_runtime");
      setLoadError(null);
      const started = performance.now();
      setAyasPhoneLlmDownloadActive(true);
      runner
        .load(selectedModel, handleProgress)
        .then((outcome) => {
          if (cancelled) return;
          clearPhoneLlmCheckpoints();
          if (!outcome.ok) {
            setLoadState("error");
            setLoadError(describeFailure(outcome.reason, outcome.detail));
            return;
          }
          setLoadMs(performance.now() - started);
          setLoadState("ready");
        })
        .finally(() => setAyasPhoneLlmDownloadActive(false));
    });
    return () => {
      cancelled = true;
    };
  }, [capability, selectedModel, runner, handleProgress]);

  useEffect(() => {
    return () => {
      void runner.dispose();
    };
  }, [runner]);

  const handleDownload = useCallback(async () => {
    setLoadState("check_storage");
    setLoadError(null);
    setLoadProgress(null);
    const started = performance.now();
    setAyasPhoneLlmDownloadActive(true);
    try {
      // PHASE downloading → verifying (per file, per 8MB chunk): Range-fetch
      // straight into IndexedDB — no full-file JS buffer, no single giant
      // storage write (the cause of the real-device cache-put-timeout Cache
      // Storage produced; Cache Storage is retired for model weights —
      // see phoneLlmPrecacheDownloader.ts's header for the full evidence).
      const precacheOutcome: AyasPhoneLlmPrecacheOutcome = await precacheModelFiles(selectedModel, handleProgress);
      if (!precacheOutcome.ok) {
        clearPhoneLlmCheckpoints(); // a handled failure — the page was alive to record it, not an abrupt termination
        setLoadState("error");
        setLoadError(describeFailure(precacheOutcome.reason, `${precacheOutcome.file ?? "?"}: ${precacheOutcome.detail}`));
        return;
      }
      setLoadState("model_ready_to_load");
      setCacheStatus("complete");
      // PHASE loading_runtime: every file is now cached AND verified — this
      // is a cache-only load, so the one buffer Transformers.js's
      // readResponse() still has to build happens as a fast local disk
      // read, not a slow network download, bounded by RUNTIME_LOAD_TIMEOUT_MS.
      setLoadState("loading_runtime");
      const outcome = await runner.load(selectedModel, handleProgress);
      clearPhoneLlmCheckpoints();
      if (!outcome.ok) {
        setLoadState("error");
        setLoadError(describeFailure(outcome.reason, outcome.detail));
        return;
      }
      setLoadMs(performance.now() - started);
      setLoadState("ready");
    } finally {
      setAyasPhoneLlmDownloadActive(false);
    }
  }, [selectedModel, runner, handleProgress]);

  /**
   * Deletes every required file's IndexedDB record for the selected model
   * (chunks + metadata) — for a clean re-download, or to reclaim device
   * storage. Never touches any other model's data, and deliberately does
   * NOT call `runner.dispose()` (that permanently bricks the runner
   * instance — `AyasPhoneLlmRunner.load()` already disposes any
   * previously-loaded generator on its own before loading again, so
   * nothing here needs to pre-empt that).
   */
  const handleDeleteModel = useCallback(async () => {
    for (const file of getRequiredModelCacheFiles(selectedModel)) {
      await deleteModelFile(buildRemoteResourceUrl(selectedModel, file)).catch(() => {});
    }
    clearPhoneLlmCheckpoints();
    setCacheStatus("none");
    setLoadState("idle");
    setLoadError(null);
    setLoadProgress(null);
  }, [selectedModel]);

  // Process-death diagnostic tools (closure sprint items 5/6/7): prove the
  // network↔IndexedDB chain step by step, WITHOUT committing to the full
  // ~460MB download, and separate "is the network/Range chain OK" from
  // "is IndexedDB itself OK on this device" — see
  // `phoneLlmDiagnosticTests.ts`'s header. Both write under a
  // `::diagnostic-*` key, never the real model's own storage key.
  const [networkDiagRunning, setNetworkDiagRunning] = useState(false);
  const [networkDiagResult, setNetworkDiagResult] = useState<SingleChunkNetworkDiagnosticResult | null>(null);
  const handleRunNetworkDiagnostic = useCallback(async () => {
    setNetworkDiagRunning(true);
    setNetworkDiagResult(null);
    try {
      setNetworkDiagResult(await runSingleChunkNetworkDiagnostic(selectedModel));
    } finally {
      setNetworkDiagRunning(false);
    }
  }, [selectedModel]);

  const [idbDiagRunning, setIdbDiagRunning] = useState(false);
  const [idbDiagResult, setIdbDiagResult] = useState<IdbOnlyDiagnosticResult | null>(null);
  const handleRunIdbDiagnostic = useCallback(async () => {
    setIdbDiagRunning(true);
    setIdbDiagResult(null);
    try {
      setIdbDiagResult(await runIdbOnlyDiagnostic());
    } finally {
      setIdbDiagRunning(false);
    }
  }, []);

  // HTTP Range blocker follow-up (real-device: iPhone/Chrome gets 200 +
  // Content-Range absent for the exact same Range request `curl` gets a
  // clean 206 for). Strictly read-only — see phoneLlmRangeDiagnostic.ts's
  // header — never reads a response body, never touches the real
  // download/storage path.
  const [rangeDiagRunning, setRangeDiagRunning] = useState(false);
  const [rangeDiagResult, setRangeDiagResult] = useState<RangeDiagnosisResult | null>(null);
  const handleRunRangeDiagnostic = useCallback(async () => {
    setRangeDiagRunning(true);
    setRangeDiagResult(null);
    try {
      setRangeDiagResult(await runRangeDiagnosis(selectedModel));
    } finally {
      setRangeDiagRunning(false);
    }
  }, [selectedModel]);

  const handleGenerate = useCallback(async () => {
    if (loadState !== "ready") return;
    setGenerating(true);
    setGenError(null);
    setOutput("");
    setGenStats(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await runner.generate(prompt, {
      signal: controller.signal,
      onDelta: (piece) => setOutput((prev) => prev + piece),
    });
    setGenerating(false);
    abortRef.current = null;
    clearPhoneLlmCheckpoints(); // generation:start/first-token/end recorded in phoneLlmRunner.ts — either outcome is a clean end
    if (!outcome.ok) {
      setGenError(describeFailure(outcome.reason, outcome.detail));
      return;
    }
    const tokPerSec = outcome.totalLatencyMs > 0 ? (outcome.tokenCount / outcome.totalLatencyMs) * 1000 : null;
    setGenStats({ firstTokenMs: outcome.firstTokenLatencyMs, totalMs: outcome.totalLatencyMs, tokenCount: outcome.tokenCount });
    setRecords((prev) => ({
      ...prev,
      [selectedModel.id]: {
        downloadedAt: new Date().toISOString(),
        loadMs: loadMs ?? 0,
        firstTokenMs: outcome.firstTokenLatencyMs,
        totalMs: outcome.totalLatencyMs,
        tokenCount: outcome.tokenCount,
        tokPerSec,
        lastAnswer: outcome.text,
      },
    }));
    // 0.5B başarılı bir üretim tamamladı → 1.5B'nin kilidi açılır.
    if (selectedModel.id === AYAS_PHONE_LLM_MODELS[0].id && AYAS_PHONE_LLM_MODELS[1]) {
      setUnlockedIds((prev) => new Set(prev).add(AYAS_PHONE_LLM_MODELS[1].id));
    }
  }, [loadState, prompt, selectedModel, loadMs, runner]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const capabilityReady = capability !== "checking";
  const isCapable = capabilityReady && (capability as AyasPhoneLlmCapabilityResult).capable;
  const pipelineActive = isPipelineActive(loadState);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>AYAS PHONE LOCAL LLM — EXPERIMENTAL</h1>
      <p style={{ color: "#a33", fontWeight: 600, marginTop: 4 }}>
        Bu deney PC&apos;ye, Cloudflare&apos;a veya OpenAI&apos;ye bağlı değildir.
      </p>
      <p style={{ fontSize: 13, opacity: 0.75 }}>
        Tier 2 fizibilite prototipi. Production &quot;/brain&quot; sohbetiyle hiçbir bağlantısı yok — burada üretilen
        yanıtlar hiçbir yere kaydedilmez, hiçbir provider/router&apos;a bağlanmaz.
      </p>
      {/*
       * Build marker (real-device deployment-staleness follow-up, 2026-09-11):
       * `NEXT_PUBLIC_ATOLYE_BUILD_MARKER` is a literal baked into this exact
       * client bundle at `next build` time (see next.config.ts's `env`) — it
       * can NEVER reflect a build newer than the one that produced this
       * bundle, unlike a runtime `fetch()`-based check, which could itself be
       * served by a stale process. A glance at this line on the phone's own
       * screen proves which build's JS actually reached it, without devtools.
       */}
      <p style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace", marginTop: 2 }}>
        build: {process.env.NEXT_PUBLIC_ATOLYE_BUILD_MARKER ?? "(bilinmiyor — dev sunucusu env değişkenini geçirmedi)"}
      </p>

      {staleCheckpoint && (
        <section style={{ marginTop: 12, padding: 12, border: "1px solid #a33", borderRadius: 8, background: "#fff5f5" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#a33" }}>Önceki deneme yarıda kesildi</h2>
          <p style={{ fontSize: 12, marginTop: 4 }}>
            Son bilinen aşama: <b>{staleCheckpoint.latest.name}</b>
            {staleCheckpoint.latest.chunkIndex !== null ? ` (chunk ${staleCheckpoint.latest.chunkIndex})` : ""}
            {staleCheckpoint.latest.file ? ` — ${staleCheckpoint.latest.file}` : ""}
            {staleCheckpoint.latest.percent !== null ? ` (%${staleCheckpoint.latest.percent.toFixed(0)})` : ""}
            {staleCheckpoint.latest.detail ? ` [${staleCheckpoint.latest.detail}]` : ""}, model{" "}
            {staleCheckpoint.latest.modelId ?? "—"}, {new Date(staleCheckpoint.latest.at).toLocaleTimeString("tr-TR")}.
            {wasLikelyBackgrounded(staleCheckpoint) ? (
              <>
                {" "}
                Kayıtlarda hemen öncesinde <b>sekme arka plana alınmış</b> (visibility:hidden) — bu genellikle
                ekranın kilitlenmesi/uygulamanın arka plana atılmasıyla iOS&apos;un sekmeyi askıya almasının işareti,
                bir hata değil. Ekranı açık tutmayı deneyin (bu sayfa artık indirme sırasında ekranı uyanık tutmaya
                çalışıyor).
              </>
            ) : (
              <>
                {" "}
                Sayfa bu noktadan sonra bir daha temiz şekilde bitiremeden yeniden başladı — arka plana alınma
                kaydı yok. Kesin sebep henüz belli değil; aşağıdaki tam kayıt (özellikle bellek örnekleri ve
                finalization satırları) teşhis için gerekli.
              </>
            )}
          </p>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 12, cursor: "pointer" }}>
              Tam checkpoint kaydı ({staleCheckpoint.history.length} satır) — teşhis için buradan kopyalayın
            </summary>
            <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", background: "#fff", padding: 6, marginTop: 4, maxHeight: 240, overflowY: "auto" }}>
              {staleCheckpoint.history
                .map(
                  (e) =>
                    `${new Date(e.at).toLocaleTimeString("tr-TR")} ${e.name}${e.chunkIndex !== null ? ` chunk=${e.chunkIndex}` : ""}${
                      e.detail ? ` [${e.detail}]` : ""
                    }`,
                )
                .join("\n")}
            </pre>
          </details>
        </section>
      )}

      <section style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>1 — Cihaz yeteneği</h2>
        {capability === "checking" && <p>Kontrol ediliyor…</p>}
        {capabilityReady && (
          <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
            <li>Browser: {(capability as AyasPhoneLlmCapabilityResult).userAgent ?? "—"}</li>
            <li>WebGPU: {isCapable ? "YES" : "NO"}</li>
            <li>GPU Adapter: {(capability as AyasPhoneLlmCapabilityResult).adapterVendor ?? "—"}</li>
            <li>WASM fallback: {(capability as AyasPhoneLlmCapabilityResult).wasmAvailable ? "YES" : "NO"}</li>
            <li style={{ opacity: 0.7 }}>
              (ayrıntı: secure-context {String((capability as AyasPhoneLlmCapabilityResult).secureContext)}, adapter{" "}
              {String((capability as AyasPhoneLlmCapabilityResult).adapterObtained)}, device{" "}
              {String((capability as AyasPhoneLlmCapabilityResult).deviceObtained)}, deviceMemory{" "}
              {(capability as AyasPhoneLlmCapabilityResult).deviceMemoryGb ?? "—"} GB)
            </li>
            <li>online (yalnızca bilgi amaçlı — üretimi engellemez): {String(online)}</li>
            <li>
              Ekran uyanık tutma (Wake Lock):{" "}
              {pipelineActive || generating ? (wakeLockHeld ? "AKTİF" : "istendi ama alınamadı (Düşük Güç Modu olabilir)") : "gerekli değil şu an"}
            </li>
          </ul>
        )}
        {capabilityReady && !isCapable && (
          <p style={{ color: "#a33", fontWeight: 700, marginTop: 8 }}>
            {AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE}
            <br />
            <span style={{ fontWeight: 400, fontSize: 12 }}>
              neden: {(capability as AyasPhoneLlmCapabilityResult).reason} — {(capability as AyasPhoneLlmCapabilityResult).detail}
            </span>
          </p>
        )}
      </section>

      {isCapable && (
        <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>2 — Model</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {AYAS_PHONE_LLM_MODELS.map((m) => {
              const unlocked = unlockedIds.has(m.id);
              return (
                <button
                  key={m.id}
                  disabled={!unlocked}
                  onClick={() => {
                    setSelectedModel(m);
                    setLoadState("idle");
                    setLoadProgress(null);
                  }}
                  style={{
                    padding: "6px 10px",
                    border: selectedModel.id === m.id ? "2px solid #333" : "1px solid #ccc",
                    borderRadius: 6,
                    opacity: unlocked ? 1 : 0.4,
                    cursor: unlocked ? "pointer" : "not-allowed",
                  }}
                  title={unlocked ? "" : "Önce 0.5B ile en az bir başarılı üretim gerekiyor"}
                >
                  {m.label} ({m.approxSizeLabel}, {m.license})
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button
              onClick={handleDownload}
              disabled={pipelineActive}
              style={{ padding: "8px 16px", fontWeight: 700, borderRadius: 6, border: "1px solid #333" }}
            >
              MODELİ İNDİR ({selectedModel.label})
            </button>
            {(cacheStatus === "partial" || cacheStatus === "complete") && !pipelineActive && (
              <button
                onClick={handleDeleteModel}
                title="Bu cihazdaki kayıtlı modeli sil (IndexedDB) — temiz bir yeniden indirme için"
                style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #a33", color: "#a33", fontSize: 12 }}
              >
                Modeli Sil
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Yaklaşık boyut: {selectedModel.approxSizeLabel}. İndirme yalnızca bu düğmeye basınca başlar — sayfa
            açıldığında otomatik başlamaz. Depolama: cihazın IndexedDB&apos;si (Cache Storage kullanılmıyor).
          </p>

          {/* navigator.onLine is informational-only (never a hard gate) — this hint only ever ADDS information, it never disables the button above. */}
          {!online && cacheStatus === "none" && loadState === "idle" && (
            <p style={{ fontSize: 12, color: "#a33", marginTop: 4 }}>
              ÇEVRİMDIŞI — bu model bu cihazda henüz hiç indirilmemiş. Local generation için önce internet varken bir
              kez indirilmesi gerekiyor.
            </p>
          )}
          {cacheStatus === "partial" && loadState === "idle" && (
            <p style={{ fontSize: 12, color: "#a70", marginTop: 4 }}>
              Önceki indirme tamamlanmamış (kısmi indirme, cihazda kısmen kayıtlı). &quot;MODELİ İNDİR&quot;e basarak
              güvenle tamamlayabilirsiniz — zaten inen ve doğrulanmış parçalar tekrar indirilmez.
            </p>
          )}

          {pipelineActive && (
            <p style={{ fontSize: 13 }}>
              {MODEL_STATUS_LABEL[loadState]}
              {loadProgress && ` (${loadProgress.status} — ${loadProgress.file ?? "?"}`}
              {loadProgress?.percent !== null && loadProgress?.percent !== undefined
                ? ` — %${loadProgress.percent.toFixed(0)}`
                : ""}
              {loadProgress?.loadedBytes !== null &&
              loadProgress?.loadedBytes !== undefined &&
              loadProgress?.totalBytes !== null &&
              loadProgress?.totalBytes !== undefined
                ? ` (${(loadProgress.loadedBytes / 1024 / 1024).toFixed(1)}MB / ${(loadProgress.totalBytes / 1024 / 1024).toFixed(1)}MB)`
                : ""}
              {loadProgress && ")"}
            </p>
          )}
          {loadState === "ready" && <p style={{ color: "#2a2" }}>hazır — yükleme {fmtMs(loadMs)}</p>}
          {loadState === "error" && <p style={{ color: "#a33" }}>{loadError}</p>}
        </section>
      )}

      {isCapable && (
        <section style={{ marginTop: 16, padding: 12, border: "1px dashed #999", borderRadius: 8, background: "#fafafa" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>2b — Tanı Araçları (process-death diagnostic)</h2>
          <p style={{ fontSize: 12, opacity: 0.75 }}>
            460MB&apos;lık tam indirmeye girmeden, zincirin ayrı ayrı gerçekten çalıştığını kanıtlar. İkisi de kendi
            ayrı &quot;::diagnostic&quot; anahtarı altında çalışır — gerçek model indirmesine hiç dokunmaz.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              onClick={handleRunNetworkDiagnostic}
              disabled={networkDiagRunning || pipelineActive}
              style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #333" }}
            >
              {networkDiagRunning ? "Çalışıyor…" : "8MB Ağ + IndexedDB Testi"}
            </button>
            <button
              onClick={handleRunIdbDiagnostic}
              disabled={idbDiagRunning || pipelineActive}
              style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #333" }}
            >
              {idbDiagRunning ? "Çalışıyor…" : "Sadece IndexedDB Testi (ağ yok)"}
            </button>
            <button
              onClick={handleRunRangeDiagnostic}
              disabled={rangeDiagRunning || pipelineActive}
              style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #333" }}
            >
              {rangeDiagRunning ? "Çalışıyor…" : "Range Teşhisi (body okunmaz)"}
            </button>
          </div>

          {networkDiagResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <p style={{ fontWeight: 700, color: networkDiagResult.ok ? "#2a2" : "#a33" }}>
                8MB Ağ + IndexedDB: {networkDiagResult.ok ? "BAŞARILI" : "BAŞARISIZ"} ({networkDiagResult.totalMs.toFixed(0)} ms)
              </p>
              <ul style={{ lineHeight: 1.6, paddingLeft: 18 }}>
                {networkDiagResult.steps.map((s) => (
                  <li key={s.name} style={{ color: s.ok ? "#2a2" : "#a33" }}>
                    {s.ok ? "✓" : "✗"} {s.name}: {s.detail}
                  </li>
                ))}
              </ul>
              <p style={{ opacity: 0.75, marginTop: 4 }}>
                Yakalanan gerçek HTTP telemetrisi — HTTP {networkDiagResult.httpStatus ?? "—"}, Content-Range:{" "}
                {networkDiagResult.contentRangeHeader ?? "—"}, Access-Control-Allow-Origin: {networkDiagResult.corsOriginHeader ?? "—"},
                ETag: {networkDiagResult.etagHeader ?? "—"}.
              </p>
            </div>
          )}

          {idbDiagResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <p style={{ fontWeight: 700, color: idbDiagResult.ok ? "#2a2" : "#a33" }}>
                Sadece IndexedDB: {idbDiagResult.ok ? "BAŞARILI" : "BAŞARISIZ"} ({idbDiagResult.totalMs.toFixed(0)} ms)
              </p>
              <ul style={{ lineHeight: 1.6, paddingLeft: 18 }}>
                {idbDiagResult.steps.map((s) => (
                  <li key={s.name} style={{ color: s.ok ? "#2a2" : "#a33" }}>
                    {s.ok ? "✓" : "✗"} {s.name}: {s.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rangeDiagResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <p style={{ fontWeight: 700 }}>
                Range Teşhisi: A={rangeDiagResult.probeA.status ?? "—"}
                {rangeDiagResult.probeA.contentRangeHeader ? ` (206 doğru)` : rangeDiagResult.probeA.status === 200 ? " (Range yok sayıldı!)" : ""}
                , B={rangeDiagResult.probeB.status ?? "—"}
                {rangeDiagResult.probeB.contentRangeHeader ? ` (206 doğru)` : rangeDiagResult.probeB.status === 200 ? " (Range yok sayıldı!)" : ""}
                , C (gateway)=
                {rangeDiagResult.probeGateway
                  ? `${rangeDiagResult.probeGateway.status ?? "—"}${rangeDiagResult.probeGateway.contentRangeHeader ? " (206 doğru — gateway ÇALIŞIYOR)" : " (Range yok!)"}`
                  : "çalıştırılmadı (yapılandırılmamış)"}
              </p>
              <p style={{ opacity: 0.75, marginTop: 2 }}>
                Bu raporu AŞAĞIDAN kopyalayıp geliştiriciye gönderin — hiçbir response body okunmadı.
              </p>
              <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", background: "#fff", padding: 6, marginTop: 4, maxHeight: 320, overflowY: "auto", border: "1px solid #ddd" }}>
                {formatRangeDiagnosis(rangeDiagResult)}
              </pre>
            </div>
          )}
        </section>
      )}

      {loadState === "ready" && (
        <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>3 — Prompt</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {PRESET_PROMPTS.map((p) => (
              <button key={p.label} onClick={() => setPrompt(p.text)} style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #ccc" }}>
                {p.label}
              </button>
            ))}
          </div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ width: "100%", padding: 8 }} />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={handleGenerate} disabled={generating} style={{ padding: "8px 16px", fontWeight: 700, borderRadius: 6, border: "1px solid #333" }}>
              Gönder
            </button>
            {generating && (
              <button onClick={handleCancel} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #a33", color: "#a33" }}>
                İptal Et
              </button>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 8, background: "#f7f7f7", borderRadius: 6, minHeight: 40, whiteSpace: "pre-wrap", fontSize: 13 }}>
            {output || (generating ? "…" : "(henüz yanıt yok)")}
          </div>
          {genError && <p style={{ color: "#a33" }}>{genError}</p>}
        </section>
      )}

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>4 — Telemetri</h2>
        <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
          <li>Model: {selectedModel.label}</li>
          <li>Model Status: {MODEL_STATUS_LABEL[loadState]}</li>
          <li>First Token: {fmtMs(genStats?.firstTokenMs ?? null)}</li>
          <li>Total Time: {fmtMs(genStats?.totalMs ?? null)}</li>
          <li>Tokens: {genStats?.tokenCount ?? "—"}</li>
          <li>tok/s: {genStats && genStats.totalMs > 0 ? ((genStats.tokenCount / genStats.totalMs) * 1000).toFixed(2) : "—"}</li>
          <li>Error: {loadError ?? genError ?? "—"}</li>
          <li>bellek: {fmtMemory()}</li>
          <li>online/offline (yalnızca bilgi amaçlı): {online ? "online" : "OFFLINE"}</li>
          <li style={{ fontWeight: 700 }}>LOCAL ONLY: bu sayfada hiçbir AYAS/Worker/OpenAI ağ çağrısı yoktur (statik gerçek, kodda yok)</li>
        </ul>
      </section>

      {Object.keys(records).length > 0 && (
        <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>5 — 0.5B vs 1.5B karşılaştırma</h2>
          <table style={{ fontSize: 12, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Model</th>
                <th>Load</th>
                <th>First token</th>
                <th>Total</th>
                <th>Token</th>
                <th>tok/s</th>
              </tr>
            </thead>
            <tbody>
              {AYAS_PHONE_LLM_MODELS.map((m) => {
                const r = records[m.id];
                if (!r) return null;
                return (
                  <tr key={m.id}>
                    <td>{m.label}</td>
                    <td>{fmtMs(r.loadMs)}</td>
                    <td>{fmtMs(r.firstTokenMs)}</td>
                    <td>{fmtMs(r.totalMs)}</td>
                    <td>{r.tokenCount}</td>
                    <td>{r.tokPerSec?.toFixed(2) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
