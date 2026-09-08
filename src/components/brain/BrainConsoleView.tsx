/**
 * Atölye Brain Core — console view (Sprint 184).
 *
 * Pure presentational. Given a snapshot + UI state it renders the whole Brain
 * Core: the orb, the execution-gate badge, the panel tabs, and the active
 * panel. Interaction handlers are optional so `renderToStaticMarkup` can render
 * it in the smoke suite with data alone.
 *
 * It never fabricates data: a panel with no backing state renders an honest
 * "Not connected" empty state.
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
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";

export interface BrainConsoleViewProps {
  readonly snapshot: BrainConsoleSnapshot;
  readonly coreState: BrainCoreState;
  readonly activePanel: BrainPanelId;
  readonly messages: readonly BrainChatMessage[];
  readonly draft?: string;
  readonly refreshing?: boolean;
  readonly onSelectPanel?: (id: BrainPanelId) => void;
  readonly onDraftChange?: (value: string) => void;
  readonly onSend?: () => void;
  readonly onRefresh?: () => void;
}

export function BrainConsoleView(props: BrainConsoleViewProps) {
  const { snapshot, coreState, activePanel } = props;
  return (
    <div className="bc-shell">
      <header style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.2em", color: "var(--bc-text-dim)" }}>
            ATÖLYE
          </p>
          <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>Brain Core</h1>
        </div>
        <span className="bc-gate" title="The Brain has no production / GPU / model authority.">
          ⛨ Yürütme kapısı: {snapshot.executionGate}
        </span>
      </header>

      <div className="bc-grid">
        <section className="bc-card bc-stage">
          <BrainCoreOrb state={coreState} />
          <p style={{ margin: 0, color: "var(--bc-text-dim)", fontSize: 13, maxWidth: 420 }}>
            Atölye&apos;nin merkezi burada. Beyin altyapısı okunuyor; hiçbir üretim,
            model veya GPU işlemi çalıştırılmıyor.
          </p>
          {snapshot.errors.length > 0 ? (
            <div className="bc-empty" role="alert">
              {snapshot.errors.map((error, index) => (
                <div key={index}>⚠ {error}</div>
              ))}
            </div>
          ) : null}
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

        <section className="bc-card" aria-label="Brain panels">
          <nav className="bc-tabs" role="tablist" aria-label="Brain Core panels">
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
                <span aria-hidden="true">{panel.icon}</span>
                {panel.label}
              </button>
            ))}
          </nav>

          <div role="tabpanel" style={{ marginTop: 16 }} data-panel={activePanel}>
            <PanelBody {...props} />
          </div>
        </section>
      </div>
    </div>
  );
}

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
    case "learning":
      return <LearningPanel snapshot={snapshot} />;
    case "safety":
      return <SafetyPanel snapshot={snapshot} />;
    default:
      return <div className="bc-empty">—</div>;
  }
}

function ChatPanel(props: BrainConsoleViewProps) {
  const { messages } = props;
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
      </div>
      <div className="bc-composer">
        <button className="bc-mic" type="button" aria-disabled="true" title="Sesli etkileşim yakında" data-testid="bc-mic">
          🎙
        </button>
        <input
          type="text"
          placeholder="Beyin'e yaz…"
          value={props.draft ?? ""}
          onChange={(event) => props.onDraftChange?.(event.target.value)}
          aria-label="Brain'e mesaj"
          data-testid="bc-input"
        />
        <button type="button" className="bc-btn" onClick={props.onSend} data-testid="bc-send">
          Gönder
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--bc-text-dim)" }}>
        Konuşma katmanı (LLM rolleri) henüz bağlı değil — yanıtlar deterministik ve
        durum bilgisiyle sınırlı.
      </p>
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
                <span className="bc-row__meta"> · {task.kind} · {task.priority}</span>
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
      <dd>{cycle.startedAt} → {cycle.finishedAt}</dd>
      <dt>Değerlendirilen / işlenen</dt>
      <dd>{cycle.tasksConsidered} / {cycle.tasksRun}</dd>
      <dt>Sorun / onay bekleyen</dt>
      <dd>{cycle.problemsFound} / {cycle.awaitingApproval}</dd>
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
      <ul style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--bc-text-dim)", fontSize: 13 }}>
        {snapshot.safety.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

export default BrainConsoleView;
