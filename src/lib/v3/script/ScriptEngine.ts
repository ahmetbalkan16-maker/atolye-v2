import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import type { Episode } from "../episode/EpisodeTypes";
import { countWords, type EpisodeValidation, validateEpisode } from "../episode/EpisodeValidator";
import { isShorts } from "../render/Format";
import { normalizeForMatch } from "../research/SourceResearch";
import { addToldCrowds, crowdProblems } from "./CrowdRules";
import { addToldStrengths } from "./ToldNumbers";
import { normalizeDraft } from "./DraftNormalizer";
import { directBattleMaps, livenStillMaps, mapProblems, shareProblems, SHORT_SHARES_FROM_S } from "./MapRules";
import { isLongForm, writeLongScript } from "./LongForm";
import { factCheckPrompt, lengthPrompt, orderFidelityPrompt, repairPrompt, type ScriptBrief, type ScriptLanguage, type SourceBank, supportCheckPrompt, wordBudget, writingPrompt } from "./ScriptPrompts";
import type { V3Budget, V3ModelChoice } from "./V3Budget";

/**
 * V3 script writer: write → extract JSON → validate (up to two repair rounds) → a separate fact-check pass whose
 * corrections are applied to the lines. Every model call goes through the episode budget.
 */
export class ScriptError extends Error {
  constructor(
    readonly code: "V3_SCRIPT_NO_JSON" | "V3_SCRIPT_JSON_CUT" | "V3_SCRIPT_JSON_SYNTAX" | "V3_SCRIPT_REFUSED" | "V3_SCRIPT_INVALID" | "V3_SCRIPT_HISTORY",
    message: string,
    /** The last draft that failed, kept for diagnosis. */
    readonly draft?: string,
    /** V3_SCRIPT_HISTORY: what the history gate found wrong, for the next draft's writer (atolye-v3 tarih-hatalari.json). */
    readonly reasons?: readonly string[],
  ) {
    super(`${code}: ${message}`);
  }
}

export type FactVerdict = "dogru" | "tartismali" | "yanlis" | "kaynaksiz";

export interface FactClaim {
  readonly sahne: string;
  readonly satir: number;
  readonly karar: FactVerdict;
  readonly gerekce?: string;
  readonly yeni_metin?: string;
  readonly kaynak_onerisi?: string;
  /**
   * The cast id who should say the corrected line, when history gives it to another character (Cannae Short, 9 Nov
   * 2026: Maharbal, not Hannibal, urged the march on Rome — the text alone could not put that right).
   */
  readonly karakter?: string;
  /** Which check found it: the editor's fact check (default) or the order-fidelity check (`siparis`). */
  readonly denetim?: "siparis";
  /**
   * The verified fact or the order's sentence a "yanlis" line contradicts, as the checker copied it — what makes a
   * correction more than the checker's memory (see `correctionSupported`).
   */
  readonly dayanak?: string;
  /** How the `dayanak` relates to the written line, as `confirmSupport` asked it; only `celisir` lets a rewrite in. */
  readonly dayanak_iliskisi?: "celisir" | "sessiz" | "ekler" | "uyumlu" | "okunamadi";
  /**
   * What happened to the claim: the line was rewritten, or why it was not (`bozuyor`: the episode would not validate;
   * `sahne`: a character's line — the scene must be written again, see `applyFactCheck`; `dayanaksiz`: no verified
   * fact or order sentence backs the correction, so the written line stays and the claim is reported).
   */
  readonly sonuc?: "duzeltildi" | "rivayet_eklendi" | "rapor" | "bulunamadi" | "gecersiz_metin" | "bozuyor" | "sahne" | "dayanaksiz";
}

export interface FactCheckReport {
  /** `okunamadi`: the checker's answer was not usable — QC must treat the episode as unchecked. */
  readonly durum: "tamam" | "okunamadi";
  readonly iddialar: readonly FactClaim[];
  readonly genel_not?: string;
  readonly uygulanan: number;
}

export interface ScriptOutcome {
  readonly episode: Episode;
  readonly validation: EpisodeValidation;
  readonly factCheck: FactCheckReport;
  readonly repairs: number;
  /** Rounds spent fixing the length (0 or 1). */
  readonly lengthRounds: number;
  readonly spokenWords: number;
  readonly targetWords: number;
  /** The writer actually used (the free fallback when the budget refused the paid one). */
  readonly writerUsed: V3ModelChoice;
}

export function spokenWords(episode: Episode): number {
  return episode.sahneler.reduce((sum, s) => sum + s.satirlar.reduce((n, l) => n + countWords(l.metin), 0), 0);
}

/** Sources outside the bank, as repair problems. Lines can only cite listed sources, so the list is what to check. */
export function bankProblems(episode: unknown, bank: SourceBank | undefined): string[] {
  if (!bank || typeof episode !== "object" || episode === null) return [];
  const allowed = new Set(bank.kaynaklar.map((k) => k.id));
  const listed = Array.isArray((episode as { kaynaklar?: unknown }).kaynaklar) ? ((episode as { kaynaklar: { id?: unknown }[] }).kaynaklar) : [];
  return listed
    .filter((k) => typeof k.id !== "string" || !allowed.has(k.id))
    .map((k) => `$.kaynaklar: "${String(k.id)}" is not in the source bank; use only: ${[...allowed].join(", ")}`);
}

/** Bank sources replace the written ones, so the citation text is exactly the verified one. */
function withBankSources(episode: Episode, bank: SourceBank | undefined): Episode {
  if (!bank) return episode;
  const byId = new Map(bank.kaynaklar.map((k) => [k.id, k]));
  return { ...episode, kaynaklar: episode.kaynaklar.map((k) => byId.get(k.id) ?? k) };
}

/**
 * Outside this band of the spoken-word budget the episode would not fill, or would overrun, its target: the same
 * ±10% the QC checks on the finished video.
 */
const LENGTH_BAND = [0.9, 1.1] as const;
/**
 * A Short's length is a ceiling (Format.lengthOk: up to it, down to half of it), so a shorter script is fine down to
 * this share of its budget (~35 s of a 60 s Short): the third Caesar Short's 98 words (44 s) were sent to three
 * expansion rounds that came back at 151–159 words, over the ceiling, and were all dropped.
 */
const SHORTS_LENGTH_BAND = [0.65, 1.1] as const;
const lengthBand = (brief: ScriptBrief): readonly [number, number] => (isShorts(brief.hedefSureSn) ? SHORTS_LENGTH_BAND : LENGTH_BAND);
/** Share of scenes that must carry an exchange (two or more lines by visible characters). */
export const MIN_DIALOGUE_SCENES = 0.3;
/** Visible characters an episode needs (the narrator is not drawn). */
export const MIN_VISIBLE_CAST = 3;
/** Revision attempts; one that does not get closer is dropped and the best version is tried again. */
const MAX_REVISIONS = 3;

const visibleCast = (episode: Episode) => episode.oyuncu_kadrosu.filter((c) => c.gorunur).length;

/** Scenes with at least two lines spoken by visible characters, as a share of all scenes. */
/**
 * Share of scenes with dialogue: two or more lines by visible characters. In a Short a map scene counts with one: the
 * owner's ~70% map Shorts (3 Nov 2026, after DFT Tarih's) tell the moment on the map with a speaking badge's quip, and
 * the Zanzibar Short scored 20% (a fail) with a badge line in every map scene — the writer was sent to add stage talk
 * (159 words for a 120-word Short).
 */
export function dialogueSceneRatio(episode: Episode, opts: { readonly short?: boolean } = {}): number {
  const visible = new Set(episode.oyuncu_kadrosu.filter((c) => c.gorunur).map((c) => c.id));
  if (!episode.sahneler.length) return 0;
  const needs = (s: Episode["sahneler"][number]) => (opts.short && s.harita?.merkez ? 1 : 2);
  return episode.sahneler.filter((s) => s.satirlar.filter((l) => visible.has(l.karakter)).length >= needs(s)).length / episode.sahneler.length;
}

/** Scenes furthest below their share of the word target (by sure_hedef), as concrete "add N words here" asks. */
export function sceneShortfalls(episode: Episode, targetWords: number): string[] {
  const total = episode.sahneler.reduce((n, s) => n + s.sure_hedef, 0) || 1;
  return episode.sahneler
    .map((s) => {
      const has = s.satirlar.reduce((n, l) => n + countWords(l.metin), 0);
      return { id: s.id, has, want: Math.round((targetWords * s.sure_hedef) / total) };
    })
    .filter((s) => s.want - s.has >= 6)
    .sort((a, b) => b.want - b.has - (a.want - a.has))
    .slice(0, 5)
    .map((s) => `scene "${s.id}" has ${s.has} spoken words and needs about ${s.want}: add ${s.want - s.has} words there (new lines — a reply, a joke, a narrator detail from the facts)`);
}

/** How far a script is from its targets: 0 is on target; length and dialogue both count. */
function revisionGap(episode: Episode, target: number, band: readonly [number, number] = LENGTH_BAND, short = false): number {
  const words = spokenWords(episode);
  const lengthGap = words < target * band[0] ? target * band[0] - words : words > target * band[1] ? words - target * band[1] : 0;
  return lengthGap / Math.max(1, target) + Math.max(0, MIN_DIALOGUE_SCENES - dialogueSceneRatio(episode, { short })) + 0.2 * Math.max(0, MIN_VISIBLE_CAST - visibleCast(episode));
}

/** First top-level JSON object in a model answer; code fences and chatter around it are ignored. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new ScriptError("V3_SCRIPT_NO_JSON", "yanıtta JSON nesnesi yok");
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch (e) {
        throw new ScriptError("V3_SCRIPT_JSON_SYNTAX", (e as Error).message);
      }
    }
  }
  throw new ScriptError("V3_SCRIPT_JSON_CUT", "JSON yarıda kesilmiş");
}

/** Output budget for the writer: the JSON around each spoken word costs several tokens. */
export function writerMaxTokens(brief: ScriptBrief): number {
  // Maps (outlines, routes), crowds and costumes add a large fixed share: the Rubicon script was cut at 4,884 tokens.
  // The repair brain may raise it for this run (ATOLYE_V3_WRITER_MAX_TOKENS) after a cut answer.
  const override = Number(process.env.ATOLYE_V3_WRITER_MAX_TOKENS);
  if (Number.isFinite(override) && override >= 3_000) return Math.min(16_000, override);
  return Math.min(16_000, Math.max(5_000, 4_000 + wordBudget(brief) * 20));
}

const FACT_CHECK_MAX_TOKENS = 3_000;
const MAX_LINE_CHARS = 240;

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parse(text: string): Parsed {
  try {
    return { ok: true, value: extractJson(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const VERDICTS: readonly FactVerdict[] = ["dogru", "tartismali", "yanlis", "kaynaksiz"];

function readFactCheck(text: string): { iddialar: FactClaim[]; genel_not?: string } | undefined {
  const parsed = parse(text);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return undefined;
  const v = parsed.value as { iddialar?: unknown; genel_not?: unknown };
  if (!Array.isArray(v.iddialar)) return undefined;
  const iddialar = v.iddialar.flatMap((c): FactClaim[] => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    if (typeof o.sahne !== "string" || typeof o.satir !== "number" || !VERDICTS.includes(o.karar as FactVerdict)) return [];
    return [{
      sahne: o.sahne,
      satir: o.satir,
      karar: o.karar as FactVerdict,
      ...(typeof o.gerekce === "string" ? { gerekce: o.gerekce } : {}),
      ...(typeof o.yeni_metin === "string" ? { yeni_metin: o.yeni_metin.trim() } : {}),
      ...(typeof o.kaynak_onerisi === "string" && o.kaynak_onerisi.trim() ? { kaynak_onerisi: o.kaynak_onerisi.trim() } : {}),
      ...(typeof o.karakter === "string" && o.karakter.trim() ? { karakter: o.karakter.trim() } : {}),
      ...(typeof o.dayanak === "string" && o.dayanak.trim() ? { dayanak: o.dayanak.trim() } : {}),
    }];
  });
  return { iddialar, ...(typeof v.genel_not === "string" && v.genel_not.trim() ? { genel_not: v.genel_not.trim() } : {}) };
}

/** What a correction may rest on: the verified facts (and their quotes) and the owner's order. */
export interface CorrectionSupport {
  readonly bank?: SourceBank & { readonly alintilar?: readonly { readonly alinti: string }[] };
  readonly order?: string;
}

/** Shortest copied text that counts as a support (a few words would match anything). */
const SUPPORT_MIN_CHARS = 20;

/**
 * Whether a "yanlis" claim's `dayanak` really is a verified fact or a sentence of the order: the copied text is found
 * in one of them, or one whole fact is found in it (the checker often adds the "[source-id]" it was shown). Measured on
 * 11 Nov 2026 over the 14 kept fact checks: of the 4 corrections applied, the 2 a bank fact backed were right (Rubicon,
 * pirates' throats cut) and the 2 none backed turned a right line wrong (Gallipoli "I order you to die" moved from 25
 * April to August; Zanzibar's royal yacht "did not return fire") — owner, 11 Nov 2026: "ölçerek düzelt".
 */
export function correctionSupported(dayanak: string | undefined, support: CorrectionSupport): boolean {
  const clean = (s: string) => normalizeForMatch(s).replace(/^[-•*\s]*(\[[^\]]*\]\s*)?/u, "").replace(/^["'\s]+|["'\s.…]+$/gu, "");
  const quote = dayanak ? clean(dayanak) : "";
  if (quote.length < SUPPORT_MIN_CHARS) return false;
  const texts = [...(support.bank?.olgular ?? []).map((o) => o.metin), ...(support.bank?.alintilar ?? []).map((a) => a.alinti), ...(support.order ? [support.order] : [])].map(clean).filter((t) => t.length >= SUPPORT_MIN_CHARS);
  return texts.some((t) => t.includes(quote) || quote.includes(t));
}

/** Name words of a text: capitalised words not opening a sentence ("Hasdrubal's" → "Hasdrubal"). */
function nameWords(text: string, known: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[.!?]\s+|\s|["'(—–-])(\p{Lu}[\p{L}]{2,})(?:['’]s)?/gu)) {
    const w = m[2]!;
    if (known.has(w) || !/^$|[.!?]\s+$/.test(m[1]!)) out.add(w);
  }
  return out;
}

/**
 * Whether a correction changes WHO a line names (a person's deed given back to its owner) — the only kind of the
 * order-fidelity check's answers applied without a person reading them: asked about every fact, it also "corrects"
 * jokes the order never mentions ("Now that's what I call a group hug" → "The trap's shut"), which keep their words.
 */
export function changesPerson(oldText: string, newText: string, known: ReadonlySet<string>): boolean {
  const before = nameWords(oldText, known);
  const after = nameWords(newText, known);
  const gained = [...after].some((w) => !before.has(w) && known.has(w));
  const lost = [...before].some((w) => !after.has(w) && known.has(w));
  return gained && lost;
}

/** The people the order and the cast name: capitalised words of the order, the cast's names. */
export function knownNames(order: string, cast: readonly { readonly ad: string }[]): Set<string> {
  const out = new Set<string>();
  for (const m of order.matchAll(/(\p{Lu}[\p{L}]{2,})/gu)) if (!NOT_NAMES.has(m[1]!)) out.add(m[1]!);
  for (const c of cast) for (const m of c.ad.matchAll(/(\p{Lu}[\p{L}]{2,})/gu)) if (!NOT_NAMES.has(m[1]!)) out.add(m[1]!);
  return out;
}

/** Capitalised words that open sentences, not names. */
const NOT_NAMES = new Set(["The", "And", "But", "His", "Her", "Their", "This", "That", "These", "Those", "When", "Then", "After", "Before", "About", "Only", "With", "From", "Narrator"]);

/** An order with facts to compare (the owner's or AYAS's detailed brief), not a bare topic ("Cannae hakkında video yap"). */
export const ORDER_FACTS_MIN_WORDS = 20;

/**
 * The order-fidelity check's answer (ScriptPrompts.orderFidelityPrompt) as claims: only a "celisir" whose correction
 * changes who the line names, and lines that exist in the episode.
 */
export function readOrderFidelity(text: string, episode: Pick<Episode, "sahneler" | "oyuncu_kadrosu">, order: string): FactClaim[] | undefined {
  const parsed = parse(text);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return undefined;
  const v = parsed.value as { olgular?: unknown };
  if (!Array.isArray(v.olgular)) return undefined;
  const known = knownNames(order, episode.oyuncu_kadrosu);
  return v.olgular.flatMap((c): FactClaim[] => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    if (o.karar !== "celisir" || typeof o.sahne !== "string" || typeof o.satir !== "number" || typeof o.yeni_metin !== "string") return [];
    const line = episode.sahneler.find((s) => s.id === o.sahne)?.satirlar[o.satir];
    if (!line || !changesPerson(line.metin, o.yeni_metin, known)) return [];
    const why = [typeof o.olgu === "string" ? `sipariş: ${o.olgu}` : "", typeof o.gerekce === "string" ? o.gerekce : ""].filter(Boolean).join(" — ");
    return [{ sahne: o.sahne, satir: o.satir, karar: "yanlis", ...(why ? { gerekce: why } : {}), yeni_metin: o.yeni_metin.trim(), ...(typeof o.karakter === "string" && o.karakter.trim() ? { karakter: o.karakter.trim() } : {}), denetim: "siparis" }];
  });
}

/** Titles in a cast name that call no one by name. */
const TITLES = new Set(["Paşa", "Pasha", "Sultan", "Sultanı", "King", "Queen", "Emperor", "Consul", "General", "Lord", "Lady", "Sir", "Bey", "Han", "Khan"]);

/** The words a person is called by ("Gaius Terentius Varro" → Gaius, Terentius, Varro; "Zağanos Paşa" → Zağanos). */
function nameWordsOf(ad: string): string[] {
  return [...ad.matchAll(/(\p{Lu}[\p{L}]{2,})/gu)].map((m) => m[1]!).filter((w) => !NOT_NAMES.has(w) && !TITLES.has(w));
}

const anyName = (ad: string) => nameWordsOf(ad).join("|");

/** Whether a line addresses someone by their name ("Hannibal, let's go", "So, Hannibal, …", "…, Hannibal!"). */
export function callsByName(text: string, ad: string): boolean {
  const n = anyName(ad);
  if (!n) return false;
  return new RegExp(`(^|[,.!?—–]\\s*)(?:${n})\\s*[,!?—–]|,\\s*(?:${n})\\s*[.!?,]|,\\s*(?:${n})$`, "u").test(text.trim());
}

/** The speech bubble for a corrected line: its shortest sentence when it fits a bubble (≤ 8 words, 70 chars). */
function bubbleOf(text: string): string | undefined {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => countWords(s) <= 8 && s.length <= 70).sort((a, b) => a.length - b.length)[0];
}

/**
 * The editor's fact check of an episode against the source bank, as the script step runs it — the claims, or undefined
 * when its answer could not be read. (The director council checks its rewritten lines with it.)
 */
export async function checkFacts(episode: Episode, dil: ScriptLanguage, bank: SourceBank | undefined, budget: V3Budget, checker: V3ModelChoice): Promise<FactClaim[] | undefined> {
  const out = await budget.generate("dogrulama-rotus", checker, factCheckPrompt(JSON.stringify(episode), dil, bank), { maxTokens: FACT_CHECK_MAX_TOKENS });
  return readFactCheck(out.result.content)?.iddialar;
}

/**
 * Applies the editor's verdicts: a wrong line is replaced by its correction, a disputed one gets its hedged text
 * and `rivayet`; an unsupported one is only reported (a suggested source cannot be verified here). A correction may
 * give the line to another cast member (`karakter`, or a "Maharbal: …" the checker wrote into the text); a line with a
 * speech bubble gets the new words in it (the old bubble would have floated the wrong history). Each correction is kept
 * only if a valid episode stays valid — until 9 Nov 2026 one bad correction threw all of them away. With `support`
 * (the production's bank and order) the editor's "yanlis" rewrite is applied only when its `dayanak` is one of them
 * (`correctionSupported`); the order-fidelity check's claims rest on the order itself.
 */
export function applyFactCheck(episode: Episode, claims: readonly FactClaim[], opts: { readonly support?: CorrectionSupport } = {}): { episode: Episode; claims: FactClaim[]; applied: number } {
  type Line = Record<string, unknown> & { karakter?: string; metin?: string; balon?: string };
  let copy = JSON.parse(JSON.stringify(episode)) as { oyuncu_kadrosu?: { id: string; ad: string; gorunur?: boolean }[]; sahneler: { id: string; satirlar: Line[] }[] };
  const cast = copy.oyuncu_kadrosu ?? [];
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  const castBy = (who: string) => cast.find((c) => c.id === who.trim() || fold(c.ad) === fold(who));
  const checkValid = validateEpisode(episode).ok;
  let applied = 0;
  const out = claims.map((claim): FactClaim => {
    if (claim.karar === "dogru") return claim;
    if (!copy.sahneler.find((s) => s.id === claim.sahne)?.satirlar[claim.satir]) return { ...claim, sonuc: "bulunamadi" };
    if (claim.karar === "kaynaksiz") return { ...claim, sonuc: "rapor" };
    // A character's invented line told wrong is part of an exchange: measured on the Cannae script (9 Nov 2026, six
    // runs) one-line corrections put Maharbal's urging into Hannibal's mouth, or wrote over Maharbal's true retort. Such
    // a line is not patched; the history gate has the script written again (V3_SCRIPT_HISTORY).
    const told = copy.sahneler.find((s) => s.id === claim.sahne)!.satirlar[claim.satir]!;
    if (claim.karar === "yanlis" && told.kurgu === true && told.karakter !== "anlatici") return { ...claim, sonuc: "sahne" };
    if (opts.support && claim.karar === "yanlis" && claim.denetim !== "siparis" && (!correctionSupported(claim.dayanak, opts.support) || (claim.dayanak_iliskisi !== undefined && claim.dayanak_iliskisi !== "celisir"))) return { ...claim, sonuc: "dayanaksiz" };
    let text = (claim.yeni_metin ?? "").trim().replace(/^["“]([\s\S]*)["”]$/u, "$1").trim();
    let speaker = claim.karakter ? castBy(claim.karakter) : undefined;
    const prefixed = /^([^:"“]{2,40}):\s*([\s\S]+)$/u.exec(text);
    const named = prefixed ? castBy(prefixed[1]!) : undefined;
    if (prefixed && named) {
      speaker = named;
      text = prefixed[2]!.trim().replace(/^["“]([\s\S]*)["”]$/u, "$1").trim();
    }
    if (!text || text.length > MAX_LINE_CHARS) return { ...claim, sonuc: "gecersiz_metin" };
    const before = JSON.stringify(copy);
    const scene = copy.sahneler.find((s) => s.id === claim.sahne)!;
    const line = scene.satirlar[claim.satir]!;
    // A correction that calls its own speaker by name belongs to someone else (Cannae, 9 Nov 2026: "Hannibal, let's
    // march on Rome now!" written for Hannibal's line): the one the reason names who speaks in the scene, else anyone it names.
    const current = cast.find((c) => c.id === line.karakter);
    if (!speaker && current && current.id !== "anlatici" && callsByName(text, current.ad)) {
      const named = cast.filter((c) => c.id !== current.id && c.id !== "anlatici" && c.gorunur !== false && anyName(c.ad) !== "" && new RegExp(`(?<!\\p{L})(?:${anyName(c.ad)})(?!\\p{L})`, "u").test(`${claim.gerekce ?? ""} ${claim.yeni_metin ?? ""}`));
      speaker = named.find((c) => scene.satirlar.some((l) => l.karakter === c.id)) ?? named[0];
    }
    line.metin = text;
    if (speaker && speaker.id !== line.karakter) line.karakter = speaker.id;
    if (line.balon !== undefined || (speaker && speaker.id !== "anlatici")) {
      const visible = cast.find((c) => c.id === line.karakter)?.gorunur !== false && line.karakter !== "anlatici";
      const bubble = visible ? bubbleOf(text) : undefined;
      if (bubble) line.balon = bubble;
      else delete line.balon;
    }
    if (claim.karar === "tartismali") line.rivayet = true;
    if (checkValid && !validateEpisode(copy as unknown as Episode).ok) {
      copy = JSON.parse(before) as typeof copy;
      return { ...claim, sonuc: "bozuyor" };
    }
    applied++;
    return { ...claim, ...(speaker && claim.karakter !== speaker.id ? { karakter: speaker.id } : {}), sonuc: claim.karar === "yanlis" ? "duzeltildi" : "rivayet_eklendi" };
  });
  return { episode: copy as unknown as Episode, claims: out, applied };
}

/**
 * A wrong line the corrections could not put right — the production must not go on with it. A claim about a line the
 * episode does not have (`bulunamadi`: the checker's own slip of scene or index) is reported, never a reason to stop;
 * so is one no fact backs (`dayanaksiz`: measured, those were the checker's memory turning right lines wrong).
 */
export function unresolvedErrors(claims: readonly FactClaim[]): FactClaim[] {
  return claims.filter((c) => c.karar === "yanlis" && (c.sonuc === "gecersiz_metin" || c.sonuc === "bozuyor" || c.sonuc === "rapor" || c.sonuc === "sahne"));
}

const RELATIONS = ["celisir", "sessiz", "ekler", "uyumlu"] as const;

/**
 * Asks, for each rewrite `applyFactCheck` would apply on a real bank fact, whether that fact rules the written line
 * out (ScriptPrompts.supportCheckPrompt) and records the answer in `dayanak_iliskisi`. Measured on 11 Nov 2026 with
 * gpt-4.1, three runs each: 27/27 right over nine cases (four held out of the prompt), where the editor alone gave a
 * true fact that says nothing on the line ("the Glasgow was sunk") to erase "it fires back", two runs of two. An answer
 * that cannot be read counts as no contradiction: an unsupported rewrite was the measured harm, a reported line is not.
 */
export async function confirmSupport(episode: Episode, claims: readonly FactClaim[], support: CorrectionSupport, input: Pick<ScriptEngineInput, "budget" | "checker">): Promise<FactClaim[]> {
  const out: FactClaim[] = [];
  for (const claim of claims) {
    const line = episode.sahneler.find((s) => s.id === claim.sahne)?.satirlar[claim.satir];
    const asks = claim.karar === "yanlis" && claim.denetim !== "siparis" && line && !(line.kurgu === true && line.karakter !== "anlatici") && claim.yeni_metin && correctionSupported(claim.dayanak, support);
    if (!asks) {
      out.push(claim);
      continue;
    }
    const answer = await input.budget.generate("dogrulama-dayanak", input.checker, supportCheckPrompt(line.metin, claim.yeni_metin!, claim.dayanak!), { maxTokens: 200 }).catch(() => undefined);
    const parsed = answer ? parse(answer.result.content) : undefined;
    const iliski = parsed?.ok && typeof parsed.value === "object" && parsed.value !== null ? (parsed.value as { iliski?: unknown }).iliski : undefined;
    out.push({ ...claim, dayanak_iliskisi: RELATIONS.includes(iliski as (typeof RELATIONS)[number]) ? (iliski as (typeof RELATIONS)[number]) : "okunamadi" });
  }
  return out;
}

/** What the production's corrections may rest on: its source bank (with the research quotes) and the order. */
function supportOf(brief: ScriptBrief): CorrectionSupport {
  return { ...(brief.kaynakBankasi ? { bank: brief.kaynakBankasi as CorrectionSupport["bank"] } : {}), order: brief.konu };
}

/** The gate's stop: the wrong lines with their reasons, for the log, AYAS and the next draft. */
function historyStop(left: readonly FactClaim[], episode: Episode): ScriptError {
  const reasons = left.map((c) => {
    const line = episode.sahneler.find((s) => s.id === c.sahne)?.satirlar[c.satir];
    const who = line ? episode.oyuncu_kadrosu.find((p) => p.id === line.karakter)?.ad ?? line.karakter : "";
    return `${c.sahne} #${c.satir}${who ? ` (${who}: "${line!.metin.slice(0, 80)}")` : ""}: ${(c.gerekce ?? "yanlış").slice(0, 200)}`;
  });
  return new ScriptError("V3_SCRIPT_HISTORY", `tarih hatası düzeltilemedi, üretim gardıroptan önce durdu — ${reasons.join(" | ")}`, JSON.stringify(episode), reasons);
}

export interface ScriptEngineInput {
  readonly brief: ScriptBrief;
  readonly catalog: readonly PackCatalogEntry[];
  readonly writer: V3ModelChoice;
  readonly checker: V3ModelChoice;
  readonly budget: V3Budget;
  /** Episode JSON Schema; constrains decoding on providers that support it (Ollama). */
  readonly jsonSchema?: Record<string, unknown>;
  readonly maxRepairs?: number;
  /** Progress lines (a long episode reports its plan and every chapter). */
  readonly log?: (s: string) => void;
}

/**
 * A long episode (over five minutes): written chapter by chapter (LongForm), then sources from the bank, and every
 * chapter's fact check applied to the joined episode — a correction that would break it is reported instead.
 */
async function writeLongEpisode(input: ScriptEngineInput): Promise<ScriptOutcome> {
  const draft = await writeLongScript({ brief: input.brief, catalog: input.catalog, writer: input.writer, checker: input.checker, budget: input.budget, ...(input.maxRepairs !== undefined ? { maxRepairs: input.maxRepairs } : {}), ...(input.log ? { log: input.log } : {}) });
  const written = withBankSources(draft.episode, input.brief.kaynakBankasi);
  const validation = validateEpisode(written);
  if (!validation.ok) throw new ScriptError("V3_SCRIPT_INVALID", `birleşen bölümler: ${validation.errors.slice(0, 5).map((e) => `${e.path} ${e.code}`).join("; ")}`);
  const reports = draft.factChecks.map((text) => readFactCheck(text));
  const claims = await confirmSupport(written, reports.flatMap((r) => r?.iddialar ?? []), supportOf(input.brief), input);
  const notes = reports.map((r) => r?.genel_not).filter((n): n is string => Boolean(n));
  const fixed = applyFactCheck(written, claims, { support: supportOf(input.brief) });
  const fixedValidation = validateEpisode(fixed.episode);
  const keep = fixedValidation.ok;
  // The same history gate as a Short's (order compared fact by fact; a wrong line still standing stops here).
  const checked = await historyGate({ episode: keep ? fixed.episode : written, claims: keep ? fixed.claims : claims.map((c) => ({ ...c, sonuc: "rapor" as const })), applied: keep ? fixed.applied : 0 }, input.brief, input);
  const episode = checked.episode;
  return {
    episode,
    validation: validateEpisode(episode),
    factCheck: {
      durum: reports.some((r) => r) ? "tamam" : "okunamadi",
      iddialar: checked.claims,
      ...(notes.length ? { genel_not: notes.join(" ") } : {}),
      uygulanan: checked.applied,
    },
    repairs: draft.repairs,
    lengthRounds: draft.lengthRounds,
    spokenWords: spokenWords(episode),
    targetWords: wordBudget(input.brief),
    writerUsed: draft.writerUsed,
  };
}

export async function writeScript(input: ScriptEngineInput): Promise<ScriptOutcome> {
  if (isLongForm(input.brief)) return writeLongEpisode(input);
  const { brief, budget } = input;
  const opts = { maxTokens: writerMaxTokens(brief), ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}) };
  const first = await budget.generate("senaryo", input.writer, writingPrompt(brief, input.catalog), opts);
  if (first.result.refused) throw new ScriptError("V3_SCRIPT_REFUSED", "model senaryoyu yazmayı reddetti");
  const writerUsed = first.used;
  // A Short of half a minute or more is asked its own shares (map ~70%); a shorter one is not asked any.
  const shortShares = isShorts(brief.hedefSureSn) && brief.hedefSureSn >= SHORT_SHARES_FROM_S;
  // `problems` make a script unusable; `quality` (the map rules) is asked for in the same repair rounds, but a script
  // that is valid is never lost over it.
  const check = (text: string): { value?: unknown; validation?: EpisodeValidation; problems: string[]; quality: string[] } => {
    const parsed = parse(text);
    if (!parsed.ok) return { problems: [parsed.error], quality: [] };
    // Mechanical slips (visible narrator, English garment names, made-up items) are fixed here, not by a model round.
    const value = normalizeDraft(parsed.value, input.catalog).value;
    const validation = validateEpisode(value);
    const problems = [...validation.errors.slice(0, 40).map((e) => `${e.path} ${e.code}: ${e.message}`), ...bankProblems(value, brief.kaynakBankasi)];
    // The owner's shares (map ~75–80%, stick figures ~15%) are asked of a short video too (the first AYAS trial of 23 Oct
    // 2026 told 3 minutes in six character scenes and three still maps); a Short is asked its own (~70% map).
    return { value, validation, problems, quality: problems.length ? [] : [...mapProblems(value), ...shareProblems(value as Episode, shortShares), ...crowdProblems(value, isShorts(brief.hedefSureSn))] };
  };
  let raw = first.result.content;
  let state = check(raw);
  let repairs = 0;
  while ((state.problems.length || state.quality.length) && repairs < (input.maxRepairs ?? 3)) {
    repairs++;
    const next = await budget.generate(`onarim-${repairs}`, writerUsed, repairPrompt(state.value !== undefined ? JSON.stringify(state.value) : raw, [...state.problems, ...state.quality]), opts);
    const checked = check(next.result.content);
    // A round for the map that broke a valid script: the valid one stays.
    if (!state.problems.length && checked.problems.length) break;
    raw = next.result.content;
    state = checked;
  }
  if (state.problems.length) throw new ScriptError("V3_SCRIPT_INVALID", `${repairs} onarımdan sonra: ${state.problems.slice(0, 5).join("; ")}`, raw);
  if (state.quality.length) input.log?.(`  senaryo: harita isteği karşılanamadı (${state.quality.length}): ${state.quality.join(" | ").slice(0, 300)}`);
  // A map left still after the repair rounds gets the camera's move as a last resort.
  const livened = livenStillMaps(state.value as Episode);
  for (const fix of livened.fixes) input.log?.(`  senaryo: ${fix}`);

  let written = livened.episode;
  let validation = livened.fixes.length ? validateEpisode(written) : state.validation!;
  const targetWords = wordBudget(brief);
  const band = lengthBand(brief);
  const short = isShorts(brief.hedefSureSn);
  let lengthRounds = 0;
  // Revision attempts for length, dialogue and cast; one is kept only if it is valid and closer to the targets,
  // otherwise the best version so far is tried again.
  while (lengthRounds < MAX_REVISIONS && revisionGap(written, targetWords, band, short) > 0) {
    lengthRounds++;
    const extra: string[] = [];
    const ratio = dialogueSceneRatio(written, { short });
    if (ratio < MIN_DIALOGUE_SCENES)
      extra.push(
        short
          ? `only ${Math.round(ratio * 100)}% of scenes have dialogue (a map scene: a visible character's line from their badge; a stage scene: two or more lines); at least ${MIN_DIALOGUE_SCENES * 100}% must`
          : `only ${Math.round(ratio * 100)}% of scenes have two or more lines by visible characters; at least ${MIN_DIALOGUE_SCENES * 100}% must`,
      );
    const cast = visibleCast(written);
    if (cast < MIN_VISIBLE_CAST) extra.push(`only ${cast} visible characters; add ${MIN_VISIBLE_CAST - cast} more fitting the period (costume from the catalog, own colour, own speaking style) and give them lines`);
    // Models stop short of a whole-script word count (the Rubicon script stayed ~20% short after three rounds); a
    // per-scene shortfall is something they do act on.
    const words = spokenWords(written);
    if (words < targetWords * band[0]) extra.push(...sceneShortfalls(written, targetWords));
    const next = await budget.generate(`uzunluk-${lengthRounds}`, writerUsed, lengthPrompt(JSON.stringify(written), spokenWords(written), targetWords, extra), opts);
    const revised = check(next.result.content);
    // A dropped round says why in the log (the Rubicon's three were dropped silently; the cause had to be replayed).
    if (revised.problems.length) {
      input.log?.(`  senaryo: uzunluk turu ${lengthRounds} kullanılmadı — ${revised.problems.length} sorun: ${revised.problems.slice(0, 3).join("; ").slice(0, 240)}`);
      continue;
    }
    if (revisionGap(revised.value as Episode, targetWords, band, short) >= revisionGap(written, targetWords, band, short)) {
      input.log?.(`  senaryo: uzunluk turu ${lengthRounds} hedefe yaklaşmadı (${spokenWords(revised.value as Episode)}/${targetWords} kelime)`);
      continue;
    }
    // A longer script that loses what the map rules won is no better: they are not asked again after these rounds.
    const before = mapProblems(written).length + shareProblems(written, shortShares).length + crowdProblems(written, isShorts(brief.hedefSureSn)).length;
    if (revised.quality.length > before) {
      input.log?.(`  senaryo: uzunluk turu ${lengthRounds} harita sorunlarını artırdı (${before} → ${revised.quality.length}): ${revised.quality.join(" | ").slice(0, 200)}`);
      continue;
    }
    written = revised.value as Episode;
    validation = revised.validation!;
  }
  // A group the narrator tells that no round put on the stage gets its crowd as a last resort.
  const crowded = addToldCrowds(written, isShorts(brief.hedefSureSn));
  for (const fix of crowded.fixes) input.log?.(`  senaryo: ${fix}`);
  if (crowded.episode !== written) {
    written = crowded.episode;
    validation = validateEpisode(written);
  }
  // Armies the narrator counts off the map get their card (Cannae, 9 Nov 2026: numbers over standing puppets).
  const counted = addToldStrengths(written, brief.dil);
  for (const fix of counted.fixes) input.log?.(`  senaryo: ${fix}`);
  if (counted.episode !== written) {
    written = counted.episode;
    validation = validateEpisode(written);
  }
  // The director's pass on the battle maps (badges with the line naming them, a fallen ruler's X, routs, charge arrows).
  const directed = directBattleMaps(written);
  for (const fix of directed.fixes) input.log?.(`  senaryo: ${fix}`);
  written = withBankSources(directed.episode, brief.kaynakBankasi);
  const lengthFields = { lengthRounds, spokenWords: spokenWords(written), targetWords };
  const checked = await checkScriptHistory(written, brief, input);
  if (!checked) {
    return { episode: written, validation, factCheck: { durum: "okunamadi", iddialar: [], uygulanan: 0 }, repairs, ...lengthFields, writerUsed };
  }
  return { episode: checked.episode, validation: validateEpisode(checked.episode), factCheck: checked.factCheck, repairs, ...lengthFields, writerUsed };
}

/**
 * The script's history review as the script step runs it: the editor's fact check (with the order), its corrections,
 * then the history gate. Undefined when the editor's answer could not be read (the episode counts as unchecked).
 * Throws V3_SCRIPT_HISTORY when a wrong line stays. Also run by hand on a kept script (owner checks, experiments).
 */
export async function checkScriptHistory(written: Episode, brief: ScriptBrief, input: Pick<ScriptEngineInput, "budget" | "checker" | "log">): Promise<{ episode: Episode; factCheck: FactCheckReport } | undefined> {
  const editor = await input.budget.generate("dogrulama", input.checker, factCheckPrompt(JSON.stringify(written), brief.dil, brief.kaynakBankasi, brief.konu), { maxTokens: FACT_CHECK_MAX_TOKENS });
  const report = readFactCheck(editor.result.content);
  if (!report) return undefined;
  const claims = await confirmSupport(written, report.iddialar, supportOf(brief), input);
  const fixed = applyFactCheck(written, claims, { support: supportOf(brief) });
  // A correction must never break a valid episode; if one would, the written text stays and the claims are reported.
  const keep = validateEpisode(fixed.episode).ok;
  const checked = await historyGate({ episode: keep ? fixed.episode : written, claims: keep ? fixed.claims : claims.map((c) => ({ ...c, sonuc: "rapor" as const })), applied: keep ? fixed.applied : 0 }, brief, input);
  return {
    episode: checked.episode,
    factCheck: { durum: "tamam", iddialar: checked.claims, ...(report.genel_not ? { genel_not: report.genel_not } : {}), uygulanan: checked.applied },
  };
}

const FIDELITY_MAX_TOKENS = 3_000;

/**
 * The history gate after the editor's fact check (owner, 9 Nov 2026, after the Cannae Short was stopped for three
 * swapped deeds: "evet durdur ve bu durdurmayı sonraki videolar için sisteme ekle"). Before any costume is drawn:
 * 1) a detailed order is compared fact by fact (orderFidelityPrompt) and a correction that gives a deed back to its
 *    person is applied — the fact check alone missed Hasdrubal's cavalry given to Maharbal in two runs of two;
 * 2) when a wrong line could not be corrected, the editor looks once more at the corrected script;
 * 3) a wrong line still standing stops the production here (V3_SCRIPT_HISTORY), so no video is made with it.
 */
async function historyGate(
  state: { episode: Episode; claims: FactClaim[]; applied: number },
  brief: ScriptBrief,
  input: Pick<ScriptEngineInput, "budget" | "checker" | "log">,
): Promise<{ episode: Episode; claims: FactClaim[]; applied: number }> {
  let { episode, applied } = state;
  const claims = [...state.claims];
  if (countWords(brief.konu) >= ORDER_FACTS_MIN_WORDS) {
    const answer = await input.budget.generate("dogrulama-siparis", input.checker, orderFidelityPrompt(episode, brief.konu, brief.dil), { maxTokens: FIDELITY_MAX_TOKENS }).catch((e: Error) => (input.log?.(`  senaryo: sipariş denetimi yapılamadı: ${e.message.slice(0, 120)}`), undefined));
    const found = answer ? readOrderFidelity(answer.result.content, episode, brief.konu) : undefined;
    if (found?.length) {
      const fixed = applyFactCheck(episode, found);
      episode = fixed.episode;
      applied += fixed.applied;
      claims.push(...fixed.claims);
      for (const c of fixed.claims) input.log?.(`  senaryo: sipariş denetimi ${c.sahne} #${c.satir} ${c.sonuc === "duzeltildi" ? "düzeltildi" : c.sonuc}: ${(c.gerekce ?? "").slice(0, 140)}`);
    }
  }
  // A character's line told wrong: the scene must be written again — no second look patches it line by line.
  const scenes = claims.filter((c) => c.sonuc === "sahne");
  if (scenes.length) throw historyStop(scenes, episode);
  if (!unresolvedErrors(claims).length) return { episode, claims, applied };
  // A wrong line still standing: the editor reads the corrected script once more; what it still calls wrong must go.
  const second = await input.budget.generate("dogrulama-2", input.checker, factCheckPrompt(JSON.stringify(episode), brief.dil, brief.kaynakBankasi, brief.konu), { maxTokens: FACT_CHECK_MAX_TOKENS });
  const report = readFactCheck(second.result.content);
  const fixed = report ? applyFactCheck(episode, await confirmSupport(episode, report.iddialar, supportOf(brief), input), { support: supportOf(brief) }) : undefined;
  const left = fixed ? unresolvedErrors(fixed.claims) : unresolvedErrors(claims);
  if (left.length) throw historyStop(left, fixed?.episode ?? episode);
  return { episode: fixed!.episode, claims: [...claims.map((c) => (c.karar === "yanlis" && c.sonuc !== "duzeltildi" && c.sonuc !== "dayanaksiz" ? { ...c, sonuc: "rapor" as const } : c)), ...fixed!.claims], applied: applied + fixed!.applied };
}
