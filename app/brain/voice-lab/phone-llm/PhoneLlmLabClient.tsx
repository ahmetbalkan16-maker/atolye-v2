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
 * (`openWakeWordRunner.ts`) either, so it can never affect it. The only new
 * runtime dependency this page pulls in is `@huggingface/transformers`, via
 * `phoneLlmRunner.ts`.
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
 * `navigator.onLine` below is DISPLAY-ONLY (spec §E) — it never gates
 * `handleDownload`/`handleGenerate`. A stale/incorrect `onLine` reading (a
 * known browser quirk) must never block a working local model.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  detectAyasPhoneLlmCapability,
  AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE,
  type AyasPhoneLlmCapabilityResult,
} from "@/components/brain/voice/localLlm/phoneLlmCapability";
import {
  AyasPhoneLlmRunner,
  AYAS_PHONE_LLM_MODELS,
  isModelCached,
  type AyasPhoneLlmModelSpec,
  type AyasPhoneLlmLoadProgress,
} from "@/components/brain/voice/localLlm/phoneLlmRunner";

type LoadState = "idle" | "loading" | "ready" | "error";

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

/** Model Status label (spec §B: NOT DOWNLOADED / DOWNLOADING / READY / ERROR). */
const MODEL_STATUS_LABEL: Record<LoadState, string> = {
  idle: "NOT DOWNLOADED",
  loading: "DOWNLOADING",
  ready: "READY",
  error: "ERROR",
};

/** A specific, technical-but-readable line per failure reason (spec §G) — never a generic "bir şeyler ters gitti". */
const FAILURE_LABEL: Record<string, string> = {
  "offline-no-cache":
    "ÇEVRİMDIŞI ve bu model bu cihazda daha önce hiç indirilmemiş — önce internet varken bir kez indirilmesi gerekiyor.",
  "webgpu-allocation-failed":
    "WebGPU bellek ayırma hatası — GPU bu modeli şu an belleğe sığdıramadı (başka sekmeleri kapatıp tekrar deneyin, veya daha küçük modeli seçin).",
  "load-failed": "Model yüklenemedi.",
  "generation-failed": "Üretim (generation) sırasında hata oluştu.",
  disposed: "Bu oturum artık kullanılamıyor (sayfa yenilenmeli).",
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

  const [prompt, setPrompt] = useState(PRESET_PROMPTS[0].text);
  const [output, setOutput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genStats, setGenStats] = useState<{ firstTokenMs: number | null; totalMs: number; tokenCount: number } | null>(null);
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

  // Rehydrate Model Status from the ACTUAL browser cache — not from in-memory
  // `loadState`, which resets to "idle" on every reload (a real reload can
  // happen for reasons outside this page's control — an SW update, iOS memory
  // pressure, …). A cache hit here means the file was already fully
  // downloaded in a past session; loading it now is a normal, fast,
  // no-network `runner.load()` — never a forced re-download (spec §5).
  useEffect(() => {
    if (capability === "checking" || !(capability as AyasPhoneLlmCapabilityResult).capable) return;
    let cancelled = false;
    isModelCached(selectedModel).then((cached) => {
      if (cancelled || !cached) return;
      setLoadState("loading");
      setLoadError(null);
      const started = performance.now();
      runner.load(selectedModel, setLoadProgress).then((outcome) => {
        if (cancelled) return;
        if (!outcome.ok) {
          setLoadState("error");
          setLoadError(describeFailure(outcome.reason, outcome.detail));
          return;
        }
        setLoadMs(performance.now() - started);
        setLoadState("ready");
      });
    });
    return () => {
      cancelled = true;
    };
  }, [capability, selectedModel, runner]);

  useEffect(() => {
    return () => {
      void runner.dispose();
    };
  }, [runner]);

  const handleDownload = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    setLoadProgress(null);
    const started = performance.now();
    const outcome = await runner.load(selectedModel, setLoadProgress);
    if (!outcome.ok) {
      setLoadState("error");
      setLoadError(describeFailure(outcome.reason, outcome.detail));
      return;
    }
    setLoadMs(performance.now() - started);
    setLoadState("ready");
  }, [selectedModel, runner]);

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
    // 0.5B başarılı bir üretim tamamladı → 1.5B'nin kilidi açılır (spec §3/§15).
    if (selectedModel.id === AYAS_PHONE_LLM_MODELS[0].id && AYAS_PHONE_LLM_MODELS[1]) {
      setUnlockedIds((prev) => new Set(prev).add(AYAS_PHONE_LLM_MODELS[1].id));
    }
  }, [loadState, prompt, selectedModel, loadMs, runner]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const capabilityReady = capability !== "checking";
  const isCapable = capabilityReady && (capability as AyasPhoneLlmCapabilityResult).capable;

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

          <button
            onClick={handleDownload}
            disabled={loadState === "loading"}
            style={{ marginTop: 12, padding: "8px 16px", fontWeight: 700, borderRadius: 6, border: "1px solid #333" }}
          >
            MODELİ İNDİR ({selectedModel.label})
          </button>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Yaklaşık boyut: {selectedModel.approxSizeLabel}. İndirme yalnızca bu düğmeye basınca başlar — sayfa
            açıldığında otomatik başlamaz.
          </p>

          {loadState === "loading" && loadProgress && (
            <p style={{ fontSize: 13 }}>
              {loadProgress.status} — {loadProgress.file ?? "?"}
              {loadProgress.percent !== null ? ` — %${loadProgress.percent.toFixed(0)}` : ""}
              {loadProgress.loadedBytes !== null && loadProgress.totalBytes !== null
                ? ` (${(loadProgress.loadedBytes / 1024 / 1024).toFixed(1)}MB / ${(loadProgress.totalBytes / 1024 / 1024).toFixed(1)}MB)`
                : ""}
            </p>
          )}
          {loadState === "ready" && <p style={{ color: "#2a2" }}>hazır — yükleme {fmtMs(loadMs)}</p>}
          {loadState === "error" && <p style={{ color: "#a33" }}>{loadError}</p>}
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
