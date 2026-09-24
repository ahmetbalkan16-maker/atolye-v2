/**
 * AYAS Retrieval Evaluation — deterministic ground-truth dataset.
 *
 * Each case is a small synthetic memory corpus, one user question and the
 * answer a careful human would expect: which memories are correct to use,
 * which ones would be an error to use (stale, superseded, historical, future,
 * conflicting or plainly off-topic), and whether the honest answer is "nothing
 * relevant is remembered". Labels describe what is TRUE for the user, never
 * what the current retriever happens to return — the evaluator must never
 * grade the system against itself.
 *
 * The 13 Memory Temporal v2 seed cases are imported unchanged and adapted, not
 * rewritten: their resolver-level semantics stay in `ayas-memory-temporal-
 * cases.ts` and `smoke-ayas-memory-temporal.ts`. The one retrieval-level
 * override is documented on `SEED_RETRIEVAL_OVERRIDES`.
 *
 * Synthetic data only (no real user content). Relative imports only (scripts
 * may run from any cwd).
 */

import type { BrainMemoryRecordInput, BrainMemoryTemporalInput } from "../../src/types/brainMemory";
import type { AyasMemoryTemporalCertainty, AyasMemoryTemporalQuery } from "../../src/lib/ayas/memory/AyasMemoryTemporal";
import { AYAS_MEMORY_TEMPORAL_CASES, type AyasMemoryTemporalCase } from "./ayas-memory-temporal-cases";

/**
 * Bumped whenever a label, corpus or query changes meaning.
 * v2 (before any remediation): the August as-of name case used a typo
 * correction with a point query, which made "Ahmet was certain" wrong ground
 * truth — replaced by a genuine change over a month window; explicit-temporal
 * cases now say which time mode their natural text carries (`naturalMode`).
 */
export const AYAS_RETRIEVAL_EVALUATION_FIXTURE_VERSION = "2";

export type AyasRetrievalCategory =
  | "exact"
  | "paraphrase"
  | "morphology"
  | "word-order"
  | "synonym"
  | "current-preference"
  | "superseded-preference"
  | "historical-as-of"
  | "explicit-correction"
  | "future-intent"
  | "contradiction"
  | "disputed"
  | "distractor"
  | "same-topic-other-attribute"
  | "identity"
  | "no-relevant"
  | "multi-relevant"
  | "legacy-v1";

/** Turkish surface variation a query exercises (evaluation tags only). */
export type AyasRetrievalLanguageTag =
  | "suffix"
  | "possessive"
  | "tense"
  | "word-order"
  | "omitted-pronoun"
  | "colloquial"
  | "punctuation"
  | "capitalization"
  | "typo"
  | "synonym";

/**
 * Why selecting / delivering a record would be wrong for this question.
 *  - superseded   an older value of an exclusive slot the user replaced
 *  - stale-free-text an older free-text statement the user explicitly replaced
 *  - historical   a fact that held in the past, asked about the present
 *  - future       a plan/intent presented as if it were already true
 *  - conflicting  a weaker source contradicting the trusted value
 *  - disputed     equally strong contradicting values; no defensible winner
 *  - out-of-window a record that did not hold in the asked time window
 *  - distractor   same words or topic, different meaning/attribute
 *  - deleted      a record the user asked to forget
 */
export type AyasRetrievalForbiddenReason =
  | "superseded"
  | "stale-free-text"
  | "historical"
  | "future"
  | "conflicting"
  | "disputed"
  | "out-of-window"
  | "distractor"
  | "deleted";

/** Temporal-class reasons: delivering them makes a context temporally wrong. */
export const AYAS_RETRIEVAL_STALE_REASONS: readonly AyasRetrievalForbiddenReason[] = [
  "superseded",
  "stale-free-text",
  "historical",
  "future",
  "out-of-window",
];

export interface AyasRetrievalCorpusRecord {
  /** Semantic key — the only identifier reports and failures ever print. */
  readonly key: string;
  readonly input: BrainMemoryRecordInput;
  /**
   * A distinctive folded value (a name) the answer path may carry when a
   * deterministic guard answers without the model (identity).
   */
  readonly answerToken?: string;
}

/** What the user is asking about in time. */
export type AyasRetrievalQueryModeLabel = "current" | "history" | "as-of";

export interface AyasRetrievalCase {
  readonly id: string;
  readonly category: AyasRetrievalCategory;
  readonly languageTags?: readonly AyasRetrievalLanguageTag[];
  readonly description: string;
  readonly source: "seed" | "new";
  /**
   * Held-out paraphrases: written with the dataset, never consulted while
   * remediating, reported separately to expose overfitting.
   */
  readonly heldOut?: boolean;
  readonly nowIso: string;
  readonly corpus: readonly AyasRetrievalCorpusRecord[];
  /** Keys removed through the store's own `remove()` before the query (forget). */
  readonly forgotten?: readonly string[];
  readonly query: {
    readonly text: string;
    /**
     * Explicit temporal query (bypasses natural-language detection, like the
     * seed cases). Omitted = the production detector decides, exactly as chat does.
     */
    readonly temporal?: AyasMemoryTemporalQuery;
    /**
     * Explicit-temporal cases only: the time mode the natural text itself
     * expresses, when chat (which detects the mode from text alone) would ask
     * the same question. Omitted = the text does not carry the window, so
     * detection and the chat layer are not scored for this case.
     */
    readonly naturalMode?: AyasRetrievalQueryModeLabel;
  };
  readonly expect: {
    /** Ground-truth time mode of the evaluated query. */
    readonly queryMode: AyasRetrievalQueryModeLabel;
    /** Keys that are correct to select/deliver. Empty = the honest answer is "nothing relevant". */
    readonly relevant: readonly string[];
    /** The single best answer, when one exists (MRR). Defaults to the only relevant key. */
    readonly primary?: string;
    /** Keys that would be an error to select/deliver, with the reason. */
    readonly forbidden?: Readonly<Record<string, AyasRetrievalForbiddenReason>>;
    /** Key groups that contradict each other; delivering two from one group = contradictory context. */
    readonly contradictionGroups?: readonly (readonly string[])[];
    /** As-of only: how certain each relevant key is for the window. */
    readonly certainty?: Readonly<Record<string, AyasMemoryTemporalCertainty>>;
    /**
     * Exact negative control: nothing in the corpus shares meaning OR wording
     * with the question, so any selection is an unambiguous false positive.
     */
    readonly strictNegative?: boolean;
  };
  readonly notes?: string;
}

/* ------------------------------------------------------------------ */
/* Corpus builders (records shaped like the production chat extractor) */
/* ------------------------------------------------------------------ */

export const EVAL_NOW = "2026-09-23T12:00:00.000Z";

type TemporalOverride = Partial<BrainMemoryTemporalInput>;

function temporal(observedAt: string, over: TemporalOverride = {}): BrainMemoryTemporalInput {
  return { assertion: "current", provenance: "direct-user-statement", recordedAt: observedAt, ...over };
}

function identity(key: string, name: string, observedAt: string, over: { body?: string; temporal?: TemporalOverride; confidence?: BrainMemoryRecordInput["confidence"]; title?: string } = {}): AyasRetrievalCorpusRecord {
  return {
    key,
    answerToken: name.toLocaleLowerCase("tr"),
    input: {
      kind: "user-preference",
      title: over.title ?? "Kullanıcı kimliği / hitap tercihi",
      body: over.body ?? `beni ${name} olarak hatırla`,
      importance: "durable",
      confidence: over.confidence ?? "reported",
      tags: ["kimlik"],
      observedAt,
      links: [],
      temporal: temporal(observedAt, { factKey: "user.identity.name", factValue: name.toLocaleLowerCase("tr"), ...over.temporal }),
    },
  };
}

function preference(key: string, body: string, observedAt: string, over: TemporalOverride = {}): AyasRetrievalCorpusRecord {
  return {
    key,
    input: {
      kind: "user-preference",
      title: "Kullanıcı tercihi",
      body,
      importance: "durable",
      confidence: "reported",
      tags: ["tercih"],
      observedAt,
      links: [],
      temporal: temporal(observedAt, over),
    },
  };
}

function decision(key: string, body: string, observedAt: string, over: TemporalOverride = {}): AyasRetrievalCorpusRecord {
  return {
    key,
    input: { kind: "decision", title: "Alınan karar", body, importance: "durable", confidence: "reported", tags: ["karar"], observedAt, links: [], temporal: temporal(observedAt, over) },
  };
}

function environment(key: string, body: string, observedAt: string, over: TemporalOverride = {}): AyasRetrievalCorpusRecord {
  return {
    key,
    input: { kind: "environment-note", title: "Çalışma ortamı bilgisi", body, importance: "durable", confidence: "reported", tags: ["ortam"], observedAt, links: [], temporal: temporal(observedAt, over) },
  };
}

/** A pre-v2 record: no temporal block, exactly as legacy live records are stored. */
function legacy(key: string, input: Omit<BrainMemoryRecordInput, "temporal" | "links" | "importance" | "confidence"> & { confidence?: BrainMemoryRecordInput["confidence"] }, answerToken?: string): AyasRetrievalCorpusRecord {
  return {
    key,
    ...(answerToken ? { answerToken } : {}),
    input: { importance: "durable", confidence: "reported", links: [], ...input },
  };
}

/* ------------------------------------------------------------------ */
/* Shared corpora                                                       */
/* ------------------------------------------------------------------ */

/**
 * Adversarial "computer" corpus (Phase 19): an old plan, the current plan
 * (explicitly replacing it), current specs, an unrelated laptop preference,
 * a historical purchase and a hypothetical future machine, plus off-topic
 * memories. Only the semantic + temporal match may win.
 */
const PC_CORPUS: readonly AyasRetrievalCorpusRecord[] = [
  decision("pcPlanOld", "RTX 4070 ekran kartlı bir masaüstü bilgisayar almaya karar verdim", "2026-07-05T10:00:00.000Z"),
  decision("pcPlanNew", "vazgeçtim, artık RTX 5080 ekran kartlı masaüstü bilgisayar almaya karar verdim", "2026-09-10T18:00:00.000Z", { provenance: "explicit-correction" }),
  environment("pcSpecs", "şu anki bilgisayarımda 16 GB RAM ve GTX 1650 ekran kartı var", "2026-08-20T09:00:00.000Z"),
  preference("laptopPref", "dizüstü bilgisayarlarda hafif ve sessiz modelleri tercih ederim", "2026-08-01T09:00:00.000Z"),
  environment("pcHistory", "2023'te ilk oyun bilgisayarımı almıştım", "2026-09-01T09:00:00.000Z", {
    assertion: "historical",
    heldFrom: "2023-01-01T00:00:00.000Z",
    heldUntil: "2024-01-01T00:00:00.000Z",
    effectivePrecision: "year",
  }),
  environment("pcFuture", "gelecek yıl belki bir de iş istasyonu alacağım", "2026-09-12T09:00:00.000Z", {
    assertion: "future",
    effectiveFrom: "2027-01-01T00:00:00.000Z",
    effectivePrecision: "year",
  }),
  preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
  decision("narrator", "Mimar Sinan belgeselinde anlatıcı olarak erkek ses kullanacağız", "2026-09-15T14:00:00.000Z"),
];

/** Old plan and current plan contradict; specs are a different attribute, not a contradiction. */
const PC_PLAN_GROUPS = [["pcPlanOld", "pcPlanNew"]] as const;

/** For "which computer do I plan to buy" questions: only the current plan is right. */
const PC_CURRENT_PLAN_EXPECT = {
  queryMode: "current" as const,
  relevant: ["pcPlanNew"],
  primary: "pcPlanNew",
  forbidden: { pcPlanOld: "stale-free-text", pcFuture: "future", pcHistory: "historical", coffee: "distractor", narrator: "distractor" } as const,
  contradictionGroups: PC_PLAN_GROUPS,
};

/** Response-length preference changed from short to long (explicit correction). */
const LENGTH_CORPUS: readonly AyasRetrievalCorpusRecord[] = [
  preference("lenShort", "bundan sonra cevapları kısa tut", "2026-08-12T09:00:00.000Z", { factKey: "user.preference.response-length", factValue: "short" }),
  preference("lenLong", "yanlış anlaşıldı, artık cevapları uzun ve detaylı yaz", "2026-09-14T09:00:00.000Z", { provenance: "explicit-correction", factKey: "user.preference.response-length", factValue: "long" }),
  preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
  decision("narrator", "Mimar Sinan belgeselinde anlatıcı olarak erkek ses kullanacağız", "2026-09-15T14:00:00.000Z"),
];

const LENGTH_CURRENT_EXPECT = {
  queryMode: "current" as const,
  relevant: ["lenLong"],
  primary: "lenLong",
  forbidden: { lenShort: "superseded", coffee: "distractor", narrator: "distractor" } as const,
  contradictionGroups: [["lenShort", "lenLong"]] as const,
};

/** Identity corrected from Ahmet to Mehmet. */
const NAME_CORPUS: readonly AyasRetrievalCorpusRecord[] = [
  identity("nameOld", "Ahmet", "2026-08-02T09:00:00.000Z"),
  identity("nameNew", "Mehmet", "2026-09-08T09:00:00.000Z", {
    body: "yanlış yazdım, beni Mehmet olarak hatırla",
    temporal: { provenance: "explicit-correction" },
  }),
  preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
  environment("pcSpecs", "şu anki bilgisayarımda 16 GB RAM ve GTX 1650 ekran kartı var", "2026-08-20T09:00:00.000Z"),
];

const NAME_CURRENT_EXPECT = {
  queryMode: "current" as const,
  relevant: ["nameNew"],
  primary: "nameNew",
  forbidden: { nameOld: "superseded", coffee: "distractor", pcSpecs: "distractor" } as const,
  contradictionGroups: [["nameOld", "nameNew"]] as const,
};

/** Editing/voice workflow preferences (multi-relevant). */
const WORKFLOW_CORPUS: readonly AyasRetrievalCorpusRecord[] = [
  preference("editTool", "kurguda DaVinci Resolve kullanmayı tercih ederim", "2026-09-01T09:00:00.000Z"),
  preference("voiceTone", "seslendirmede tok bir erkek ses tonunu tercih ederim", "2026-09-03T09:00:00.000Z"),
  preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
  environment("pcSpecs", "şu anki bilgisayarımda 16 GB RAM ve GTX 1650 ekran kartı var", "2026-08-20T09:00:00.000Z"),
  decision("channelTopic", "kanalda Osmanlı mimarisi belgeselleri yayınlayacağız", "2026-09-09T09:00:00.000Z"),
];

/* ------------------------------------------------------------------ */
/* Seed adaptation                                                      */
/* ------------------------------------------------------------------ */

const SEED_CATEGORY: Readonly<Record<string, AyasRetrievalCategory>> = {
  "recency-response-length": "superseded-preference",
  "identity-correction-current": "explicit-correction",
  "identity-as-of-january": "historical-as-of",
  "identity-known-at-january": "historical-as-of",
  "identity-as-of-after-change": "historical-as-of",
  "historical-recorded-today": "historical-as-of",
  "historical-not-current": "historical-as-of",
  "future-intent-not-current": "future-intent",
  "future-intent-as-of-never-certain": "future-intent",
  "same-instant-contradiction": "disputed",
  "weaker-newer-source": "contradiction",
  "voice-length-change": "legacy-v1",
  "project-decision-free-text": "explicit-correction",
};

/** What the seed's natural text expresses, when it matches the explicit query closely enough for chat. */
const SEED_NATURAL_MODE: Readonly<Record<string, AyasRetrievalQueryModeLabel>> = {
  "identity-as-of-january": "as-of",
  "identity-known-at-january": "as-of",
  // "İzmir'de ne zaman yaşıyordum" asks WHEN — a history question, not a window.
  "historical-recorded-today": "history",
};

const STATE_REASON: Readonly<Record<string, AyasRetrievalForbiddenReason | undefined>> = {
  superseded: "superseded",
  historical: "historical",
  future: "future",
  disputed: "disputed",
  conflicting: "conflicting",
};

/**
 * Retrieval-level ground truth that differs from the resolver-level seed.
 * `project-decision-free-text`: the user said "artık render için Remotion
 * kullanacağız" after the FFmpeg decision. The resolver correctly keeps both
 * as `current` (free text has no exclusive slot — the seed documents this as
 * "the known gap Retrieval Evaluation must measure"), but the true answer to
 * "render için ne kullanacağız" is Remotion; FFmpeg is stale.
 */
const SEED_RETRIEVAL_OVERRIDES: Readonly<Record<string, Partial<AyasRetrievalCase["expect"]>>> = {
  "project-decision-free-text": {
    relevant: ["remotion"],
    primary: "remotion",
    forbidden: { ffmpeg: "stale-free-text" },
    contradictionGroups: [["ffmpeg", "remotion"]],
  },
};

/** Values of one exclusive fact that contradict each other if delivered together as current. */
const SEED_CONTRADICTION_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  "recency-response-length": [["short", "long"]],
  "identity-correction-current": [["ahmet", "mehmet"]],
  "same-instant-contradiction": [["ahmet", "mehmet"]],
  "weaker-newer-source": [["ahmet", "atlas"]],
  "voice-length-change": [["shortLegacy", "long"]],
};

function adaptSeed(seed: AyasMemoryTemporalCase): AyasRetrievalCase {
  const selected = new Set(seed.expectedSelected);
  const asOf = seed.query.temporal?.mode === "as-of";
  const forbidden: Record<string, AyasRetrievalForbiddenReason> = {};
  for (const record of seed.records) {
    if (selected.has(record.label)) continue;
    const state = seed.expectedStates[record.label];
    const reason = state ? STATE_REASON[state] : asOf ? "out-of-window" : undefined;
    if (reason) forbidden[record.label] = reason;
  }
  const certain = seed.expectedSelected.find((label) => seed.expectedCertainty?.[label] === "certain");
  const primary = certain ?? (seed.expectedSelected.length === 1 ? seed.expectedSelected[0] : undefined);
  const base: AyasRetrievalCase["expect"] = {
    queryMode: asOf ? "as-of" : "current",
    relevant: [...seed.expectedSelected],
    ...(primary ? { primary } : {}),
    forbidden,
    contradictionGroups: SEED_CONTRADICTION_GROUPS[seed.id] ?? [],
    ...(seed.expectedCertainty ? { certainty: seed.expectedCertainty } : {}),
  };
  return {
    id: `seed:${seed.id}`,
    category: SEED_CATEGORY[seed.id] ?? "historical-as-of",
    description: seed.description,
    source: "seed",
    nowIso: seed.nowIso,
    corpus: seed.records.map((record) => {
      const name = record.input.tags.includes("kimlik") ? record.input.temporal?.factValue : undefined;
      return { key: record.label, input: record.input, ...(name ? { answerToken: name } : {}) };
    }),
    query: { ...seed.query, ...(seed.query.temporal && SEED_NATURAL_MODE[seed.id] ? { naturalMode: SEED_NATURAL_MODE[seed.id] } : {}) },
    expect: { ...base, ...SEED_RETRIEVAL_OVERRIDES[seed.id] },
  };
}

/* ------------------------------------------------------------------ */
/* New cases                                                            */
/* ------------------------------------------------------------------ */

const NEW_CASES: readonly AyasRetrievalCase[] = [
  /* A — exact recall */
  {
    id: "exact-pc-plan",
    category: "exact",
    description: "The question reuses the stored wording of the current computer decision.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "masaüstü bilgisayar almaya karar verdim, hangisiydi?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "exact-coffee",
    category: "exact",
    description: "Exact wording of a single unambiguous preference among distractors.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "sabahları ne içmeyi severim?" },
    expect: { queryMode: "current", relevant: ["coffee"], primary: "coffee", forbidden: { pcPlanNew: "distractor", pcSpecs: "distractor", narrator: "distractor" } },
  },
  {
    id: "exact-narrator",
    category: "exact",
    description: "Exact recall of a project decision.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "Mimar Sinan belgeselinde anlatıcı olarak ne kullanacağız?" },
    expect: { queryMode: "current", relevant: ["narrator"], primary: "narrator", forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },

  /* B — paraphrase */
  {
    id: "para-pc-thinking",
    category: "paraphrase",
    languageTags: ["suffix", "omitted-pronoun"],
    description: "The user's own example: which computer am I thinking of buying.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "hangi bilgisayarı almayı düşünüyorum?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "para-pc-plan",
    category: "paraphrase",
    languageTags: ["possessive"],
    description: "Short possessive paraphrase of the purchase decision.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "bilgisayar planım ne?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "para-length-how",
    category: "paraphrase",
    languageTags: ["tense", "omitted-pronoun"],
    description: "How did I ask you to write your answers — current length preference.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "cevaplarını nasıl yazmanı istemiştim?" },
    expect: LENGTH_CURRENT_EXPECT,
  },
  {
    id: "para-name-address",
    category: "paraphrase",
    languageTags: ["omitted-pronoun"],
    description: "How should you address me — current name.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: NAME_CORPUS,
    query: { text: "bana nasıl hitap edeceksin?" },
    expect: NAME_CURRENT_EXPECT,
  },

  /* C — Turkish morphology */
  {
    id: "morph-pc-last-decision",
    category: "morphology",
    languageTags: ["tense", "suffix", "omitted-pronoun"],
    description: "The user's example: what did I last decide to buy (pluperfect, no noun).",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "en son ne almaya karar vermiştim?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "morph-pc-card-accusative",
    category: "morphology",
    languageTags: ["suffix", "possessive"],
    description: "Accusative + possessive forms of the stored nouns.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "almaya karar verdiğim bilgisayarın ekran kartını hatırlıyor musun?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "morph-length-plural",
    category: "morphology",
    languageTags: ["suffix", "possessive"],
    description: "Plural possessive of 'answer' with a preference noun.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "cevaplarımın uzunluğu konusundaki tercihim nedir?" },
    expect: LENGTH_CURRENT_EXPECT,
  },
  {
    id: "morph-coffee-locative",
    category: "morphology",
    languageTags: ["suffix"],
    description: "Locative/possessive forms around a simple preference.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "kahvemi sabahları nasıl içerim?" },
    expect: { queryMode: "current", relevant: ["coffee"], primary: "coffee", forbidden: { pcPlanNew: "distractor", narrator: "distractor" } },
  },

  /* D — word order */
  {
    id: "order-pc-inverted",
    category: "word-order",
    languageTags: ["word-order"],
    description: "Verb-first, noun-last ordering of the purchase question.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "karar verdiğim hangisiydi, almayı düşündüğüm bilgisayar?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "order-length-inverted",
    category: "word-order",
    languageTags: ["word-order"],
    description: "Inverted order of the length preference question.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "uzun mu olsun kısa mı, cevapların?" },
    expect: LENGTH_CURRENT_EXPECT,
  },

  /* E — synonym / natural phrasing */
  {
    id: "syn-pc-colloquial",
    category: "synonym",
    languageTags: ["colloquial", "synonym", "tense"],
    description: "The user's example: 'pc' instead of 'bilgisayar', asking for the latest decision.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "pc konusunda son kararım neydi?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "syn-length-yanit",
    category: "synonym",
    languageTags: ["synonym", "tense"],
    description: "'yanıt' instead of the stored 'cevap'.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "yanıtların uzun mu kısa mı olsun demiştim?" },
    expect: LENGTH_CURRENT_EXPECT,
  },
  {
    id: "syn-edit-montaj",
    category: "synonym",
    languageTags: ["synonym"],
    description: "'montaj' for the stored 'kurgu'.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "montaj için hangi programı kullanıyorum?" },
    expect: { queryMode: "current", relevant: ["editTool"], primary: "editTool", forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },

  /* F — current preference */
  {
    id: "current-pref-voice",
    category: "current-preference",
    description: "A single, unchanged voice preference.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "seslendirmede hangi ses tonunu tercih ederim?" },
    expect: { queryMode: "current", relevant: ["voiceTone"], primary: "voiceTone", forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },
  {
    id: "current-pref-edit",
    category: "current-preference",
    description: "A single, unchanged editing tool preference.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "kurguda hangi programı tercih ediyorum?" },
    expect: { queryMode: "current", relevant: ["editTool"], primary: "editTool", forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },

  /* G — superseded preference */
  {
    id: "superseded-length-direct",
    category: "superseded-preference",
    description: "Asking about the current length preference while the old one is still stored.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "cevap uzunluğu tercihim ne?" },
    expect: LENGTH_CURRENT_EXPECT,
  },
  {
    id: "superseded-length-old-wording",
    category: "superseded-preference",
    description: "The question echoes the OLD value's wording; the current value must still win and the old one stay out.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "cevapları kısa tutmamı mı istiyorum?" },
    expect: LENGTH_CURRENT_EXPECT,
  },

  /* H — historical / as-of */
  {
    id: "asof-pc-july-detected",
    category: "historical-as-of",
    languageTags: ["tense"],
    description: "Which card was I planning to buy in July — natural-language as-of, before the change.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "Temmuz ayında hangi ekran kartlı bilgisayarı almayı düşünüyordum?" },
    expect: {
      queryMode: "as-of",
      relevant: ["pcPlanOld"],
      primary: "pcPlanOld",
      forbidden: { pcPlanNew: "out-of-window", pcFuture: "future", coffee: "distractor", narrator: "distractor" },
    },
  },
  {
    id: "asof-pc-2023-explicit",
    category: "historical-as-of",
    description: "Explicit 2023 window: the historical purchase holds for certain.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "2023'te hangi bilgisayarı almıştım?", temporal: { mode: "as-of", at: "2023-01-01T00:00:00.000Z", until: "2024-01-01T00:00:00.000Z" }, naturalMode: "as-of" },
    expect: {
      queryMode: "as-of",
      relevant: ["pcHistory"],
      primary: "pcHistory",
      certainty: { pcHistory: "certain" },
      forbidden: { pcFuture: "future", coffee: "distractor", narrator: "distractor" },
    },
  },
  {
    id: "asof-name-august-window",
    category: "historical-as-of",
    description: "August window: the name stated inside it held for certain; the later name's change date is unknown, so it is only possible.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      identity("nameOld", "Ahmet", "2026-08-02T09:00:00.000Z"),
      identity("nameNew", "Mehmet", "2026-09-08T09:00:00.000Z"),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "Ağustos ayında adım neydi?", temporal: { mode: "as-of", at: "2026-08-01T00:00:00.000Z", until: "2026-09-01T00:00:00.000Z" }, naturalMode: "as-of" },
    expect: { queryMode: "as-of", relevant: ["nameOld", "nameNew"], primary: "nameOld", certainty: { nameOld: "certain", nameNew: "possible" }, forbidden: { coffee: "distractor" } },
  },
  {
    id: "history-length-used-to",
    category: "historical-as-of",
    languageTags: ["tense"],
    description: "What did I use to prefer — the old value is the answer, the current one is context.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "eskiden cevapların uzunluğu için ne istiyordum?" },
    expect: { queryMode: "history", relevant: ["lenShort", "lenLong"], primary: "lenShort", forbidden: { coffee: "distractor", narrator: "distractor" } },
  },

  /* I — explicit correction */
  {
    id: "correction-voice-length",
    category: "explicit-correction",
    description: "Voice length corrected from short to long.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      preference("voiceShort", "sesli yanıtları kısa tut", "2026-08-15T09:00:00.000Z", { factKey: "user.preference.voice-length", factValue: "short" }),
      preference("voiceLong", "yanlış anlaşıldı, sesli yanıtları uzun tut", "2026-09-16T09:00:00.000Z", { provenance: "explicit-correction", factKey: "user.preference.voice-length", factValue: "long" }),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "sesli yanıtlar nasıl olsun istiyorum?" },
    expect: { queryMode: "current", relevant: ["voiceLong"], primary: "voiceLong", forbidden: { voiceShort: "superseded", coffee: "distractor" }, contradictionGroups: [["voiceShort", "voiceLong"]] },
  },
  {
    id: "correction-name-current",
    category: "explicit-correction",
    description: "After a name correction the current name is the only right answer.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: NAME_CORPUS,
    query: { text: "adım ne?" },
    expect: NAME_CURRENT_EXPECT,
  },

  /* J — future intent */
  {
    id: "future-as-current-workstation",
    category: "future-intent",
    description: "Do I have a workstation now — a plan must not answer as a fact.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "şu an bir iş istasyonum var mı?" },
    expect: { queryMode: "current", relevant: [], forbidden: { pcFuture: "future", coffee: "distractor", narrator: "distractor" } },
  },
  {
    id: "future-plan-question",
    category: "future-intent",
    description: "Asking about next year's plan: the plan itself is the answer, as a plan.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "gelecek yıl ne almayı planlıyorum?" },
    expect: { queryMode: "current", relevant: ["pcFuture"], primary: "pcFuture", forbidden: { pcHistory: "historical", coffee: "distractor", narrator: "distractor" } },
    notes: "A plan question is about a current intention; plans are stored with assertion=future.",
  },

  /* K — contradiction */
  {
    id: "contradiction-inferred-name",
    category: "contradiction",
    description: "A newer AYAS-inferred name never overrides the user's own statement.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      identity("nameUser", "Selin", "2026-08-20T09:00:00.000Z"),
      identity("nameInferred", "Seda", "2026-09-18T09:00:00.000Z", { confidence: "inferred", title: "AYAS çıkarımı", temporal: { provenance: "conversation-derived" } }),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "benim adım ne?" },
    expect: { queryMode: "current", relevant: ["nameUser"], primary: "nameUser", forbidden: { nameInferred: "conflicting", coffee: "distractor" }, contradictionGroups: [["nameUser", "nameInferred"]] },
  },
  {
    id: "contradiction-free-text-coffee",
    category: "contradiction",
    description: "A free-text taste changed later without an exclusive slot; the newer statement is the current one.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      preference("sugarYes", "kahveyi şekerli içerim", "2026-07-20T09:00:00.000Z"),
      preference("sugarNo", "artık kahveyi şekersiz içiyorum", "2026-09-17T09:00:00.000Z", { provenance: "explicit-correction" }),
      decision("narrator", "Mimar Sinan belgeselinde anlatıcı olarak erkek ses kullanacağız", "2026-09-15T14:00:00.000Z"),
    ],
    query: { text: "kahveyi nasıl içerim?" },
    expect: { queryMode: "current", relevant: ["sugarNo"], primary: "sugarNo", forbidden: { sugarYes: "stale-free-text", narrator: "distractor" }, contradictionGroups: [["sugarYes", "sugarNo"]] },
  },

  /* L — disputed */
  {
    id: "disputed-length-same-instant",
    category: "disputed",
    description: "Short and long stated at the same instant with equal trust: no defensible winner, recall nothing.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      preference("lenShortSame", "cevapları kısa tut", "2026-09-10T09:00:00.000Z", { factKey: "user.preference.response-length", factValue: "short" }),
      preference("lenLongSame", "cevapları uzun tut", "2026-09-10T09:00:00.000Z", { factKey: "user.preference.response-length", factValue: "long" }),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "cevap uzunluğu tercihim ne?" },
    expect: { queryMode: "current", relevant: [], forbidden: { lenShortSame: "disputed", lenLongSame: "disputed", coffee: "distractor" }, contradictionGroups: [["lenShortSame", "lenLongSame"]] },
  },

  /* M — irrelevant distractors */
  {
    id: "distractor-pc-heavy-current",
    category: "distractor",
    description: "Phase 19: every computer-related memory is present; only the current plan answers the plan question.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "şu anki bilgisayar satın alma planım ne?" },
    expect: { ...PC_CURRENT_PLAN_EXPECT, forbidden: { ...PC_CURRENT_PLAN_EXPECT.forbidden, laptopPref: "distractor" } },
  },
  {
    id: "distractor-edit-vs-channel",
    category: "distractor",
    description: "A channel-topic decision shares the documentary theme but not the asked attribute.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "kurgu programı tercihim hangisi?" },
    expect: { queryMode: "current", relevant: ["editTool"], primary: "editTool", forbidden: { channelTopic: "distractor", coffee: "distractor", pcSpecs: "distractor" } },
  },

  /* N — same topic, different attribute */
  {
    id: "attribute-pc-ram",
    category: "same-topic-other-attribute",
    description: "Asking about RAM: specs answer; purchase plans are the same topic, wrong attribute.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "bilgisayarımda kaç GB RAM var?" },
    expect: { queryMode: "current", relevant: ["pcSpecs"], primary: "pcSpecs", forbidden: { pcPlanOld: "distractor", pcPlanNew: "distractor", pcFuture: "future", pcHistory: "historical", laptopPref: "distractor", coffee: "distractor" } },
  },
  {
    id: "attribute-pc-current-card",
    category: "same-topic-other-attribute",
    description: "Current graphics card: the planned RTX 5080 is not owned yet.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "şu anki ekran kartım ne?" },
    expect: { queryMode: "current", relevant: ["pcSpecs"], primary: "pcSpecs", forbidden: { pcPlanOld: "distractor", pcPlanNew: "distractor", pcFuture: "future", pcHistory: "historical", coffee: "distractor" } },
  },

  /* O — identity */
  {
    id: "identity-who-am-i",
    category: "identity",
    languageTags: ["omitted-pronoun"],
    description: "'Ben kimim' — the current name.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: NAME_CORPUS,
    query: { text: "ben kimim?" },
    expect: NAME_CURRENT_EXPECT,
  },
  {
    id: "identity-old-unchanged",
    category: "identity",
    description: "A name stated long ago and never changed is still the user's name.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      identity("nameLongAgo", "Kerem", "2026-01-10T09:00:00.000Z"),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "benim adım ne?" },
    expect: { queryMode: "current", relevant: ["nameLongAgo"], primary: "nameLongAgo", forbidden: { coffee: "distractor" } },
    notes: "Names do not go stale with age; only a later statement can replace them.",
  },

  /* P — no relevant information */
  {
    id: "none-weather",
    category: "no-relevant",
    description: "Weather question against a corpus with nothing about weather.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "yarın hava nasıl olacak?" },
    expect: { queryMode: "current", relevant: [], strictNegative: true },
  },
  {
    id: "none-football",
    category: "no-relevant",
    description: "Favourite football team was never mentioned.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "en sevdiğim futbol takımı hangisi?" },
    expect: { queryMode: "current", relevant: [], strictNegative: true },
  },
  {
    id: "none-same-word-other-meaning",
    category: "no-relevant",
    description: "General advice about studying computer engineering; the user's computer memories are not relevant.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "bilgisayar mühendisliği okumak mantıklı mı?" },
    expect: { queryMode: "current", relevant: [], forbidden: { pcSpecs: "distractor", pcPlanNew: "distractor", pcPlanOld: "distractor", laptopPref: "distractor" } },
  },
  {
    id: "none-empty-corpus",
    category: "no-relevant",
    description: "Empty memory: nothing can be selected.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [],
    query: { text: "benim adım ne?" },
    expect: { queryMode: "current", relevant: [], strictNegative: true },
  },
  {
    id: "none-forgotten-name",
    category: "no-relevant",
    description: "The only name record was forgotten; it must not resurrect in current recall.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [identity("forgottenName", "Deniz", "2026-09-01T09:00:00.000Z"), preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z")],
    forgotten: ["forgottenName"],
    query: { text: "benim adım ne?" },
    expect: { queryMode: "current", relevant: [], forbidden: { forgottenName: "deleted", coffee: "distractor" } },
  },
  {
    id: "none-forgotten-name-history",
    category: "no-relevant",
    description: "A forgotten record must not resurrect through a history question either.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [identity("forgottenName", "Deniz", "2026-09-01T09:00:00.000Z"), preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z")],
    forgotten: ["forgottenName"],
    query: { text: "eskiden adım neydi?", temporal: { mode: "current", includeHistory: true }, naturalMode: "history" },
    expect: { queryMode: "history", relevant: [], forbidden: { forgottenName: "deleted", coffee: "distractor" } },
  },

  /* Q — multiple relevant facts */
  {
    id: "multi-workflow-prefs",
    category: "multi-relevant",
    description: "Editing and voice-over preferences asked together; both are needed.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "kurgu ve seslendirme tercihlerim neler?" },
    expect: { queryMode: "current", relevant: ["editTool", "voiceTone"], forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },
  {
    id: "multi-pc-card-and-ram",
    category: "multi-relevant",
    description: "Owned computer specs plus the purchase plan, asked together.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "şu anki bilgisayarımın özellikleri ne ve hangi bilgisayarı almaya karar verdim?" },
    expect: { queryMode: "current", relevant: ["pcSpecs", "pcPlanNew"], forbidden: { pcPlanOld: "stale-free-text", pcFuture: "future", pcHistory: "historical", coffee: "distractor", narrator: "distractor" }, contradictionGroups: PC_PLAN_GROUPS },
  },

  /* R — legacy v1 */
  {
    id: "legacy-identity-current",
    category: "legacy-v1",
    description: "A legacy (no temporal block) identity record is still recalled as the current name.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      legacy("legacyName", { kind: "user-preference", title: "Kullanıcı kimliği / hitap tercihi", body: "beni Ayşe olarak hatırla", tags: ["kimlik"], observedAt: "2026-08-25T09:00:00.000Z" }, "ayşe"),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "benim adım ne?" },
    expect: { queryMode: "current", relevant: ["legacyName"], primary: "legacyName", forbidden: { coffee: "distractor" } },
  },
  {
    id: "legacy-superseded-by-v2",
    category: "legacy-v1",
    description: "A legacy length preference replaced by a later v2 correction.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      legacy("legacyShort", { kind: "user-preference", title: "Kullanıcı tercihi", body: "cevapları kısa tut", tags: ["tercih"], observedAt: "2026-08-05T09:00:00.000Z" }),
      preference("v2Long", "artık cevapları uzun ve detaylı yaz", "2026-09-12T09:00:00.000Z", { provenance: "explicit-correction", factKey: "user.preference.response-length", factValue: "long" }),
    ],
    query: { text: "cevaplarımın uzunluğu ne olmalı?" },
    expect: { queryMode: "current", relevant: ["v2Long"], primary: "v2Long", forbidden: { legacyShort: "superseded" }, contradictionGroups: [["legacyShort", "v2Long"]] },
  },
  {
    id: "legacy-free-text-discovery",
    category: "legacy-v1",
    description: "A legacy free-text environment note is found as a candidate like any v2 record.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      legacy("legacyEnv", { kind: "environment-note", title: "Çalışma ortamı bilgisi", body: "render işlerini evdeki ikinci makinede çalıştırıyorum", tags: ["ortam"], observedAt: "2026-09-02T09:00:00.000Z" }),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "render işlerini hangi makinede çalıştırıyorum?" },
    expect: { queryMode: "current", relevant: ["legacyEnv"], primary: "legacyEnv", forbidden: { coffee: "distractor" } },
  },
  {
    id: "legacy-as-of-unknown-start",
    category: "legacy-v1",
    description: "As-of before a legacy record was observed: its start is unknown, so it may be possible, never certain.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      legacy("legacyName", { kind: "user-preference", title: "Kullanıcı kimliği / hitap tercihi", body: "beni Ayşe olarak hatırla", tags: ["kimlik"], observedAt: "2026-08-25T09:00:00.000Z" }, "ayşe"),
    ],
    query: { text: "Temmuz'da adım neydi?", temporal: { mode: "as-of", at: "2026-07-01T00:00:00.000Z", until: "2026-08-01T00:00:00.000Z" }, naturalMode: "as-of" },
    expect: { queryMode: "as-of", relevant: ["legacyName"], primary: "legacyName", certainty: { legacyName: "possible" } },
    notes: "Unknown effective start must stay unknown: 'possible', not 'none' and not 'certain'.",
  },

  /* Turkish surface robustness (Phase 5) on the same intents */
  {
    id: "tr-pc-capitals",
    category: "morphology",
    languageTags: ["capitalization", "suffix"],
    description: "All caps with dotted İ.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "BİLGİSAYAR ALMA KARARIM NEYDİ" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "tr-pc-punctuation",
    category: "morphology",
    languageTags: ["punctuation"],
    description: "Heavy punctuation around the same question.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "bilgisayar... almaya karar verdiğim... hangisiydi???" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "tr-name-no-diacritics",
    category: "identity",
    languageTags: ["colloquial"],
    description: "Typed without Turkish characters.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: NAME_CORPUS,
    query: { text: "adim ne benim" },
    expect: NAME_CURRENT_EXPECT,
  },
  {
    id: "tr-pc-typo",
    category: "morphology",
    languageTags: ["typo"],
    description: "A light typo in the key noun (stretch: no fuzzy matching is claimed).",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "hangi bilgisyarı almaya karar verdim?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },

  /* Held-out paraphrases — never used to guide remediation */
  {
    id: "heldout-pc-card-want",
    category: "paraphrase",
    languageTags: ["suffix", "tense"],
    heldOut: true,
    description: "Held-out: the graphics card of the computer I want to buy.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "almak istediğim bilgisayarın ekran kartı hangisiydi?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "heldout-pc-switch",
    category: "paraphrase",
    languageTags: ["suffix"],
    heldOut: true,
    description: "Held-out: which card did I decide to switch to.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "hangi ekran kartına geçmeye karar verdim?" },
    expect: PC_CURRENT_PLAN_EXPECT,
  },
  {
    id: "heldout-length-want",
    category: "paraphrase",
    languageTags: ["omitted-pronoun"],
    heldOut: true,
    description: "Held-out: what length do I want answers in.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: LENGTH_CORPUS,
    query: { text: "cevapları ne uzunlukta istiyorum?" },
    expect: LENGTH_CURRENT_EXPECT,
  },
  {
    id: "heldout-name-call-me",
    category: "identity",
    languageTags: ["omitted-pronoun", "synonym"],
    heldOut: true,
    description: "Held-out: which name should you call me by.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: NAME_CORPUS,
    query: { text: "bana hangi isimle seslenmelisin?" },
    expect: NAME_CURRENT_EXPECT,
  },
  {
    id: "heldout-ram-bellek",
    category: "synonym",
    languageTags: ["synonym", "possessive"],
    heldOut: true,
    description: "Held-out: 'bellek' for RAM.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "şu an kullandığım bilgisayarın belleği ne kadar?" },
    expect: { queryMode: "current", relevant: ["pcSpecs"], primary: "pcSpecs", forbidden: { pcPlanOld: "distractor", pcPlanNew: "distractor", pcFuture: "future", pcHistory: "historical", coffee: "distractor" } },
  },
  {
    id: "heldout-narrator-voice",
    category: "paraphrase",
    heldOut: true,
    description: "Held-out: whose voice narrates the Mimar Sinan documentary.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: PC_CORPUS,
    query: { text: "Mimar Sinan belgeselini kimin sesi anlatacak?" },
    expect: { queryMode: "current", relevant: ["narrator"], primary: "narrator", forbidden: { coffee: "distractor", pcSpecs: "distractor" } },
  },
  {
    id: "heldout-none-recipe",
    category: "no-relevant",
    heldOut: true,
    description: "Held-out negative: a recipe question.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: WORKFLOW_CORPUS,
    query: { text: "mercimek çorbası nasıl yapılır?" },
    expect: { queryMode: "current", relevant: [], strictNegative: true },
  },
  {
    id: "heldout-voice-length",
    category: "explicit-correction",
    heldOut: true,
    description: "Held-out: are my spoken answers supposed to be short.",
    source: "new",
    nowIso: EVAL_NOW,
    corpus: [
      preference("voiceShort", "sesli yanıtları kısa tut", "2026-08-15T09:00:00.000Z", { factKey: "user.preference.voice-length", factValue: "short" }),
      preference("voiceLong", "yanlış anlaşıldı, sesli yanıtları uzun tut", "2026-09-16T09:00:00.000Z", { provenance: "explicit-correction", factKey: "user.preference.voice-length", factValue: "long" }),
      preference("coffee", "sabahları filtre kahve içmeyi severim", "2026-09-05T08:00:00.000Z"),
    ],
    query: { text: "sesli cevaplarım kısa mı olacaktı?" },
    expect: { queryMode: "current", relevant: ["voiceLong"], primary: "voiceLong", forbidden: { voiceShort: "superseded", coffee: "distractor" }, contradictionGroups: [["voiceShort", "voiceLong"]] },
  },
];

export const AYAS_RETRIEVAL_EVALUATION_CASES: readonly AyasRetrievalCase[] = [
  ...AYAS_MEMORY_TEMPORAL_CASES.map(adaptSeed),
  ...NEW_CASES,
];
