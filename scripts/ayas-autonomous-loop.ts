/**
 * AYAS — continuous autonomous loop runner (Sprint 186).
 *
 *   npx tsx scripts/ayas-autonomous-loop.ts [options]
 *     --once            run exactly one cycle now, then exit (default)
 *     --ticks <n>       run <n> heartbeat ticks (heartbeatMs apart), cycling when due
 *     --continuous      run forever (for a future always-on worker / an idle PC)
 *     --llm             allow ONE throttled local-model call per due cycle for ideas
 *                       (default: no model call at all — deterministic drafts)
 *     --root <dir>      state root (default: data/brain)
 *     --interval-ms <n> override the cycle interval (for a manual run)
 *
 * What it does each cycle: observe the Brain's real state (read-only) → derive
 * gaps → draft a `# USER APPROVAL REQUIRED` proposal for the top gap → validate
 * it structurally → checkpoint. It NEVER runs a task, a pipeline, the GPU, or
 * applies a change. The execution gate stays CLOSED. Parked proposals wait for a
 * human.
 *
 * PC-off note: this is a local process. When the PC is off it does not run.
 * State is persisted to `data/brain/autonomy/state.json` so a future always-on
 * worker — or the PC on its next boot — resumes from exactly where it stopped.
 */

import { AIRouter } from "../src/lib/ai/router/AIRouter";
import type { AIProviderOutput } from "../src/lib/ai/providers/AIProvider";
import { loadBrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { createAyasAutonomousStore } from "../src/lib/brain/autonomy/AyasAutonomousStore";
import {
  AYAS_LOOP_DEFAULTS,
  advanceAyasCycle,
  ayasHeartbeat,
  ayasLoopRespectsGate,
  startAyasAutonomousLoop,
  type AyasAutonomousState,
  type AyasLoopConfig,
  type AyasSnapshotInput,
} from "../src/lib/brain/autonomy/AyasAutonomousLoop";
import { renderBrainImprovementProposalReport } from "../src/lib/brain";

interface Options {
  mode: "once" | "ticks" | "continuous";
  ticks: number;
  llm: boolean;
  root?: string;
  intervalMs?: number;
}

function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { mode: "once", ticks: 1, llm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--once") opts.mode = "once";
    else if (arg === "--continuous") opts.mode = "continuous";
    else if (arg === "--ticks") { opts.mode = "ticks"; opts.ticks = Number(argv[++i] ?? "1"); }
    else if (arg === "--llm") opts.llm = true;
    else if (arg === "--root") opts.root = argv[++i];
    else if (arg === "--interval-ms") opts.intervalMs = Number(argv[++i]);
  }
  if (!Number.isFinite(opts.ticks) || opts.ticks < 1) opts.ticks = 1;
  return opts;
}

function toSnapshotInput(now: string, s: Awaited<ReturnType<typeof loadBrainConsoleSnapshot>>): AyasSnapshotInput {
  return {
    observedAt: now,
    taskTotal: s.tasks.total,
    pendingApproval: s.tasks.pendingApproval,
    skippedUnsafe: s.tasks.skippedUnsafe,
    cyclesRecorded: s.cyclesRecorded,
    experienceTotal: s.experience.total,
    experienceConnected: s.connected.experience,
    safetyDecision: s.safety.decision,
    storeErrors: s.errors.length,
  };
}

function outputText(output: AIProviderOutput): string {
  return typeof output === "string" ? output : output.content ?? "";
}

/** One bounded local-model call for improvement ideas. Never recursive. */
async function fetchIdeas(gapHint: string): Promise<string[]> {
  const prompt = [
    "Sen AYAS'sın — Atölye'nin yapay zekâ çekirdeği. Yürütme yetkin yok; sadece öneri üretiyorsun.",
    "Aşağıdaki eksik için, mevcut mimariyi bozmadan uygulanabilecek 1-3 küçük, geriye dönük uyumlu iyileştirme fikri yaz.",
    "Her fikri tek satırda, kısa Türkçe cümleyle ver. Kod yazma, sadece fikir.",
    "",
    `Eksik: ${gapHint}`,
  ].join("\n");
  try {
    const provider = new AIRouter().getProvider("ollama");
    const text = outputText(await provider.generate(prompt, { maxTokens: 280 }));
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((line) => line.length > 6)
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function runCycle(
  state: AyasAutonomousState,
  opts: Options,
  config: AyasLoopConfig,
): Promise<AyasAutonomousState> {
  const now = new Date().toISOString();
  const snapshot = await loadBrainConsoleSnapshot(opts.root ? { rootDir: opts.root } : {});
  const snapInput = toSnapshotInput(now, snapshot);

  const cooldownOk =
    !state.lastLlmRequestAt ||
    Date.now() - Date.parse(state.lastLlmRequestAt) >= config.llmCooldownMs;
  const llmAllowed = opts.llm && cooldownOk;

  // Peek: run once to see if ideas would help, then (optionally) fetch them once.
  let ideas: string[] = [];
  const peek = advanceAyasCycle(state, { snapshot: snapInput, llmAllowed, llmIdeas: [] }, now, config);
  if (peek.llmRequested && llmAllowed) {
    const gapHint = peek.state.observation?.gaps[0] ?? "genel iyileştirme";
    ideas = await fetchIdeas(gapHint);
    console.log(`  [llm] ${ideas.length} fikir alındı`);
  }

  const result =
    ideas.length > 0
      ? advanceAyasCycle(state, { snapshot: snapInput, llmAllowed, llmIdeas: ideas }, now, config)
      : peek;

  const gate = ayasLoopRespectsGate(result.state);
  if (!gate.ok) {
    throw new Error(`AYAS gate invariant broken: ${gate.reason}`);
  }

  console.log(
    `  cycle ${result.state.cycleCount} · phase ${result.state.phase} · ` +
      `pending ${result.state.pendingImprovements.length} · ${result.state.nextSingleStep}`,
  );
  if (result.proposal) {
    console.log("  --- drafted proposal ---");
    console.log(
      renderBrainImprovementProposalReport(result.proposal)
        .split("\n")
        .slice(0, 12)
        .map((line) => `  ${line}`)
        .join("\n"),
    );
  }
  return result.state;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config: AyasLoopConfig = {
    ...AYAS_LOOP_DEFAULTS,
    ...(opts.intervalMs ? { cycleIntervalMs: opts.intervalMs } : {}),
  };
  const store = createAyasAutonomousStore(opts.root ? { rootDir: opts.root } : {});

  let state = store.load() ?? startAyasAutonomousLoop(new Date().toISOString());
  console.log(
    `AYAS autonomous loop — mode=${opts.mode} llm=${opts.llm} gate=${state.executionGate} ` +
      `(resumed cycle ${state.cycleCount}, heartbeat ${state.heartbeatCount})`,
  );
  state = store.save(state);

  const doCycle = async () => {
    state = await runCycle(state, opts, config);
    state = store.save(state);
  };

  if (opts.mode === "once") {
    await doCycle();
  } else {
    const limit = opts.mode === "continuous" ? Number.POSITIVE_INFINITY : opts.ticks;
    for (let tick = 0; tick < limit; tick += 1) {
      const hb = ayasHeartbeat(state, new Date().toISOString(), config);
      state = hb.state;
      state = store.save(state);
      if (hb.dueForCycle) await doCycle();
      if (tick + 1 < limit) await sleep(config.heartbeatMs);
    }
  }

  console.log(
    `\ndone — cycle ${state.cycleCount}, heartbeat ${state.heartbeatCount}, ` +
      `${state.pendingImprovements.filter((r) => r.status === "awaiting-approval").length} öneri onay bekliyor`,
  );
  console.log(`state: ${store.stateFile}`);
  console.log(JSON.stringify({ status: "OK", cycles: state.cycleCount, heartbeats: state.heartbeatCount, gate: state.executionGate }));
}

main().catch((error) => {
  console.error("AYAS autonomous loop FAILED:", error);
  process.exitCode = 1;
});
