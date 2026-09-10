/**
 * Atölye Brain Core — UI smoke suite (Sprint 184).
 *
 * Deterministic / GPU-free / $0 / no network. Renders the pure Brain Core
 * components with `renderToStaticMarkup` (same approach as
 * `smoke-production-health-ui.ts`) and exercises the read-only snapshot loader
 * against a temp workspace.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBrainTaskStore,
  runBrainWorkerCycle,
  DEFAULT_BRAIN_WORKER_CONFIG,
} from "../src/lib/brain";
import type { BrainTaskInput } from "../src/lib/brain";
import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "../src/lib/brain/ui/BrainConsoleSnapshot";
import {
  BRAIN_CORE_STATES,
  BRAIN_PANELS,
  deriveAyasPresence,
  deriveBrainCoreState,
  mapTaskStatusToDisplay,
  brainDeterministicReply,
  brainWelcomeMessage,
  type BrainChatMessage,
  type BrainCoreState,
} from "../src/components/brain/brainCore";
import { BrainCoreOrb } from "../src/components/brain/BrainCoreOrb";
import { BrainConsoleView } from "../src/components/brain/BrainConsoleView";
import { advanceIncident, buildBrainIncident } from "../src/lib/brain/selfheal/BrainIncident";
import { buildBrainReportCenterView } from "../src/lib/brain/selfheal/BrainReportCenter";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const NOW = "2026-09-08T03:00:00.000Z";
const START = "2026-09-08T02:00:00.000Z";
const END = "2026-09-08T02:04:00.000Z";

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-ui-"));
}
async function withWs(body: (root: string) => Promise<void>): Promise<void> {
  const root = ws();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const task = (over: Partial<BrainTaskInput> = {}): BrainTaskInput => ({
  kind: "analyze-codebase",
  title: "map brain",
  rationale: "boundaries",
  priority: "normal",
  dependsOn: [],
  payload: {},
  createdAt: START,
  ...over,
});

function baseSnapshot(over: Partial<BrainConsoleSnapshot> = {}): BrainConsoleSnapshot {
  return {
    generatedAt: NOW,
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: {
        queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0,
        succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0,
      },
      pendingApproval: 0,
      skippedUnsafe: 0,
      items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: {
      decision: "proceed-with-constraints",
      snapshotSource: "unavailable",
      reasons: ["resource snapshot unavailable — assuming a shared, thermally-constrained GPU (conservative bundle)"],
      hardwareProfileId: "gtx-1650-4gb",
    },
    ...over,
  };
}

function renderView(props: Partial<Parameters<typeof BrainConsoleView>[0]> & { snapshot: BrainConsoleSnapshot }) {
  const messages: readonly BrainChatMessage[] = props.messages ?? [brainWelcomeMessage(props.snapshot)];
  return renderToStaticMarkup(
    createElement(BrainConsoleView, {
      ...props,
      snapshot: props.snapshot,
      coreState: props.coreState ?? deriveBrainCoreState(props.snapshot),
      activePanel: props.activePanel ?? "chat",
      messages,
    }),
  );
}

async function run() {
  /* --------------------------- A. core state ------------------------- */

  await scenario("1. all 7 core states are described with a hue + intensity", () => {
    const states: BrainCoreState[] = ["idle", "active", "thinking", "learning", "working", "warning", "error"];
    for (const s of states) {
      const info = BRAIN_CORE_STATES[s];
      assert.equal(info.state, s);
      assert.ok(info.intensity > 0 && info.intensity <= 1);
      assert.ok(["cyan", "violet", "amber", "emerald", "rose"].includes(info.hue));
    }
  });

  await scenario("2. deriveBrainCoreState — errors → error, pending approval → warning, else idle", () => {
    assert.equal(deriveBrainCoreState(baseSnapshot({ errors: ["task queue: BRAIN_TASK_STORE_CORRUPT — bad"] })), "error");
    assert.equal(
      deriveBrainCoreState(baseSnapshot({ tasks: { ...baseSnapshot().tasks, pendingApproval: 1 } })),
      "warning",
    );
    assert.equal(deriveBrainCoreState(baseSnapshot({ safety: { ...baseSnapshot().safety, decision: "hold" } })), "warning");
    assert.equal(deriveBrainCoreState(baseSnapshot()), "idle");
    assert.equal(
      deriveBrainCoreState(baseSnapshot({ experience: { total: 3 } })),
      "learning",
    );
  });

  await scenario("3. mapTaskStatusToDisplay covers every BrainTaskStatus with a tone", () => {
    for (const status of [
      "queued", "running", "blocked-on-dependency", "blocked-on-approval",
      "succeeded", "failed", "cancelled", "skipped-unsafe",
    ] as const) {
      const d = mapTaskStatusToDisplay(status);
      assert.ok(d.label.length > 0);
      assert.ok(["neutral", "info", "good", "bad", "warn", "muted"].includes(d.tone));
    }
    assert.equal(mapTaskStatusToDisplay("skipped-unsafe").tone, "bad");
    assert.equal(mapTaskStatusToDisplay("blocked-on-approval").tone, "warn");
  });

  /* --------------------------- B. orb render ------------------------- */

  await scenario("4. orb renders per state with data-state, data-hue, aria-label", () => {
    for (const state of ["idle", "thinking", "working", "warning", "error"] as const) {
      const html = renderToStaticMarkup(createElement(BrainCoreOrb, { state }));
      assert.ok(html.includes(`data-state="${state}"`), `orb missing data-state ${state}`);
      assert.ok(html.includes(`data-hue="${BRAIN_CORE_STATES[state].hue}"`));
      assert.ok(html.includes('role="img"'));
      assert.ok(/aria-label="AYAS/.test(html));
      assert.ok(html.includes("bc-orb__core") && html.includes("bc-orb__particles"));
    }
  });

  await scenario("5. orb honours showLabel + custom size", () => {
    const withLabel = renderToStaticMarkup(createElement(BrainCoreOrb, { state: "idle", size: 140 }));
    assert.ok(withLabel.includes("bc-pip"));
    assert.ok(withLabel.includes("140px"));
    const noLabel = renderToStaticMarkup(createElement(BrainCoreOrb, { state: "idle", showLabel: false }));
    assert.ok(!noLabel.includes("bc-pip__dot"));
  });

  /* ------------------------- C. console view ------------------------- */

  await scenario("6. console renders the CLOSED execution-gate badge + all panel tabs", () => {
    const html = renderView({ snapshot: baseSnapshot() });
    assert.ok(html.includes("Yürütme kapısı: CLOSED"));
    for (const panel of BRAIN_PANELS) {
      assert.ok(html.includes(`data-testid="bc-tab-${panel.id}"`), `missing tab ${panel.id}`);
    }
    assert.ok(html.includes('data-testid="bc-refresh"'));
  });

  await scenario("7. research + production panels render an honest 'Not connected' state", () => {
    for (const panel of ["research", "production"] as const) {
      const html = renderView({ snapshot: baseSnapshot(), activePanel: panel });
      assert.ok(html.includes('data-testid="bc-not-connected"'));
      assert.ok(html.includes("Not connected"));
    }
  });

  await scenario("8. tasks panel — empty state vs real rows with status badges", () => {
    const empty = renderView({ snapshot: baseSnapshot(), activePanel: "tasks" });
    assert.ok(empty.includes('data-testid="bc-tasks-empty"'));

    const connected = baseSnapshot({
      connected: { tasks: true, cycles: false, experience: false },
      tasks: {
        total: 2,
        byStatus: { ...baseSnapshot().tasks.byStatus, queued: 1, "blocked-on-approval": 1 },
        pendingApproval: 1,
        skippedUnsafe: 0,
        items: [
          { taskId: "brain-task-1", kind: "analyze-codebase", title: "map graph", priority: "normal", status: "queued", autonomy: "auto-safe", requiresApproval: false, blocked: false, createdAt: START },
          { taskId: "brain-task-2", kind: "apply-improvement", title: "apply 12", priority: "high", status: "blocked-on-approval", autonomy: "requires-user-approval", requiresApproval: true, blocked: true, createdAt: START },
        ],
      },
    });
    const html = renderView({ snapshot: connected, activePanel: "tasks" });
    assert.ok(html.includes('data-testid="bc-tasks"'));
    assert.ok(html.includes("map graph") && html.includes("apply 12"));
    assert.ok(html.includes("Queued") && html.includes("Awaiting approval"));
    assert.ok(html.includes("1 onay bekliyor"));
  });

  await scenario("9. safety panel lists the conservative reasons + gate", () => {
    const html = renderView({ snapshot: baseSnapshot(), activePanel: "safety" });
    assert.ok(html.includes('data-testid="bc-safety"'));
    assert.ok(html.includes("proceed-with-constraints"));
    assert.ok(html.includes("probe yok"));
    assert.ok(html.includes("conservative bundle"));
  });

  await scenario("10. learning panel — empty until a cycle exists, then shows the report", () => {
    const empty = renderView({ snapshot: baseSnapshot(), activePanel: "learning" });
    assert.ok(empty.includes('data-testid="bc-learning-empty"'));
    const withCycle = renderView({
      snapshot: baseSnapshot({
        lastCycle: {
          cycleId: "brain-worker-cycle-abc", startedAt: START, finishedAt: END,
          tasksConsidered: 3, tasksRun: 2, problemsFound: 0, awaitingApproval: 1,
          nextSingleStep: "review parked tasks",
        },
      }),
      activePanel: "learning",
    });
    assert.ok(withCycle.includes('data-testid="bc-learning"'));
    assert.ok(withCycle.includes("brain-worker-cycle-abc"));
    assert.ok(withCycle.includes("review parked tasks"));
  });

  await scenario("11. core state drives the orb hue inside the console (state transition)", () => {
    const idle = renderView({ snapshot: baseSnapshot(), coreState: "idle" });
    assert.ok(idle.includes('data-hue="cyan"') && idle.includes('data-state="idle"'));
    const warn = renderView({ snapshot: baseSnapshot(), coreState: "warning" });
    assert.ok(warn.includes('data-hue="amber"') && warn.includes('data-state="warning"'));
    const err = renderView({ snapshot: baseSnapshot({ errors: ["x"] }), coreState: "error" });
    assert.ok(err.includes('data-hue="rose"'));
    assert.ok(err.includes('role="alert"'));
  });

  await scenario("11b. the state readout under the orb shows label · tr + a character line", () => {
    const html = renderView({ snapshot: baseSnapshot(), coreState: "thinking" });
    assert.ok(html.includes("bc-stateline__label"));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.label));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.tr));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.characterTr));
    // every state carries a non-empty premium one-liner
    for (const s of Object.values(BRAIN_CORE_STATES)) {
      assert.ok(s.characterTr.trim().length > 8, `characterTr for ${s.state}`);
    }
  });

  await scenario("11c. status cards are drawn only from the real snapshot; research/production are 'off'", () => {
    const empty = renderView({ snapshot: baseSnapshot() });
    assert.ok(empty.includes('data-testid="bc-cards"'));
    for (const k of ["Tasks", "Memory", "Learning", "Safety", "Research", "Production"]) {
      assert.ok(empty.includes(k), `missing status card ${k}`);
    }
    assert.ok(empty.includes("bc-statcard--off"), "research/production render as an 'off' card");

    const withData = renderView({
      snapshot: baseSnapshot({
        connected: { tasks: true, cycles: true, experience: true },
        tasks: { ...baseSnapshot().tasks, total: 7, pendingApproval: 2 },
        cyclesRecorded: 3,
        experience: { total: 4, lastTopic: "İstanbul 1453" },
      }),
    });
    assert.ok(withData.includes(">7<"), "tasks total card shows the real number");
    assert.ok(withData.includes("2 onay bekliyor"));
    assert.ok(withData.includes("bc-statcard--warn"), "pending approval marks the tasks card as a warning");
    assert.ok(withData.includes("İstanbul 1453"));
  });

  /* --------------------- AYAS presence (mobile + voice) -------------- */

  await scenario("11d. deriveAyasPresence — online with voice → ÇEVRİM İÇİ + voice CTA", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle" },
    });
    assert.equal(p.online, true);
    assert.equal(p.statusTr, "ÇEVRİM İÇİ");
    assert.equal(p.statusTone, "ok");
    assert.equal(p.voice.value, "Sesli iletişim hazır");
    assert.equal(p.mobile.value, "Mobil erişim hazır");
    assert.match(p.security.value, /yürütme kapısı kapalı/);
    assert.equal(p.cta.kind, "voice");
    assert.equal(p.handsFree, false, "no wake engine → not hands-free");
  });

  await scenario("11d2. deriveAyasPresence — wake engine active → hands-free label + armed hint", () => {
    const armed = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine" },
    });
    assert.equal(armed.handsFree, true);
    assert.match(armed.voice.value, /eller serbest/i);
    // not listening yet → the CTA advertises hands-free
    const idle = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", mode: "wake-engine" },
    });
    assert.equal(idle.cta.kind, "voice");
    assert.match(idle.cta.label, /eller serbest/i);
    // fell back to the tap path
    const tap = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle", mode: "single-shot" },
    });
    assert.equal(tap.handsFree, false);
    assert.equal(tap.cta.label, "AYAS ile sesli konuş");
  });

  await scenario("11d2b. deriveAyasPresence — conversation session active → 'Konuşma aktif' voice row", () => {
    const active = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: {
        sttAvailable: true, ttsAvailable: true, listening: true, state: "idle",
        mode: "wake-engine", conversationActive: true,
      },
    });
    assert.match(active.voice.value, /konuşma aktif/i, "the voice row reflects the open session");
    assert.equal(active.voice.tone, "ok");
    // recovering / paused still win over the session label (honest state first)
    const recovering = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: {
        sttAvailable: true, ttsAvailable: true, listening: true, state: "idle",
        mode: "wake-engine", conversationActive: true, recovering: true,
      },
    });
    assert.equal(recovering.voice.value, "AYAS bağlantıyı toparlıyor");
  });

  await scenario("11d3. deriveAyasPresence — wake pipeline recovering → honest 'toparlıyor' state", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine", recovering: true },
    });
    assert.equal(p.voice.value, "AYAS bağlantıyı toparlıyor");
    assert.equal(p.voice.tone, "warn");
    // offline still wins — never claim a recovery is happening when there's no link
    const off = deriveAyasPresence({
      connectivity: "offline",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine", recovering: true },
    });
    assert.equal(off.voice.value, "Çevrim dışı");
  });

  await scenario("11d4. deriveAyasPresence — wake pipeline PAUSED → 'dokunarak sürdür' + voice CTA (never fatal)", () => {
    const p = deriveAyasPresence({
      connectivity: "online",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine", paused: true },
    });
    assert.match(p.voice.value, /yeniden kuruyor.*dokunarak sürdür/);
    assert.equal(p.voice.tone, "warn");
    // the CTA must be actionable (a tap = the gesture iOS needs), not disabled
    assert.equal(p.cta.kind, "voice");
    assert.equal(p.cta.label, "Sesli oturumu sürdür");
    // offline still wins
    const off = deriveAyasPresence({
      connectivity: "offline",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: true, state: "idle", mode: "wake-engine", paused: true },
    });
    assert.equal(off.voice.value, "Çevrim dışı");
    assert.equal(off.cta.kind, "disabled");
  });

  await scenario("11e. deriveAyasPresence — offline never fakes online; CTA disabled", () => {
    const p = deriveAyasPresence({
      connectivity: "offline",
      secureContext: true,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle" },
    });
    assert.equal(p.online, false);
    assert.equal(p.statusTr, "ÇEVRİM DIŞI");
    assert.equal(p.statusTone, "off");
    assert.equal(p.cta.kind, "disabled");
    assert.equal(p.voice.tone, "off");
    assert.equal(p.mobile.tone, "off");
  });

  await scenario("11f. deriveAyasPresence — degraded refresh, no voice, insecure context", () => {
    const degraded = deriveAyasPresence({
      connectivity: "degraded",
      secureContext: true,
      executionGate: "CLOSED",
    });
    assert.equal(degraded.statusTr, "BAĞLANTI ZAYIF");
    assert.equal(degraded.statusTone, "warn");
    assert.equal(degraded.voice.value, "Bu cihazda ses yok");
    assert.equal(degraded.cta.kind, "text");

    const insecure = deriveAyasPresence({
      connectivity: "online",
      secureContext: false,
      executionGate: "CLOSED",
      voice: { sttAvailable: true, ttsAvailable: true, listening: false, state: "idle" },
    });
    assert.equal(insecure.mobile.value, "Güvenli bağlantı gerekli");
    assert.equal(insecure.mobile.tone, "warn");
  });

  await scenario("11g. presence card renders in the stage, CTA wired, gate restated, no transport leak", () => {
    const html = renderView({
      snapshot: baseSnapshot(),
      connectivity: "online",
      secureContext: true,
      onStartConversation: () => {},
      voice: {
        state: "idle",
        capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: false,
        muted: false,
        disclosureAccepted: true,
      },
    });
    assert.ok(html.includes('data-testid="bc-presence"'));
    assert.ok(html.includes('data-testid="bc-presence-cta"'));
    assert.ok(html.includes('data-cta-kind="voice"'));
    assert.ok(/ÇEVRİM İÇİ/.test(html));
    assert.ok(/yürütme kapısı kapalı/i.test(html), "the presence card restates the CLOSED gate");
    // §13 — the transient quick tunnel must never appear in the markup
    for (const leak of ["trycloudflare", "cloudflare", "haven-finds", "quick tunnel", "ngrok"]) {
      assert.ok(!html.toLowerCase().includes(leak), `markup leaked "${leak}"`);
    }
  });

  await scenario("11h. presence card — offline markup shows ÇEVRİM DIŞI and a disabled CTA", () => {
    const html = renderView({
      snapshot: baseSnapshot(),
      connectivity: "offline",
      onStartConversation: () => {},
    });
    assert.ok(/ÇEVRİM DIŞI/.test(html));
    assert.ok(html.includes('data-cta-kind="disabled"'));
    assert.ok(html.includes('data-online="false"'));
    // the CTA <button> carries a `disabled` attribute in the offline markup
    const ctaTag = html.slice(html.indexOf('class="bc-btn bc-presence__cta"'));
    assert.ok(/disabled/.test(ctaTag.slice(0, ctaTag.indexOf(">"))), "offline CTA button is disabled");
  });

  await scenario("11i. presence card — reload interrupted a voice session → resume notice + CTA", () => {
    const html = renderView({
      snapshot: baseSnapshot(),
      connectivity: "online",
      voiceSessionInterrupted: true,
      onStartConversation: () => {},
      voice: {
        state: "idle",
        capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: false,
        muted: false,
        disclosureAccepted: true,
        recognitionMode: "wake-engine",
      },
    });
    assert.ok(html.includes('data-interrupted="true"'));
    assert.ok(html.includes('data-testid="bc-presence-interrupted"'));
    // A soft "reconnecting" notice — never a scary "your session died".
    assert.ok(/yeniden kuruyor/.test(html), "reconnecting, not 'session died'");
    assert.ok(/ekrana dokun/.test(html), "any tap resumes it");
    assert.doesNotMatch(html, /kesildi|yeniden yüklendi/);
    assert.ok(/Sesli oturuma devam et/.test(html), "the CTA offers to resume");
    assert.ok(html.includes('data-cta-kind="voice"'));
    // once the user is listening again, the notice is gone
    const resumed = renderView({
      snapshot: baseSnapshot(),
      connectivity: "online",
      voiceSessionInterrupted: true,
      onStartConversation: () => {},
      voice: {
        state: "listening", capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: true, muted: false, disclosureAccepted: true, recognitionMode: "wake-engine",
      },
    });
    assert.ok(!resumed.includes('data-testid="bc-presence-interrupted"'), "no notice once re-armed");
  });

  await scenario("12. chat reply is deterministic, never fakes an LLM, reflects real numbers", () => {
    const snap = baseSnapshot({ cyclesRecorded: 2, tasks: { ...baseSnapshot().tasks, total: 4, pendingApproval: 1 } });
    const a = brainDeterministicReply("merhaba", snap, 1);
    const b = brainDeterministicReply("merhaba", snap, 1);
    assert.deepEqual(a, b);
    assert.equal(a.role, "brain");
    assert.match(a.text, /konuşma katmanı .* henüz bağlı değil/i);
    assert.match(a.text, /KAPALI/);
    assert.match(a.text, /kuyrukta 4 görev/);
    assert.match(a.text, /1 onay bekliyor/);
  });

  await scenario("12b. header shows AYAS + ● ONLINE; orb aria-label is AYAS", () => {
    const html = renderView({ snapshot: baseSnapshot() });
    assert.ok(html.includes("bc-brand__title"));
    assert.ok(/>AYAS</.test(html), "brand title is AYAS");
    assert.ok(html.includes("bc-online"));
    assert.ok(/ONLINE|AUTONOMOUS|ATTENTION|DEGRADED/.test(html));
    assert.ok(/aria-label="AYAS —/.test(html));
  });

  await scenario("12b2. Voice Lab is reachable from the Brain screen — inside .bc-shell, themed, not dark-on-dark", () => {
    const html = renderView({ snapshot: baseSnapshot() });
    // the diagnostics footer renders inside the shell (so it gets color-scheme: dark)
    const shellStart = html.indexOf('class="bc-shell"');
    const shellEnd = html.lastIndexOf("</div>");
    const labsIdx = html.indexOf('data-testid="bc-labs"');
    assert.ok(labsIdx > shellStart && labsIdx < shellEnd, "the labs footer is inside .bc-shell");
    assert.ok(html.includes('href="/brain/voice-lab/wake"'), "links to the existing wake lab route");
    assert.ok(html.includes('data-testid="bc-labs-wake"') && /AYAS Voice Lab/.test(html));
    // the old invisibility bugs must be gone: no inline color:inherit, no low opacity
    const footer = html.slice(labsIdx - 40, html.indexOf("</footer>", labsIdx) + 9);
    assert.ok(!/color:\s*inherit/i.test(footer), "no color:inherit (was dark-on-dark in iOS light mode)");
    assert.ok(!/opacity:\s*0?\.[0-4]/.test(footer), "no <0.5 opacity");
    assert.ok(/bc-labs__link/.test(footer), "uses the themed link class");
  });

  await scenario("12b3. Self-Healing panel — wired into the tab strip; empty state restates the operator-approval + gate rule", () => {
    const panelIds = BRAIN_PANELS.map((p) => p.id);
    assert.ok(panelIds.includes("selfheal"), "selfheal panel is in BRAIN_PANELS");
    assert.equal(BRAIN_PANELS.find((p) => p.id === "selfheal")?.label, "AYAS Raporları");
    const html = renderView({ snapshot: baseSnapshot(), activePanel: "selfheal" });
    assert.ok(html.includes('data-panel="selfheal"'));
    // empty store → the honest "beklemede" state
    assert.ok(/bc-selfheal-empty/.test(html), "empty self-heal state");
    assert.ok(/operatör onayı olmadan/i.test(html), "restates: never applies without operator approval");
    assert.ok(!/AKIA|sk-[a-z]|Bearer /i.test(html), "no secret shapes in the panel");
  });

  await scenario("12b4. AYAS Report Center — home status card + the report panel render from the reportCenter view", () => {
    let inc = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "wake sonrası komut erken kapanıyor", now: NOW });
    inc = advanceIncident(inc, { kind: "diagnose", now: NOW, hypotheses: [{ statement: "VAD pre-roll kirlenmesi", confidence: 0.86, evidence: [], counterEvidence: [], suspectFiles: ["scripts/smoke-x.ts"] }] }).incident;
    inc = advanceIncident(inc, { kind: "sandbox-patch", now: NOW, patch: { patchId: "p", baseCommit: "abc", changedFiles: ["scripts/smoke-x.ts"], diff: "@@ -1 +1 @@", diffLines: 10, safetyLevel: "SAFE", risk: "LOW", rollbackPlan: "x", attempt: 1 } }).incident;
    inc = advanceIncident(inc, { kind: "checks", now: NOW, checks: [
      { name: "tsc", kind: "typecheck", status: "PASS", detail: "0" },
      { name: "eslint", kind: "lint", status: "PASS", detail: "0" },
      { name: "build", kind: "build", status: "PASS", detail: "0" },
      { name: "smoke", kind: "smoke", status: "PASS", detail: "" },
      { name: "regression", kind: "regression", status: "PASS", detail: "" },
    ] }).incident;
    inc = advanceIncident(inc, { kind: "verified", now: NOW }).incident;
    inc = advanceIncident(inc, { kind: "await-approval", now: NOW }).incident;
    const rc = buildBrainReportCenterView({ incidents: [inc], learned: [], decisions: [], now: NOW });

    // home status card — a real <button> (clickable on touch), and the
    // command-center panel carries a scroll anchor id so mobile can scroll it
    // into view (the panel stacks far below the orb + presence card there —
    // a plain panel switch looked like nothing happened).
    const home = renderView({ snapshot: baseSnapshot(), reportCenter: rc, onOpenReports: () => {} });
    assert.ok(home.includes('data-testid="bc-card-reports"'), "AYAS Raporları status card is drawn");
    assert.ok(/AYAS Raporlar/.test(home));
    assert.ok(/1 onay/.test(home));
    assert.ok(/<button[^>]*data-testid="bc-card-reports"/.test(home), "the card is a real <button>, not an inert <div>");
    assert.ok(/id="bc-command-center"/.test(home), "the command-center panel has the scroll anchor");
    // no handler passed at all → still falls back to a plain panel switch (a button, not dead)
    const homeNoHandler = renderView({ snapshot: baseSnapshot(), reportCenter: rc, onSelectPanel: () => {} });
    assert.ok(/<button[^>]*data-testid="bc-card-reports"/.test(homeNoHandler), "card stays clickable via the onSelectPanel fallback");

    // the report panel with the incident expanded + decision handlers
    const panel = renderView({
      snapshot: baseSnapshot(),
      activePanel: "selfheal",
      reportCenter: rc,
      reportHandlers: {
        filter: { status: "all", category: "all" },
        onFilter: () => {},
        expandedReportId: inc.id,
        onToggleReport: () => {},
        onDecision: () => {},
        decisionPending: null,
      },
    });
    assert.ok(/data-testid="bc-report"/.test(panel));
    assert.ok(/Sistem Sağlığı %/.test(panel));
    assert.ok(/data-testid="bc-report-counts"/.test(panel));
    assert.ok(/data-testid="bc-report-detail"/.test(panel), "expanded incident shows the full chain");
    assert.ok(/Zaman çizelgesi/.test(panel) && /Kök neden/.test(panel) && /Watchdog/.test(panel));
    assert.ok(panel.includes(`bc-report-approve-${inc.id}`), "SAFE verified incident → ONAYLA button");
    assert.ok(!panel.includes("@@"), "no raw diff in the panel");
  });

  await scenario("12c. chat note is dynamic — no static 'not connected' line when the model is configured", () => {
    const configured = renderView({ snapshot: baseSnapshot(), modelConfigured: true, lastReplySource: "llm" });
    assert.ok(configured.includes('data-testid="bc-chat-note"'));
    assert.ok(configured.includes("yerel model (Ollama) üzerinden yanıtlıyor"));
    assert.ok(!configured.includes("Konuşma katmanı (LLM rolleri) henüz bağlı değil"), "the old static note is gone");
    const fell = renderView({ snapshot: baseSnapshot(), modelConfigured: true, lastReplySource: "fallback" });
    assert.ok(fell.includes("deterministik özet yanıt"));
  });

  await scenario("12d. voice UI — mic wired, disabled cleanly when unsupported", () => {
    const noVoice = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "unsupported",
        capability: { stt: false, tts: false, sttCloudBacked: false },
        listening: false, muted: false, disclosureAccepted: false,
      },
    });
    assert.ok(noVoice.includes('data-testid="bc-mic"'));
    assert.ok(noVoice.includes('aria-disabled="true"'));
    assert.ok(noVoice.includes('data-testid="bc-voice"'));

    const cloudStt = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "off",
        capability: { stt: true, tts: true, sttCloudBacked: true },
        listening: false, muted: false, disclosureAccepted: false,
      },
    });
    assert.ok(cloudStt.includes('data-testid="bc-voice-disclosure"'), "cloud STT needs an opt-in disclosure");
    assert.ok(cloudStt.includes("bulut servisine gönderir"));

    // TTS-capable browser → auto-speech mute toggle + auto-speech note
    const ttsOnly = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "off",
        capability: { stt: false, tts: true, sttCloudBacked: false },
        listening: false, muted: false, disclosureAccepted: false,
      },
    });
    assert.ok(ttsOnly.includes('data-testid="bc-voice-mute"'), "TTS browser gets an auto-speech mute toggle");
    assert.ok(ttsOnly.includes("otomatik seslendirilir"));

    // A voice error surfaces its own status line; a blocked auto-speech offers replay
    const errored = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "error",
        capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: false, muted: false, disclosureAccepted: true,
        errorMessage: "Mikrofon izni reddedildi.",
        pendingSpeech: "Merhaba, ben AYAS.",
      },
    });
    assert.ok(errored.includes('data-testid="bc-voice-error"'));
    assert.ok(errored.includes("Mikrofon izni reddedildi."));
    assert.ok(errored.includes('data-testid="bc-voice-replay"'));
  });

  await scenario("12d2. voice UI — an open conversation session shows the 'Konuşma aktif' pill", () => {
    const inSession = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "listening",
        capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: true, muted: false, disclosureAccepted: true,
        recognitionMode: "wake-engine", conversationActive: true,
      },
    });
    assert.ok(inSession.includes('data-testid="bc-voice-session"'), "the session pill renders");
    assert.ok(inSession.includes("Konuşma aktif"));

    const idle = renderView({
      snapshot: baseSnapshot(),
      voice: {
        state: "idle",
        capability: { stt: true, tts: true, sttCloudBacked: false },
        listening: true, muted: false, disclosureAccepted: true,
        recognitionMode: "wake-engine", conversationActive: false,
      },
    });
    assert.ok(!idle.includes('data-testid="bc-voice-session"'), "no pill when no session is open");
  });

  await scenario("12e. autonomous panel — empty vs real checkpoint", () => {
    const empty = renderView({ snapshot: baseSnapshot(), activePanel: "autonomous" });
    assert.ok(empty.includes('data-testid="bc-autonomous-empty"'));
    assert.ok(empty.includes("yürütme kapısı KAPALI") || empty.includes("hiçbir şey yürütmez"));

    const withState = renderView({
      snapshot: baseSnapshot(),
      activePanel: "autonomous",
      autonomous: {
        connected: true, executionGate: "CLOSED", phase: "await-approval",
        cycleCount: 4, heartbeatCount: 40, pendingCount: 2, completedCount: 1,
        awaitingApprovalCount: 2, pending: [{ id: "i1", title: "AYAS önerisi: test kapsamı", status: "awaiting-approval" }],
        gaps: ["Deneyim geçmişi boş."], nextSingleStep: "2 öneri onay bekliyor.",
      },
    });
    assert.ok(withState.includes('data-testid="bc-autonomous"'));
    assert.ok(withState.includes(">CLOSED<"));
    assert.ok(withState.includes("await-approval"));
    assert.ok(withState.includes("AYAS önerisi: test kapsamı"));
  });

  /* --------------------- D. responsive / perf (static) --------------- */

  await scenario("13. CSS is responsive + reduced-motion aware + overflow-safe + no WebGL/canvas", () => {
    const rawCss = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/BrainCore.css"), "utf8");
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ""); // drop comments — check rules, not prose
    assert.ok(css.includes("@media (min-width: 960px)"), "missing desktop breakpoint");
    assert.ok(css.includes("@media (max-width: 640px)"), "missing mobile breakpoint");
    assert.ok(css.includes("prefers-reduced-motion"), "missing reduced-motion guard");
    assert.ok(css.includes("100dvh"), "expected dynamic viewport height for mobile");
    assert.ok(css.includes("env(safe-area-inset-"), "expected safe-area-inset padding for notched phones");
    assert.ok(/\.bc-composer input\s*\{\s*font-size:\s*16px/.test(css), "mobile composer input must be 16px (no iOS zoom)");
    assert.ok(/\.bc-shell\s*\{[^}]*overflow-x:\s*hidden/.test(css), "shell must clip horizontal overflow");
    assert.ok(css.includes("clamp("), "expected fluid clamp() sizing");
    for (const banned of ["WebGL", "getContext", "canvas", "requestAnimationFrame"]) {
      assert.ok(!css.includes(banned), `CSS must not reference ${banned}`);
    }
  });

  await scenario("14. no Brain UI module contains a client fetch / timer / execution primitive", () => {
    // The ONE allowed client fetch is the chat SSE consumer (ayasChatStreamClient.ts,
    // checked separately below) — every other Brain UI module stays fetch-free.
    const files = [
      "src/components/brain/brainCore.ts",
      "src/components/brain/BrainCoreOrb.tsx",
      "src/components/brain/BrainConsoleView.tsx",
      "src/components/brain/BrainCoreConsole.tsx",
      "src/components/brain/ayasVoice.ts",
      // The screen wake lock only asks the OS to keep the display on — no
      // timer, no network. Held to the same bar as the rest of the Brain UI.
      "src/components/brain/useScreenWakeLock.ts",
      "src/components/brain/BrainSelfHealingPanel.tsx",
      "src/lib/brain/ui/BrainConsoleSnapshot.ts",
      "src/lib/brain/selfheal/BrainSelfHealSnapshot.ts",
    ];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const banned of ["fetch(", "XMLHttpRequest", "setInterval(", "child_process", "execFile", "spawn(", "PipelineRunner", "requestAnimationFrame", "nvidia-smi", "ffprobe"]) {
        assert.ok(!code.includes(banned), `${file} must not reference "${banned}"`);
      }
    }
    // The wake lock carries NO interval/polling. A bounded, `.unref()`'d retry
    // `setTimeout` (≤3 attempts with backoff) is allowed — a Low Power Mode
    // rejection must get a couple more tries before the screen is left to the OS.
    const wl = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/useScreenWakeLock.ts"), "utf8");
    assert.ok(!wl.includes("setInterval("), "useScreenWakeLock has no polling interval");
    assert.ok(/RETRY_BACKOFF_MS\s*=\s*\[[^\]]*\]\s*as const/.test(wl), "the retry schedule is a fixed, bounded array");
    assert.ok(wl.includes("retries >= RETRY_BACKOFF_MS.length"), "retries are capped");
    assert.ok(wl.includes("unref?.()"), "the retry timer is unref'd");
    assert.ok(wl.includes('navigator.wakeLock'), "useScreenWakeLock uses the Screen Wake Lock API");
  });

  await scenario("14c. BrainCoreConsole persists + restores the transcript so a reload does not re-greet", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/BrainCoreConsole.tsx"), "utf8");
    // restore from sessionStorage on mount
    assert.ok(src.includes("parsePersistedConversation("), "restores a saved transcript");
    assert.ok(src.includes("BRAIN_CONVERSATION_KEY"), "uses the conversation storage key");
    // persist on change + on the way out
    assert.ok(src.includes("serializeConversation("), "serialises the transcript");
    assert.ok(/pagehide[\s\S]{0,120}persistConversation|persistConversation[\s\S]{0,200}pagehide/.test(src), "flushes on pagehide");
    assert.ok(src.includes('visibilityState === "hidden"'), "flushes when the tab is hidden");
    // stable ids — NOT messages.length
    assert.ok(!/const seq = messages\.length/.test(src), "message ids no longer derive from messages.length");
    assert.ok(src.includes("turnSeqRef.current"), "a monotonic turn ordinal drives message ids");
    // the model history drops the system welcome
    assert.ok(src.includes("conversationHistoryForModel("), "history for the model excludes the welcome line");
  });

  await scenario("14b. the chat SSE client streams text only — no execution / timer / GPU primitive", () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/ayasChatStreamClient.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(code.includes("fetch"), "the SSE client does fetch the stream endpoint");
    for (const banned of ["setInterval(", "child_process", "execFile", "spawn(", "PipelineRunner", "requestAnimationFrame", "nvidia-smi", "ffprobe", "eval(", "Function("]) {
      assert.ok(!code.includes(banned), `ayasChatStreamClient.ts must not reference "${banned}"`);
    }
    // it targets exactly the AYAS chat stream route
    assert.ok(code.includes("/api/ayas/chat/stream"));
  });

  /* ---------------------- E. snapshot loader ------------------------- */

  await scenario("15. loader — empty workspace → all sections 'not connected', no mock data", () =>
    withWs(async (root) => {
      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.equal(snap.connected.tasks, false);
      assert.equal(snap.connected.cycles, false);
      assert.equal(snap.connected.experience, false);
      assert.equal(snap.tasks.total, 0);
      assert.equal(snap.executionGate, "CLOSED");
      assert.equal(snap.safety.snapshotSource, "unavailable");
      assert.equal(snap.errors.length, 0);
    }));

  await scenario("16. loader — reflects a real queue + a real worker cycle", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "analyze" }));
      store.enqueue(task({ kind: "apply-improvement", title: "apply 12" }));
      runBrainWorkerCycle(store, {
        config: DEFAULT_BRAIN_WORKER_CONFIG, startedAtIso: START, finishedAtIso: END,
      });

      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.equal(snap.connected.tasks, true);
      assert.equal(snap.connected.cycles, true);
      assert.equal(snap.tasks.total, 2);
      assert.equal(snap.tasks.byStatus.succeeded, 1);
      assert.equal(snap.tasks.pendingApproval, 1);
      assert.ok(snap.lastCycle);
      assert.equal(snap.lastCycle?.tasksRun, 1);
      assert.equal(deriveBrainCoreState(snap), "warning"); // a parked approval task
    }));

  await scenario("17. loader — a corrupt task store surfaces as errors[], not a crash", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      fs.mkdirSync(path.dirname(store.queueFile), { recursive: true });
      fs.writeFileSync(store.queueFile, "{ not json", "utf8");
      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.ok(snap.errors.some((e) => e.includes("BRAIN_TASK_STORE_CORRUPT")));
      assert.equal(snap.connected.tasks, false);
      assert.equal(deriveBrainCoreState(snap), "error");
      // and the console renders that error visibly
      const html = renderView({ snapshot: snap });
      assert.ok(html.includes('role="alert"'));
      assert.ok(html.includes("BRAIN_TASK_STORE_CORRUPT"));
    }));

  await scenario("18. hardware profile — per-host env override, safe fallback, unknown ignored (§19)", async () => {
    const { resolveBrainHardwareProfileId } = await import("../src/lib/brain/ui/BrainConsoleSnapshot");
    assert.equal(resolveBrainHardwareProfileId({}), "gtx-1650-4gb", "safe fallback on an unknown host");
    assert.equal(
      resolveBrainHardwareProfileId({ ATOLYE_BRAIN_HARDWARE_PROFILE: "rtx-a2000-12gb" }),
      "rtx-a2000-12gb",
      "a known id from the env is honoured",
    );
    assert.equal(
      resolveBrainHardwareProfileId({ ATOLYE_BRAIN_HARDWARE_PROFILE: "made-up-gpu" }),
      "gtx-1650-4gb",
      "an unknown id is ignored (falls back)",
    );
    await withWs(async (root) => {
      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW, hardwareProfileId: "rtx-a2000-12gb" });
      assert.equal(snap.safety.hardwareProfileId, "rtx-a2000-12gb");
    });
  });

  console.log(`Atölye Brain Core UI smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-core-ui", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain Core UI smoke FAILED:", error);
  process.exitCode = 1;
});
