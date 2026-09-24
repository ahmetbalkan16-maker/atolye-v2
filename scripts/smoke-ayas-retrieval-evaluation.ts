/**
 * AYAS Retrieval Evaluation — deterministic quality benchmark + regression gate.
 *
 *   npx tsx scripts/smoke-ayas-retrieval-evaluation.ts                 # gate (exit 1 on regression)
 *   npx tsx scripts/smoke-ayas-retrieval-evaluation.ts --report <TEMP file> # also write the JSON artifact
 *   npx tsx scripts/smoke-ayas-retrieval-evaluation.ts --failures      # also print safe failure rows
 *   npx tsx scripts/smoke-ayas-retrieval-evaluation.ts --explain <id>  # debug one case, no gate
 *
 * Grades the real retrieval → context → chat path against implementation-
 * independent ground truth (`fixtures/ayas-retrieval-evaluation-cases.ts`),
 * per layer (candidate / ranking / recall block / chat prompt), then gates:
 *   - every case not listed in KNOWN_LIMITATIONS passes every layer; a listed
 *     case may fail only its declared layers and must still fail (a fixed
 *     limitation has to be removed from the list);
 *   - 100% / 0% invariants (exclusive-slot staleness, future/historical as
 *     current, forget, explicit as-of, exact negatives, no network);
 *   - aggregate floors/ceilings at the verified post-remediation values;
 *   - determinism (repeat run, shuffled write order, time zones), linear
 *     scaling, fail-closed error cases, isolation, trace privacy, the
 *     end-to-end chat chains, and no fixture text in production source.
 *
 * TEMP-only (see the evaluator header): no live memory, runtime, authority,
 * provider or network. No LLM judges anything here.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recallAyasMemoryWithTrace } from "../src/lib/ayas/memory/AyasMemoryRecall";
import { retrieveAyasMemory } from "../src/lib/ayas/memory/AyasMemoryRetrieval";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { BoundedAyasTraceStore, startAyasTrace } from "../src/lib/ayas/trace/AyasUnifiedTrace";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { BrainMemoryRecordInput } from "../src/types/brainMemory";
import {
  AYAS_RETRIEVAL_EVALUATION_CASES,
  AYAS_RETRIEVAL_EVALUATION_FIXTURE_VERSION,
  EVAL_NOW,
} from "./fixtures/ayas-retrieval-evaluation-cases";
import {
  assertAyasRetrievalTempRoot,
  benchmarkAyasRetrievalScale,
  buildAyasRetrievalReport,
  computeAyasRetrievalMetrics,
  createAyasRetrievalRunRoot,
  evaluateAyasRetrieval,
  evaluateAyasRetrievalCase,
  explainAyasRetrievalCase,
  ayasRetrievalFailureRows,
  removeAyasRetrievalRunRoot,
  runAyasRetrievalChatTurn,
  stableAyasRetrievalView,
  withAyasRetrievalNetworkGuard,
  type AyasRetrievalCaseResult,
  type AyasRetrievalFailureClass,
  type AyasRetrievalLayer,
} from "./lib/AyasRetrievalEvaluation";
import type { AyasRetrievalCase } from "./fixtures/ayas-retrieval-evaluation-cases";

/* ------------------------------------------------------------------ */
/* Reviewed limitations (baseline classification, Phase 10–11)          */
/* ------------------------------------------------------------------ */

interface KnownLimitation {
  readonly classification: AyasRetrievalFailureClass;
  /** Layers this case is allowed to fail; any other failing layer is a regression. */
  readonly layers: readonly AyasRetrievalLayer[];
  readonly reason: string;
}

const FREE_TEXT = "free text has no exclusive slot, so an explicitly replaced plan/decision stays current next to its replacement (Memory Temporal v2 design gap)";
const CHAT_GATE = "the chat relevance gate needs two shared roots (or one of 7+ letters) before memory reaches the prompt — deliberate anti-leak design, unchanged";
const SAME_TOPIC = "lexical retrieval cannot tell attributes of one topic apart; the right record ranks first but top-K fills with same-topic records";
const RANK_CTX: readonly AyasRetrievalLayer[] = ["ranking", "recall-context", "chat-context"];

const KNOWN_LIMITATIONS: Readonly<Record<string, KnownLimitation>> = {
  "seed:project-decision-free-text": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "exact-pc-plan": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "para-pc-thinking": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "para-pc-plan": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "morph-pc-last-decision": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "morph-pc-card-accusative": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "order-pc-inverted": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "syn-pc-colloquial": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "contradiction-free-text-coffee": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "multi-pc-card-and-ram": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "tr-pc-capitals": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "tr-pc-punctuation": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "tr-pc-typo": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "heldout-pc-card-want": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "heldout-pc-switch": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: FREE_TEXT },
  "asof-pc-july-detected": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: `${FREE_TEXT}; its unknown start makes it "possible" in an earlier window` },
  "distractor-pc-heavy-current": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: `${FREE_TEXT}; ${SAME_TOPIC}` },
  "para-length-how": { classification: "CONTEXT_ASSEMBLY", layers: ["chat-context"], reason: CHAT_GATE },
  "syn-length-yanit": { classification: "CONTEXT_ASSEMBLY", layers: ["chat-context"], reason: CHAT_GATE },
  "superseded-length-old-wording": { classification: "CONTEXT_ASSEMBLY", layers: ["chat-context"], reason: CHAT_GATE },
  "history-length-used-to": { classification: "CONTEXT_ASSEMBLY", layers: ["chat-context"], reason: CHAT_GATE },
  "heldout-voice-length": { classification: "CONTEXT_ASSEMBLY", layers: ["chat-context"], reason: CHAT_GATE },
  "attribute-pc-ram": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: SAME_TOPIC },
  "attribute-pc-current-card": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: SAME_TOPIC },
  "heldout-ram-bellek": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: `${SAME_TOPIC}; "bellek"/"RAM" synonymy is not modelled` },
  "none-same-word-other-meaning": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: "a general question sharing a word with personal memories is indistinguishable lexically" },
  "syn-edit-montaj": { classification: "EXPECTED_LIMITATION", layers: ["candidate", ...RANK_CTX], reason: "no synonym lexicon (montaj/kurgu); no embeddings by design" },
  "future-plan-question": { classification: "EXPECTED_LIMITATION", layers: RANK_CTX, reason: "plans are reachable only through as-of/history; current recall never presents a plan (by design)" },
  "seed:identity-known-at-january": { classification: "QUERY_NORMALIZATION", layers: ["query", "chat-context"], reason: 'the temporal detector does not read "<month> sonunda … biliniyordu" (explicit query is correct)' },
  "seed:historical-recorded-today": { classification: "QUERY_NORMALIZATION", layers: ["query", "chat-context"], reason: 'the temporal detector does not read "ne zaman … -dum" as a history question' },
};

/**
 * Verified post-remediation values (Phase 21). Floors may only rise; a drop
 * is a regression. Error rates are ceilings.
 */
const FLOORS = {
  candidateRecall: 0.983,
  recallAt1: 0.862,
  recallAtK: 0.967,
  hitRateAt1: 0.903,
  hitRateAtK: 0.967,
  mrr: 0.924,
  precisionAt1: 0.918,
  selectionPrecision: 0.728,
  queryModeAccuracy: 0.972,
  currentCorrectRate: 0.596,
  historyCorrectRate: 1,
  asOfCorrectRate: 0.666,
  conflictCorrectRate: 0.8,
  abstentionCorrectRate: 0.916,
  recallRequiredDelivered: 0.967,
  chatRequiredDelivered: 0.816,
  heldOutHitRateAtK: 1,
  heldOutMrr: 0.833,
} as const;
const CEILINGS = {
  staleSelectionRate: 0.378,
  falsePositiveSelectionRate: 0.084,
  distractorSelectionRate: 0.091,
  recallStaleContext: 0.378,
  recallContradictoryContext: 0.422,
  chatStaleContext: 0.387,
  chatContradictoryContext: 0.369,
  chatDistractorDelivery: 0.073,
  chatAbstainLeak: 0.084,
  /** retrieval(2000 records) / retrieval(500): linear ≈ 4, quadratic ≈ 16. */
  scaleRatio: 10,
} as const;

/* ------------------------------------------------------------------ */

const gateFailures: string[] = [];
function gate(condition: boolean, message: string): void {
  if (!condition) gateFailures.push(message);
}
function atLeast(name: string, value: number | null, floor: number): void {
  gate(value !== null && value >= floor, `${name} ${value?.toFixed(4) ?? "n/a"} < floor ${floor}`);
}
function atMost(name: string, value: number | null, ceiling: number): void {
  gate(value !== null && value <= ceiling, `${name} ${value?.toFixed(4) ?? "n/a"} > ceiling ${ceiling}`);
}
const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function commit(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

function fold(text: string): string {
  return text.toLocaleLowerCase("tr").replace(/[İıI]/g, "i").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ğ/g, "g").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function identityInput(name: string, observedAt: string): BrainMemoryRecordInput {
  return {
    kind: "user-preference", title: "Kullanıcı kimliği / hitap tercihi", body: `beni ${name} olarak hatırla`,
    importance: "durable", confidence: "reported", tags: ["kimlik"], observedAt, links: [],
    temporal: { assertion: "current", provenance: "direct-user-statement", recordedAt: observedAt, factKey: "user.identity.name", factValue: name.toLocaleLowerCase("tr") },
  };
}

function sha(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/* ------------------------------------------------------------------ */

async function checkLimitations(results: readonly AyasRetrievalCaseResult[]): Promise<void> {
  const ids = new Set(results.map((r) => r.caseId));
  for (const id of Object.keys(KNOWN_LIMITATIONS)) gate(ids.has(id), `limitation ${id} names no case`);
  for (const result of results) {
    const limitation = KNOWN_LIMITATIONS[result.caseId];
    const failed = (Object.keys(result.layerPass) as AyasRetrievalLayer[]).filter((layer) => !result.layerPass[layer]);
    if (!limitation) {
      gate(result.pass, `REGRESSION ${result.caseId}: failed ${failed.join(",")} (${result.failures.map((f) => f.code).join(" ")})`);
      continue;
    }
    gate(!result.pass, `IMPROVED ${result.caseId}: now passes — remove it from KNOWN_LIMITATIONS`);
    const unexpected = failed.filter((layer) => !limitation.layers.includes(layer));
    gate(unexpected.length === 0, `REGRESSION ${result.caseId}: new failing layer(s) ${unexpected.join(",")}`);
  }
}

/** Layer A counts a category-label match even if admission later removes it. */
async function checkCandidateLayerSeparation(): Promise<void> {
  const observedAt = "2026-09-10T09:00:00.000Z";
  const input = (body: string): BrainMemoryRecordInput => ({
    kind: "user-preference", title: "Kullanıcı tercihi", body, importance: "durable",
    confidence: "reported", tags: ["tercih"], observedAt, links: [],
  });
  const testCase: AyasRetrievalCase = {
    id: "candidate-layer-separation", category: "same-topic-other-attribute", description: "category-only candidate is not selected",
    source: "new", nowIso: EVAL_NOW,
    corpus: [
      { key: "voice", input: input("seslendirmede tok erkek ses tonu tercih ederim") },
      { key: "coffee", input: input("sabah filtre kahve içerim") },
    ],
    query: { text: "seslendirme tercihim ne?" },
    expect: { queryMode: "current", relevant: ["voice"], forbidden: { coffee: "distractor" } },
  };
  const root = createAyasRetrievalRunRoot("candidate");
  try {
    const result = await evaluateAyasRetrievalCase(testCase, root, { chat: false });
    gate(result.matchedKeys.join(",") === "coffee,voice" && result.candidateCount === 2,
      "Layer A must count category-only candidate before admission");
    gate(result.selectedKeys.join(",") === "voice", "Layer B must remove the unrelated category-only candidate");
  } finally {
    removeAyasRetrievalRunRoot(root);
  }
}

async function checkErrorCases(): Promise<number> {
  const root = createAyasRetrievalRunRoot("errors");
  let count = 0;
  try {
    const good = buildBrainMemoryRecord(identityInput("Ahmet", "2026-09-01T09:00:00.000Z"));
    const variants: Record<string, (file: string) => void> = {
      unreadable: (file) => fs.mkdirSync(file, { recursive: true }),
      malformed: (file) => fs.writeFileSync(file, "{ not json", "utf8"),
      "unknown-schema": (file) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: "99", records: [good] }), "utf8"),
      "corrupted-record": (file) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: "1", records: [good, { ...good, recordId: 42 }] }), "utf8"),
      "malformed-v2": (file) => fs.writeFileSync(file, JSON.stringify({ schemaVersion: "1", records: [{ ...good, temporal: { ...good.temporal, version: 99 } }] }), "utf8"),
    };
    for (const [name, write] of Object.entries(variants)) {
      const caseRoot = assertAyasRetrievalTempRoot(path.join(root, name));
      fs.mkdirSync(path.join(caseRoot, "memory"), { recursive: true });
      const file = path.join(caseRoot, "memory", "records.json");
      write(file);
      const before = fs.statSync(file).isFile() ? sha(file) : "dir";
      const recall = await recallAyasMemoryWithTrace("benim adım ne?", { nowIso: EVAL_NOW, store: { rootDir: caseRoot } });
      gate(recall.status === "unreadable" && recall.lines.length === 0, `error case ${name}: recall must fail closed with no lines (got ${recall.status}/${recall.lines.length})`);
      const turn = await runAyasRetrievalChatTurn("benim adım ne?", caseRoot, EVAL_NOW);
      gate(!turn.prompts.some((prompt) => /ahmet/i.test(prompt)) && !/ahmet/i.test(turn.done.text), `error case ${name}: chat must not surface the unreadable store's content`);
      gate((fs.statSync(file).isFile() ? sha(file) : "dir") === before, `error case ${name}: the store must not be rewritten`);
      count += 1;
    }
    // Invalid as-of timestamp: nothing selected, current state never substituted.
    const invalid = retrieveAyasMemory([good], "adım neydi", { nowIso: EVAL_NOW, temporal: { mode: "as-of", at: "not-a-date" } });
    gate(invalid.invalidTemporalQuery && invalid.selected.length === 0, "invalid as-of timestamp must select nothing");
    count += 1;
    // Duplicate record ids: either the store fails closed or retrieval dedupes; never a duplicated context line.
    const dupRoot = assertAyasRetrievalTempRoot(path.join(root, "duplicate"));
    fs.mkdirSync(path.join(dupRoot, "memory"), { recursive: true });
    fs.writeFileSync(path.join(dupRoot, "memory", "records.json"), JSON.stringify({ schemaVersion: "1", records: [good, good] }), "utf8");
    const dup = await recallAyasMemoryWithTrace("benim adım ne?", { nowIso: EVAL_NOW, store: { rootDir: dupRoot } });
    gate(dup.status === "unreadable" || (dup.lines.length === 1 && new Set(dup.lines).size === dup.lines.length), `duplicate ids must fail closed or dedupe (got ${dup.status}/${dup.lines.length})`);
    count += 1;
    // Empty corpus: no store file at all.
    const empty = await recallAyasMemoryWithTrace("benim adım ne?", { nowIso: EVAL_NOW, store: { rootDir: assertAyasRetrievalTempRoot(path.join(root, "empty")) } });
    gate(empty.status === "ok" && empty.lines.length === 0, "empty corpus must recall nothing");
    count += 1;
  } finally {
    removeAyasRetrievalRunRoot(root);
  }
  return count;
}

async function checkIsolationAndPrivacy(): Promise<number> {
  let count = 0;
  // The benchmark also runs from a clean source archive inside os.tmpdir();
  // cwd-relative paths there are valid TEMP paths, so test absolute outsiders.
  for (const bad of [path.join(path.parse(os.tmpdir()).root, "ayas-memory-outside-temp"), os.homedir(), path.join(os.homedir(), "ayas-memory")]) {
    assert.throws(() => assertAyasRetrievalTempRoot(bad), /outside the OS temp directory/);
    count += 1;
  }
  const root = createAyasRetrievalRunRoot("isolation");
  try {
    const a = assertAyasRetrievalTempRoot(path.join(root, "a"));
    const b = assertAyasRetrievalTempRoot(path.join(root, "b"));
    createAyasMemoryStore({ rootDir: a }).append(buildBrainMemoryRecord(identityInput("Ahmet", "2026-09-01T09:00:00.000Z")));
    createAyasMemoryStore({ rootDir: b }).append(buildBrainMemoryRecord(identityInput("Mehmet", "2026-09-01T09:00:00.000Z")));
    for (const temporal of [undefined, { mode: "current" as const, includeHistory: true }, { mode: "as-of" as const, at: "2026-09-10T00:00:00.000Z" }]) {
      const fromA = await recallAyasMemoryWithTrace("benim adım ne?", { nowIso: EVAL_NOW, store: { rootDir: a }, ...(temporal ? { temporal } : {}) });
      gate(fromA.lines.length === 1 && fromA.lines.every((line) => line.includes("Ahmet") && !line.includes("Mehmet")), `cross-root isolation (${temporal?.mode ?? "current"}${temporal && "includeHistory" in temporal ? "+history" : ""})`);
      count += 1;
    }
    const turnB = await runAyasRetrievalChatTurn("benim adım ne?", b, EVAL_NOW);
    gate(!turnB.prompts.some((prompt) => prompt.includes("Ahmet")) && !turnB.done.text.includes("Ahmet"), "chat on root B never sees root A");
    count += 1;

    // Unified Trace: counts and flags only — no bodies, names, query text or case ids.
    const store = new BoundedAyasTraceStore();
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "retrieval-eval", store });
    const pcCase = AYAS_RETRIEVAL_EVALUATION_CASES.find((c) => c.id === "para-pc-thinking")!;
    const traced = assertAyasRetrievalTempRoot(path.join(root, "traced"));
    const traceStore = createAyasMemoryStore({ rootDir: traced });
    for (const entry of pcCase.corpus) traceStore.append(buildBrainMemoryRecord(entry.input));
    traceStore.append(buildBrainMemoryRecord(identityInput("Mehmet", "2026-09-01T09:00:00.000Z")));
    await runAyasRetrievalChatTurn(pcCase.query.text, traced, pcCase.nowIso, { trace });
    await runAyasRetrievalChatTurn("benim adım ne?", traced, pcCase.nowIso, { trace });
    trace.finish("ok");
    const serialized = fold(JSON.stringify(store.get(trace.traceId, "retrieval-eval")));
    const memory = store.get(trace.traceId, "retrieval-eval")?.spans.filter((span) => span.kind === "memory") ?? [];
    gate(memory.length > 0 && memory.every((span) => typeof span.metadata?.candidateCount === "number"), "trace carries memory spans with counts");
    for (const secret of [...pcCase.corpus.map((entry) => entry.input.body), pcCase.query.text, "mehmet", "rtx", pcCase.id, "pcPlanNew"]) {
      gate(!serialized.includes(fold(secret)), `trace leaked fixture content (${fold(secret).slice(0, 12)}…)`);
    }
    count += 1;
  } finally {
    removeAyasRetrievalRunRoot(root);
  }
  return count;
}

/** Phase 26–27: write → retrieve → context → answer, through real chat turns at frozen times. */
async function checkChatChains(): Promise<number> {
  const root = createAyasRetrievalRunRoot("chain");
  let count = 0;
  const memoryLines = (prompts: readonly string[]) => prompts.flatMap((prompt) => prompt.split("\n")).filter((line) => /^\s*·\s*\(/.test(line));
  try {
    const identityRoot = assertAyasRetrievalTempRoot(path.join(root, "identity"));
    await runAyasRetrievalChatTurn("beni Ahmet olarak hatırla", identityRoot, "2026-08-01T09:00:00.000Z", { reply: "Tamam, Ahmet." });
    await runAyasRetrievalChatTurn("artık beni Mehmet olarak hatırla", identityRoot, "2026-09-01T09:00:00.000Z", { reply: "Tamam, Mehmet." });
    gate(createAyasMemoryStore({ rootDir: identityRoot }).load().filter((record) => record.tags.includes("kimlik")).length === 2, "chain: both identity statements persisted");

    const current = await runAyasRetrievalChatTurn("benim adım ne?", identityRoot, EVAL_NOW, { reply: "Adın Mehmet." });
    gate(/mehmet/i.test(current.done.text) && !/ahmet/i.test(current.done.text), "chain: current name answer is Mehmet");
    gate(!memoryLines(current.prompts).some((line) => line.includes("Ahmet")), "chain: superseded name never reaches the prompt");
    const wrong = await runAyasRetrievalChatTurn("benim adım ne?", identityRoot, EVAL_NOW, { reply: "Adın Ahmet." });
    gate(!/\bahmet\b/i.test(wrong.done.text), "chain: a model answer with the superseded name is corrected");
    const august = await runAyasRetrievalChatTurn("Ağustos ayında adım neydi?", identityRoot, EVAL_NOW, { reply: "Ağustos'ta sana Ahmet diyordum." });
    gate(memoryLines(august.prompts).some((line) => line.includes("Ahmet") && /\[[^\]]+\]/.test(line)), "chain: as-of question reaches the old name, annotated with its time");
    gate(/ahmet/i.test(august.done.text), "chain: historical answer is not replaced by the current name");
    count += 4;

    const prefRoot = assertAyasRetrievalTempRoot(path.join(root, "preference"));
    await runAyasRetrievalChatTurn("bundan sonra cevapları kısa tut", prefRoot, "2026-08-05T09:00:00.000Z", { reply: "Tamam." });
    await runAyasRetrievalChatTurn("bundan sonra cevapları uzun ve detaylı yaz", prefRoot, "2026-09-10T09:00:00.000Z", { reply: "Tamam." });
    const pref = await runAyasRetrievalChatTurn("cevap uzunluğu tercihim ne?", prefRoot, EVAL_NOW, { reply: "Uzun ve detaylı istiyorsun." });
    const prefLines = memoryLines(pref.prompts);
    gate(prefLines.some((line) => line.includes("uzun ve detaylı")) && !prefLines.some((line) => line.includes("kısa tut")), "chain: current length preference reaches the prompt, the replaced one does not");
    count += 1;

    const none = await runAyasRetrievalChatTurn("yarın hava nasıl olacak?", prefRoot, EVAL_NOW, { reply: "Bilmiyorum." });
    gate(memoryLines(none.prompts).length === 0, "chain: an unrelated question carries no memory");
    count += 1;

    const disputedRoot = assertAyasRetrievalTempRoot(path.join(root, "disputed"));
    const disputed = createAyasMemoryStore({ rootDir: disputedRoot });
    disputed.append(buildBrainMemoryRecord(identityInput("Ahmet", "2026-09-10T09:00:00.000Z")));
    disputed.append(buildBrainMemoryRecord(identityInput("Mehmet", "2026-09-10T09:00:00.000Z")));
    const ambiguous = await runAyasRetrievalChatTurn("benim adım ne?", disputedRoot, EVAL_NOW, { reply: "Emin değilim, nasıl hitap etmemi istersin?" });
    gate(!/ahmet|mehmet/i.test(ambiguous.done.text) && memoryLines(ambiguous.prompts).length === 0, "chain: a disputed name is neither recalled nor asserted");
    count += 1;
  } finally {
    removeAyasRetrievalRunRoot(root);
  }
  return count;
}

/** Phase 31: production code must not recognise benchmark content. */
function checkNoFixtureLeakage(): number {
  const needles = new Set<string>();
  for (const testCase of AYAS_RETRIEVAL_EVALUATION_CASES.filter((c) => c.source === "new")) {
    needles.add(testCase.id);
    for (const entry of testCase.corpus) {
      if (/[A-Z]/.test(entry.key)) needles.add(entry.key);
      // "beni X olarak hatırla" is the extractor's own canonical identity sentence, documented in its source.
      const body = fold(entry.input.body);
      if (!/^beni \p{L}+ olarak hatirla$/u.test(body)) needles.add(body);
    }
    const query = fold(testCase.query.text);
    if (query.split(" ").length >= 4) needles.add(query);
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  for (const dir of ["src", "app"]) if (fs.existsSync(dir)) walk(dir);
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const folded = fold(raw);
    for (const needle of needles) {
      const hit = /[A-Z]|[:-]/.test(needle) ? raw.includes(needle) : folded.includes(needle);
      gate(!hit, `fixture text "${needle.slice(0, 24)}" found in production source: ${path.relative(process.cwd(), file)}`);
    }
  }
  return files.length;
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const cases = AYAS_RETRIEVAL_EVALUATION_CASES;
  const explainId = argValue("--explain");
  if (explainId) {
    const testCase = cases.find((c) => c.id === explainId);
    if (!testCase) throw new Error(`no case ${explainId}`);
    console.log(JSON.stringify(await explainAyasRetrievalCase(testCase), null, 2));
    return;
  }

  const { results, networkAttempts } = await evaluateAyasRetrieval(cases);
  gate(networkAttempts === 0, `network attempts during evaluation: ${networkAttempts}`);
  const metrics = computeAyasRetrievalMetrics(results);
  await checkCandidateLayerSeparation();

  // Determinism (Phase 16): repeat, shuffled write order, time zones.
  const baseline = stableAyasRetrievalView(results);
  const repeat = await evaluateAyasRetrieval(cases);
  const shuffled = await evaluateAyasRetrieval(cases, { shuffleSeed: 20260924 });
  const originalTz = process.env.TZ;
  const zones: Record<string, boolean> = {};
  try {
    for (const zone of ["America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      zones[zone] = stableAyasRetrievalView((await evaluateAyasRetrieval(cases)).results) === baseline;
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
  const determinism = {
    repeatRun: stableAyasRetrievalView(repeat.results) === baseline,
    shuffledWriteOrder: stableAyasRetrievalView(shuffled.results) === baseline,
    ...Object.fromEntries(Object.entries(zones).map(([zone, same]) => [`tz:${zone}`, same])),
  };
  for (const [name, same] of Object.entries(determinism)) gate(same, `nondeterministic result: ${name}`);

  // Scale (Phase 20).
  const pc = cases.find((c) => c.id === "exact-pc-plan")!;
  const scale = await withAyasRetrievalNetworkGuard(() => benchmarkAyasRetrievalScale({
    corpus: pc.corpus, query: pc.query.text, nowIso: pc.nowIso, targetKey: "pcPlanNew", staleKey: "pcPlanOld",
    sizes: [50, 200, 500, 2000], repetitions: 15, storeCap: 500,
  }));
  const at = (records: number) => scale.value.find((row) => row.records === records)!;
  atMost("scale ratio retrieval(2000)/retrieval(500)", at(2000).medianRetrievalMs / at(500).medianRetrievalMs, CEILINGS.scaleRatio);
  gate(scale.value.every((row) => row.targetSelected), "the current plan must stay in the top-K at every corpus size");

  // Hard invariants (must be 100% / 0%).
  const t = metrics.temporal;
  gate(t.supersededSelectionRate === 0, "an exclusive-slot superseded value was selected in current recall");
  gate(metrics.context.recall.STALE_CONTEXT_RATE_CLEAN_EXCLUSIVE === 0 && metrics.context.chat.STALE_CONTEXT_RATE_CLEAN_EXCLUSIVE === 0, "stale exclusive-slot fact reached the context");
  gate(t.futureAsCurrentRate === 0, "a plan was selected as a current fact");
  gate(t.historicalAsCurrentRate === 0, "a past fact was selected as a current fact");
  gate(t.deletedResurrectionRate === 0, "a forgotten memory resurrected");
  gate(t.explicitAsOfCorrectRate === 1, "an explicitly labelled as-of case failed");
  gate(metrics.negative.strictNegativeCorrectRate === 1, "an exact negative control selected or delivered something");
  gate(results.every((r) => !r.forbiddenSelected.some((f) => f.reason === "disputed" || f.reason === "conflicting")), "a disputed/conflicting value was selected");
  gate(metrics.context.recall.duplicateRate === 0 && metrics.context.chat.duplicateRate === 0, "duplicated context lines");

  // Floors / ceilings at the verified values.
  atLeast("candidate recall", metrics.candidate.recall, FLOORS.candidateRecall);
  atLeast("Recall@1", metrics.ranking.recallAt1, FLOORS.recallAt1);
  atLeast("Recall@K", metrics.ranking.recallAtK, FLOORS.recallAtK);
  atLeast("HitRate@1", metrics.ranking.hitRateAt1, FLOORS.hitRateAt1);
  atLeast("HitRate@K", metrics.ranking.hitRateAtK, FLOORS.hitRateAtK);
  atLeast("MRR", metrics.ranking.mrr, FLOORS.mrr);
  atLeast("Precision@1", metrics.ranking.precisionAt1, FLOORS.precisionAt1);
  atLeast("selection precision", metrics.ranking.selectionPrecision, FLOORS.selectionPrecision);
  atLeast("query-mode accuracy", t.queryModeAccuracy, FLOORS.queryModeAccuracy);
  atLeast("current correctness", t.currentCorrectRate, FLOORS.currentCorrectRate);
  atLeast("history correctness", t.historyCorrectRate, FLOORS.historyCorrectRate);
  atLeast("as-of correctness", t.asOfCorrectRate, FLOORS.asOfCorrectRate);
  atLeast("conflict correctness", t.conflictCorrectRate, FLOORS.conflictCorrectRate);
  atLeast("abstention correctness", metrics.negative.abstentionCorrectRate, FLOORS.abstentionCorrectRate);
  atLeast("recall-block required delivery", metrics.context.recall.requiredDeliveredRate, FLOORS.recallRequiredDelivered);
  atLeast("chat required delivery", metrics.context.chat.requiredDeliveredRate, FLOORS.chatRequiredDelivered);
  atLeast("held-out HitRate@K", metrics.heldOut.hitRateAtK, FLOORS.heldOutHitRateAtK);
  atLeast("held-out MRR", metrics.heldOut.mrr, FLOORS.heldOutMrr);
  atMost("stale selection rate", t.staleSelectionRate, CEILINGS.staleSelectionRate);
  atMost("false-positive selection rate", metrics.negative.falsePositiveSelectionRate, CEILINGS.falsePositiveSelectionRate);
  atMost("distractor selection rate", metrics.negative.distractorSelectionRate, CEILINGS.distractorSelectionRate);
  atMost("recall STALE_CONTEXT_RATE", metrics.context.recall.STALE_CONTEXT_RATE, CEILINGS.recallStaleContext);
  atMost("recall CONTRADICTORY_CONTEXT_RATE", metrics.context.recall.CONTRADICTORY_CONTEXT_RATE, CEILINGS.recallContradictoryContext);
  atMost("chat STALE_CONTEXT_RATE", metrics.context.chat.STALE_CONTEXT_RATE, CEILINGS.chatStaleContext);
  atMost("chat CONTRADICTORY_CONTEXT_RATE", metrics.context.chat.CONTRADICTORY_CONTEXT_RATE, CEILINGS.chatContradictoryContext);
  atMost("chat distractor delivery", metrics.context.chat.distractorDeliveryRate, CEILINGS.chatDistractorDelivery);
  atMost("chat abstain leak", metrics.context.chat.abstainLeakRate, CEILINGS.chatAbstainLeak);

  await checkLimitations(results);
  const errorCases = await withAyasRetrievalNetworkGuard(checkErrorCases);
  const isolation = await withAyasRetrievalNetworkGuard(checkIsolationAndPrivacy);
  const chains = await withAyasRetrievalNetworkGuard(checkChatChains);
  gate(errorCases.networkAttempts + isolation.networkAttempts + chains.networkAttempts + scale.networkAttempts === 0, "network attempted outside the main evaluation");
  const scannedFiles = checkNoFixtureLeakage();

  const reportPath = argValue("--report");
  if (reportPath) {
    const resolvedReport = path.resolve(reportPath);
    const tempRoot = fs.realpathSync(os.tmpdir());
    const realParent = fs.realpathSync(path.dirname(resolvedReport));
    gate(realParent === tempRoot || realParent.startsWith(tempRoot + path.sep), "report path must be inside the OS temp directory");
    gate(!fs.existsSync(resolvedReport), "report path must be a new file");
    if (gateFailures.some((failure) => failure.startsWith("report path"))) throw new Error("unsafe retrieval report path");
    const report = buildAyasRetrievalReport({
      cases, fixtureVersion: AYAS_RETRIEVAL_EVALUATION_FIXTURE_VERSION, commit: commit(), results, networkAttempts, scale: scale.value, determinism,
    });
    fs.writeFileSync(resolvedReport, `${JSON.stringify({ ...report, knownLimitations: KNOWN_LIMITATIONS, gateFailures }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }

  const c = metrics.counts;
  const lines = [
    `cases ${c.cases} (seed ${c.seed}, new ${c.new}, held-out ${c.heldOut}); all-layer pass ${c.passed}; known limitations ${Object.keys(KNOWN_LIMITATIONS).length}`,
    `candidate recall ${pct(metrics.candidate.recall)} | Recall@1 ${pct(metrics.ranking.recallAt1)} Recall@${metrics.ranking.k} ${pct(metrics.ranking.recallAtK)} | HitRate@1 ${pct(metrics.ranking.hitRateAt1)} HitRate@${metrics.ranking.k} ${pct(metrics.ranking.hitRateAtK)} | MRR ${metrics.ranking.mrr?.toFixed(3)} | P@1 ${pct(metrics.ranking.precisionAt1)} selection precision ${pct(metrics.ranking.selectionPrecision)}`,
    `temporal: query mode ${pct(t.queryModeAccuracy)} current ${pct(t.currentCorrectRate)} history ${pct(t.historyCorrectRate)} as-of ${pct(t.asOfCorrectRate)} (explicit ${pct(t.explicitAsOfCorrectRate)}) | stale sel ${pct(t.staleSelectionRate)} (slot ${pct(t.supersededSelectionRate)}, free text ${pct(t.freeTextStaleSelectionRate)}) future-as-current ${pct(t.futureAsCurrentRate)} conflict ${pct(t.conflictCorrectRate)} forget-resurrection ${pct(t.deletedResurrectionRate)}`,
    `negative: abstention ${pct(metrics.negative.abstentionCorrectRate)} strict ${pct(metrics.negative.strictNegativeCorrectRate)} false-positive sel ${pct(metrics.negative.falsePositiveSelectionRate)} distractor sel ${pct(metrics.negative.distractorSelectionRate)}`,
    `context recall block: required ${pct(metrics.context.recall.requiredDeliveredRate)} STALE ${pct(metrics.context.recall.STALE_CONTEXT_RATE)} (clean slot ${pct(metrics.context.recall.STALE_CONTEXT_RATE_CLEAN_EXCLUSIVE)}) CONTRADICTORY ${pct(metrics.context.recall.CONTRADICTORY_CONTEXT_RATE)}`,
    `context chat prompt: required ${pct(metrics.context.chat.requiredDeliveredRate)} STALE ${pct(metrics.context.chat.STALE_CONTEXT_RATE)} (clean slot ${pct(metrics.context.chat.STALE_CONTEXT_RATE_CLEAN_EXCLUSIVE)}) CONTRADICTORY ${pct(metrics.context.chat.CONTRADICTORY_CONTEXT_RATE)} abstain leak ${pct(metrics.context.chat.abstainLeakRate)}`,
    `held-out: pass ${pct(metrics.heldOut.passRate)} HitRate@K ${pct(metrics.heldOut.hitRateAtK)} MRR ${metrics.heldOut.mrr?.toFixed(3)} | in-sample: pass ${pct(metrics.inSample.passRate)} HitRate@K ${pct(metrics.inSample.hitRateAtK)} MRR ${metrics.inSample.mrr?.toFixed(3)}`,
    `latency (median): retrieval ${metrics.latency.medianRetrievalMs?.toFixed(2)} ms, recall ${metrics.latency.medianRecallMs?.toFixed(2)} ms | scale ${scale.value.map((row) => `${row.records}:${row.medianRetrievalMs.toFixed(1)}ms`).join(" ")}`,
    `determinism ${Object.entries(determinism).map(([k, v]) => `${k}=${v}`).join(" ")} | error cases ${errorCases.value} | isolation/privacy ${isolation.value} | chat chains ${chains.value} | leakage scan ${scannedFiles} files`,
  ];
  for (const line of lines) console.log(line);
  if (process.argv.includes("--failures")) console.log(JSON.stringify(ayasRetrievalFailureRows(results), null, 2));

  if (gateFailures.length > 0) {
    console.error(`FAIL (${gateFailures.length} gate failure(s))`);
    for (const failure of gateFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`PASS (${cases.length} cases, ${Object.keys(determinism).length} determinism checks, ${errorCases.value} error cases, ${isolation.value} isolation/privacy checks, ${chains.value} chat chains)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
