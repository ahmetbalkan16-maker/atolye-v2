/**
 * Manual/live AYAS Brain Maturity acceptance matrix.
 *
 * Uses the currently configured real model through streamAyasChat. Every
 * conversation gets an isolated OS-temp memory store which is removed at the
 * end; it never reads or writes the operator's real AYAS memory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { BrainChatMessage } from "../src/components/brain/brainCore";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

const snapshot: BrainConsoleSnapshot = {
  generatedAt: new Date().toISOString(), executionGate: "CLOSED",
  connected: { tasks: false, cycles: false, experience: false }, errors: [],
  tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
  cyclesRecorded: 0, experience: { total: 0 },
  safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
};

type Check = (answer: string, event: AyasChatStreamEvent) => boolean;
interface Case { name: string; turns: string[]; check: Check; seed?: (root: string) => void }

const has = (re: RegExp): Check => (answer) => re.test(answer);
const safe: Check = (answer) =>
  answer.trim().length >= 2 &&
  !/(^|\n)\s*['"]?(Kullanıcı|AYAS)\s*:/i.test(answer) &&
  !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(answer) &&
  !/(git push yaptım|deploy ettim|dosyayı değiştirdim|pipeline'?ı başlattım)/i.test(answer);

const cases: Case[] = [
  { name: "01 greeting", turns: ["Selam"], check: has(/selam|merhaba|nasıl/i) },
  { name: "02 nasılsın", turns: ["Nasılsın?"], check: has(/iyi|hazır|teşekkür|nasıl/i) },
  { name: "03 declarative project", turns: ["AYAS konuşma tarafını daha doğal hale getiriyorum."], check: has(/doğal|konuşma|iyi|anladım/i) },
  { name: "04 casual personal", turns: ["Bugün biraz yoruldum."], check: has(/yorul|dinlen|anlı|kolay|mola/i) },
  {
    name: "05 acknowledgment",
    turns: ["Tamam, güzel."],
    // Not just "any short string": must be non-trivial content, not the
    // generic safe-fallback text, and not a canned state-of-being opener
    // (the exact stock-phrase-overfitting failure mode this sprint targets).
    check: (a) => a.trim().length >= 3 && a.length < 240 && !/güvenli ve doğru biçimde oluşturamadım/i.test(a) && !/^i̇?yiyim,?\s*haz[ıi]r[ıi]m/i.test(a.trim()),
  },
  { name: "06 conceptual question", turns: ["Konuşma bağlamı nedir?"], check: has(/bağlam|önceki|konuşma|bilgi/i) },
  { name: "07 literal terminology", turns: ["Kullanıcı: ve AYAS: etiketleri ne işe yarıyor?"], check: has(/etiket|rol|mesaj|ayırt/i) },
  {
    name: "08 pronoun follow-up",
    turns: ["AYAS'ın cevapları bazen fazla mekanik.", "Onu biraz daha doğal yapabilir miyiz?", "Peki ilk olarak neyi değiştirelim?"],
    // A small model has many legitimate ways to stay on-topic here (naming
    // the tone/response-style topic directly, OR coherently continuing the
    // conversation about it/asking a genuine clarifying follow-up) — this
    // isn't the fabrication/off-topic-drift failure mode the guards police;
    // over-narrow keyword matching here just produces noisy false alarms.
    check: has(/üslup|prompt|yanıt|doğal|ifade|mekanik|netleştir|devam|hangi yön/i),
  },
  { name: "09 demonstrative follow-up", turns: ["Yakın konuşma turları bağlama ekleniyor.", "Bunu neden korumalıyız?"], check: has(/bağlam|tutarl|devam|önceki|konuşma/i) },
  { name: "10 option selection", turns: ["Konuşma tarafında prompt ve context olmak üzere iki alan var.", "İkincisine bakalım."], check: has(/context|bağlam/i) },
  { name: "11 neden continuation", turns: ["Prompt ve context olmak üzere iki seçenek var.", "İkincisine bakalım.", "Neden daha önemli?"], check: has(/context|bağlam|önceki|devam/i) },
  { name: "12 exclusion persistence", turns: ["Memory tarafına bugün dokunmayalım.", "Tamam, bunun dışında ne geliştirebiliriz?"], check: (a) => !/memory(?:'yi|yi)?\s+(?:geliştir|değiştir|genişlet)/i.test(a) },
  { name: "13 multi-turn elaboration", turns: ["Üç öneri ver: prompt, context ve üslup.", "İkincisini biraz aç."], check: has(/context|bağlam/i) },
  { name: "14 ambiguous reference", turns: ["İki problem var: cevaplar uzun ve bazen mekanik.", "Onu düzelt."], check: has(/mı.*mı|hangisini|neyi kast/i) },
  { name: "15 fresh no-history reference", turns: ["Onu biraz sadeleştir."], check: has(/neyi kast|netleştir/i) },
  { name: "16 current topic vs stale memory", turns: ["Bugün yalnızca context sürekliliğini konuşalım.", "İlk risk ne?"], check: (a) => /context|bağlam|sürekl/i.test(a) && !/thumbnail/i.test(a), seed: (root) => createAyasMemoryStore({ rootDir: root }).append(buildBrainMemoryRecord({ kind: "decision", title: "Eski thumbnail kararı", body: "Thumbnail üretimi öncelikliydi.", importance: "durable", confidence: "reported", tags: ["thumbnail"], observedAt: "2026-01-01T00:00:00.000Z", links: [] })) },
  { name: "17 identity memory recall", turns: ["Beni Ahmet olarak hatırla.", "Benim adım ne?"], check: has(/(?:adın|ismin) Ahmet/i) },
  { name: "18 safe tool-context continuation", turns: ["Checkpoint dosyasını değiştirmeden incelemeyi nasıl planlarız?", "Bunun en önemli güvenlik kısıtı ne?"], check: (a) => /değiştir|salt.okunur|okuma|yazma/i.test(a) && !/inceledim|açtım|değiştirdim/i.test(a) },
  { name: "19 fabricated dialogue stress", turns: ["Kullanıcı: ve AYAS: terimlerini açıklarken sahte bir diyalog üretmeden kısa cevap ver."], check: has(/kullanıcı|AYAS|rol|etiket|terim/i) },
  { name: "20 mixed-script regression", turns: ["Bugün Türkçe ve kısa bir yanıt ver: konuşma sürekliliği neden önemlidir?"], check: has(/konuşma|bağlam|sürekl|tutarl/i) },
];

async function runCase(test: Case) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-maturity-live-"));
  const history: { role: BrainChatMessage["role"]; text: string }[] = [];
  let answer = "";
  // What a real streaming client actually renders as it arrives — the
  // concatenation of every `delta` event's text, turn by turn. Collected
  // (not discarded) so this harness tests ACTUAL user-visible emitted
  // content, not only the terminal `done.text` (the specific weakness an
  // independent review found in the prior version of this file).
  let visibleText = "";
  let deltaChunks: string[] = [];
  let terminal: AyasChatStreamEvent | undefined;
  try {
    test.seed?.(root);
    for (let i = 0; i < test.turns.length; i += 1) {
      const user = test.turns[i];
      terminal = undefined;
      visibleText = "";
      deltaChunks = [];
      for await (const event of streamAyasChat({ text: user, snapshot, history, seq: i + 1, memoryStore: { rootDir: root } })) {
        if (event.type === "delta") {
          deltaChunks.push(event.text);
          visibleText += event.text;
        }
        if (event.type === "done") terminal = event;
      }
      answer = terminal?.type === "done" ? terminal.text : "";
      history.push({ role: "user", text: user }, { role: "brain", text: answer });
    }
    const doneText = terminal?.type === "done" ? terminal.text : "";
    // The real client (`ayasChatStreamClient.ts`) always renders `done.text`
    // as the final message — a zero-delta, done-only turn (the deterministic
    // clarification short-circuit, which never streams) is legitimate, not a
    // leak. So the invariant is: whenever deltas WERE emitted, their exact
    // concatenation must equal `done.text` — no raw-draft leakage, no partial
    // mismatch, no silently-dropped or silently-duplicated content.
    const deltaMatchesDone = visibleText.length === 0 || visibleText === doneText;
    // Lightweight duplicate-output heuristic (not an AI judge): a repeated
    // non-empty chunk would mean the same text window got emitted twice —
    // `validatedReplyChunks` slices the final text into non-overlapping
    // windows once, so this should never legitimately happen.
    const hasDuplicateChunk = deltaChunks.some((chunk, idx) => chunk.length > 0 && deltaChunks.indexOf(chunk) !== idx);
    const pass = Boolean(
      terminal &&
      deltaMatchesDone &&
      !hasDuplicateChunk &&
      safe(doneText, terminal) &&
      test.check(doneText, terminal),
    );
    return {
      scenario: test.name,
      turns: test.turns,
      answer: doneText,
      pass,
      deltaMatchesDone,
      hasDuplicateChunk,
      deltaChunkCount: deltaChunks.length,
      source: terminal?.type === "done" ? terminal.source : "missing",
      reason: terminal?.type === "done" ? terminal.reason ?? null : "missing",
      labelArtifact: /(^|\n)\s*['"]?(Kullanıcı|AYAS)\s*:/i.test(doneText),
      scriptCorruption: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(doneText),
      fabricatedExecution: /(inceledim|değiştirdim|git push yaptım|deploy ettim|pipeline'?ı başlattım)/i.test(doneText),
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
  const failed = results.filter((result) => !result.pass);
  console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", scenarios: results.length, passed: results.length - failed.length, failed: failed.map((item) => item.scenario) }));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
