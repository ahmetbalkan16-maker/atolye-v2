/**
 * AYAS Retrieval Evaluation — deterministic evaluator (test/debug only).
 *
 * Grades the REAL retrieval path against implementation-independent ground
 * truth (`scripts/fixtures/ayas-retrieval-evaluation-cases.ts`) at three
 * separate layers, never collapsed into one number:
 *
 *   A  candidate   did the right record get any relevance signal at all
 *                  (lexical or concept), before temporal filtering?
 *   B  ranking     after temporal/conflict quarantine, where does it rank, is
 *                  it in the production top-K, and did anything temporally
 *                  wrong or off-topic get selected?
 *   C  context     what actually reached the context: C1 the recall block
 *                  (`recallAyasMemoryWithTrace`, char budget) and C2 the model
 *                  prompt / answer of a real `streamAyasChat` turn (second
 *                  relevance gate included).
 *
 * Isolation: every store lives under a run-owned `os.tmpdir()` folder and the
 * evaluator refuses any other root; the model is a captured in-process fake,
 * `env` carries no provider settings and global `fetch` is replaced by a throwing guard, so no
 * provider, network, live memory, runtime or authority can be reached.
 * Determinism: every read passes the case's `nowIso`; chat turns (which read
 * the clock themselves) run under a frozen `Date`.
 *
 * Reports carry semantic keys, counts and codes only — never memory bodies.
 * Relative imports only (scripts may run from any cwd).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { streamAyasChat, type AyasChatStreamEvent } from "../../src/lib/ayas/AyasChatStream";
import { recallAyasMemoryWithTrace, stripAyasMemoryLineAnnotation } from "../../src/lib/ayas/memory/AyasMemoryRecall";
import { retrieveAyasMemory, type AyasMemoryRetrievalDecision } from "../../src/lib/ayas/memory/AyasMemoryRetrieval";
import { createAyasMemoryStore } from "../../src/lib/ayas/memory/AyasMemoryStore";
import {
  detectAyasMemoryTemporalQuery,
  resolveAyasMemoryTemporal,
  type AyasMemoryTemporalQuery,
} from "../../src/lib/ayas/memory/AyasMemoryTemporal";
import type { AyasTraceHandle } from "../../src/lib/ayas/trace/AyasUnifiedTrace";
import { buildBrainMemoryRecord } from "../../src/lib/brain/BrainMemoryModel";
import type { BrainConsoleSnapshot } from "../../src/lib/brain/ui/BrainConsoleSnapshot";
import type { BrainMemoryRecord, BrainMemoryRecordInput } from "../../src/types/brainMemory";
import {
  AYAS_RETRIEVAL_STALE_REASONS,
  type AyasRetrievalCase,
  type AyasRetrievalCategory,
  type AyasRetrievalForbiddenReason,
  type AyasRetrievalLanguageTag,
  type AyasRetrievalQueryModeLabel,
} from "../fixtures/ayas-retrieval-evaluation-cases";

/** Mirrors the production `TOP_K` (AyasMemoryRetrieval / AyasMemoryRecall); verified per case. */
export const AYAS_RETRIEVAL_EVAL_TOP_K = 4;
export const AYAS_RETRIEVAL_EVAL_SCHEMA_VERSION = "1";

export type AyasRetrievalFailureClass =
  | "QUERY_NORMALIZATION"
  | "CANDIDATE_GENERATION"
  | "TEMPORAL_FILTER"
  | "RANKING"
  | "CONFLICT_RESOLUTION"
  | "CONTEXT_ASSEMBLY"
  | "FIXTURE_PROBLEM"
  | "EXPECTED_LIMITATION";

export type AyasRetrievalLayer = "query" | "candidate" | "ranking" | "recall-context" | "chat-context";

export interface AyasRetrievalFailure {
  readonly layer: AyasRetrievalLayer;
  readonly code: string;
  readonly keys: readonly string[];
  /** Mechanical first guess; the regression gate's limitation map holds the reviewed class. */
  readonly suggested: AyasRetrievalFailureClass;
}

export interface AyasRetrievalKeyedReason {
  readonly key: string;
  readonly reason: string;
}

export interface AyasRetrievalDelivery {
  /** Delivered keys in order (duplicates kept so they can be counted). */
  readonly keys: readonly string[];
  readonly requiredDelivered: boolean;
  readonly relevantRecall: number | null;
  readonly forbidden: readonly AyasRetrievalKeyedReason[];
  readonly contradictory: boolean;
  readonly duplicates: number;
  readonly unmapped: number;
  /** Chat only: whether any model prompt was built this turn. */
  readonly modelCalled?: boolean;
}

export interface AyasRetrievalCaseResult {
  readonly caseId: string;
  readonly category: AyasRetrievalCategory;
  readonly languageTags: readonly AyasRetrievalLanguageTag[];
  readonly heldOut: boolean;
  readonly source: "seed" | "new";
  readonly explicitTemporal: boolean;
  readonly expectedQueryMode: AyasRetrievalQueryModeLabel;
  /** Mode the natural text expresses; `null` when it does not carry the explicit window (not scored). */
  readonly naturalQueryMode: AyasRetrievalQueryModeLabel | null;
  readonly detectedQueryMode: AyasRetrievalQueryModeLabel;
  readonly relevant: readonly string[];
  readonly required: readonly string[];
  readonly forbiddenLabels: Readonly<Record<string, AyasRetrievalForbiddenReason>>;
  readonly strictNegative: boolean;
  readonly hasContradictionGroups: boolean;
  /** Records the candidate stage considered (after expiry, dedupe and knownAt). */
  readonly poolSize: number;
  /** Records with any relevance signal, before temporal filtering (Layer A). */
  readonly candidateCount: number;
  /** Relevant, unquarantined records in rank order (Layer B, full list). */
  readonly eligibleCount: number;
  readonly matchedKeys: readonly string[];
  readonly rankedKeys: readonly string[];
  readonly selectedKeys: readonly string[];
  readonly quarantined: readonly AyasRetrievalKeyedReason[];
  readonly candidateRecall: number | null;
  readonly firstRelevantRank: number | null;
  readonly reciprocalRank: number | null;
  readonly recallAt1: number | null;
  readonly recallAtK: number | null;
  readonly hitAt1: boolean | null;
  readonly hitAtK: boolean | null;
  readonly precisionAt1: number | null;
  readonly selectionPrecision: number | null;
  readonly forbiddenSelected: readonly AyasRetrievalKeyedReason[];
  readonly contradictorySelection: boolean;
  readonly abstainCorrect: boolean | null;
  readonly certaintyCorrect: boolean | null;
  readonly recallContext: AyasRetrievalDelivery;
  readonly chatContext: AyasRetrievalDelivery | null;
  readonly layerPass: Readonly<Record<AyasRetrievalLayer, boolean>>;
  readonly pass: boolean;
  readonly failures: readonly AyasRetrievalFailure[];
  readonly timing: { readonly retrievalMs: number; readonly recallMs: number; readonly chatMs: number };
}

export interface AyasRetrievalEvaluationOptions {
  /** Run Layer C2 through a real `streamAyasChat` turn (default true). */
  readonly chat?: boolean;
  /** Deterministic permutation of each corpus' write order (order-independence check). */
  readonly shuffleSeed?: number;
}

/* ------------------------------------------------------------------ */
/* Isolation guards                                                     */
/* ------------------------------------------------------------------ */

const TMP = path.resolve(os.tmpdir());

export function assertAyasRetrievalTempRoot(root: string): string {
  const resolved = path.resolve(root);
  if (!resolved.startsWith(TMP + path.sep)) {
    throw new Error("retrieval evaluation refuses a memory root outside the OS temp directory");
  }
  return resolved;
}

export function createAyasRetrievalRunRoot(label = "run"): string {
  return assertAyasRetrievalTempRoot(fs.mkdtempSync(path.join(TMP, `ayas-retrieval-eval-${label}-`)));
}

export function removeAyasRetrievalRunRoot(root: string): void {
  fs.rmSync(assertAyasRetrievalTempRoot(root), { recursive: true, force: true });
}

/** Any global `fetch` during evaluation is a bug: it throws and is counted. */
export async function withAyasRetrievalNetworkGuard<T>(run: () => Promise<T>): Promise<{ value: T; networkAttempts: number }> {
  const original = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = (async () => {
    networkAttempts += 1;
    throw new Error("network is disabled during retrieval evaluation");
  }) as typeof fetch;
  try {
    const value = await run();
    return { value, networkAttempts };
  } finally {
    globalThis.fetch = original;
  }
}

/** Chat reads the clock itself; freeze `new Date()` / `Date.now()` to the case time. */
export async function withAyasRetrievalFrozenClock<T>(iso: string, run: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = RealDate.parse(iso);
  if (!Number.isFinite(fixed)) throw new Error("frozen clock needs a valid ISO instant");
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [string]));
    }
    static now(): number {
      return fixed;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
}

/* ------------------------------------------------------------------ */
/* Corpus setup                                                         */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permute<T>(items: readonly T[], seed: number | undefined): T[] {
  const out = [...items];
  if (seed === undefined) return out;
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface PreparedCorpus {
  readonly root: string;
  readonly records: BrainMemoryRecord[];
  readonly keyById: ReadonlyMap<string, string>;
  /** Collapsed body per key, for mapping context lines back to keys. */
  readonly bodyByKey: ReadonlyMap<string, string>;
  readonly answerTokenByKey: ReadonlyMap<string, string>;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function prepareCorpus(testCase: AyasRetrievalCase, root: string, shuffleSeed: number | undefined): PreparedCorpus {
  assertAyasRetrievalTempRoot(root);
  const store = createAyasMemoryStore({ rootDir: root });
  const keyById = new Map<string, string>();
  const bodyByKey = new Map<string, string>();
  const answerTokenByKey = new Map<string, string>();
  const idByKey = new Map<string, string>();
  for (const entry of permute(testCase.corpus, shuffleSeed)) {
    const record = buildBrainMemoryRecord(entry.input);
    const result = store.append(record);
    if (result !== "stored") throw new Error(`fixture ${testCase.id}: record ${entry.key} was ${result}, not stored`);
    keyById.set(record.recordId, entry.key);
    idByKey.set(entry.key, record.recordId);
    bodyByKey.set(entry.key, collapse(record.body));
    if (entry.answerToken) answerTokenByKey.set(entry.key, fold(entry.answerToken));
  }
  for (const key of testCase.forgotten ?? []) {
    const id = idByKey.get(key);
    if (!id || !store.remove(id)) throw new Error(`fixture ${testCase.id}: forgotten key ${key} could not be removed`);
  }
  const bodies = [...bodyByKey.values()];
  if (new Set(bodies).size !== bodies.length) throw new Error(`fixture ${testCase.id}: bodies must be unique per corpus`);
  return { root, records: store.load(), keyById, bodyByKey, answerTokenByKey };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g");
}

function modeLabel(query: AyasMemoryTemporalQuery): AyasRetrievalQueryModeLabel {
  if (query.mode === "as-of") return "as-of";
  return query.includeHistory === true ? "history" : "current";
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

const MEMORY_LINE = /^\s*·\s*\((project-structure|decision|test-result|known-bug|user-preference|security-policy|outcome-history|graphify-state|environment-note)\)\s*(.*)$/;

/** Map a context line back to the corpus key whose body it carries. */
function keyForLine(line: string, corpus: PreparedCorpus): string | null {
  const match = MEMORY_LINE.exec(stripAyasMemoryLineAnnotation(line));
  if (!match) return null;
  const text = collapse(match[2]);
  for (const [key, body] of corpus.bodyByKey) {
    if (body === text) return key;
    if (text.endsWith("…") && body.startsWith(text.slice(0, -1))) return key;
  }
  return null;
}

function delivery(
  keys: readonly string[],
  unmapped: number,
  testCase: AyasRetrievalCase,
  required: readonly string[],
  modelCalled?: boolean,
): AyasRetrievalDelivery {
  const unique = new Set(keys);
  const forbiddenLabels = testCase.expect.forbidden ?? {};
  const relevant = testCase.expect.relevant;
  return {
    keys,
    requiredDelivered: required.every((key) => unique.has(key)),
    relevantRecall: ratio(relevant.filter((key) => unique.has(key)).length, relevant.length),
    forbidden: [...unique].filter((key) => forbiddenLabels[key]).map((key) => ({ key, reason: forbiddenLabels[key] })),
    contradictory: (testCase.expect.contradictionGroups ?? []).some((group) => group.filter((key) => unique.has(key)).length >= 2),
    duplicates: keys.length - unique.size,
    unmapped,
    ...(modelCalled === undefined ? {} : { modelCalled }),
  };
}

function deliveryPass(value: AyasRetrievalDelivery, testCase: AyasRetrievalCase): boolean {
  const abstain = testCase.expect.relevant.length === 0;
  if (abstain) return value.keys.length === 0 && value.unmapped === 0;
  return value.requiredDelivered && value.forbidden.length === 0 && !value.contradictory && value.duplicates === 0 && value.unmapped === 0;
}

/* ------------------------------------------------------------------ */
/* Chat (Layer C2)                                                      */
/* ------------------------------------------------------------------ */

export function ayasRetrievalEvalSnapshot(): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-09T03:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
  };
}

/** Healthy fake local model; captures every `/api/chat` prompt. Never touches the network. */
export function ayasRetrievalCapturingModel(reply: string, prompts: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    }
    if (init?.body) {
      const parsed = JSON.parse(String(init.body)) as { messages?: { content?: string }[] };
      prompts.push(parsed.messages?.map((message) => message.content ?? "").join("\n") ?? "");
    }
    const lines = [JSON.stringify({ message: { content: reply }, done: false }), JSON.stringify({ done: true, done_reason: "stop" })];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

export interface AyasRetrievalChatTurn {
  readonly prompts: readonly string[];
  readonly done: Extract<AyasChatStreamEvent, { type: "done" }>;
}

export async function runAyasRetrievalChatTurn(
  text: string,
  root: string,
  nowIso: string,
  options: {
    readonly history?: readonly { role: "user" | "brain"; text: string }[];
    readonly reply?: string;
    readonly trace?: AyasTraceHandle;
  } = {},
): Promise<AyasRetrievalChatTurn> {
  assertAyasRetrievalTempRoot(root);
  const prompts: string[] = [];
  const done = await withAyasRetrievalFrozenClock(nowIso, async () => {
    let terminal: Extract<AyasChatStreamEvent, { type: "done" }> | undefined;
    for await (const event of streamAyasChat({
      text,
      snapshot: ayasRetrievalEvalSnapshot(),
      seq: 1,
      // No cloud key, no provider override: the local fake model is the only route.
      env: { NODE_ENV: "test" },
      fetcher: ayasRetrievalCapturingModel(options.reply ?? "Anladım.", prompts),
      memoryStore: { rootDir: root },
      ...(options.history ? { history: options.history } : {}),
      ...(options.trace ? { trace: options.trace } : {}),
    })) {
      if (event.type === "done") terminal = event;
    }
    return terminal;
  });
  if (!done) throw new Error("chat turn ended without a terminal event");
  return { prompts, done };
}

function chatDelivery(turn: AyasRetrievalChatTurn, corpus: PreparedCorpus): { keys: string[]; unmapped: number } {
  const keys: string[] = [];
  let unmapped = 0;
  for (const prompt of turn.prompts) {
    for (const line of prompt.split("\n")) {
      if (!MEMORY_LINE.test(stripAyasMemoryLineAnnotation(line))) continue;
      const key = keyForLine(line, corpus);
      if (key) keys.push(key);
      else unmapped += 1;
    }
  }
  // A deterministic answer (identity guard) carries the value without a prompt.
  const answer = fold(turn.done.text);
  for (const [key, token] of corpus.answerTokenByKey) {
    if (!keys.includes(key) && new RegExp(`(^|[^\\p{L}])${token}([^\\p{L}]|$)`, "u").test(answer)) keys.push(key);
  }
  return { keys, unmapped };
}

/* ------------------------------------------------------------------ */
/* Case evaluation                                                      */
/* ------------------------------------------------------------------ */

function hasSignal(decision: AyasMemoryRetrievalDecision): boolean {
  return decision.lexicalScore > 0 || decision.conceptScore > 0;
}

function candidateSignalKeys(corpus: PreparedCorpus, text: string, nowIso: string, temporal: AyasMemoryTemporalQuery): string[] {
  return corpus.records.flatMap((record) => {
    const probe = retrieveAyasMemory([record], text, { nowIso, temporal, limit: 1 });
    const decision = [...probe.selected, ...probe.quarantined].find(hasSignal);
    return decision ? [corpus.keyById.get(record.recordId) ?? "?"] : [];
  }).sort();
}

export async function evaluateAyasRetrievalCase(
  testCase: AyasRetrievalCase,
  runRoot: string,
  options: AyasRetrievalEvaluationOptions = {},
): Promise<AyasRetrievalCaseResult> {
  const root = assertAyasRetrievalTempRoot(fs.mkdtempSync(path.join(assertAyasRetrievalTempRoot(runRoot), "case-")));
  const corpus = prepareCorpus(testCase, root, options.shuffleSeed);
  const key = (decision: AyasMemoryRetrievalDecision) => corpus.keyById.get(decision.record.recordId) ?? "?";
  const { text } = testCase.query;
  const detected = detectAyasMemoryTemporalQuery(text, testCase.nowIso);
  const temporal = testCase.query.temporal ?? detected;
  const expect = testCase.expect;
  const relevant = expect.relevant;
  const required = expect.primary ? [expect.primary] : relevant;
  const forbiddenLabels = expect.forbidden ?? {};
  const failures: AyasRetrievalFailure[] = [];

  /* Layers A + B — the pure production ranking, full list and production top-K. */
  const retrievalStart = performance.now();
  const full = retrieveAyasMemory(corpus.records, text, { nowIso: testCase.nowIso, temporal, limit: Number.MAX_SAFE_INTEGER });
  const production = retrieveAyasMemory(corpus.records, text, { nowIso: testCase.nowIso, temporal });
  const retrievalMs = performance.now() - retrievalStart;
  const rankedKeys = full.selected.map(key);
  const selectedKeys = production.selected.map(key);
  if (selectedKeys.join("|") !== rankedKeys.slice(0, AYAS_RETRIEVAL_EVAL_TOP_K).join("|")) {
    throw new Error(`harness: ${testCase.id} production selection is not the top-${AYAS_RETRIEVAL_EVAL_TOP_K} of the full ranking`);
  }
  // Inspect each record before the production admission/ranking stage. A
  // category-only record can have a real lexical/concept signal yet be dropped
  // by admission when another record matches the question's own words. Using
  // full.selected here would incorrectly score that ranking choice as a
  // candidate-generation miss. A singleton read preserves the same signal
  // calculation and temporal eligibility without changing the live retriever.
  const matchedKeys = candidateSignalKeys(corpus, text, testCase.nowIso, temporal);
  const quarantined = full.quarantined.map((decision) => ({ key: key(decision), reason: decision.quarantineReason ?? "unknown" }));
  const poolSize = corpus.records.length - full.droppedExpired - full.droppedDuplicates - full.droppedNotYetKnown;

  const expectedQueryMode = expect.queryMode;
  const detectedQueryMode = modeLabel(detected);
  const explicitTemporal = testCase.query.temporal !== undefined;
  const naturalQueryMode = explicitTemporal ? testCase.query.naturalMode ?? null : expectedQueryMode;
  const queryPass = naturalQueryMode === null || detectedQueryMode === naturalQueryMode;
  if (!queryPass) {
    failures.push({ layer: "query", code: `QUERY_MODE_${detectedQueryMode.toUpperCase()}_NOT_${naturalQueryMode!.toUpperCase()}`, keys: [], suggested: "QUERY_NORMALIZATION" });
  }

  // Layer A
  const matchedSet = new Set(matchedKeys);
  const candidateRecall = ratio(relevant.filter((k) => matchedSet.has(k)).length, relevant.length);
  const unmatched = relevant.filter((k) => !matchedSet.has(k));
  if (unmatched.length) failures.push({ layer: "candidate", code: "RELEVANT_NOT_MATCHED", keys: unmatched, suggested: "CANDIDATE_GENERATION" });
  const candidatePass = unmatched.length === 0;

  // Layer B
  const rankOf = (k: string) => {
    const index = rankedKeys.indexOf(k);
    return index < 0 ? null : index + 1;
  };
  const relevantRanks = relevant.map(rankOf).filter((rank): rank is number => rank !== null);
  const firstRelevantRank = relevantRanks.length ? Math.min(...relevantRanks) : null;
  const primaryKey = expect.primary ?? (relevant.length === 1 ? relevant[0] : undefined);
  const mrrRank = primaryKey ? rankOf(primaryKey) : firstRelevantRank;
  const reciprocalRank = relevant.length === 0 ? null : mrrRank ? 1 / mrrRank : 0;
  const selectedSet = new Set(selectedKeys);
  const top1 = new Set(selectedKeys.slice(0, 1));
  const recallAt1 = ratio(relevant.filter((k) => top1.has(k)).length, relevant.length);
  const recallAtK = ratio(relevant.filter((k) => selectedSet.has(k)).length, relevant.length);
  const hitAt1 = relevant.length ? relevant.some((k) => top1.has(k)) : null;
  const hitAtK = relevant.length ? relevant.some((k) => selectedSet.has(k)) : null;
  const precisionAt1 = relevant.length && selectedKeys.length ? (relevant.includes(selectedKeys[0]) ? 1 : 0) : null;
  const selectionPrecision = relevant.length && selectedKeys.length ? selectedKeys.filter((k) => relevant.includes(k)).length / selectedKeys.length : null;
  const forbiddenSelected = selectedKeys.filter((k) => forbiddenLabels[k]).map((k) => ({ key: k, reason: forbiddenLabels[k] }));
  const contradictorySelection = (expect.contradictionGroups ?? []).some((group) => group.filter((k) => selectedSet.has(k)).length >= 2);
  const abstainCorrect = relevant.length === 0 ? selectedKeys.length === 0 : null;
  let certaintyCorrect: boolean | null = null;
  if (expect.certainty) {
    certaintyCorrect = Object.entries(expect.certainty).every(([k, certainty]) => {
      const decision = full.selected.find((d) => key(d) === k);
      return decision?.temporal.asOf === certainty;
    });
    if (!certaintyCorrect) failures.push({ layer: "ranking", code: "CERTAINTY_MISMATCH", keys: Object.keys(expect.certainty), suggested: "TEMPORAL_FILTER" });
  }
  const missingRequired = required.filter((k) => !selectedSet.has(k));
  for (const k of missingRequired) {
    if (!matchedSet.has(k)) continue; // already a Layer A failure
    const q = quarantined.find((entry) => entry.key === k);
    if (q) failures.push({ layer: "ranking", code: `RELEVANT_QUARANTINED:${q.reason}`, keys: [k], suggested: q.reason === "conflicting-fact" ? "CONFLICT_RESOLUTION" : "TEMPORAL_FILTER" });
    else failures.push({ layer: "ranking", code: "RELEVANT_BELOW_TOP_K", keys: [k], suggested: "RANKING" });
  }
  for (const entry of forbiddenSelected) {
    failures.push({
      layer: "ranking",
      code: `FORBIDDEN_SELECTED:${entry.reason}`,
      keys: [entry.key],
      suggested: entry.reason === "distractor" ? "RANKING" : entry.reason === "conflicting" || entry.reason === "disputed" ? "CONFLICT_RESOLUTION" : "TEMPORAL_FILTER",
    });
  }
  if (relevant.length === 0 && selectedKeys.length > 0) {
    failures.push({ layer: "ranking", code: "FALSE_POSITIVE_SELECTION", keys: selectedKeys, suggested: "CANDIDATE_GENERATION" });
  }
  const rankingPass = missingRequired.length === 0 && forbiddenSelected.length === 0 && !contradictorySelection && certaintyCorrect !== false && abstainCorrect !== false;

  // Layer C1 — the recall block, exactly as chat receives it before its own gate.
  const recallStart = performance.now();
  const recall = await recallAyasMemoryWithTrace(text, { nowIso: testCase.nowIso, temporal, store: { rootDir: root } });
  const recallMs = performance.now() - recallStart;
  let recallUnmapped = 0;
  const recallKeys: string[] = [];
  for (const line of recall.lines) {
    const k = keyForLine(line, corpus);
    if (k) recallKeys.push(k);
    else recallUnmapped += 1;
  }
  const recallContext = delivery(recallKeys, recallUnmapped, testCase, required);
  const recallPass = recall.status === "ok" && deliveryPass(recallContext, testCase);
  if (!recallPass && rankingPass) {
    failures.push({ layer: "recall-context", code: recall.status === "ok" ? "RECALL_BLOCK_MISMATCH" : "RECALL_UNREADABLE", keys: required.filter((k) => !recallKeys.includes(k)), suggested: "CONTEXT_ASSEMBLY" });
  }

  // Layer C2 — a real chat turn. Chat detects the time mode from the text
  // alone, so it is scored only when the text carries the evaluated question.
  let chatContext: AyasRetrievalDelivery | null = null;
  let chatMs = 0;
  if (options.chat !== false && naturalQueryMode !== null) {
    const chatStart = performance.now();
    const turn = await runAyasRetrievalChatTurn(text, root, testCase.nowIso);
    chatMs = performance.now() - chatStart;
    const delivered = chatDelivery(turn, corpus);
    chatContext = delivery(delivered.keys, delivered.unmapped, testCase, required, turn.prompts.length > 0);
    if (!deliveryPass(chatContext, testCase)) {
      const missing = required.filter((k) => !delivered.keys.includes(k));
      if (missing.length && recallPass) failures.push({ layer: "chat-context", code: "RELEVANT_DROPPED_BY_CHAT_GATE", keys: missing, suggested: "CONTEXT_ASSEMBLY" });
      for (const entry of chatContext.forbidden) {
        if (!recallContext.forbidden.some((f) => f.key === entry.key)) {
          failures.push({ layer: "chat-context", code: `FORBIDDEN_DELIVERED_BY_CHAT:${entry.reason}`, keys: [entry.key], suggested: "CONTEXT_ASSEMBLY" });
        }
      }
      if (relevant.length === 0 && chatContext.keys.length > 0 && recallContext.keys.length === 0) {
        failures.push({ layer: "chat-context", code: "FALSE_POSITIVE_DELIVERY", keys: chatContext.keys, suggested: "CONTEXT_ASSEMBLY" });
      }
      if (chatContext.unmapped > 0) failures.push({ layer: "chat-context", code: "UNMAPPED_MEMORY_LINE", keys: [], suggested: "FIXTURE_PROBLEM" });
    }
  }
  const chatPass = chatContext === null || deliveryPass(chatContext, testCase);

  const layerPass: Record<AyasRetrievalLayer, boolean> = {
    query: queryPass,
    candidate: candidatePass,
    ranking: rankingPass,
    "recall-context": recallPass,
    "chat-context": chatPass,
  };
  return {
    caseId: testCase.id,
    category: testCase.category,
    languageTags: testCase.languageTags ?? [],
    heldOut: testCase.heldOut === true,
    source: testCase.source,
    explicitTemporal,
    expectedQueryMode,
    naturalQueryMode,
    detectedQueryMode,
    relevant,
    required,
    forbiddenLabels,
    strictNegative: expect.strictNegative === true,
    hasContradictionGroups: (expect.contradictionGroups ?? []).length > 0,
    poolSize,
    candidateCount: matchedKeys.length,
    eligibleCount: full.selected.length,
    matchedKeys,
    rankedKeys,
    selectedKeys,
    quarantined,
    candidateRecall,
    firstRelevantRank,
    reciprocalRank,
    recallAt1,
    recallAtK,
    hitAt1,
    hitAtK,
    precisionAt1,
    selectionPrecision,
    forbiddenSelected,
    contradictorySelection,
    abstainCorrect,
    certaintyCorrect,
    recallContext,
    chatContext,
    layerPass,
    pass: Object.values(layerPass).every(Boolean),
    failures,
    timing: { retrievalMs, recallMs, chatMs },
  };
}

export async function evaluateAyasRetrieval(
  cases: readonly AyasRetrievalCase[],
  options: AyasRetrievalEvaluationOptions = {},
): Promise<{ results: AyasRetrievalCaseResult[]; networkAttempts: number }> {
  const ids = cases.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error("retrieval evaluation case ids must be unique");
  const runRoot = createAyasRetrievalRunRoot();
  try {
    const { value, networkAttempts } = await withAyasRetrievalNetworkGuard(async () => {
      const results: AyasRetrievalCaseResult[] = [];
      for (const testCase of cases) results.push(await evaluateAyasRetrievalCase(testCase, runRoot, options));
      return results;
    });
    return { results: value, networkAttempts };
  } finally {
    removeAyasRetrievalRunRoot(runRoot);
  }
}

/* ------------------------------------------------------------------ */
/* Explanation (Phase 14) — keys, states, scores, reasons; never bodies */
/* ------------------------------------------------------------------ */

export interface AyasRetrievalExplanationRow {
  readonly key: string;
  readonly label: "relevant" | "neutral" | `forbidden:${AyasRetrievalForbiddenReason}`;
  readonly signal: boolean;
  readonly lexicalScore: number;
  readonly conceptScore: number;
  readonly rerankScore: number;
  readonly temporalState: string;
  readonly asOf?: string;
  readonly quarantineReason?: string;
  readonly rank: number | null;
  readonly selected: boolean;
}

export async function explainAyasRetrievalCase(testCase: AyasRetrievalCase): Promise<{
  readonly caseId: string;
  readonly queryMode: { readonly expected: string; readonly effective: string };
  readonly poolSize: number;
  readonly candidateCount: number;
  readonly selectedKeys: readonly string[];
  readonly rows: readonly AyasRetrievalExplanationRow[];
  /** Signal was present, but the production admission stage removed the record. */
  readonly admissionDropped: readonly string[];
  readonly notMatched: readonly string[];
}> {
  const runRoot = createAyasRetrievalRunRoot("explain");
  try {
    const root = assertAyasRetrievalTempRoot(fs.mkdtempSync(path.join(runRoot, "case-")));
    const corpus = prepareCorpus(testCase, root, undefined);
    const temporal = testCase.query.temporal ?? detectAyasMemoryTemporalQuery(testCase.query.text, testCase.nowIso);
    const full = retrieveAyasMemory(corpus.records, testCase.query.text, { nowIso: testCase.nowIso, temporal, limit: Number.MAX_SAFE_INTEGER });
    const key = (decision: AyasMemoryRetrievalDecision) => corpus.keyById.get(decision.record.recordId) ?? "?";
    const ranked = full.selected.map(key);
    const rows = [...full.selected, ...full.quarantined].map((decision): AyasRetrievalExplanationRow => {
      const k = key(decision);
      const forbidden = testCase.expect.forbidden?.[k];
      const rank = ranked.indexOf(k);
      return {
        key: k,
        label: testCase.expect.relevant.includes(k) ? "relevant" : forbidden ? `forbidden:${forbidden}` : "neutral",
        signal: hasSignal(decision),
        lexicalScore: Number(decision.lexicalScore.toFixed(4)),
        conceptScore: decision.conceptScore,
        rerankScore: Number(decision.rerankScore.toFixed(4)),
        temporalState: decision.temporal.state,
        ...(decision.temporal.asOf ? { asOf: decision.temporal.asOf } : {}),
        ...(decision.quarantineReason ? { quarantineReason: decision.quarantineReason } : {}),
        rank: rank < 0 ? null : rank + 1,
        selected: rank >= 0 && rank < AYAS_RETRIEVAL_EVAL_TOP_K,
      };
    });
    const seen = new Set(rows.map((row) => row.key));
    const candidateKeys = candidateSignalKeys(corpus, testCase.query.text, testCase.nowIso, temporal);
    const candidateSet = new Set(candidateKeys);
    const poolSize = corpus.records.length - full.droppedExpired - full.droppedDuplicates - full.droppedNotYetKnown;
    return {
      caseId: testCase.id,
      queryMode: { expected: testCase.expect.queryMode, effective: modeLabel(temporal) },
      poolSize,
      candidateCount: candidateKeys.length,
      selectedKeys: ranked.slice(0, AYAS_RETRIEVAL_EVAL_TOP_K),
      rows,
      admissionDropped: candidateKeys.filter((k) => !seen.has(k)),
      notMatched: testCase.corpus.map((entry) => entry.key).filter((k) => !candidateSet.has(k) && !(testCase.forgotten ?? []).includes(k)),
    };
  } finally {
    removeAyasRetrievalRunRoot(runRoot);
  }
}

/* ------------------------------------------------------------------ */
/* Metrics                                                              */
/* ------------------------------------------------------------------ */

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function rate(results: readonly AyasRetrievalCaseResult[], predicate: (result: AyasRetrievalCaseResult) => boolean): number | null {
  return results.length ? results.filter(predicate).length / results.length : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const isStaleReason = (reason: string) => (AYAS_RETRIEVAL_STALE_REASONS as readonly string[]).includes(reason);
const labelsWith = (result: AyasRetrievalCaseResult, reasons: readonly string[]) =>
  Object.values(result.forbiddenLabels).some((reason) => reasons.includes(reason));
const selectedWith = (result: AyasRetrievalCaseResult, reasons: readonly string[]) =>
  result.forbiddenSelected.some((entry) => reasons.includes(entry.reason));
const deliveredWith = (value: AyasRetrievalDelivery | null, reasons: readonly string[]) =>
  value !== null && value.forbidden.some((entry) => reasons.includes(entry.reason));

export interface AyasRetrievalGroupMetrics {
  readonly cases: number;
  readonly passRate: number | null;
  readonly candidateRecall: number | null;
  readonly hitRateAtK: number | null;
  readonly recallAtK: number | null;
  readonly mrr: number | null;
  readonly chatDeliveryRate: number | null;
}

function groupMetrics(results: readonly AyasRetrievalCaseResult[]): AyasRetrievalGroupMetrics {
  const withRelevant = results.filter((r) => r.relevant.length > 0);
  return {
    cases: results.length,
    passRate: rate(results, (r) => r.pass),
    candidateRecall: mean(withRelevant.map((r) => r.candidateRecall)),
    hitRateAtK: rate(withRelevant, (r) => r.hitAtK === true),
    recallAtK: mean(withRelevant.map((r) => r.recallAtK)),
    mrr: mean(withRelevant.map((r) => r.reciprocalRank)),
    chatDeliveryRate: rate(withRelevant.filter((r) => r.chatContext), (r) => r.chatContext!.requiredDelivered),
  };
}

function contextMetrics(results: readonly AyasRetrievalCaseResult[], pick: (r: AyasRetrievalCaseResult) => AyasRetrievalDelivery | null) {
  const evaluated = results.filter((r) => pick(r) !== null);
  const withRelevant = evaluated.filter((r) => r.relevant.length > 0);
  const staleLabelled = evaluated.filter((r) => Object.values(r.forbiddenLabels).some(isStaleReason));
  const clean = staleLabelled.filter((r) => r.expectedQueryMode === "current" && !labelsWith(r, ["stale-free-text"]));
  const contradictionLabelled = evaluated.filter((r) => r.hasContradictionGroups);
  const distractorLabelled = evaluated.filter((r) => labelsWith(r, ["distractor"]));
  const abstain = evaluated.filter((r) => r.relevant.length === 0);
  return {
    cases: evaluated.length,
    requiredDeliveredRate: rate(withRelevant, (r) => pick(r)!.requiredDelivered),
    relevantRecall: mean(withRelevant.map((r) => pick(r)!.relevantRecall)),
    STALE_CONTEXT_RATE: rate(staleLabelled, (r) => pick(r)!.forbidden.some((f) => isStaleReason(f.reason))),
    STALE_CONTEXT_RATE_CLEAN_EXCLUSIVE: rate(clean, (r) => pick(r)!.forbidden.some((f) => isStaleReason(f.reason))),
    CONTRADICTORY_CONTEXT_RATE: rate(contradictionLabelled, (r) => pick(r)!.contradictory),
    distractorDeliveryRate: rate(distractorLabelled, (r) => pick(r)!.forbidden.some((f) => f.reason === "distractor")),
    duplicateRate: rate(evaluated, (r) => pick(r)!.duplicates > 0),
    abstainLeakRate: rate(abstain, (r) => pick(r)!.keys.length > 0),
    staleLabelledCases: staleLabelled.length,
    cleanExclusiveCases: clean.length,
    contradictionLabelledCases: contradictionLabelled.length,
  };
}

export function computeAyasRetrievalMetrics(results: readonly AyasRetrievalCaseResult[]) {
  const withRelevant = results.filter((r) => r.relevant.length > 0);
  const abstain = results.filter((r) => r.relevant.length === 0);
  const current = results.filter((r) => r.expectedQueryMode === "current" && r.relevant.length > 0);
  const history = results.filter((r) => r.expectedQueryMode === "history" && r.relevant.length > 0);
  const asOf = results.filter((r) => r.expectedQueryMode === "as-of");
  const explicitAsOf = asOf.filter((r) => r.explicitTemporal);
  const currentMode = results.filter((r) => r.expectedQueryMode === "current");
  const superseded = currentMode.filter((r) => labelsWith(r, ["superseded"]));
  const freeTextStale = results.filter((r) => labelsWith(r, ["stale-free-text"]));
  const futureLabelled = currentMode.filter((r) => labelsWith(r, ["future"]));
  const historicalLabelled = currentMode.filter((r) => labelsWith(r, ["historical"]));
  const staleLabelled = results.filter((r) => Object.values(r.forbiddenLabels).some(isStaleReason));
  const conflict = results.filter((r) => r.category === "contradiction" || r.category === "disputed" || labelsWith(r, ["conflicting", "disputed"]));
  const deleted = results.filter((r) => labelsWith(r, ["deleted"]));
  const byCategory: Record<string, AyasRetrievalGroupMetrics> = {};
  for (const category of [...new Set(results.map((r) => r.category))].sort()) {
    byCategory[category] = groupMetrics(results.filter((r) => r.category === category));
  }
  const byLanguageTag: Record<string, AyasRetrievalGroupMetrics> = {};
  for (const tag of [...new Set(results.flatMap((r) => r.languageTags))].sort()) {
    byLanguageTag[tag] = groupMetrics(results.filter((r) => r.languageTags.includes(tag)));
  }
  const firstRanks = withRelevant.map((r) => r.firstRelevantRank).filter((rank): rank is number => rank !== null);
  return {
    counts: {
      cases: results.length,
      seed: results.filter((r) => r.source === "seed").length,
      new: results.filter((r) => r.source === "new").length,
      heldOut: results.filter((r) => r.heldOut).length,
      withRelevant: withRelevant.length,
      abstain: abstain.length,
      passed: results.filter((r) => r.pass).length,
    },
    overall: groupMetrics(results),
    layerPassRate: Object.fromEntries(
      (["query", "candidate", "ranking", "recall-context", "chat-context"] as const).map((layer) => [layer, rate(results, (r) => r.layerPass[layer])]),
    ) as Record<AyasRetrievalLayer, number | null>,
    candidate: {
      recall: mean(withRelevant.map((r) => r.candidateRecall)),
      hitRate: rate(withRelevant, (r) => (r.candidateRecall ?? 0) > 0),
      medianCandidateCount: median(results.map((r) => r.candidateCount)),
      medianPoolSize: median(results.map((r) => r.poolSize)),
    },
    ranking: {
      k: AYAS_RETRIEVAL_EVAL_TOP_K,
      recallAt1: mean(withRelevant.map((r) => r.recallAt1)),
      recallAtK: mean(withRelevant.map((r) => r.recallAtK)),
      hitRateAt1: rate(withRelevant, (r) => r.hitAt1 === true),
      hitRateAtK: rate(withRelevant, (r) => r.hitAtK === true),
      mrr: mean(withRelevant.map((r) => r.reciprocalRank)),
      precisionAt1: mean(withRelevant.map((r) => r.precisionAt1)),
      selectionPrecision: mean(withRelevant.map((r) => r.selectionPrecision)),
      medianFirstRelevantRank: median(firstRanks),
      meanSelectedCount: mean(results.map((r) => r.selectedKeys.length)),
    },
    temporal: {
      queryModeAccuracy: rate(results.filter((r) => r.naturalQueryMode !== null), (r) => r.detectedQueryMode === r.naturalQueryMode),
      currentCorrectRate: rate(current, (r) => r.layerPass.ranking),
      historyCorrectRate: rate(history, (r) => r.layerPass.ranking),
      asOfCorrectRate: rate(asOf, (r) => r.layerPass.ranking && r.layerPass.query),
      explicitAsOfCorrectRate: rate(explicitAsOf, (r) => r.layerPass.ranking),
      staleSelectionRate: rate(staleLabelled, (r) => r.forbiddenSelected.some((f) => isStaleReason(f.reason))),
      supersededSelectionRate: rate(superseded, (r) => selectedWith(r, ["superseded"])),
      freeTextStaleSelectionRate: rate(freeTextStale, (r) => selectedWith(r, ["stale-free-text"])),
      futureAsCurrentRate: rate(futureLabelled, (r) => selectedWith(r, ["future"])),
      historicalAsCurrentRate: rate(historicalLabelled, (r) => selectedWith(r, ["historical"])),
      conflictCorrectRate: rate(conflict, (r) => r.layerPass.ranking),
      deletedResurrectionRate: rate(deleted, (r) => selectedWith(r, ["deleted"]) || deliveredWith(r.recallContext, ["deleted"]) || deliveredWith(r.chatContext, ["deleted"])),
      cases: { current: current.length, history: history.length, asOf: asOf.length, explicitAsOf: explicitAsOf.length, superseded: superseded.length, freeTextStale: freeTextStale.length, future: futureLabelled.length, historical: historicalLabelled.length, conflict: conflict.length, deleted: deleted.length },
    },
    negative: {
      abstentionCorrectRate: rate(abstain, (r) => r.abstainCorrect === true),
      strictNegativeCorrectRate: rate(abstain.filter((r) => r.strictNegative), (r) => r.abstainCorrect === true && r.recallContext.keys.length === 0 && (r.chatContext?.keys.length ?? 0) === 0),
      falsePositiveSelectionRate: rate(abstain, (r) => r.selectedKeys.length > 0),
      falsePositiveChatDeliveryRate: rate(abstain.filter((r) => r.chatContext), (r) => r.chatContext!.keys.length > 0),
      distractorSelectionRate: rate(results.filter((r) => labelsWith(r, ["distractor"])), (r) => selectedWith(r, ["distractor"])),
      strictNegativeCases: abstain.filter((r) => r.strictNegative).length,
    },
    context: {
      recall: contextMetrics(results, (r) => r.recallContext),
      chat: contextMetrics(results, (r) => r.chatContext),
    },
    byCategory,
    byLanguageTag,
    heldOut: groupMetrics(results.filter((r) => r.heldOut)),
    inSample: groupMetrics(results.filter((r) => !r.heldOut)),
    latency: {
      medianRetrievalMs: median(results.map((r) => r.timing.retrievalMs)),
      medianRecallMs: median(results.map((r) => r.timing.recallMs)),
      medianChatMs: median(results.map((r) => r.timing.chatMs)),
    },
  };
}

export type AyasRetrievalMetrics = ReturnType<typeof computeAyasRetrievalMetrics>;

/** Timing-free, order-stable view of results, for determinism comparisons. */
export function stableAyasRetrievalView(results: readonly AyasRetrievalCaseResult[]): string {
  return JSON.stringify(results.map((result) => {
    const { timing: _timing, ...rest } = result;
    void _timing;
    return rest;
  }));
}

/** Safe failure rows: ids, keys, ranks, counts and codes — never memory bodies. */
export function ayasRetrievalFailureRows(results: readonly AyasRetrievalCaseResult[]) {
  return results.filter((r) => !r.pass).map((r) => ({
    caseId: r.caseId,
    category: r.category,
    heldOut: r.heldOut,
    expected: { queryMode: r.expectedQueryMode, naturalQueryMode: r.naturalQueryMode, relevant: r.relevant, required: r.required },
    detectedQueryMode: r.detectedQueryMode,
    selected: r.selectedKeys,
    firstRelevantRank: r.firstRelevantRank,
    candidateCount: r.candidateCount,
    recallContext: r.recallContext.keys,
    chatContext: r.chatContext?.keys ?? null,
    failedLayers: (Object.keys(r.layerPass) as AyasRetrievalLayer[]).filter((layer) => !r.layerPass[layer]),
    failures: r.failures,
  }));
}

/* ------------------------------------------------------------------ */
/* Scale (Phase 20)                                                     */
/* ------------------------------------------------------------------ */

const NOISE_TOPICS = ["seyahat", "yemek", "kitap", "müzik", "spor", "bahçe", "fotoğraf", "resim", "tarih", "şiir", "kamp", "bisiklet"];
const NOISE_VERBS = ["seviyorum", "planladım", "okudum", "dinledim", "denedim", "öğrendim", "yazdım", "hazırladım"];

function syllableWord(random: () => number): string {
  const syllables = ["ka", "lo", "mer", "ti", "sun", "da", "ve", "ro", "pel", "zi", "nor", "fa"];
  let word = "";
  const length = 2 + Math.floor(random() * 3);
  for (let i = 0; i < length; i += 1) word += syllables[Math.floor(random() * syllables.length)];
  return word;
}

/** Deterministic synthetic noise: realistic unrelated statements + a few same-word distractors. */
export function syntheticAyasRetrievalNoise(count: number, seed: number, nowIso: string): BrainMemoryRecordInput[] {
  const random = mulberry32(seed);
  const nowMs = Date.parse(nowIso);
  const out: BrainMemoryRecordInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const observedAt = new Date(nowMs - (1 + Math.floor(random() * 150)) * 86_400_000 - i * 1000).toISOString();
    const sameWord = i % 50 === 7;
    const body = sameWord
      ? `arkadaşım ${syllableWord(random)} bilgisayar dükkanında çalışıyor ${i}`
      : `${NOISE_TOPICS[Math.floor(random() * NOISE_TOPICS.length)]} konusunda ${syllableWord(random)} ${NOISE_VERBS[Math.floor(random() * NOISE_VERBS.length)]} ${i}`;
    out.push({
      kind: i % 3 === 0 ? "decision" : i % 3 === 1 ? "environment-note" : "user-preference",
      title: i % 3 === 0 ? "Alınan karar" : i % 3 === 1 ? "Çalışma ortamı bilgisi" : "Kullanıcı tercihi",
      body,
      importance: "durable",
      confidence: "reported",
      tags: [i % 3 === 0 ? "karar" : i % 3 === 1 ? "ortam" : "tercih"],
      observedAt,
      links: [],
      temporal: { assertion: "current", provenance: "direct-user-statement", recordedAt: observedAt },
    });
  }
  return out;
}

export interface AyasRetrievalScaleRow {
  readonly records: number;
  readonly medianTemporalMs: number;
  readonly medianRetrievalMs: number;
  readonly medianRecallMs: number | null;
  readonly targetRank: number | null;
  readonly targetSelected: boolean;
  readonly staleSelected: boolean;
}

/**
 * Latency and quality under growing noise. `targetInputs` are the case's own
 * corpus; the store-backed recall runs only up to the store's 500-record cap.
 */
export async function benchmarkAyasRetrievalScale(input: {
  readonly corpus: readonly { key: string; input: BrainMemoryRecordInput }[];
  readonly query: string;
  readonly nowIso: string;
  readonly targetKey: string;
  readonly staleKey?: string;
  readonly sizes: readonly number[];
  readonly repetitions: number;
  readonly storeCap: number;
}): Promise<AyasRetrievalScaleRow[]> {
  const rows: AyasRetrievalScaleRow[] = [];
  const runRoot = createAyasRetrievalRunRoot("scale");
  try {
    for (const size of input.sizes) {
      const noise = syntheticAyasRetrievalNoise(Math.max(0, size - input.corpus.length), 20260923 + size, input.nowIso).map(buildBrainMemoryRecord);
      const own = input.corpus.map((entry) => ({ key: entry.key, record: buildBrainMemoryRecord(entry.input) }));
      const records = [...noise, ...own.map((entry) => entry.record)];
      const keyById = new Map(own.map((entry) => [entry.record.recordId, entry.key]));
      const temporal = detectAyasMemoryTemporalQuery(input.query, input.nowIso);
      const time = (run: () => unknown) => {
        for (let i = 0; i < 3; i += 1) run();
        const samples: number[] = [];
        for (let i = 0; i < input.repetitions; i += 1) {
          const start = performance.now();
          run();
          samples.push(performance.now() - start);
        }
        return median(samples) ?? 0;
      };
      const medianTemporalMs = time(() => resolveAyasMemoryTemporal(records, { nowIso: input.nowIso, query: temporal }));
      const medianRetrievalMs = time(() => retrieveAyasMemory(records, input.query, { nowIso: input.nowIso, temporal }));
      const full = retrieveAyasMemory(records, input.query, { nowIso: input.nowIso, temporal, limit: Number.MAX_SAFE_INTEGER });
      const ranked = full.selected.map((d) => keyById.get(d.record.recordId) ?? "noise");
      const rank = ranked.indexOf(input.targetKey);
      let medianRecallMs: number | null = null;
      if (records.length <= input.storeCap) {
        const root = assertAyasRetrievalTempRoot(path.join(runRoot, `n${size}`));
        fs.mkdirSync(path.join(root, "memory"), { recursive: true });
        fs.writeFileSync(path.join(root, "memory", "records.json"), `${JSON.stringify({ schemaVersion: "1", revision: 1, records }, null, 2)}\n`, "utf8");
        const loaded = createAyasMemoryStore({ rootDir: root }).load();
        if (loaded.length !== records.length) throw new Error("scale store did not round-trip");
        await recallAyasMemoryWithTrace(input.query, { nowIso: input.nowIso, temporal, store: { rootDir: root } });
        const samples: number[] = [];
        for (let i = 0; i < input.repetitions; i += 1) {
          const start = performance.now();
          await recallAyasMemoryWithTrace(input.query, { nowIso: input.nowIso, temporal, store: { rootDir: root } });
          samples.push(performance.now() - start);
        }
        medianRecallMs = median(samples);
      }
      rows.push({
        records: records.length,
        medianTemporalMs,
        medianRetrievalMs,
        medianRecallMs,
        targetRank: rank < 0 ? null : rank + 1,
        targetSelected: rank >= 0 && rank < AYAS_RETRIEVAL_EVAL_TOP_K,
        staleSelected: input.staleKey ? ranked.slice(0, AYAS_RETRIEVAL_EVAL_TOP_K).includes(input.staleKey) : false,
      });
    }
    return rows;
  } finally {
    removeAyasRetrievalRunRoot(runRoot);
  }
}

/* ------------------------------------------------------------------ */
/* Machine-readable artifact (Phase 22) — produced on demand only       */
/* ------------------------------------------------------------------ */

/** SHA-256 of the ground truth itself, so a report is tied to the exact fixture content. */
export function ayasRetrievalFixtureDigest(cases: readonly AyasRetrievalCase[]): string {
  return createHash("sha256").update(JSON.stringify(cases)).digest("hex");
}

export function buildAyasRetrievalReport(input: {
  readonly cases: readonly AyasRetrievalCase[];
  readonly fixtureVersion: string;
  readonly commit: string;
  readonly results: readonly AyasRetrievalCaseResult[];
  readonly networkAttempts: number;
  readonly scale?: readonly AyasRetrievalScaleRow[];
  readonly determinism?: Readonly<Record<string, boolean>>;
}) {
  const metrics = computeAyasRetrievalMetrics(input.results);
  const { latency, ...quality } = metrics;
  return {
    schemaVersion: AYAS_RETRIEVAL_EVAL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    commit: input.commit,
    fixtureVersion: input.fixtureVersion,
    fixtureDigest: ayasRetrievalFixtureDigest(input.cases),
    caseCounts: metrics.counts,
    metrics: quality,
    networkAttempts: input.networkAttempts,
    ...(input.determinism ? { determinism: input.determinism } : {}),
    failures: ayasRetrievalFailureRows(input.results),
    latency: { ...latency, ...(input.scale ? { scale: input.scale } : {}) },
  };
}
