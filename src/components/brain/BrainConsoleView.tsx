/**
 * AYAS / Brain Core — command-center view (Sprint 186).
 *
 * Pure presentational. Renders the living orb, the AYAS status line, minimal
 * snapshot-only status cards, the execution-gate badge, and the command-center
 * panel (chat / tasks / memory / autonomous / research / production / learning /
 * safety). Interaction handlers + the voice/autonomous view are optional so
 * `renderToStaticMarkup` can render it with data alone.
 *
 * Never fabricates data: a panel or card with no backing state renders an
 * honest "Not connected" / empty state.
 */

import { BrainCoreOrb } from "./BrainCoreOrb";
import {
  BRAIN_PANELS,
  findBrainPanel,
  mapTaskStatusToDisplay,
  type BrainChatMessage,
  type BrainCoreState,
  type BrainPanelId,
} from "./brainCore";
import { describeAyasVoiceState, type AyasVoiceCapability, type AyasVoiceState } from "./ayasVoice";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasAutonomousView } from "@/lib/brain/autonomy/AyasAutonomousView";

export interface BrainConsoleVoiceView {
  readonly state: AyasVoiceState;
  readonly capability: AyasVoiceCapability;
  /** Voice INPUT (wake word) mode is on. */
  readonly listening: boolean;
  /** Voice OUTPUT (auto-speech) is muted. */
  readonly muted: boolean;
  readonly disclosureAccepted: boolean;
  readonly errorMessage?: string | null;
  readonly pendingSpeech?: string | null;
  readonly voiceName?: string | null;
  readonly voiceTier?: string | null;
  readonly onToggleListening?: () => void;
  readonly onToggleMute?: () => void;
  readonly onAcceptDisclosure?: () => void;
  readonly onReplayPendingSpeech?: () => void;
}

export interface BrainConsoleViewProps {
  readonly snapshot: BrainConsoleSnapshot;
  readonly coreState: BrainCoreState;
  readonly activePanel: BrainPanelId;
  readonly messages: readonly BrainChatMessage[];
  readonly draft?: string;
  readonly refreshing?: boolean;
  /** `true` while a chat reply is in flight. */
  readonly chatPending?: boolean;
  /** Whether the local model backend is configured (drops the "not connected" note). */
  readonly modelConfigured?: boolean;
  /** Where the last chat reply came from. */
  readonly lastReplySource?: "llm" | "fallback";
  readonly autonomous?: AyasAutonomousView;
  readonly voice?: BrainConsoleVoiceView;
  readonly onSelectPanel?: (id: BrainPanelId) => void;
  readonly onDraftChange?: (value: string) => void;
  readonly onSend?: () => void;
  readonly onRefresh?: () => void;
}

export function BrainConsoleView(props: BrainConsoleViewProps) {
  const { snapshot, coreState, activePanel } = props;

  return (
    <div className="bc-shell">
      <header className="bc-topbar">
        <div className="bc-brand">
          <p className="bc-brand__eyebrow">Atölye</p>
          <h1 className="bc-brand__title">AYAS</h1>
          <p className="bc-brand__sub">
            <span className={`bc-online bc-online--${coreState}`} aria-hidden="true" />
            {onlineLabel(coreState)} · Brain Core
          </p>
        </div>
        <span className="bc-gate" title="AYAS has no production / GPU / model-execution authority.">
          <span className="bc-gate__lock" aria-hidden="true" />
          ⛨ Yürütme kapısı: {snapshot.executionGate}
        </span>
      </header>

      <div className="bc-main">
        <section className="bc-stage" aria-label="AYAS Core">
          <div className="bc-stage__orb">
            <BrainCoreOrb state={coreState} showLabel={false} />
          </div>

          <div className="bc-stateline">
            <span className="bc-stateline__label">{stateLabel(coreState)}</span>
            <span className="bc-stateline__sep" aria-hidden="true">·</span>
            <span className="bc-stateline__tr">{stateTr(coreState)}</span>
          </div>
          <p className="bc-character">{stateCharacter(coreState)}</p>

          {snapshot.errors.length > 0 ? (
            <div className="bc-alert" role="alert">
              {snapshot.errors.map((error, index) => (
                <div key={index}>⚠ {error}</div>
              ))}
            </div>
          ) : null}

          <StatusCards snapshot={snapshot} autonomous={props.autonomous} />

          <button
            type="button"
            className="bc-btn bc-btn--ghost"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            data-testid="bc-refresh"
          >
            {props.refreshing ? "Yenileniyor…" : "Durumu yenile"}
          </button>
        </section>

        <section className="bc-panel" aria-label="AYAS command center">
          <div className="bc-panel__head">
            <p className="bc-panel__title">Command Center</p>
            <span className="bc-panel__title" aria-hidden="true">{activePanel}</span>
          </div>

          <nav className="bc-tabs" role="tablist" aria-label="AYAS panels">
            {BRAIN_PANELS.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="tab"
                aria-selected={panel.id === activePanel}
                className="bc-tab"
                onClick={() => props.onSelectPanel?.(panel.id)}
                data-testid={`bc-tab-${panel.id}`}
              >
                <span className="bc-tab__icon" aria-hidden="true">{panel.icon}</span>
                {panel.label}
                {panel.connected ? null : <span className="bc-tab__off">off</span>}
              </button>
            ))}
          </nav>

          <div className="bc-tabpanel" role="tabpanel" data-panel={activePanel}>
            <PanelBody {...props} />
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- state helpers --- */

function onlineLabel(state: BrainCoreState): string {
  if (state === "error") return "DEGRADED";
  if (state === "warning") return "ATTENTION";
  if (state === "autonomous") return "AUTONOMOUS";
  if (state === "listening") return "LISTENING";
  if (state === "speaking") return "SPEAKING";
  return "ONLINE";
}
function stateLabel(state: BrainCoreState): string {
  return {
    idle: "Idle", active: "Active", thinking: "Thinking", learning: "Learning",
    working: "Working", warning: "Warning", error: "Error",
    listening: "Listening", speaking: "Speaking", autonomous: "Autonomous",
  }[state];
}
function stateTr(state: BrainCoreState): string {
  return {
    idle: "Hazır", active: "Etkin", thinking: "Düşünüyor", learning: "Öğreniyor",
    working: "Çalışıyor", warning: "Uyarı", error: "Hata",
    listening: "Dinliyor", speaking: "Konuşuyor", autonomous: "Otonom",
  }[state];
}
function stateCharacter(state: BrainCoreState): string {
  return {
    idle: "Sakin nefes alan çekirdek — beklemede.",
    active: "Girdini alıyor — enerji canlanıyor.",
    thinking: "Halkalar dönüyor, tarama sürüyor — güvenli analiz.",
    learning: "Bilgi akışı yoğunlaşıyor — deneyim taranıyor.",
    working: "Güçlü ama kontrollü aktivite — worker cycle işliyor.",
    warning: "Dikkat gerekiyor — onay veya inceleme bekleyen bir durum var.",
    error: "Bir okuma başarısız — ayrıntıları kontrol et.",
    listening: "\"AYAS\" duyuldu — sesli komut alınıyor.",
    speaking: "AYAS yanıtını sesli okuyor (yerel).",
    autonomous: "Otonom döngü gözlemliyor ve öneri taslağı hazırlıyor — yürütme yok.",
  }[state];
}

/* ---------------------------------------------------------- status cards --- */

function StatusCards({
  snapshot,
  autonomous,
}: {
  snapshot: BrainConsoleSnapshot;
  autonomous?: AyasAutonomousView;
}) {
  const pending = snapshot.tasks.pendingApproval;
  return (
    <div className="bc-cards" data-testid="bc-cards">
      <StatCard
        k="Tasks"
        v={String(snapshot.tasks.total)}
        s={pending > 0 ? `${pending} onay bekliyor` : "onay bekleyen yok"}
        tone={pending > 0 ? "warn" : undefined}
      />
      <StatCard
        k="Memory"
        v={snapshot.connected.experience ? String(snapshot.experience.total) : "—"}
        s={
          snapshot.connected.experience
            ? `son: ${snapshot.experience.lastTopic ?? "—"}`
            : "Not connected"
        }
        tone={snapshot.connected.experience ? undefined : "off"}
      />
      <StatCard
        k="Learning"
        v={String(snapshot.cyclesRecorded)}
        s={snapshot.lastCycle ? `son cycle işlenen: ${snapshot.lastCycle.tasksRun}` : "cycle kaydı yok"}
      />
      <StatCard
        k="Autonomous"
        v={autonomous?.connected ? String(autonomous.cycleCount) : "—"}
        s={
          autonomous?.connected
            ? `${autonomous.awaitingApprovalCount} onay bekliyor`
            : "başlatılmadı"
        }
        tone={autonomous?.awaitingApprovalCount ? "warn" : autonomous?.connected ? undefined : "off"}
      />
      <StatCard
        k="Safety"
        v={snapshot.safety.decision}
        s="probe yok — muhafazakâr"
        tone={
          snapshot.safety.decision === "hold" || snapshot.safety.decision === "abort"
            ? "warn"
            : undefined
        }
      />
      <StatCard k="Research" v="Not connected" s="onaylı sonraki aşama" tone="off" />
      <StatCard k="Production" v="Not connected" s="yürütme kapısı kapalı" tone="off" />
    </div>
  );
}

function StatCard({
  k,
  v,
  s,
  tone,
}: {
  k: string;
  v: string;
  s?: string;
  tone?: "warn" | "off";
}) {
  const cls =
    "bc-statcard" + (tone === "warn" ? " bc-statcard--warn" : tone === "off" ? " bc-statcard--off" : "");
  return (
    <div className={cls}>
      <span className="bc-statcard__k">{k}</span>
      <span className="bc-statcard__v">{v}</span>
      {s ? <span className="bc-statcard__s">{s}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- panels --- */

function PanelBody(props: BrainConsoleViewProps) {
  const { snapshot, activePanel } = props;
  const panel = findBrainPanel(activePanel);

  if (!panel.connected) {
    return (
      <div className="bc-empty" data-testid="bc-not-connected">
        <strong>Not connected</strong>
        <p style={{ margin: "6px 0 0" }}>{panel.placeholder}</p>
      </div>
    );
  }

  switch (activePanel) {
    case "chat":
      return <ChatPanel {...props} />;
    case "tasks":
      return <TasksPanel snapshot={snapshot} />;
    case "memory":
      return <MemoryPanel snapshot={snapshot} />;
    case "autonomous":
      return <AutonomousPanel autonomous={props.autonomous} />;
    case "learning":
      return <LearningPanel snapshot={snapshot} />;
    case "safety":
      return <SafetyPanel snapshot={snapshot} />;
    default:
      return <div className="bc-empty">—</div>;
  }
}

function ChatPanel(props: BrainConsoleViewProps) {
  const { messages, voice } = props;
  const voiceInfo = voice ? describeAyasVoiceState(voice.state) : undefined;
  const needsDisclosure =
    voice && voice.capability.stt && voice.capability.sttCloudBacked && !voice.disclosureAccepted;
  const llmLive = props.modelConfigured && props.lastReplySource !== "fallback";

  return (
    <div className="bc-chat">
      <div className="bc-chat__log" data-testid="bc-chat-log">
        {messages.length === 0 ? (
          <p className="bc-msg bc-msg--system">Henüz mesaj yok.</p>
        ) : (
          messages.map((message) => (
            <p key={message.id} className={`bc-msg bc-msg--${message.role}`}>
              {message.text}
            </p>
          ))
        )}
        {props.chatPending ? (
          <p className="bc-msg bc-msg--brain bc-msg--typing">AYAS düşünüyor…</p>
        ) : null}
      </div>

      {voice && voiceInfo ? (
        <p className="bc-voice" data-voice={voice.state} data-testid="bc-voice">
          <span className="bc-voice__dot" aria-hidden="true" />
          Ses: {voiceInfo.tr}
          {voice.capability.stt && !voice.listening && !needsDisclosure ? (
            <button
              type="button"
              className="bc-link"
              onClick={voice.onToggleListening}
              data-testid="bc-voice-toggle"
            >
              dinlemeyi aç
            </button>
          ) : null}
          {voice.listening ? (
            <button
              type="button"
              className="bc-link"
              onClick={voice.onToggleListening}
              data-testid="bc-voice-toggle"
            >
              dinlemeyi kapat
            </button>
          ) : null}
          {voice.capability.tts ? (
            <button
              type="button"
              className="bc-link"
              onClick={voice.onToggleMute}
              aria-pressed={voice.muted ? "true" : "false"}
              data-testid="bc-voice-mute"
            >
              {voice.muted ? "sesli yanıtı aç" : "sesli yanıtı sustur"}
            </button>
          ) : null}
        </p>
      ) : null}

      {voice?.errorMessage ? (
        <p className="bc-voice bc-voice--err" data-testid="bc-voice-error" role="status">
          <span className="bc-voice__dot" aria-hidden="true" />
          {voice.errorMessage}
        </p>
      ) : null}

      {voice?.pendingSpeech ? (
        <button
          type="button"
          className="bc-btn bc-btn--ghost"
          onClick={voice.onReplayPendingSpeech}
          data-testid="bc-voice-replay"
        >
          ▶ Sesli yanıtı başlat
        </button>
      ) : null}

      {needsDisclosure ? (
        <div className="bc-empty" data-testid="bc-voice-disclosure">
          <strong>Sesli mod — bilgilendirme</strong>
          <p style={{ margin: "6px 0 8px" }}>
            Tarayıcının konuşma tanıma motoru (Chromium&apos;da webkitSpeechRecognition) sesi
            işlemek için ses verisini tarayıcı sağlayıcısının bulut servisine gönderir. Bunu
            etkinleştirmek tamamen senin seçimin. Metin sohbeti ve AYAS&apos;ın sesli yanıtı
            (yerel) bundan bağımsız çalışır.
          </p>
          <button type="button" className="bc-btn" onClick={voice?.onAcceptDisclosure} data-testid="bc-voice-accept">
            Anladım, sesli modu aç
          </button>
        </div>
      ) : null}

      <div className="bc-composer">
        <button
          className={`bc-mic${voice?.listening ? " bc-mic--live" : ""}`}
          type="button"
          onClick={voice?.capability.stt ? voice.onToggleListening : undefined}
          aria-disabled={voice?.capability.stt ? undefined : "true"}
          aria-pressed={voice?.listening ? "true" : "false"}
          title={
            voice?.capability.stt
              ? "Sesli mod: \"AYAS\" diyerek seslen"
              : "Bu tarayıcıda konuşma tanıma yok — metin sohbeti çalışır"
          }
          data-testid="bc-mic"
        >
          🎙
        </button>
        <input
          type="text"
          placeholder="AYAS'a yaz…"
          value={props.draft ?? ""}
          onChange={(event) => props.onDraftChange?.(event.target.value)}
          aria-label="AYAS'a mesaj"
          data-testid="bc-input"
        />
        <button type="button" className="bc-btn" onClick={props.onSend} data-testid="bc-send" disabled={props.chatPending}>
          Gönder
        </button>
      </div>

      <p className="bc-note" data-testid="bc-chat-note">
        {llmLive
          ? "AYAS yerel model (Ollama) üzerinden yanıtlıyor. Modele ulaşılamazsa deterministik özet devreye girer."
          : props.lastReplySource === "fallback"
            ? "Yerel modele ulaşılamadı — şu an deterministik özet yanıt veriliyor."
            : "AYAS yerel model (Ollama) üzerinden yanıtlar; yapılandırılmamış/ulaşılamazsa deterministik özet kullanılır."}
        {voice?.capability.tts
          ? " Yanıtlar tarayıcının yerel sesiyle otomatik seslendirilir."
          : ""}
      </p>
    </div>
  );
}

function AutonomousPanel({ autonomous }: { autonomous?: AyasAutonomousView }) {
  if (!autonomous || !autonomous.connected) {
    return (
      <div className="bc-empty" data-testid="bc-autonomous-empty">
        AYAS otonom döngüsü henüz başlatılmadı. Döngü yalnızca gözlemler ve öneri taslağı
        hazırlar — hiçbir şey yürütmez (yürütme kapısı KAPALI). Başlatıcı:{" "}
        <code>npx tsx scripts/ayas-autonomous-loop.ts</code>
      </div>
    );
  }
  return (
    <div data-testid="bc-autonomous">
      <dl className="bc-kv">
        <dt>Yürütme kapısı</dt>
        <dd>{autonomous.executionGate}</dd>
        <dt>Faz</dt>
        <dd>{autonomous.phase}</dd>
        <dt>Döngü / heartbeat</dt>
        <dd>
          {autonomous.cycleCount} / {autonomous.heartbeatCount}
        </dd>
        <dt>Bekleyen / tamamlanan öneri</dt>
        <dd>
          {autonomous.pendingCount} / {autonomous.completedCount}
        </dd>
        <dt>Onay bekleyen</dt>
        <dd>{autonomous.awaitingApprovalCount}</dd>
        <dt>Sıradaki adım</dt>
        <dd>{autonomous.nextSingleStep}</dd>
      </dl>
      {autonomous.error ? (
        <p className="bc-alert" role="alert" style={{ marginTop: 12 }}>
          ⚠ {autonomous.error}
        </p>
      ) : null}
      {autonomous.gaps.length ? (
        <>
          <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Son gözlem — eksikler</p>
          <ul className="bc-reasons">
            {autonomous.gaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </>
      ) : null}
      {autonomous.pending.length ? (
        <>
          <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Bekleyen öneriler</p>
          <div className="bc-list">
            {autonomous.pending.map((improvement) => (
              <div key={improvement.id} className="bc-row">
                <span>{improvement.title}</span>
                <span className="bc-badge bc-badge--warn">{improvement.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TasksPanel({ snapshot }: { snapshot: BrainConsoleSnapshot }) {
  if (!snapshot.connected.tasks) {
    return (
      <div className="bc-empty" data-testid="bc-tasks-empty">
        Kuyruk store&apos;u boş — henüz görev yok (<code>data/brain/queue/tasks.json</code>).
      </div>
    );
  }
  return (
    <div className="bc-list" data-testid="bc-tasks">
      <p className="bc-row__meta">
        {snapshot.tasks.total} görev · {snapshot.tasks.pendingApproval} onay bekliyor ·{" "}
        {snapshot.tasks.skippedUnsafe} güvensiz atlandı
      </p>
      {snapshot.tasks.items.length === 0 ? (
        <div className="bc-empty">Kuyrukta görev yok.</div>
      ) : (
        snapshot.tasks.items.map((task) => {
          const display = mapTaskStatusToDisplay(task.status);
          return (
            <div key={task.taskId} className="bc-row">
              <span>
                {task.title}
                <span className="bc-row__meta">
                  {" "}· {task.kind} · {task.priority}
                </span>
              </span>
              <span className={`bc-badge bc-badge--${display.tone}`}>{display.label}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function MemoryPanel({ snapshot }: { snapshot: BrainConsoleSnapshot }) {
  return (
    <dl className="bc-kv" data-testid="bc-memory">
      <dt>Experience kayıtları</dt>
      <dd>{snapshot.connected.experience ? snapshot.experience.total : "Not connected"}</dd>
      <dt>Son konu</dt>
      <dd>{snapshot.experience.lastTopic ?? "—"}</dd>
      <dt>Son kayıt</dt>
      <dd>{snapshot.experience.lastCompletedAt ?? "—"}</dd>
      <dt>Worker cycle kayıtları</dt>
      <dd>{snapshot.cyclesRecorded}</dd>
    </dl>
  );
}

function LearningPanel({ snapshot }: { snapshot: BrainConsoleSnapshot }) {
  if (!snapshot.lastCycle) {
    return (
      <div className="bc-empty" data-testid="bc-learning-empty">
        Henüz bir worker cycle kaydı yok. Cycle çalıştırma ayrı onay gerektirir —
        yürütme kapısı kapalı.
      </div>
    );
  }
  const cycle = snapshot.lastCycle;
  return (
    <dl className="bc-kv" data-testid="bc-learning">
      <dt>Son cycle</dt>
      <dd>{cycle.cycleId}</dd>
      <dt>Pencere</dt>
      <dd>
        {cycle.startedAt} → {cycle.finishedAt}
      </dd>
      <dt>Değerlendirilen / işlenen</dt>
      <dd>
        {cycle.tasksConsidered} / {cycle.tasksRun}
      </dd>
      <dt>Sorun / onay bekleyen</dt>
      <dd>
        {cycle.problemsFound} / {cycle.awaitingApproval}
      </dd>
      <dt>Sıradaki adım</dt>
      <dd>{cycle.nextSingleStep}</dd>
    </dl>
  );
}

function SafetyPanel({ snapshot }: { snapshot: BrainConsoleSnapshot }) {
  return (
    <div data-testid="bc-safety">
      <dl className="bc-kv">
        <dt>Karar</dt>
        <dd>{snapshot.safety.decision}</dd>
        <dt>Snapshot</dt>
        <dd>{snapshot.safety.snapshotSource} (probe yok — muhafazakâr)</dd>
        <dt>Donanım profili</dt>
        <dd>{snapshot.safety.hardwareProfileId}</dd>
        <dt>Yürütme kapısı</dt>
        <dd>{snapshot.executionGate}</dd>
      </dl>
      <ul className="bc-reasons">
        {snapshot.safety.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

export default BrainConsoleView;
