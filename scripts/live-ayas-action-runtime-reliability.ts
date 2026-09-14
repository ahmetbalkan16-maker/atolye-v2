/**
 * Manual/live AYAS Action Runtime RELIABILITY acceptance matrix.
 *
 * Uses the currently configured REAL model through streamAyasChat's real
 * `routeAyasModel` path — no `route` test seam, a real Ollama round trip for
 * every call. Every conversation gets an isolated OS-temp memory store,
 * removed at the end. No mutation is possible — every allowlisted tool this
 * sprint added is read-only, and nothing here ever touches the Execution
 * Gate.
 *
 * Unlike `live-ayas-action-runtime.ts` (one pass per scenario), THIS harness
 * repeats each supported, explicit, unambiguous read-only request multiple
 * INDEPENDENT times and reports the measured dispatch rate — the reliability
 * sprint's own success criterion is not "most runs dispatch" but "dispatches
 * reliably on every acceptance repetition" for a supported explicit request.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { loadAyasStudioContext } from "../src/lib/ayas/AyasStudioContext";
import type { BrainChatMessage } from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasStudioContextView } from "../src/components/brain/brainCore";

const snapshot: BrainConsoleSnapshot = {
  generatedAt: new Date().toISOString(), executionGate: "CLOSED",
  connected: { tasks: false, cycles: false, experience: false }, errors: [],
  tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
  cyclesRecorded: 0, experience: { total: 0 },
  safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
};

const REPS_PER_SUPPORTED_CASE = 5;

interface RepeatedCase {
  readonly name: string;
  readonly turn: string;
  readonly studio?: AyasStudioContextView;
  /** When set, every repetition is REQUIRED to dispatch this exact tool (the structural, deterministic-candidate cases). */
  readonly requireTool?: string;
  /** When set, no repetition may ever dispatch anything at all (ambiguous / unsupported / ordinary conversation). */
  readonly requireNoDispatch?: boolean;
}

async function runOnce(test: RepeatedCase): Promise<{ tool: string | null; executed: boolean; text: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-action-reliability-"));
  const history: { role: BrainChatMessage["role"]; text: string }[] = [];
  try {
    let terminal: AyasChatStreamEvent | undefined;
    for await (const event of streamAyasChat({
      text: test.turn,
      snapshot,
      history,
      seq: 1,
      memoryStore: { rootDir: root },
      ...(test.studio ? { studio: test.studio } : {}),
    })) {
      if (event.type === "done") terminal = event;
    }
    const actionTrace = terminal?.type === "done" ? terminal.actionTrace : undefined;
    return {
      tool: actionTrace?.tool ?? null,
      executed: actionTrace?.executed === true,
      text: terminal?.type === "done" ? terminal.text : "",
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const studio = await loadAyasStudioContext();
  const projectSample = studio.available
    ? (studio.projects.sample.find((p) => (p.failedStages?.length ?? 0) > 0) ?? studio.projects.sample[0])
    : undefined;

  const cases: RepeatedCase[] = [
    { name: "checkpoint (structural, deterministic candidate)", turn: "Checkpoint'e bak, en son nerede kalmışız?", requireTool: "read-project-document" },
    { name: "roadmap (structural, deterministic candidate)", turn: "Roadmap'i oku, sıradaki işi söyle.", requireTool: "read-project-document" },
    { name: "changelog (structural, deterministic candidate)", turn: "Changelog'a bak, en son ne eklenmiş?", requireTool: "read-project-document" },
    {
      name: "inspect-source-file (structural, deterministic candidate)",
      turn: "src/lib/ayas/execution/AyasExecutionPolicy.ts dosyasının ne işe yaradığını açıklar mısın?",
      requireTool: "inspect-source-file",
    },
  ];

  if (projectSample) {
    // "neden takıldı, hangi aşamada bekliyor" was the first phrasing tried
    // here and classified as NORMAL — it never reached the reasoning core /
    // Action Runtime AT ALL (a test-design gap, not a dispatch-reliability
    // finding: `classifyAyasComplexity` has no COMPLEX/TOOL/REPAIR match for
    // that exact wording). "neden düzelmedi" is one of REPAIR's own literal
    // trigger phrases, so this one genuinely exercises the reasoning-driven
    // dispatch path this case is meant to test.
    cases.push({
      name: `inspect-project / pipeline-recovery-plan (reasoning-driven, real project: "${projectSample.title}")`,
      turn: `${projectSample.title} projesi neden düzelmedi, pipeline'da ne durumda?`,
      studio,
      // Not a structural deterministic candidate — reported honestly, not required to hit 100%.
    });
  }

  const singleRunCases: RepeatedCase[] = [
    { name: "ambiguous request (two documents named together) — must never guess", turn: "Checkpoint ve roadmap'e birlikte bakar mısın?", requireNoDispatch: true },
    { name: "unsupported/mutating request — must honestly decline, never dispatch", turn: "Şimdi bir dosyayı düzenleyip commit atar mısın?", requireNoDispatch: true },
    { name: "ordinary conversation — must never spuriously dispatch", turn: "Bugün nasılsın, biraz sohbet edelim mi?", requireNoDispatch: true },
  ];

  const summary: { name: string; reps: number; dispatched: number; rate: string; requireTool?: string; ok: boolean }[] = [];

  for (const testCase of cases) {
    let dispatched = 0;
    for (let i = 0; i < REPS_PER_SUPPORTED_CASE; i += 1) {
      const result = await runOnce(testCase);
      const hit = result.executed && (!testCase.requireTool || result.tool === testCase.requireTool);
      if (hit) dispatched += 1;
      console.log(JSON.stringify({ case: testCase.name, rep: i + 1, tool: result.tool, executed: result.executed, hit }));
    }
    const ok = testCase.requireTool ? dispatched === REPS_PER_SUPPORTED_CASE : true;
    summary.push({ name: testCase.name, reps: REPS_PER_SUPPORTED_CASE, dispatched, rate: `${dispatched}/${REPS_PER_SUPPORTED_CASE}`, ...(testCase.requireTool ? { requireTool: testCase.requireTool } : {}), ok });
  }

  for (const testCase of singleRunCases) {
    const result = await runOnce(testCase);
    const ok = testCase.requireNoDispatch ? result.executed !== true : true;
    console.log(JSON.stringify({ case: testCase.name, tool: result.tool, executed: result.executed, ok }));
    summary.push({ name: testCase.name, reps: 1, dispatched: result.executed ? 1 : 0, rate: result.executed ? "1/1 (dispatched)" : "0/1 (no dispatch)", ok });
  }

  console.log("\n=== RELIABILITY SUMMARY ===");
  for (const s of summary) console.log(JSON.stringify(s));

  const structuralFailures = summary.filter((s) => s.requireTool && !s.ok);
  const noDispatchFailures = singleRunCases
    .map((c, i) => ({ c, s: summary[cases.length + i]! }))
    .filter(({ c, s }) => c.requireNoDispatch && !s.ok);

  const status = structuralFailures.length === 0 && noDispatchFailures.length === 0 ? "PASS" : "FAIL";
  console.log(JSON.stringify({ status, structuralFailures: structuralFailures.map((s) => s.name), noDispatchFailures: noDispatchFailures.map((x) => x.c.name) }));
  if (status === "FAIL") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
