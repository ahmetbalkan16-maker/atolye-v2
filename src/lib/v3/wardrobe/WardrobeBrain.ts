import type { AIProvider } from "../../ai/providers/AIProvider";
import { passes, pickBackground } from "../backgrounds/BackgroundJudge";
import { commonsPreview } from "../backgrounds/CommonsProvider";
import { findPeriodCandidates, periodEndYear } from "../backgrounds/HistorySources";
import type { CreditRecord } from "../backgrounds/LicenseFilter";
import { type CouncilLog, type DebateEntry, readJsonAnswer } from "../council/Council";
import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import type { PartOrder } from "../costumes/PartDesigner";
import type { Episode } from "../episode/EpisodeTypes";
import { PART_FIELDS, validateEpisode } from "../episode/EpisodeValidator";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";

/**
 * The costume brain (Kostüm beyni): before a part is drawn it looks up a real example of it on history pages and museum
 * collections (a helmet in The Met, a sword on Commons), has the local vision model describe it for the illustrator,
 * and after the drawing a historian and the chief argue over it (see PartDesigner). It also reviews the whole cast's
 * costumes against the period before any part is ordered. Every exchange is kept in the council log.
 */
export interface PartReference {
  readonly title: string;
  readonly url: string;
  readonly credit: Omit<CreditRecord, "assetId" | "kind" | "sha256">;
  /** What the real piece looks like, for the illustrator (English, ~50 words). */
  readonly description: string;
  /** The reference picture (small JPEG, base64) shown to the drawing model. */
  readonly imageB64: string;
}

export interface BrainDeps {
  readonly cacheDir: string;
  readonly judge: AIProvider;
  readonly budget: V3Budget;
  /** Historian and chief: a small text model is enough. */
  readonly critic: V3ModelChoice;
  readonly council: CouncilLog;
  readonly log: (s: string) => void;
}

/** A real example of an ordered part, or undefined (then the part is drawn from its description alone). */
export async function findPartReference(order: PartOrder, donem: string, deps: BrainDeps): Promise<PartReference | undefined> {
  // Beards and moustaches have no museum pieces worth looking up; their description is enough.
  if (order.slot === "beard" || order.slot === "mustache") return undefined;
  const query = order.tarif.replace(/^(a|an|the)\s+/i, "");
  const found = await findPeriodCandidates(deps.cacheDir, { query, alternatives: [`${query} museum`] }, periodEndYear(donem)).catch(() => undefined);
  if (!found?.candidates.length) return undefined;
  const scene = { konu: order.tarif, donem, mekan: order.slot, tr: order.tarif, en: order.tarif, anlatim: "" };
  const pick = await pickBackground(found.candidates, scene, deps.judge, (c) => commonsPreview(deps.cacheDir, c), deps.log, { mode: "referans", max: 6 });
  if (!pick.chosen || !pick.verdict || !passes(pick.verdict)) return undefined;
  const preview = await commonsPreview(deps.cacheDir, pick.chosen);
  const b64 = preview.toString("base64");
  const described = await deps.judge.generate(`Describe this ${order.tarif} for an illustrator in at most 50 English words: overall shape and proportions, colours, materials, decoration. Plain text only.`, { images: [b64], maxTokens: 160 }).catch(() => undefined);
  const description = (typeof described === "string" ? described : described?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  return { title: pick.chosen.title, url: pick.chosen.descriptionUrl, credit: pick.chosen.credit, description: description || pick.verdict.gosterilen, imageB64: b64 };
}

export interface HistorianNote {
  readonly onem: "yok" | "kucuk" | "buyuk";
  readonly sorunlar: readonly string[];
}

/** The historian looks at what the art director saw on the puppet and at the real piece, and names the errors. */
export async function historianOnPart(order: PartOrder, donem: string, seen: string, ref: PartReference | undefined, deps: BrainDeps): Promise<HistorianNote> {
  const prompt = `You are the historian on the costume team of an animated history show (cartoon style is fine; history must be right).
PART ORDERED: ${order.tarif}
PERIOD: ${donem}
WHAT THE DRAWING SHOWS (the art director's description): ${seen}
${ref ? `REAL EXAMPLE OF THE PART: ${ref.description}` : "No real example was found."}
List only real historical errors of shape, colour or decoration a well-read viewer would notice (not style). "onem": "yok" if none, "kucuk" for details, "buyuk" if it reads as the wrong period or object.
Return ONLY JSON: {"onem": "yok|kucuk|buyuk", "sorunlar": ["…"]}`;
  const out = await deps.budget.generate("kostum-tarihci", deps.critic, prompt, { maxTokens: 300 });
  const v = readJsonAnswer<{ onem?: string; sorunlar?: unknown[] }>(out.result.content);
  const onem = v?.onem === "buyuk" || v?.onem === "kucuk" ? v.onem : "yok";
  return { onem, sorunlar: (v?.sorunlar ?? []).map(String).slice(0, 5) };
}

export interface ChiefCall {
  readonly karar: "kabul" | "revize";
  readonly talimat: string;
}

/** The chief weighs the art director and the historian and decides; "revize" carries one instruction for the designer. */
export async function chiefOnPart(order: PartOrder, round: number, lastRound: boolean, artScore: number, historian: HistorianNote, deps: BrainDeps): Promise<ChiefCall> {
  if (historian.onem === "yok") return { karar: "kabul", talimat: "" };
  if (lastRound) return { karar: "kabul", talimat: `son turda kabul; tarihçinin notları: ${historian.sorunlar.join("; ")}` };
  const prompt = `You run the costume team (on behalf of AYAS, the studio manager). Round ${round} of "${order.tarif}".
Art director score: ${artScore}/10. Historian (${historian.onem}): ${historian.sorunlar.join("; ") || "-"}.
Accept it, or send it back with ONE clear instruction to the illustrator (what to change in the drawing). Revise only for errors a viewer would notice.
Return ONLY JSON: {"karar": "kabul|revize", "talimat": "…"}`;
  const out = await deps.budget.generate("kostum-sef", deps.critic, prompt, { maxTokens: 200 });
  const v = readJsonAnswer<{ karar?: string; talimat?: string }>(out.result.content);
  return { karar: v?.karar === "revize" ? "revize" : "kabul", talimat: String(v?.talimat ?? "") };
}

/**
 * A colour's plain name for the historian, who cannot read a hex code: the Rubicon's 13th Legionary went on screen in
 * "#7a64b8" — a purple tunic, the colour of Rome's elite — and the review never saw it (22 Oct 2026).
 */
export function colourName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15 || d < 0.06) return l > 0.85 ? "white" : l > 0.6 ? "light grey" : l > 0.3 ? "grey" : "black";
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const tone = l < 0.3 ? "dark " : l > 0.78 ? "pale " : "";
  const hue = h < 15 || h >= 345 ? "red" : h < 40 ? (l < 0.45 ? "brown" : "orange") : h < 65 ? (l < 0.4 ? "olive" : "yellow/gold") : h < 165 ? "green" : h < 200 ? "teal" : h < 255 ? "blue" : h < 290 ? "purple" : "magenta/pink";
  return `${tone}${hue}`;
}

/** Each costume's colours by name ("legionary: ana #7a64b8 = purple, …") beside the JSON the historian corrects. */
function colourLines(people: readonly { kim: string; kostum?: { renkler?: Readonly<Record<string, string>> } }[]): string {
  return people
    .filter((p) => p.kostum?.renkler)
    .map((p) => `${p.kim}: ${Object.entries(p.kostum!.renkler!).map(([k, v]) => `${k} ${v} = ${colourName(v)}`).join(", ")}`)
    .join("\n");
}

/**
 * The costume review before parts are ordered: the historian checks every visible character's and crowd's costume
 * against the period and the role (garment, colours, parts), proposes corrected costumes, the chief keeps the
 * corrections that are right. A correction is applied only if the episode stays valid.
 */
export async function reviewCostumes(episode: Episode, catalog: readonly PackCatalogEntry[], deps: BrainDeps): Promise<Episode> {
  const people = episode.oyuncu_kadrosu.filter((c) => c.gorunur && c.kostum).map((c) => ({ kim: c.id, ad: c.ad, rol: c.rol, kostum: c.kostum }));
  const crowds = episode.sahneler.flatMap((s) => (s.kalabalik ?? []).map((g, i) => ({ kim: `${s.id}/kalabalik/${i}`, ad: g.ad, rol: "crowd", kostum: g.kostum })));
  const items = catalog.map((p) => `${p.pack}: ${Object.values(p.items).flat().map((id) => (p.notes?.[id!] ? `${id} (${p.notes[id!]})` : id)).join(", ")}`).join("\n");
  const prompt = `You are the historian of an animated history show's costume team. Episode: "${episode.konu}" (${episode.donem}).
Check each costume against the period, the place and the person's rank: body garment, colours, headwear, beard, held objects.
Headwear only for those who wore it in that role and period (soldiers' helmets, rulers' crowns, a turban, a working cap); many went bareheaded — Roman senators and citizens in town, for example: then remove "bas" and give "sac" ({"stil", "renk"}) instead.
Colours as that rank could wear them: costly dyes marked rank (in Rome and Byzantium purple was for emperors, magistrates and the senators' stripe, never a common soldier; legionaries wore red or undyed wool). Correct a colour with another hex code.
Garments available: kaftan, cubbe, zirh, onluk, bizans, yeniceri, sade, tunik, toga, ceket, uniforma, takim, elbise.
Parts: an item from the catalog ("pack/item") or an order "yeni:<English description>" for a part the team will draw.
CATALOG:
${items}
COSTUMES (JSON):
${JSON.stringify([...people, ...crowds])}
THE COLOURS BY NAME:
${colourLines([...people, ...crowds])}
Return ONLY JSON: {"sorunlar": [{"kim": "…", "sorun": "…"}], "duzeltmeler": [{"kim": "…", "kostum": {full corrected costume, same shape}}]}. Correct only real errors; keep everything else as it is.`;
  const out = await deps.budget.generate("kostum-inceleme", deps.critic, prompt, { maxTokens: 2_500 });
  const v = readJsonAnswer<{ sorunlar?: { kim?: string; sorun?: string }[]; duzeltmeler?: { kim?: string; kostum?: unknown }[] }>(out.result.content);
  const transcript: DebateEntry[] = [{ rol: "Tarihçi", metin: (v?.sorunlar ?? []).map((s) => `${s.kim}: ${s.sorun}`).join(" | ") || "sorun görmedi" }];
  let current = episode;
  let applied = 0;
  for (const d of v?.duzeltmeler ?? []) {
    if (!d.kim || typeof d.kostum !== "object" || d.kostum === null) continue;
    const next = applyCostume(current, d.kim, d.kostum as Record<string, unknown>);
    if (next && validateEpisode(next).ok) {
      current = next;
      applied++;
    }
  }
  transcript.push({ rol: "Şef", metin: `${applied} düzeltme uygulandı${(v?.duzeltmeler?.length ?? 0) > applied ? `, ${(v?.duzeltmeler?.length ?? 0) - applied} düzeltme bölümü bozacağı için alınmadı` : ""}` });
  deps.council.debate("kostum", "kostüm incelemesi", transcript);
  return current;
}

/** A correction's parts: one set to null, empty or "none" is removed, as is "bas" when "sac" is given without it. */
function mergeCostume<T extends object>(old: T, correction: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...old, ...correction };
  for (const f of PART_FIELDS) {
    const v = merged[f];
    if (v === null || v === undefined || (typeof v === "string" && /^(none|null|yok|-|)$/i.test(v.trim()))) delete merged[f];
  }
  // The prompt's own rule ("remove bas and give sac instead"): the historian may simply leave "bas" out.
  if ("sac" in correction && !("bas" in correction)) delete merged.bas;
  return merged as T;
}

function applyCostume(episode: Episode, kim: string, kostum: Record<string, unknown>): Episode | undefined {
  const crowd = /^(.+)\/kalabalik\/(\d+)$/.exec(kim);
  if (crowd) {
    const [, sceneId, index] = crowd;
    let hit = false;
    const sahneler = episode.sahneler.map((s) => {
      if (s.id !== sceneId || !s.kalabalik?.[Number(index)]) return s;
      hit = true;
      return { ...s, kalabalik: s.kalabalik.map((g, i) => (i === Number(index) ? { ...g, kostum: mergeCostume(g.kostum, kostum) } : g)) };
    });
    return hit ? { ...episode, sahneler } : undefined;
  }
  if (!episode.oyuncu_kadrosu.some((c) => c.id === kim && c.kostum)) return undefined;
  return { ...episode, oyuncu_kadrosu: episode.oyuncu_kadrosu.map((c) => (c.id === kim && c.kostum ? { ...c, kostum: mergeCostume(c.kostum, kostum) } : c)) };
}
