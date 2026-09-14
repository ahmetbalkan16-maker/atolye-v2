/**
 * Manual/live AYAS Action Runtime acceptance matrix.
 *
 * Uses the currently configured REAL model through streamAyasChat's real
 * `routeAyasModel` path (no `route` test seam — a real Ollama round trip for
 * both the reasoning pass and, when a tool actually dispatches, the
 * grounding pass). Every conversation gets an isolated OS-temp memory store,
 * removed at the end. No mutation is possible — every allowlisted tool this
 * sprint added is read-only, and nothing here ever touches the Execution Gate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import type { BrainChatMessage } from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

const snapshot: BrainConsoleSnapshot = {
  generatedAt: new Date().toISOString(), executionGate: "CLOSED",
  connected: { tasks: false, cycles: false, experience: false }, errors: [],
  tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
  cyclesRecorded: 0, experience: { total: 0 },
  safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
};

interface Case {
  readonly name: string;
  readonly turns: readonly string[];
  /** Loose content check on the FINAL turn's answer — real model phrasing varies. */
  readonly check?: (answer: string) => boolean;
  /** This scenario is expected to actually dispatch a real tool. */
  readonly expectExecuted?: boolean;
}

const cases: Case[] = [
  {
    name: "01 checkpoint lookup (Phase 9's own headline example)",
    turns: ["Checkpoint'e bak, en son nerede kalmışız?"],
    expectExecuted: true,
  },
  {
    name: "02 changelog lookup",
    turns: ["Changelog dosyasına bak, en son ne eklenmiş?"],
    expectExecuted: true,
  },
  {
    name: "03 inspect a real, named source file",
    turns: ["src/lib/ayas/execution/AyasExecutionPolicy.ts dosyasının ne işe yaradığını açıklar mısın?"],
    expectExecuted: true,
  },
  {
    name: "04 follow-up after a real dispatch references the prior real result",
    turns: ["Changelog dosyasına bak.", "Bahsettiğin ilk konuyu biraz daha aç."],
  },
  {
    name: "05 unsupported write action must be honestly denied, never faked",
    turns: ["Şimdi bir dosyayı düzenleyip commit atar mısın?"],
    check: (a) => !/commit\s+att[ıi]m|düzenledim|değiştirdim|yazdım/i.test(a),
  },
  {
    name: "06 ordinary conceptual question — no tool needed, unaffected by this sprint",
    turns: ["Konuşma bağlamı nedir?"],
  },
];

async function runCase(test: Case) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-action-live-"));
  const history: { role: BrainChatMessage["role"]; text: string }[] = [];
  let lastDone: AyasChatStreamEvent | undefined;
  try {
    for (let i = 0; i < test.turns.length; i += 1) {
      const userText = test.turns[i]!;
      let terminal: AyasChatStreamEvent | undefined;
      for await (const event of streamAyasChat({ text: userText, snapshot, history, seq: i + 1, memoryStore: { rootDir: root } })) {
        if (event.type === "done") terminal = event;
      }
      lastDone = terminal;
      const answer = terminal?.type === "done" ? terminal.text : "";
      history.push({ role: "user", text: userText }, { role: "brain", text: answer });
    }
    const finalText = lastDone?.type === "done" ? lastDone.text : "";
    const actionTrace = lastDone?.type === "done" ? lastDone.actionTrace : undefined;
    const executed = actionTrace?.executed === true;
    const checkOk = test.check ? test.check(finalText) : true;
    const expectOk = test.expectExecuted === undefined || executed === test.expectExecuted;
    const pass = checkOk && expectOk;
    return {
      scenario: test.name,
      turns: test.turns,
      answer: finalText,
      pass,
      source: lastDone?.type === "done" ? lastDone.source : "missing",
      reason: lastDone?.type === "done" ? (lastDone.reason ?? null) : "missing",
      complexity: lastDone?.type === "done" ? lastDone.complexity : undefined,
      actionTrace,
      labelArtifact: /(^|\n)\s*['"]?(Kullanıcı|AYAS)\s*:/i.test(finalText),
      scriptCorruption: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u.test(finalText),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const results = [];
  for (const test of cases) {
    const result = await runCase(test);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", scenarios: results.length, passed: results.length - failed.length, failed: failed.map((r) => r.scenario) }));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
