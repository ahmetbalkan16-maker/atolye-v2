/**
 * Atölye Brain Core — command-center view (Sprint 185).
 *
 * Pure presentational. Given a snapshot + UI state it renders the whole Brain
 * Core: the living orb at the true centre, the state readout, minimal status
 * cards drawn only from the real snapshot, the execution-gate badge, and the
 * command-center panel. Interaction handlers are optional so
 * `renderToStaticMarkup` can render it in the smoke suite with data alone.
 *
 * It never fabricates data: a panel or card with no backing state renders an
 * honest "Not connected" state.
 */

import { BrainCoreOrb } from "./BrainCoreOrb";
import {
  BRAIN_PANELS,
  describeBrainCoreState,
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
  const stateInfo = describeBrainCoreState(coreState);

  return (
    <div className="bc-shell">
      <header className="bc-topbar">
        <div>
          <p className="bc-brand__eyebrow">Atölye</p>
          <h1 className="bc-brand__title">Brain Core</h1>
        </div>
        <span className="bc-gate" title="The Brain has no production / GPU / model authority.">
          <span className="bc-gate__lock" aria-hidden="true" />
          ⛨ Yürütme kapısı: {snapshot.executionGate}
        </span>
      </header>

      <div className="bc-main">
        <section className="bc-stage" aria-label="Brain Core">
          <div className="bc-stage__orb">
            <BrainCoreOrb state={coreState} showLabel={false} />
          </div>

          <div className="bc-stateline">
            <span className="bc-stateline__label">{stateInfo.label}</span>
            <span className="bc-stateline__sep" aria-hidden="true">·</span>
            <span className="bc-stateline__tr">{stateInfo.tr}</span>
          </div>
          <p className="bc-character">{stateInfo.characterTr}</p>

          {snapshot.errors.length > 0 ? (
            <div className="bc-alert" role="alert">
              {snapshot.errors.map((error, index) => (
                <div key={index}>⚠ {error}</div>
              ))}
            </div>
          ) : null}

          <StatusCards snapshot={snapshot} />

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

        <section className="bc-panel" aria-label="Brain command center">
          <div className="bc-panel__head">
            <p className="bc-panel__title">Command Center</p>
            <span className="bc-panel__title" aria-hidden="true">{activePanel}</span>
          </div>

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

/* ---------------------------------------------------------- status cards --- */

function StatusCards({ snapshot }: { snapshot: BrainConsoleSnapshot }) {
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
        <button
          className="bc-mic"
          type="button"
          aria-disabled="true"
          title="Sesli etkileşim yakında"
          data-testid="bc-mic"
        >
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
      <p className="bc-note">
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
