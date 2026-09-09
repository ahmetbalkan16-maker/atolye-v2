"use client";

/**
 * D2 WAKE LAB — throwaway wake-word feasibility probe (Phase 1).
 *
 * Branch: research/ayas-d2-audio-lab. NOT part of AYAS. NOT merged to any
 * production branch. Does not import or touch the AYAS voice engine, chat path,
 * TTS, execution gate, storage, Caddy, or .env.
 *
 * Phase 0 proved on a real iPhone installed PWA: one gesture → getUserMedia →
 * AudioContext → AudioWorklet → 48k→16k mono PCM → stable foreground → clean
 * background recovery. This lab reuses that exact chain and adds ONE layer:
 *
 *   16 kHz mono frames (80 ms) → main-thread WakeDetector.accept(frame) → event
 *
 * The bundled detector is a HEURISTIC SPEECH-BURST STUB — NOT a wake-word model.
 * It exists to prove the plumbing + measure the CPU / thermal / background cost
 * of running a continuous detector on the phone, and to de-risk the real engine
 * (openWakeWord / sherpa-onnx) integration in Phase 1b. It will fire on many
 * 2-syllable words; that is expected and says nothing about wake accuracy.
 *
 * NOTHING leaves the device: no upload, no MediaRecorder, no storage, no server
 * call, no chat, no TTS, no execution.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type MicState = "off" | "requesting" | "on" | "denied" | "ended";
type WorkletState = "idle" | "loading" | "running" | "stopped";

interface Telemetry {
  readonly inSamples: number;
  readonly outSamples: number;
  readonly frames: number;
  readonly inRate: number;
  readonly outRate: number;
  readonly rms: number;
}
type WorkletMessage =
  | { readonly type: "frame"; readonly samples: Float32Array }
  | ({ readonly type: "telemetry" } & Telemetry);

interface WakeEvent {
  readonly keyword: string;
  readonly score: number;
  readonly at: number;
}

interface WakeDetector {
  readonly name: string;
  readonly info: string;
  accept(frame: Float32Array): WakeEvent | null | Promise<WakeEvent | null>;
  reset(): void;
  init?(): Promise<void>;
  dispose?(): void;
}

/**
 * HEURISTIC SPEECH-BURST STUB. Detects a voiced burst bounded by silence whose
 * duration falls in the "AYAS" range (~160–900 ms). NOT a wake-word model —
 * plumbing + CPU probe only.
 */
class SpeechBurstStub implements WakeDetector {
  readonly name = "HEURISTIC-STUB";
  readonly info = "speech-burst VAD, tek nefeslik ~AYAS uzunluğu — gerçek wake-word modeli DEĞİL";
  private inBurst = false;
  private burstFrames = 0;
  private silenceFrames = 0;
  private peak = 0;
  private readonly openThreshold: () => number;

  constructor(openThreshold: () => number) {
    this.openThreshold = openThreshold;
  }

  private static rms(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  accept(frame: Float32Array): WakeEvent | null {
    const level = SpeechBurstStub.rms(frame);
    const open = this.openThreshold();
    const close = open * 0.5;

    if (!this.inBurst) {
      if (level >= open) {
        this.inBurst = true;
        this.burstFrames = 1;
        this.silenceFrames = 0;
        this.peak = level;
      }
      return null;
    }

    this.burstFrames += 1;
    if (level > this.peak) this.peak = level;

    if (level < close) {
      this.silenceFrames += 1;
      if (this.silenceFrames >= 3) {
        // ~240 ms trailing silence closes the burst
        const voicedMs = (this.burstFrames - this.silenceFrames) * 80;
        const event: WakeEvent | null =
          voicedMs >= 160 && voicedMs <= 900
            ? { keyword: `burst ${voicedMs}ms`, score: this.peak, at: Date.now() }
            : null;
        this.reset();
        return event;
      }
    } else {
      this.silenceFrames = 0;
    }

    if (this.burstFrames > 45) this.reset(); // 3.6 s cap — not a wake word
    return null;
  }

  reset(): void {
    this.inBurst = false;
    this.burstFrames = 0;
    this.silenceFrames = 0;
    this.peak = 0;
  }
}

/**
 * REAL openWakeWord "AYAS" detector — the production path. Loads the three ONNX
 * models from /wake/ via onnxruntime-web and runs the streaming pipeline. Needs
 * `public/wake/ayas.onnx` (train it) + `npx tsx scripts/setup-wake-assets.ts`.
 */
class OpenWakeWordDetector implements WakeDetector {
  readonly name = "openWakeWord";
  readonly info = "gerçek wake-word modeli (ONNX, onnxruntime-web) — /wake/ayas.onnx";
  private runner: import("@/components/brain/voice/wake/openWakeWordRunner").OpenWakeWordRunner | null = null;
  private lastFire = 0;
  constructor(private readonly threshold: () => number) {}
  async init(): Promise<void> {
    const { OpenWakeWordRunner } = await import("@/components/brain/voice/wake/openWakeWordRunner");
    this.runner = new OpenWakeWordRunner({
      melspectrogramUrl: "/wake/melspectrogram.onnx",
      embeddingUrl: "/wake/embedding_model.onnx",
      wakewordUrl: "/wake/ayas.onnx",
      wasmPaths: "/ort/",
    });
    await this.runner.init();
  }
  async accept(frame: Float32Array): Promise<WakeEvent | null> {
    if (!this.runner) return null;
    const score = await this.runner.accept(frame);
    if (score === null) return null;
    const now = Date.now();
    if (score >= this.threshold() && now - this.lastFire > 1500) {
      this.lastFire = now;
      return { keyword: "AYAS", score, at: now };
    }
    return null;
  }
  reset(): void {
    this.runner?.reset();
  }
  dispose(): void {
    this.runner?.dispose();
  }
}

/* ---- SSR-safe environment fingerprint (no effect, no hydration mismatch) ---- */

interface EnvFingerprint {
  readonly standalone: boolean;
  readonly displayMode: string;
  readonly secureContext: boolean;
  readonly userAgent: string;
  readonly hardwareConcurrency: number;
}
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type IosNavigator = Navigator & { standalone?: boolean };

let ENV_CACHE: EnvFingerprint | null = null;

function envSnapshot(): EnvFingerprint | null {
  if (typeof window === "undefined") return null;
  if (ENV_CACHE) return ENV_CACHE;
  const nav = navigator as IosNavigator;
  const displayMode =
    typeof window.matchMedia === "function"
      ? ["standalone", "fullscreen", "minimal-ui", "browser"].find((mode) =>
          window.matchMedia(`(display-mode: ${mode})`).matches,
        ) ?? "unknown"
      : "unknown";
  ENV_CACHE = {
    standalone: displayMode === "standalone" || nav.standalone === true,
    displayMode,
    secureContext: window.isSecureContext === true,
    userAgent: navigator.userAgent,
    hardwareConcurrency: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 0,
  };
  return ENV_CACHE;
}
const NO_SUBSCRIBE = () => () => {};

const WORKLET_URL = "/worklets/d2-wake-lab-processor.js";
const ZERO_TEL: Telemetry = { inSamples: 0, outSamples: 0, frames: 0, inRate: 0, outRate: 16000, rms: 0 };

function hhmmss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function D2WakeLabPage() {
  const envFp = useSyncExternalStore<EnvFingerprint | null>(NO_SUBSCRIBE, envSnapshot, () => null);

  const [engine, setEngine] = useState<"stub" | "openwakeword">("stub");
  const [armed, setArmed] = useState(false);
  const [mic, setMic] = useState<MicState>("off");
  const [ctxState, setCtxState] = useState<string>("—");
  const [worklet, setWorklet] = useState<WorkletState>("idle");
  const [sampleRate, setSampleRate] = useState<number>(0);
  const [tel, setTel] = useState<Telemetry>(ZERO_TEL);
  const [elapsed, setElapsed] = useState(0);
  const [threshold, setThreshold] = useState(0.012);
  const [hits, setHits] = useState(0);
  const [truePos, setTruePos] = useState(0);
  const [falsePos, setFalsePos] = useState(0);
  const [lastDetection, setLastDetection] = useState<string>("—");
  const [wakeScore, setWakeScore] = useState(0);
  const [sttState, setSttState] = useState<"idle" | "capturing" | "transcribing" | "done" | "error">("idle");
  const [lastTranscript, setLastTranscript] = useState<string>("—");
  const [bgRecovery, setBgRecovery] = useState<string>("— (henüz arka plana alınmadı)");
  const [logLines, setLogLines] = useState<readonly string[]>([]);
  const cmdRef = useRef<{ frames: Float32Array[]; ms: number; silence: number } | null>(null);

  const acRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const detectorRef = useRef<WakeDetector | null>(null);
  const thresholdRef = useRef(threshold);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  const log = useCallback((line: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogLines((prev) => [...prev.slice(-250), `${ts}  ${line}`]);
  }, []);

  const teardown = useCallback(
    (reason: string) => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        nodeRef.current?.port.postMessage("stop");
      } catch {
        /* ignore */
      }
      for (const node of [srcRef.current, nodeRef.current, gainRef.current]) {
        try {
          node?.disconnect();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
      const ac = acRef.current;
      if (ac && ac.state !== "closed") ac.close().catch(() => {});
      srcRef.current = null;
      nodeRef.current = null;
      gainRef.current = null;
      streamRef.current = null;
      acRef.current = null;
      detectorRef.current?.dispose?.();
      detectorRef.current = null;
      cmdRef.current = null;
      setArmed(false);
      setMic((m) => (m === "denied" ? m : "off"));
      setWorklet("stopped");
      log(`teardown (${reason})`);
    },
    [log],
  );

  useEffect(() => () => teardown("unmount"), [teardown]);

  // Test F — the wake detector's background → foreground behaviour.
  useEffect(() => {
    const onVisibility = () => {
      const ac = acRef.current;
      log(
        `visibility → ${document.visibilityState}` +
          (ac ? ` | AudioContext=${ac.state} worklet=${nodeRef.current ? "bağlı" : "yok"}` : ""),
      );
      if (document.visibilityState !== "visible" || !ac) return;
      setBgRecovery(`foreground'a dönüldü — AudioContext="${ac.state}"`);
      if (ac.state !== "running") {
        ac.resume().then(
          () => {
            log("foreground sonrası AudioContext.resume() → running (jest gerekmedi)");
            setBgRecovery((b) => `${b} → resume() OK; detector devam ediyor`);
          },
          (error) => {
            log(`foreground sonrası AudioContext.resume() BAŞARISIZ: ${String(error)}`);
            setBgRecovery((b) => `${b} → resume() BAŞARISIZ (platform davranışı — Faz 1'de çözülmeyecek)`);
          },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [log]);

  const runStt = useCallback(
    async (samples: Float32Array) => {
      setSttState("transcribing");
      try {
        const { encodeWav16kMono } = await import("@/components/brain/voice/wake/wav");
        const wav = encodeWav16kMono(samples);
        const res = await fetch("/api/ayas/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" }) });
        const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (res.ok && data.text) {
          setLastTranscript(data.text);
          setSttState("done");
          log(`STT -> "${data.text}"`);
        } else {
          setSttState("error");
          log(`STT error: ${res.status} ${data.error ?? ""}`);
        }
      } catch (e) {
        setSttState("error");
        log(`STT transport error: ${String(e)}`);
      }
    },
    [log],
  );

  const onWorkletMessage = useCallback(
    (event: MessageEvent<WorkletMessage>) => {
      const data = event.data;
      if (data.type === "telemetry") {
        setTel(data);
        return;
      }
      // data.type === "frame"
      const detector = detectorRef.current;
      if (!detector) return;

      // openWakeWord mode: after a hit, capture ~5 s / until silence, then STT.
      const cap = cmdRef.current;
      if (cap) {
        cap.frames.push(data.samples.slice(0));
        cap.ms += 80;
        let rms = 0;
        for (let i = 0; i < data.samples.length; i += 1) rms += data.samples[i] * data.samples[i];
        rms = Math.sqrt(rms / data.samples.length);
        cap.silence = rms < 0.012 ? cap.silence + 80 : 0;
        if (cap.ms >= 6000 || (cap.ms >= 400 && cap.silence >= 900)) {
          cmdRef.current = null;
          const merged = new Float32Array(cap.frames.reduce((n, f) => n + f.length, 0));
          let off = 0;
          for (const f of cap.frames) { merged.set(f, off); off += f.length; }
          detector.reset();
          void runStt(merged);
        }
        return;
      }

      void Promise.resolve(detector.accept(data.samples)).then((hit) => {
        if (hit && "score" in hit) setWakeScore(hit.score);
        if (!hit) return;
        setHits((n) => n + 1);
        const stamp = new Date(hit.at).toISOString().slice(11, 19);
        setLastDetection(`${stamp}  (${hit.keyword}, skor ${hit.score.toFixed(3)})`);
        log(`WAKE_DETECTED — ${hit.keyword} skor=${hit.score.toFixed(3)}`);
        if (detectorRef.current?.name === "openWakeWord") {
          cmdRef.current = { frames: [], ms: 0, silence: 0 };
          setSttState("capturing");
          setLastTranscript("—");
        }
      });
    },
    [log, runStt],
  );

  const arm = useCallback(async () => {
    if (armed) return;
    setLogLines([]);
    setTel(ZERO_TEL);
    setHits(0);
    setTruePos(0);
    setFalsePos(0);
    setLastDetection("—");
    setBgRecovery("— (henüz arka plana alınmadı)");
    log("ARM: kullanıcı dokunuşu alındı");

    const w = window as WebkitWindow;
    const Ctor: typeof AudioContext | undefined =
      (typeof window.AudioContext === "function" ? window.AudioContext : undefined) ?? w.webkitAudioContext;
    if (!Ctor) {
      log("BAŞARISIZ: AudioContext constructor yok");
      return;
    }
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      log("BAŞARISIZ: navigator.mediaDevices.getUserMedia yok");
      return;
    }
    if (typeof AudioWorkletNode === "undefined") {
      log("BAŞARISIZ: AudioWorkletNode yok — D2 bu cihazda mümkün değil");
      return;
    }

    let ac: AudioContext;
    try {
      ac = new Ctor();
      acRef.current = ac;
      setSampleRate(ac.sampleRate);
      setCtxState(ac.state);
      ac.onstatechange = () => {
        setCtxState(ac.state);
        log(`AudioContext state → ${ac.state}`);
      };
      log(`AudioContext: state=${ac.state} sampleRate=${ac.sampleRate}`);
    } catch (error) {
      log(`BAŞARISIZ: new AudioContext: ${String(error)}`);
      return;
    }

    try {
      await ac.resume();
      log(`AudioContext.resume() → ${ac.state}`);
    } catch (error) {
      log(`AudioContext.resume() hata: ${String(error)}`);
    }

    setMic("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setMic("on");
      const track = stream.getAudioTracks()[0];
      log(`getUserMedia OK — "${track?.label || "(etiket yok)"}" ${track?.readyState}`);
      if (track) {
        track.onended = () => {
          log("track.onended");
          setMic("ended");
        };
      }
    } catch (error) {
      const err = error as DOMException;
      setMic("denied");
      log(`getUserMedia BAŞARISIZ: ${err.name} — ${err.message}`);
      return;
    }

    setWorklet("loading");
    try {
      await ac.audioWorklet.addModule(WORKLET_URL);
      log("audioWorklet.addModule OK");
    } catch (error) {
      setWorklet("stopped");
      log(`audioWorklet.addModule BAŞARISIZ: ${String(error)}`);
      return;
    }

    try {
      const det: WakeDetector =
        engine === "openwakeword"
          ? new OpenWakeWordDetector(() => thresholdRef.current)
          : new SpeechBurstStub(() => thresholdRef.current);
      if (det.init) {
        log(`${det.name}: model yükleniyor...`);
        await det.init();
        log(`${det.name}: model hazır`);
      }
      detectorRef.current = det;
      cmdRef.current = null;
      setSttState("idle");
      const src = ac.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ac, "d2-wake-lab-processor");
      const gain = ac.createGain();
      gain.gain.value = 0;
      node.port.onmessage = onWorkletMessage;
      node.onprocessorerror = () => log("AudioWorkletNode onprocessorerror");
      src.connect(node);
      node.connect(gain);
      gain.connect(ac.destination);
      srcRef.current = src;
      nodeRef.current = node;
      gainRef.current = gain;
      setWorklet("running");
      log(`detector: ${detectorRef.current.name} — graf bağlandı`);
    } catch (error) {
      setWorklet("stopped");
      log(`graf bağlama BAŞARISIZ: ${String(error)}`);
      return;
    }

    startedAtRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    setArmed(true);
    log("ARMED — wake detector çalışıyor");
  }, [armed, engine, log, onWorkletMessage]);

  const classifyLast = useCallback(
    (correct: boolean) => {
      if (hits === 0) return;
      if (correct) setTruePos((n) => n + 1);
      else setFalsePos((n) => n + 1);
      log(`son tespit işaretlendi: ${correct ? "DOĞRU (AYAS)" : "YANLIŞ (AYAS değil)"}`);
    },
    [hits, log],
  );

  const reportJson = useMemo(
    () =>
      JSON.stringify(
        {
          engine,
          env: envFp,
          audio: {
            inputRateHz: sampleRate,
            outputRateHz: 16000,
            channels: 1,
            audioContextState: ctxState,
            worklet,
            framesProcessed: tel.frames,
          },
          detection: {
            threshold,
            hits,
            markedCorrect: truePos,
            markedWrong: falsePos,
            lastDetection,
            lastWakeScore: wakeScore,
          },
          stt: { state: sttState, lastTranscript },
          elapsedSeconds: elapsed,
          elapsedHms: hhmmss(elapsed),
          backgroundRecovery: bgRecovery,
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    [engine, envFp, sampleRate, ctxState, worklet, tel.frames, threshold, hits, truePos, falsePos, lastDetection, wakeScore, sttState, lastTranscript, elapsed, bgRecovery],
  );

  const rmsPct = Math.min(100, Math.round(tel.rms * 400));
  const thrPct = Math.min(100, Math.round(threshold * 400));

  return (
    <div className="bc-shell" style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <p className="bc-brand__eyebrow">Atölye · araştırma · D2 Faz 1</p>
        <h1 className="bc-brand__title" style={{ margin: "2px 0" }}>
          D2 WAKE LAB
        </h1>
        <p className="bc-note" style={{ margin: 0 }}>
          Atılabilir wake-word fizibilite testi. <strong>Motor: HEURISTIC-STUB</strong> — gerçek
          wake-word modeli değil; boru hattını + CPU/ısı/pil maliyetini ölçmek için. Gerçek motor
          (openWakeWord / sherpa-onnx) = Faz 1b. Ses cihazdan çıkmaz.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" className="bc-btn" onClick={() => void arm()} disabled={armed} data-testid="d2w-start">
          START
        </button>
        <button
          type="button"
          className="bc-btn bc-btn--ghost"
          onClick={() => teardown("kullanıcı durdurdu")}
          disabled={!armed}
          data-testid="d2w-stop"
        >
          STOP
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          <input
            type="radio"
            name="wake-engine"
            checked={engine === "stub"}
            disabled={armed}
            onChange={() => {
              setEngine("stub");
              setThreshold(0.012);
            }}
          />{" "}
          HEURISTIC-STUB (plumbing/CPU)
        </label>
        <label style={{ fontSize: 12 }}>
          <input
            type="radio"
            name="wake-engine"
            checked={engine === "openwakeword"}
            disabled={armed}
            onChange={() => {
              setEngine("openwakeword");
              setThreshold(0.5);
            }}
          />{" "}
          openWakeWord + STT (gerçek AYAS)
        </label>
      </div>

      <dl className="bc-kv" data-testid="d2w-engine">
        <dt>Wake Engine</dt>
        <dd>{engine === "openwakeword" ? "openWakeWord (ONNX)" : "HEURISTIC-STUB"}</dd>
        <dt>Engine status</dt>
        <dd>{armed ? "RUNNING" : worklet === "stopped" ? "stopped" : "idle"}</dd>
        <dt>Wake score (son frame)</dt>
        <dd>{wakeScore.toFixed(3)}</dd>
        <dt>STT state</dt>
        <dd>{sttState}</dd>
        <dt>Son transcript</dt>
        <dd style={{ wordBreak: "break-word" }}>{lastTranscript}</dd>
      </dl>

      <dl className="bc-kv" data-testid="d2w-audio" style={{ marginTop: 12 }}>
        <dt>Mic</dt>
        <dd>{mic.toUpperCase()}</dd>
        <dt>AudioContext</dt>
        <dd>{ctxState}</dd>
        <dt>AudioWorklet</dt>
        <dd>{worklet}</dd>
        <dt>Input rate</dt>
        <dd>{sampleRate ? `${sampleRate} Hz` : "—"}</dd>
        <dt>Output rate</dt>
        <dd>{tel.outRate} Hz</dd>
        <dt>Channels</dt>
        <dd>1 (mono)</dd>
        <dt>Frames processed</dt>
        <dd>{tel.frames.toLocaleString("tr-TR")}</dd>
        <dt>RMS</dt>
        <dd>
          {tel.rms.toFixed(4)}
          <Bar pct={rmsPct} />
        </dd>
      </dl>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="d2w-thr" className="bc-panel__title" style={{ display: "block", marginBottom: 4 }}>
          {engine === "openwakeword"
            ? `Wake threshold (model skoru 0-1): ${threshold.toFixed(2)}`
            : `Detection threshold (VAD open RMS): ${threshold.toFixed(3)}`}
        </label>
        <input
          id="d2w-thr"
          type="range"
          min={engine === "openwakeword" ? 0.2 : 0.004}
          max={engine === "openwakeword" ? 0.98 : 0.06}
          step={engine === "openwakeword" ? 0.01 : 0.001}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          style={{ width: "100%" }}
          data-testid="d2w-threshold"
        />
        <Bar pct={engine === "openwakeword" ? Math.round(threshold * 100) : thrPct} />
      </div>

      <dl className="bc-kv" data-testid="d2w-detection" style={{ marginTop: 14 }}>
        <dt>Wake hits</dt>
        <dd>{hits}</dd>
        <dt>İşaretli doğru (AYAS)</dt>
        <dd>{truePos}</dd>
        <dt>İşaretli yanlış (false positive)</dt>
        <dd>{falsePos}</dd>
        <dt>Last detection</dt>
        <dd>{lastDetection}</dd>
        <dt>Elapsed</dt>
        <dd>{hhmmss(elapsed)}</dd>
        <dt>Background recovery</dt>
        <dd>{bgRecovery}</dd>
        <dt>CPU observation</dt>
        <dd>[operatör — cihazda gözlemle]</dd>
      </dl>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="bc-btn bc-btn--ghost"
          onClick={() => classifyLast(true)}
          disabled={hits === 0}
          data-testid="d2w-mark-correct"
        >
          ✓ son tespit = AYAS
        </button>
        <button
          type="button"
          className="bc-btn bc-btn--ghost"
          onClick={() => classifyLast(false)}
          disabled={hits === 0}
          data-testid="d2w-mark-wrong"
        >
          ✗ son tespit = AYAS değildi
        </button>
      </div>

      {envFp ? (
        <dl className="bc-kv" style={{ marginTop: 14, opacity: 0.85 }} data-testid="d2w-env">
          <dt>Installed PWA?</dt>
          <dd>{envFp.standalone ? "EVET (standalone)" : `HAYIR (${envFp.displayMode})`}</dd>
          <dt>Secure context</dt>
          <dd>{envFp.secureContext ? "EVET (HTTPS)" : "HAYIR"}</dd>
          <dt>hardwareConcurrency</dt>
          <dd>{envFp.hardwareConcurrency || "—"}</dd>
          <dt>User-Agent</dt>
          <dd style={{ wordBreak: "break-all", fontSize: 11 }}>{envFp.userAgent}</dd>
        </dl>
      ) : null}

      <p className="bc-panel__title" style={{ margin: "16px 0 6px" }}>
        Rapor snapshot (operatör kopyalasın)
      </p>
      <textarea
        readOnly
        value={reportJson}
        data-testid="d2w-report"
        style={{
          width: "100%",
          minHeight: 200,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          padding: 8,
          background: "var(--bc-bg-elev, #0b0d12)",
          color: "var(--bc-text, #dfe3ea)",
          border: "1px solid var(--bc-border, #333)",
          borderRadius: 8,
        }}
      />

      <p className="bc-panel__title" style={{ margin: "16px 0 6px" }}>
        Olay günlüğü
      </p>
      <pre
        data-testid="d2w-log"
        style={{
          maxHeight: 240,
          overflow: "auto",
          fontSize: 11,
          lineHeight: 1.5,
          padding: 8,
          background: "var(--bc-bg-elev, #0b0d12)",
          color: "var(--bc-text-dim, #aab)",
          border: "1px solid var(--bc-border, #333)",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
        }}
      >
        {logLines.length ? logLines.join("\n") : "(henüz olay yok)"}
      </pre>

      <p className="bc-note" style={{ marginTop: 16 }}>
        <strong>Faz 1b (gerçek motor):</strong> WASM + ONNX asset&apos;leri{" "}
        <code>/public/wake/</code> altına konur (git&apos;e eklenmez — <code>.gitignore</code>).
        Motor kararı (openWakeWord eğitim adımı kabul / sherpa-onnx İngilizce-model riski kabul)
        yönetmene aittir — rapora bakın.
      </p>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        marginLeft: 8,
        width: 120,
        height: 8,
        verticalAlign: "middle",
        background: "var(--bc-border, #333)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${pct}%`,
          background: "var(--bc-accent-bright, #6cf)",
        }}
      />
    </span>
  );
}
