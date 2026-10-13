"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MediaStreamWorkletBackend } from "@/components/brain/voice/wakeWordVoiceAdapter";
import { LocalWhisperWakeListener, type LocalWakeSnapshot, type LocalWakeTranscript } from "@/components/brain/voice/wake/localWhisperWakeListener";

const EMPTY: LocalWakeSnapshot = { phase: "stopped", frames: 0, maxRms: 0, requests: 0, hits: 0, lastTranscript: "", lastReason: "", processingMs: 0 };

export default function LocalWakeLab() {
  const [consent, setConsent] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState(EMPTY);
  const [error, setError] = useState("");
  const listener = useRef<LocalWhisperWakeListener | null>(null);
  const backend = useRef<MediaStreamWorkletBackend | null>(null);
  const session = useRef(0);

  function stop() {
    session.current++;
    listener.current?.stop(); listener.current = null;
    backend.current?.dispose(); backend.current = null;
    setActive(false);
    setStatus(previous => ({ ...previous, phase: "stopped" }));
  }
  useEffect(() => () => {
    session.current++;
    listener.current?.stop();
    backend.current?.dispose();
  }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" || !backend.current) return;
      session.current++;
      listener.current?.stop(); listener.current = null;
      backend.current?.dispose(); backend.current = null;
      setActive(false); setStatus(previous => ({ ...previous, phase: "stopped" }));
      setError("Sayfa arka plana alındı; dönünce START ile yeniden başlatın.");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  async function start() {
    if (!consent || active || backend.current) return;
    const generation = ++session.current;
    setActive(true); setError(""); setStatus(EMPTY);
    const audio = new MediaStreamWorkletBackend();
    backend.current = audio;
    audio.prime(); // iPhone user gesture; no model load before microphone start.
    const probe = new LocalWhisperWakeListener({
      transcribe: async (wav, signal) => {
        const response = await fetch("/api/ayas/stt", {
          method: "POST", headers: { "Content-Type": "audio/wav", "X-AYAS-STT-Mode": "wake-probe" },
          body: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }), signal,
        });
        const result = await response.json() as LocalWakeTranscript & { error?: string };
        if (!response.ok) throw new Error(result.error ?? `stt-${response.status}`);
        return result;
      },
      onChange: s => { if (session.current === generation) setStatus(s); },
      onWake: () => {}, // Qualification only: no chat, TTS, project or execution.
    });
    listener.current = probe;
    try {
      await audio.start(frame => probe.accept(frame));
      if (session.current !== generation) { probe.stop(); audio.dispose(); return; }
      setStatus(probe.status);
    } catch (e) {
      probe.stop(); audio.dispose();
      if (session.current === generation) { listener.current = null; backend.current = null; setActive(false); setError(e instanceof Error ? e.message : "mic-start-failed"); }
    }
  }

  return <main className="bc-shell" style={{ maxWidth: 640, padding: 16, margin: "0 auto" }}>
    <h1>Yerel Whisper uyandırma denemesi</h1>
    <p>Konuşma parçaları uyandırmadan önce güvenli bağlantıyla kendi AYAS PC’nize gönderilir.
      Ücretsiz mevcut Whisper kullanılır. Bu deneme yalnız AYAS/AYAZ/HAYAS ile başlayan
      yeterli güvene sahip transcript’i sayar; komut çalıştırmaz, sohbet veya sesli yanıt başlatmaz.</p>
    <p>Telefon ekranı açıkken 10 kez, aralarında en az 4 saniye bırakarak “Ayas” deyin.
      Ardından “beyaz”, “hayat güzel” ve normal konuşma deneyin. Son transcript, neden ve hit sayısını kaydedin.
      Kısa tek kelime hatası hâlâ araştırılıyor; bu aday ana sesli oturumda etkin değildir.</p>
    <label><input type="checkbox" checked={consent} disabled={active} onChange={e => setConsent(e.target.checked)} /> Kısa konuşma parçalarının kendi PC’me gönderilmesini kabul ediyorum.</label>
    <div style={{ margin: "16px 0", display: "flex", gap: 12 }}>
      <button className="bc-btn" disabled={!consent || active} onClick={() => void start()}>START</button>
      <button className="bc-btn" disabled={!active} onClick={stop}>STOP</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <dl className="bc-kv" aria-live="polite">
      <dt>Durum</dt><dd>{status.phase}</dd>
      <dt>Kareler</dt><dd>{status.frames}</dd>
      <dt>En yüksek RMS</dt><dd>{status.maxRms.toFixed(4)}</dd>
      <dt>STT istekleri</dt><dd>{status.requests}</dd>
      <dt>Wake hits</dt><dd>{status.hits}</dd>
      <dt>Son transcript</dt><dd>{status.lastTranscript || "—"}</dd>
      <dt>Son neden</dt><dd>{status.lastReason || "—"}</dd>
      <dt>STT süresi</dt><dd>{status.processingMs} ms</dd>
    </dl>
    <Link href="/brain/voice-lab/wake">Akustik wake tanısına dön</Link>
  </main>;
}
