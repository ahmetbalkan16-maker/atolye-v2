"use client";

/**
 * D2 AUDIO LAB — throwaway iOS installed-PWA audio feasibility probe (Phase 0).
 *
 * Branch: research/ayas-d2-audio-lab. NOT part of AYAS. NOT merged to any
 * production branch. It does not import or touch the AYAS voice engine, the
 * chat path, TTS, the execution gate, storage, Caddy, or .env.
 *
 * It proves ONE chain on a real iPhone, and nothing else:
 *
 *   installed PWA → one user gesture → getUserMedia({audio})
 *   → AudioContext.resume() → AudioWorklet.addModule → AudioWorkletNode
 *   → 16 kHz mono downsample → live RMS + sample counter → 5–10 min foreground
 *
 * Audio NEVER leaves the device: no upload, no MediaRecorder, no storage, no
 * network. The AudioWorklet posts only a low-rate { samples, rms } telemetry
 * message. The mic is monitored through a gain=0 node so there is no feedback.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type MicState = "off" | "requesting" | "on" | "denied" | "ended";
type WorkletState = "idle" | "loading" | "running" | "stopped";

interface Telemetry {
  readonly inSamples: number;
  readonly outSamples: number;
  readonly inRate: number;
  readonly outRate: number;
  readonly rms: number;
}

interface EnvFingerprint {
  readonly standalone: boolean;
  readonly displayMode: string;
  readonly secureContext: boolean;
  readonly userAgent: string;
  readonly hasGetUserMedia: boolean;
  readonly hasAudioContext: boolean;
  readonly hasAudioWorkletNode: boolean;
}

const WORKLET_URL = "/worklets/d2-audio-lab-processor.js";
const ZERO_TEL: Telemetry = { inSamples: 0, outSamples: 0, inRate: 0, outRate: 16000, rms: 0 };

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
type IosNavigator = Navigator & { standalone?: boolean };

/* ---- SSR-safe environment fingerprint (no effect, no hydration mismatch) ---- */

let ENV_CACHE: EnvFingerprint | null = null;

function envSnapshot(): EnvFingerprint | null {
  if (typeof window === "undefined") return null;
  if (ENV_CACHE) return ENV_CACHE;
  const w = window as WebkitWindow;
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
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    hasAudioContext:
      typeof window.AudioContext === "function" || typeof w.webkitAudioContext === "function",
    hasAudioWorkletNode: typeof AudioWorkletNode !== "undefined",
  };
  return ENV_CACHE;
}

const NO_SUBSCRIBE = () => () => {};

function hhmmss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function D2AudioLabPage() {
  const envFp = useSyncExternalStore<EnvFingerprint | null>(
    NO_SUBSCRIBE,
    envSnapshot,
    () => null,
  );
  const workletUnsupported = envFp ? !envFp.hasAudioWorkletNode : false;

  const [armed, setArmed] = useState(false);
  const [mic, setMic] = useState<MicState>("off");
  const [ctxState, setCtxState] = useState<string>("—");
  const [worklet, setWorklet] = useState<WorkletState>("idle");
  const [sampleRate, setSampleRate] = useState<number>(0);
  const [tel, setTel] = useState<Telemetry>(ZERO_TEL);
  const [elapsed, setElapsed] = useState(0);
  const [bgRecovery, setBgRecovery] = useState<string>("— (henüz arka plana alınmadı)");
  const [logLines, setLogLines] = useState<readonly string[]>([]);

  const acRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      for (const disconnectable of [srcRef.current, nodeRef.current, gainRef.current]) {
        try {
          disconnectable?.disconnect();
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
      if (ac && ac.state !== "closed") {
        ac.close().catch(() => {});
      }
      srcRef.current = null;
      nodeRef.current = null;
      gainRef.current = null;
      streamRef.current = null;
      acRef.current = null;
      setArmed(false);
      setMic((m) => (m === "denied" ? m : "off"));
      setWorklet("stopped");
      log(`teardown (${reason})`);
    },
    [log],
  );

  useEffect(() => () => teardown("unmount"), [teardown]);

  // Test G — background → foreground: record the AudioContext state on return.
  // setState here is inside an event callback (allowed), not the effect body.
  useEffect(() => {
    const onVisibility = () => {
      const ac = acRef.current;
      log(`visibility → ${document.visibilityState}${ac ? ` | AudioContext=${ac.state}` : ""}`);
      if (document.visibilityState !== "visible" || !ac) return;
      setBgRecovery(`foreground'a dönüldü — AudioContext="${ac.state}"`);
      if (ac.state !== "running") {
        ac.resume().then(
          () => {
            log("foreground sonrası AudioContext.resume() → running (jest gerekmedi)");
            setBgRecovery((b) => `${b} → resume() OK, jest gerekmedi`);
          },
          (error) => {
            log(`foreground sonrası AudioContext.resume() BAŞARISIZ: ${String(error)}`);
            setBgRecovery((b) => `${b} → resume() BAŞARISIZ (muhtemelen dokunuş gerekiyor)`);
          },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [log]);

  const arm = useCallback(async () => {
    // This function's synchronous head runs inside the click's user activation —
    // exactly what iOS requires for getUserMedia + AudioContext.resume().
    if (armed) return;
    setLogLines([]);
    setTel(ZERO_TEL);
    setBgRecovery("— (henüz arka plana alınmadı)");
    log("ARM: kullanıcı dokunuşu alındı");

    const w = window as WebkitWindow;
    const Ctor: typeof AudioContext | undefined =
      (typeof window.AudioContext === "function" ? window.AudioContext : undefined) ??
      w.webkitAudioContext;
    if (!Ctor) {
      log("BAŞARISIZ: AudioContext constructor yok");
      return;
    }
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      log("BAŞARISIZ: navigator.mediaDevices.getUserMedia yok");
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
      log(`AudioContext oluşturuldu: state=${ac.state} sampleRate=${ac.sampleRate}`);
    } catch (error) {
      log(`BAŞARISIZ: new AudioContext hata verdi: ${String(error)}`);
      return;
    }

    try {
      await ac.resume();
      log(`AudioContext.resume() → ${ac.state}`);
    } catch (error) {
      log(`AudioContext.resume() hata verdi: ${String(error)}`);
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
      log(`getUserMedia OK — track "${track?.label || "(etiket yok)"}" readyState=${track?.readyState}`);
      if (track) {
        track.onmute = () => log("track.onmute");
        track.onunmute = () => log("track.onunmute");
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
      const src = ac.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ac, "d2-audio-lab-processor");
      const gain = ac.createGain();
      gain.gain.value = 0; // no mic monitoring — silence, no feedback
      node.port.onmessage = (event: MessageEvent<Telemetry>) => setTel(event.data);
      node.onprocessorerror = () => log("AudioWorkletNode onprocessorerror");
      src.connect(node);
      node.connect(gain);
      gain.connect(ac.destination);
      srcRef.current = src;
      nodeRef.current = node;
      gainRef.current = gain;
      setWorklet("running");
      log("graf bağlandı: source → worklet → gain(0) → destination");
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
    log("ARMED — ölçüm başladı");
  }, [armed, log]);

  const reportJson = useMemo(
    () =>
      JSON.stringify(
        {
          env: envFp,
          sampleRateHz: sampleRate,
          audioContextState: ctxState,
          worklet: workletUnsupported ? "unsupported" : worklet,
          mic,
          telemetry: tel,
          elapsedSeconds: elapsed,
          elapsedHms: hhmmss(elapsed),
          backgroundRecovery: bgRecovery,
          capturedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    [envFp, sampleRate, ctxState, worklet, workletUnsupported, mic, tel, elapsed, bgRecovery],
  );

  const rmsPct = Math.min(100, Math.round(tel.rms * 400));

  return (
    <div className="bc-shell" style={{ padding: 16, maxWidth: 640, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <p className="bc-brand__eyebrow">Atölye · araştırma</p>
        <h1 className="bc-brand__title" style={{ margin: "2px 0" }}>
          D2 AUDIO LAB
        </h1>
        <p className="bc-note" style={{ margin: 0 }}>
          Atılabilir iOS installed-PWA ses fizibilite testi (Faz 0). AYAS&apos;ın parçası değil. Ses
          cihazdan çıkmaz — yükleme yok, kayıt yok, depolama yok.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className="bc-btn"
          onClick={() => void arm()}
          disabled={armed || workletUnsupported}
          data-testid="d2-arm"
        >
          Sesli modu başlat
        </button>
        <button
          type="button"
          className="bc-btn bc-btn--ghost"
          onClick={() => teardown("kullanıcı durdurdu")}
          disabled={!armed}
          data-testid="d2-stop"
        >
          Durdur
        </button>
      </div>

      {workletUnsupported ? (
        <p className="bc-alert" role="alert" style={{ marginBottom: 16 }}>
          ⚠ Bu tarayıcıda <code>AudioWorkletNode</code> yok — D2 bu cihazda mümkün değil.
        </p>
      ) : null}

      <dl className="bc-kv" data-testid="d2-status">
        <dt>Mic</dt>
        <dd>{mic.toUpperCase()}</dd>
        <dt>AudioContext</dt>
        <dd>{ctxState}</dd>
        <dt>AudioWorklet</dt>
        <dd>{workletUnsupported ? "unsupported" : worklet}</dd>
        <dt>Sample rate (giriş)</dt>
        <dd>{sampleRate ? `${sampleRate} Hz` : "—"}</dd>
        <dt>Output</dt>
        <dd>
          {tel.outRate} Hz mono{" "}
          {tel.inRate ? `(oran ${(tel.inRate / tel.outRate).toFixed(3)}×)` : ""}
        </dd>
        <dt>RMS</dt>
        <dd>
          {tel.rms.toFixed(4)}
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
                width: `${rmsPct}%`,
                background: "var(--bc-accent-bright, #6cf)",
              }}
            />
          </span>
        </dd>
        <dt>Samples (16 kHz çıkış)</dt>
        <dd>{tel.outSamples.toLocaleString("tr-TR")}</dd>
        <dt>Samples (ham giriş)</dt>
        <dd>{tel.inSamples.toLocaleString("tr-TR")}</dd>
        <dt>Elapsed</dt>
        <dd>{hhmmss(elapsed)}</dd>
        <dt>Background recovery</dt>
        <dd>{bgRecovery}</dd>
      </dl>

      {envFp ? (
        <dl className="bc-kv" style={{ marginTop: 12, opacity: 0.85 }} data-testid="d2-env">
          <dt>Installed PWA?</dt>
          <dd>
            {envFp.standalone ? "EVET (standalone)" : `HAYIR (display-mode: ${envFp.displayMode})`}
          </dd>
          <dt>Secure context</dt>
          <dd>{envFp.secureContext ? "EVET (HTTPS)" : "HAYIR"}</dd>
          <dt>getUserMedia</dt>
          <dd>{envFp.hasGetUserMedia ? "var" : "YOK"}</dd>
          <dt>AudioContext</dt>
          <dd>{envFp.hasAudioContext ? "var" : "YOK"}</dd>
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
        data-testid="d2-report"
        style={{
          width: "100%",
          minHeight: 180,
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
        data-testid="d2-log"
        style={{
          maxHeight: 260,
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
    </div>
  );
}
