/**
 * Atölye Brain — AYAS conversation state (Phase 2 · Phase B).
 *
 * A small, DETERMINISTIC projection of "where we are in this conversation",
 * derived purely from the turn history + (optionally) the read-only studio
 * context. It is NOT a second chat log — the raw turns stay authoritative. This
 * gives the reference resolver and the prompt a compact "what is `bu` / `o
 * proje` / `devam et` about" without asking a model.
 *
 * Pure: no fs, no network, no model, no clock beyond an injected `now`.
 */

import type { AyasStudioContextView } from "@/components/brain/brainCore";
import type { BrainChatMessage } from "@/components/brain/brainCore";

export interface AyasConversationEntity {
  /** Canonical form (a project slug / title, a stage key, a runtime path…). */
  readonly value: string;
  /** `project` | `stage` | `path` | `topic`. */
  readonly kind: "project" | "stage" | "path" | "topic";
  /** 1-based turn index it was last seen in (higher = more recent). */
  readonly lastTurn: number;
}

export interface AyasConversationStateView {
  readonly conversationId: string;
  /** Most recently referenced project's DISPLAY title (or slug if no title), or `null`. */
  readonly activeProject: string | null;
  /**
   * The SAME project's real slug — Action Runtime (`AyasChatStream.ts`) tool
   * dispatch (spec §Action Runtime) derives `projectSlug` from this, NEVER
   * from model-supplied free text, so a hallucinated/invented slug can never
   * reach a real executor. `null` whenever `activeProject` is null OR was
   * matched from conversation text with no known-project slug behind it.
   */
  readonly activeProjectSlug: string | null;
  /** A short label for what AYAS is currently helping with, or `null`. */
  readonly activeTopic: string | null;
  /** The pipeline stage last discussed, or `null`. */
  readonly activeStage: string | null;
  /** Options last presented/discussed, in their conversational order. */
  readonly options: readonly string[];
  /** Option explicitly selected by the user (for example "ikincisi"), if any. */
  readonly selectedOption: string | null;
  /** Immediate, conversation-only exclusions such as "memory'ye bugün girme". */
  readonly temporaryConstraints: readonly string[];
  /** The user's last message, trimmed — the thing `devam et` / `bunu da` extends. */
  readonly lastUserText: string | null;
  /** AYAS's last reply, trimmed — the thing `bir önceki` / `onu` may point at. */
  readonly lastAssistantText: string | null;
  /** Questions AYAS asked that the user has not answered yet. */
  readonly unresolvedQuestions: readonly string[];
  /** Entities seen in the conversation, most-recent first, capped. */
  readonly recentEntities: readonly AyasConversationEntity[];
  /** Turn count fed in (post-system-filter). */
  readonly turnCount: number;
}

export const EMPTY_AYAS_CONVERSATION_STATE: AyasConversationStateView = Object.freeze({
  conversationId: "c0",
  activeProject: null,
  activeProjectSlug: null,
  activeTopic: null,
  activeStage: null,
  options: [],
  selectedOption: null,
  temporaryConstraints: [],
  lastUserText: null,
  lastAssistantText: null,
  unresolvedQuestions: [],
  recentEntities: [],
  turnCount: 0,
});

const MAX_ENTITIES = 8;
const MAX_UNRESOLVED = 3;
const MAX_OPTIONS = 5;
const MAX_CONSTRAINTS = 3;

const STAGE_WORDS = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "audio",
  "video",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
];

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

/** A trailing "?" clause AYAS emitted that reads as a question to the user. */
function pendingQuestion(assistantText: string): string | null {
  const trimmed = assistantText.trim();
  if (!trimmed.endsWith("?")) return null;
  // the last sentence ending in "?"
  const parts = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  return last.length <= 200 ? last : null;
}

function compact(text: string, max = 120): string {
  const value = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Small, general option extractor; it is deliberately not a Turkish parser. */
export function extractAyasConversationOptions(text: string): string[] {
  const value = compact(text, 500);
  const folded = fold(value);
  let source = "";

  // Adversarial-sweep finding: "yaklaşım/yöntem/yol" (approach/method/way) are
  // ordinary synonyms for an enumerable option in Turkish, same shape as
  // "seçenek/alan" — without them, a real "Üç yaklaşım var: A, B ve C."
  // failed to extract options at all, so a later "üçüncüsü" fell through
  // safely to a clarification instead of correctly resolving. Extending the
  // existing whitelist, not adding a parser.
  const colon = folded.match(/\b(?:iki|uc|2|3)\s+(?:secenek|alan|problem|oneri|yaklasim|yontem|yol)[^:]{0,30}:\s*(.+)$/i);
  if (colon?.[1]) source = colon[1];

  if (!source && /\bolmak uzere\b/.test(folded)) {
    source = value.split(/\bolmak üzere\b|\bolmak uzere\b/i)[0]?.trim() ?? "";
    source = source.replace(/^.*?(?:tarafında|tarafinda)\s+/i, "");
  }

  if (source) {
    const parts = source
      .split(/\s+(?:ve|veya)\s+|\s*,\s*/i)
      .map((part) => compact(part, 80))
      .filter((part) => part.length >= 2 && part.length <= 80);
    if (parts.length >= 2 && parts.length <= MAX_OPTIONS) return parts;
  }

  const ordinalMatches = [...value.matchAll(/(?:^|\s)(?:\d+[.)]|birincisi|ikincisi|üçüncüsü|ucuncusu)\s*[:—-]?\s*([^\n;]+?)(?=(?:\s+(?:\d+[.)]|birincisi|ikincisi|üçüncüsü|ucuncusu)\s*[:—-]?)|$)/gi)]
    .map((match) => compact(match[1] ?? "", 80))
    .filter((part) => part.length >= 2);
  return ordinalMatches.length >= 2 ? ordinalMatches.slice(0, MAX_OPTIONS) : [];
}

function selectedOptionIndex(text: string): number | null {
  const value = fold(text);
  if (/\b(ilki|birincisi|birincisine|birincisini|ilkine|ilkini)\b/.test(value)) return 0;
  if (/\b(ikincisi|ikincisine|ikincisini|ikinciye|ikinciyi)\b/.test(value)) return 1;
  if (/\b(ucuncusu|ucuncusune|ucuncusunu|ucuncuye|ucuncuyu)\b/.test(value)) return 2;
  return null;
}

function immediateConstraint(text: string): string | null {
  const value = fold(text);
  if (!/\b(dokunmayalim|girme|girmeyelim|degistirme|konusmayalim|haric|disinda tut|olmasin)\b/.test(value)) return null;
  return compact(text, 140);
}

function explicitTopic(text: string): string | null {
  const value = fold(text);
  const match = value.match(/^(.{2,100}?)\s+(?:konusalim|inceleyelim|ele alalim|uzerinden gidelim)\b/);
  if (!match?.[1]) return null;
  let topic = match[1].replace(/^(?:bugun|simdi)\s+/, "").trim();
  const marker = Math.max(topic.lastIndexOf("yalnizca "), topic.lastIndexOf("sadece "));
  if (marker >= 0) topic = topic.slice(marker).replace(/^(?:yalnizca|sadece)\s+/, "");
  topic = topic.replace(/\b(?:tarafini|konusunu)$/, "").trim();
  return topic.length >= 2 ? compact(topic, 80) : null;
}

/**
 * Deterministically derive the conversation state. `history` is the same
 * `{role,text}[]` the chat route already has; system/welcome turns are filtered.
 */
export function deriveAyasConversationState(
  history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[],
  options: {
    readonly conversationId?: string;
    readonly studio?: AyasStudioContextView;
  } = {},
): AyasConversationStateView {
  const turns = history.filter((t) => t.role !== "system" && typeof t.text === "string" && t.text.trim());
  if (turns.length === 0) {
    return { ...EMPTY_AYAS_CONVERSATION_STATE, conversationId: options.conversationId ?? "c0" };
  }

  const knownProjects: { slugFold: string; titleFold: string; display: string; slug: string }[] = (options.studio?.available
    ? options.studio.projects.sample
    : []
  ).map((p) => ({
    slugFold: fold(p.slug),
    titleFold: fold(p.title || p.slug),
    display: (p.title || p.slug).trim(),
    slug: p.slug,
  }));

  const entities = new Map<string, AyasConversationEntity>();
  const note = (value: string, kind: AyasConversationEntity["kind"], turn: number) => {
    const key = `${kind}:${value}`;
    const prev = entities.get(key);
    if (!prev || turn > prev.lastTurn) entities.set(key, { value, kind, lastTurn: turn });
  };

  let activeProject: string | null = null;
  let activeProjectSlug: string | null = null;
  let activeProjectTurn = -1;
  let activeStage: string | null = null;
  let conversationOptions: string[] = [];
  let selectedOption: string | null = null;
  let selectedOptionTurn = -1;
  let statedTopic: string | null = null;
  let statedTopicTurn = -1;
  const constraints: string[] = [];
  let lastUserText: string | null = null;
  let lastAssistantText: string | null = null;
  const unresolved: string[] = [];

  turns.forEach((turn, i) => {
    const idx = i + 1;
    const folded = fold(turn.text);

    for (const p of knownProjects) {
      if (
        (p.slugFold && folded.includes(p.slugFold)) ||
        (p.titleFold && p.titleFold.length > 3 && folded.includes(p.titleFold))
      ) {
        note(p.display, "project", idx);
        activeProject = p.display;
        activeProjectSlug = p.slug;
        activeProjectTurn = idx;
      }
    }
    for (const stage of STAGE_WORDS) {
      if (new RegExp(`\\b${stage}\\b`).test(folded)) {
        note(stage, "stage", idx);
        activeStage = stage;
      }
    }
    for (const m of turn.text.matchAll(/(?:[A-Za-z]:\\|\/)[\w.\\/-]{2,}/g)) {
      note(m[0], "path", idx);
    }

    if (turn.role === "user") {
      lastUserText = turn.text.trim();
      const choice = selectedOptionIndex(turn.text);
      if (choice !== null && conversationOptions[choice]) {
        selectedOption = conversationOptions[choice];
        selectedOptionTurn = idx;
      }
      const constraint = immediateConstraint(turn.text);
      if (constraint) {
        constraints.push(constraint);
        if (constraints.length > MAX_CONSTRAINTS) constraints.shift();
      }
      const topic = explicitTopic(turn.text);
      if (topic) {
        statedTopic = topic;
        statedTopicTurn = idx;
        note(topic, "topic", idx);
      }
      // answering clears the most recent pending question
      if (unresolved.length && turn.text.trim().length > 0) unresolved.length = 0;
    } else {
      lastAssistantText = turn.text.trim();
      const q = pendingQuestion(turn.text);
      if (q) {
        unresolved.length = 0;
        unresolved.push(q);
      }
    }

    const discoveredOptions = extractAyasConversationOptions(turn.text);
    if (discoveredOptions.length) {
      conversationOptions = discoveredOptions;
      selectedOption = null;
      selectedOptionTurn = -1;
      discoveredOptions.forEach((option) => note(option, "topic", idx));
    }
  });

  const recentEntities = [...entities.values()]
    .sort((a, b) => b.lastTurn - a.lastTurn || a.value.localeCompare(b.value))
    .slice(0, MAX_ENTITIES);

  const conversationalTopic = [...turns]
    .reverse()
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.text.trim())
    .find((value) =>
      value.split(/\s+/).length >= 3 &&
      !/^\s*(?:tamam|peki|evet|hayır|hayir|bunu|şunu|sunu|onu|o\b|bu\b|neden\b|niye\b|nasıl yani|nasil yani|devam et|ilk\b|ikinci\b)/i.test(value),
    );

  const explicitFocus = [
    ...(selectedOption ? [{ value: selectedOption, turn: selectedOptionTurn }] : []),
    ...(statedTopic ? [{ value: statedTopic, turn: statedTopicTurn }] : []),
    ...(activeProject ? [{ value: activeProject, turn: activeProjectTurn }] : []),
  ].sort((a, b) => b.turn - a.turn)[0]?.value ?? null;

  const activeTopic =
    explicitFocus ??
    recentEntities.find((e) => e.kind === "topic")?.value ??
    (activeStage ? `${activeStage} aşaması` : null) ??
    (conversationalTopic ? compact(conversationalTopic, 100) : null);

  return {
    conversationId: options.conversationId ?? "c0",
    activeProject,
    activeProjectSlug,
    activeTopic,
    activeStage,
    options: conversationOptions,
    selectedOption,
    temporaryConstraints: constraints,
    lastUserText,
    lastAssistantText,
    unresolvedQuestions: unresolved.slice(0, MAX_UNRESOLVED),
    recentEntities,
    turnCount: turns.length,
  };
}
