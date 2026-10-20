import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CouncilLog, type DebateEntry, readJsonAnswer } from "../council/Council";
import { toLook, toRenderCast } from "../costumes/CastMapper";
import { loadAccessories, packCatalog } from "../costumes/CostumePackLoader";
import { costumeRootsFor, NEW_PART, type PartRecord, type PartSlot, partKey, puppetStills } from "../costumes/PartDesigner";
import { AGES, type CastCostume, type CastEntry, type Episode, FACE_SHAPES, GARMENTS, HAIR_STYLES, NOSES } from "../episode/EpisodeTypes";
import { PART_FIELDS, validateEpisode } from "../episode/EpisodeValidator";
import type { V3Look } from "../render/RenderPlanTypes";
import { fetchArticle } from "../research/SourceResearch";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import type { PartReference } from "../wardrobe/WardrobeBrain";
import { findPortrait, type PortraitResult } from "./PortraitFaces";

/**
 * The likeness designer of the costume brain (owner direction, 20 Oct 2026): the important real people of an episode
 * are drawn the way the reference channel draws Henry VIII — our flat puppet, but with the person's own face shape,
 * skin, nose, hair, beard, headwear and clothes, taken from their portrait and corrected to how they looked IN the
 * episode's period (Henry at 17 in 1509 is not the bearded Henry of Holbein's 1537 portrait).
 *
 * For each cast member with `portre.wiki`: the historian reads the appearance sentences of the person's Wikipedia
 * article and writes how they looked and dressed in the period; the picture researcher finds a portrait (the judge
 * prefers one near that age); the designer looks at the portrait with the historian's note and writes a likeness
 * sheet — face fields and a costume whose missing parts are ordered ("yeni:Henry VIII's …") from the wardrobe, which
 * draws them with the portrait as its reference. After the parts are made, the cartoon and the portrait are judged
 * side by side. A finished likeness is kept per person and period, so a later episode reuses it for free.
 * Crowds and invented characters are not touched (soldiers in a crowd may share one look).
 */
export interface LikenessDeps {
  readonly paths: V3Paths;
  /** Commons cache (portraits) and Wikipedia cache (articles). */
  readonly commonsCache: string;
  readonly wikiCache: string;
  /** The free vision judge that picks the portrait. */
  readonly judge: AIProvider;
  readonly budget: V3Budget;
  /** Writes the likeness sheet and judges the likeness (needs image input). */
  readonly designer: V3ModelChoice;
  /** The historian's period note (text only). */
  readonly critic: V3ModelChoice;
  readonly council?: CouncilLog;
  readonly log: (s: string) => void;
}

export interface PeriodNote {
  readonly yas?: number;
  readonly gorunus: string;
  readonly giyim: string;
  readonly simge: string;
  readonly fark: string;
}

export interface LikenessRecord {
  readonly castId: string;
  readonly kisi: string;
  readonly donem: string;
  readonly kaynak: "kutuphane" | "tasarim" | "degismedi";
  readonly not?: PeriodNote;
  readonly portre?: { readonly baslik: string; readonly url: string; readonly puan: number; readonly donemPuani?: number };
  readonly tarif?: string;
  /** Part descriptions this likeness ordered from the wardrobe. */
  readonly siparisler: readonly string[];
  readonly sorunlar: readonly string[];
  /** Side-by-side check after the parts were made (0–10), and what still differs. */
  readonly benzerlik?: number;
  readonly farklar?: readonly string[];
}

export interface LikenessOutcome {
  readonly episode: Episode;
  readonly records: LikenessRecord[];
  /** Part key → the person's portrait and face, for the wardrobe (see designParts). */
  readonly references: Map<string, { ref?: PartReference; look?: V3Look }>;
  /** Portrait previews by cast id, for the side-by-side check. */
  readonly portraits: Map<string, PortraitResult>;
}

const LOOK_WORDS =
  /\b(appearance|appeared|beard(ed)?|moustache|mustache|hair(ed|line)?|bald(ing|ness)?|tall|height|stout|obese|corpulent|overweight|portly|fat|thin|slim|wore|wearing|dressed|cloth(es|ing)|garments?|robes?|toga|crown(ed)?|wreath|hat|helmet|armou?r|uniform|wig|portraits?|depicted|likeness|complexion|eyes|red-haired|blond(e)?|scar)\b/i;

/** Sentences of an article that say how the person looked or dressed (the historian's evidence). */
export function appearanceSentences(text: string, max = 14): string[] {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  return sentences.filter((s) => s.length >= 30 && s.length <= 400 && LOOK_WORDS.test(s)).slice(0, max);
}

export function periodNotePrompt(c: CastEntry, episode: Episode, wiki: string, sentences: readonly string[]): string {
  return `You are the historian on the costume team of an animated history show. Before the illustrator draws ${wiki}, say how this person looked and dressed IN ${episode.donem}, during the events of the episode ("${episode.konu}") — not at another time of their life.
ROLE IN THE EPISODE: ${c.rol}
FROM THEIR WIKIPEDIA ARTICLE (sentences about appearance and dress; may be empty):
${sentences.map((s) => `- ${s}`).join("\n") || "- (none found)"}
Use these sentences and well-established history; do not invent details. When the famous portraits show them at a different age than in ${episode.donem}, say what differs (younger or older, beard or none, weight, hair).
Return ONLY JSON: {"yas": <their age in ${episode.donem} as a number, or null>, "gorunus": "<face, build, hair and beard in ${episode.donem}, at most 45 words>", "giyim": "<what they wore then, with colours and headwear, at most 45 words>", "simge": "<an object they carried then (sword, sceptre, scroll), or empty>", "fark": "<how the famous portraits differ from how they looked in ${episode.donem}, or empty>"}`;
}

export function readPeriodNote(text: string): PeriodNote | undefined {
  const v = readJsonAnswer<Record<string, unknown>>(text);
  if (!v) return undefined;
  const s = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const yas = typeof v.yas === "number" && v.yas > 0 && v.yas < 120 ? Math.round(v.yas) : undefined;
  return { ...(yas !== undefined ? { yas } : {}), gorunus: s(v.gorunus, 400), giyim: s(v.giyim, 400), simge: s(v.simge, 120), fark: s(v.fark, 300) };
}

export function sheetPrompt(c: CastEntry, episode: Episode, wiki: string, note: PeriodNote | undefined, portraitTitle: string | undefined): string {
  return `You design the cartoon of a real historical person for an animated history show in the style of OverSimplified: flat colours, bold dark outlines, a simple puppet body — the person recognisable from their headwear, hair, beard, face shape and clothes, the way OverSimplified draws Henry VIII after Holbein's portrait.
PERSON: ${wiki} — ${c.rol}
THE EPISODE: "${episode.konu}", set in ${episode.donem}. Draw them as they looked THEN.
HISTORIAN'S NOTE for ${episode.donem}: ${note ? `age ${note.yas ?? "unknown"}; looks: ${note.gorunus}; dress: ${note.giyim}${note.simge ? `; carries: ${note.simge}` : ""}${note.fark ? `; differs from the famous portraits: ${note.fark}` : ""}` : "none"}
${portraitTitle ? `PORTRAIT (attached): ${portraitTitle.replace(/^File:/, "")} — take their features and dress from it, corrected by the historian's note for ${episode.donem}.` : "No portrait was found: work from the historian's note."}
THE SCRIPT'S COSTUME (keep what already fits): ${JSON.stringify(c.kostum ?? {})}

Choose:
- "yuz": {"sekil": yuvarlak (round) | oval | uzun (long) | genis (wide, heavy jowls) | kare (square jaw); "ten": skin colour #RRGGBB for a flat cartoon (light skin is a pale warm white like #f6e7d8; darker skins true to the person); "burun": kucuk (small) | duz (straight) | iri (big, round) | kemerli (aquiline, Roman) | kalkik (upturned); "kas_renk": eyebrow colour #RRGGBB (their hair colour; grey or white when old); "yas": genc (under 35) | orta (35–55) | yasli (over 55)}
- "sac": parametric hair {"stil": kisa (short) | dalgali (wavy) | yan_ayrik (side part) | uzun (to the shoulders) | topuz (bun) | orgu (braids) | kel (bald) | kivircik (curly) | kakul (fringe) | geriye (combed back) | seyrek (receding: bald crown, hair at the back and sides); "renk": #RRGGBB}, or null when a drawn haircut is ordered or the headwear hides all the hair.
- "sac_parca": "yeni:${wiki}'s <haircut>" only when their haircut is distinctive and no parametric style fits; else null.
- "bas": the headwear they wore in ${episode.donem} ("yeni:${wiki}'s <description>"), the script's item to keep, or null for a bare head.
- "sakal", "biyik": beard and moustache ("yeni:${wiki}'s <description>"), or null if clean-shaven in ${episode.donem}.
- "giysi": kaftan | cubbe (robe) | zirh (armour) | onluk (apron) | bizans | yeniceri | sade (plain tunic) | tunik | toga | ceket (long coat, 1600s on) | uniforma | takim (modern suit) | elbise (long dress).
- "renkler": {"ana": main, "ikincil": second, "ic": undergarment, "sus": trim}, each #RRGGBB, true to the portrait and the period.
- "yaka": "kurk" (fur collar and fur front bands) or "yok".
- "gogus": what they wore on the chest (chain of office, order sash, medals, pendant): "yeni:${wiki}'s <description>", or null.
- "el_on": an object they held ("yeni:${wiki}'s <description>"), the script's item to keep, or null.
- "tarif": one sentence: what makes this cartoon recognisably ${wiki} in ${episode.donem}.
Every "yeni:" description starts with "${wiki}'s " and is at most 70 characters, concrete (shape, colour, decoration). Order only what they really wore.
Return ONLY JSON with exactly these keys.`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const REF = /^(([a-z0-9-]+\/)?[a-z0-9-]+|yeni:.{3,80})$/;
const SHEET_PARTS = ["bas", "sakal", "biyik", "sac_parca", "gogus", "el_on"] as const;

/** A part value from the sheet: a catalog ref or an order cut to the validator's 80 characters; null removes it. */
function partValue(v: unknown): string | null | undefined {
  if (v === null || (typeof v === "string" && /^(none|null|yok|-)?$/i.test(v.trim()))) return null;
  if (typeof v !== "string") return undefined;
  let t = v.trim();
  if (t.startsWith("yeni:")) {
    const body = t.slice(5).trim().replace(/\s+/g, " ");
    t = `yeni:${body.length > 80 ? body.slice(0, 80).replace(/\s+\S*$/, "") : body}`;
  }
  return REF.test(t) ? t : undefined;
}

/**
 * The likeness sheet applied to the script's costume (pure): every valid field replaces the script's, null removes a
 * part, anything unreadable keeps the script's value and is reported. Likeness faces get the detailed eyes.
 */
export function applySheet(costume: CastCostume, raw: unknown): { kostum: CastCostume; sorunlar: string[]; tarif: string } {
  const sorunlar: string[] = [];
  const sheet = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const k: Record<string, unknown> = { ...costume };
  const y = (typeof sheet.yuz === "object" && sheet.yuz !== null ? sheet.yuz : {}) as Record<string, unknown>;
  const yuz: Record<string, unknown> = { goz: "detayli" };
  if (FACE_SHAPES.includes(y.sekil as never)) yuz.sekil = y.sekil;
  if (NOSES.includes(y.burun as never)) yuz.burun = y.burun;
  if (AGES.includes(y.yas as never)) yuz.yas = y.yas;
  if (typeof y.ten === "string" && HEX.test(y.ten)) yuz.ten = y.ten;
  if (typeof y.kas_renk === "string" && HEX.test(y.kas_renk)) yuz.kas_renk = y.kas_renk;
  if (Object.keys(yuz).length < 4) sorunlar.push("yüz alanları eksik okundu");
  k.yuz = yuz;
  if (GARMENTS.includes(sheet.giysi as never)) k.giysi = sheet.giysi;
  else if (sheet.giysi !== undefined) sorunlar.push(`giysi okunamadı: ${String(sheet.giysi)}`);
  const r = sheet.renkler as Record<string, unknown> | undefined;
  if (r && ["ana", "ikincil", "ic", "sus"].every((key) => typeof r[key] === "string" && HEX.test(r[key] as string))) k.renkler = { ana: r.ana, ikincil: r.ikincil, ic: r.ic, sus: r.sus };
  else sorunlar.push("renkler okunamadı; senaryonun renkleri kaldı");
  if (sheet.yaka === "kurk" || sheet.yaka === "yok") k.yaka = sheet.yaka;
  for (const field of SHEET_PARTS) {
    if (!(field in sheet)) continue;
    const v = partValue(sheet[field]);
    if (v === null) delete k[field];
    else if (v !== undefined) k[field] = v;
    else sorunlar.push(`${field} okunamadı`);
  }
  const sac = sheet.sac as Record<string, unknown> | null | undefined;
  if (sac === null || typeof k.sac_parca === "string") delete k.sac;
  else if (sac && HAIR_STYLES.includes(sac.stil as never) && typeof sac.renk === "string" && HEX.test(sac.renk)) k.sac = { stil: sac.stil, renk: sac.renk };
  else if (sac !== undefined) sorunlar.push("saç okunamadı");
  return { kostum: k as unknown as CastCostume, sorunlar, tarif: typeof sheet.tarif === "string" ? sheet.tarif.slice(0, 300) : "" };
}

const SLOT_OF: Readonly<Record<(typeof SHEET_PARTS)[number], PartSlot>> = { bas: "head", sakal: "beard", biyik: "mustache", sac_parca: "hair", gogus: "chest", el_on: "hand" };

/** The orders a likeness costume makes, with their slots. */
export function likenessOrders(k: CastCostume): { slot: PartSlot; tarif: string }[] {
  const rec = k as unknown as Record<string, unknown>;
  return SHEET_PARTS.flatMap((f) => {
    const m = NEW_PART.exec(String(rec[f] ?? ""));
    return m ? [{ slot: SLOT_OF[f], tarif: m[1]!.trim() }] : [];
  });
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "kisi";
}

/** Finished likenesses, one file per person and period (outside git, next to the wardrobe). */
export function peopleDir(paths: V3Paths): string {
  return path.join(paths.workRoot, "_kutuphane", "kisiler");
}

const personFile = (paths: V3Paths, wiki: string, donem: string) => path.join(peopleDir(paths), `${slug(wiki)}--${slug(donem)}.json`);

async function knownRefs(paths: V3Paths): Promise<Set<string>> {
  const known = new Set<string>();
  for (const p of await packCatalog(costumeRootsFor(paths))) for (const ids of Object.values(p.items)) for (const id of ids ?? []) known.add(`${p.pack}/${id}`);
  return known;
}

function withCostume(episode: Episode, castId: string, kostum: CastCostume): Episode {
  return { ...episode, oyuncu_kadrosu: episode.oyuncu_kadrosu.map((c) => (c.id === castId ? { ...c, kostum } : c)) };
}

/** Designs the likeness of every visible real person of the episode (before the wardrobe step draws the parts). */
export async function designLikenesses(episode: Episode, deps: LikenessDeps): Promise<LikenessOutcome> {
  const { paths, log } = deps;
  const records: LikenessRecord[] = [];
  const references = new Map<string, { ref?: PartReference; look?: V3Look }>();
  const portraits = new Map<string, PortraitResult>();
  const known = await knownRefs(paths);
  let current = episode;
  for (const c of episode.oyuncu_kadrosu.filter((x) => x.gorunur && x.kostum && x.portre?.wiki)) {
    const wiki = c.portre!.wiki;
    const talk: DebateEntry[] = [];
    // A likeness finished for this person and period in an earlier episode: reused while all its parts still exist.
    const saved = personFile(paths, wiki, episode.donem);
    if (existsSync(saved)) {
      const stored = JSON.parse(await fs.readFile(saved, "utf8")) as { kostum: CastCostume; tarif?: string };
      const parts = PART_FIELDS.map((f) => (stored.kostum as unknown as Record<string, unknown>)[f]).filter((v): v is string => typeof v === "string");
      const resolvable = parts.every((ref) => known.has(ref.includes("/") ? ref : `${c.kostum_paketi}/${ref}`));
      const next = withCostume(current, c.id, { ...stored.kostum, ...(c.kostum!.el_arka ? { el_arka: c.kostum!.el_arka } : {}) });
      if (resolvable && validateEpisode(next).ok) {
        current = next;
        records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "kutuphane", ...(stored.tarif ? { tarif: stored.tarif } : {}), siparisler: [], sorunlar: [] });
        log(`  benzerlik: ${c.ad} — ${episode.donem} için kişi kütüphanesinde`);
        continue;
      }
    }
    const article = await fetchArticle(deps.wikiCache, wiki).catch(() => undefined);
    const sentences = article ? appearanceSentences(article.text) : [];
    talk.push({ rol: "Araştırmacı", metin: article ? `"${article.title}" makalesinde görünüş/giyim üzerine ${sentences.length} cümle` : `"${wiki}" makalesi okunamadı` });
    const noteOut = await deps.budget.generate("benzerlik-tarihci", deps.critic, periodNotePrompt(c, episode, wiki, sentences), { maxTokens: 450 }).catch((e: Error) => (log(`  benzerlik: ${c.ad} tarihçi notu alınamadı (${e.message.slice(0, 100)})`), undefined));
    const note = noteOut ? readPeriodNote(noteOut.result.content) : undefined;
    talk.push({ rol: "Tarihçi", metin: note ? `${episode.donem}: ${note.yas !== undefined ? `${note.yas} yaşında; ` : ""}${note.gorunus} | giyim: ${note.giyim}${note.fark ? ` | portrelerden farkı: ${note.fark}` : ""}` : "not yazılamadı" });
    const portrait = await findPortrait({ cacheDir: deps.commonsCache, judge: deps.judge, person: { id: c.id, ad: c.ad, rol: c.rol, wiki }, donem: episode.donem, log }).catch(() => undefined);
    if (portrait) portraits.set(c.id, portrait);
    talk.push({ rol: "Resim araştırmacısı", metin: portrait ? `portre: ${portrait.candidate.title.replace(/^File:/, "")} (kişi ${portrait.secim.puan}/10, dönem ${portrait.secim.donem ?? "?"}/10)` : "uygun portre yok; tarihçinin notundan çizilecek" });
    const sheetOut = await deps.budget
      .generate("benzerlik-tasarim", deps.designer, sheetPrompt(c, episode, wiki, note, portrait?.candidate.title), { maxTokens: 900, ...(portrait ? { images: [portrait.preview.toString("base64")] } : {}) })
      .catch((e: Error) => (log(`  benzerlik: ${c.ad} kart yazılamadı (${e.message.slice(0, 100)})`), undefined));
    const sheet = sheetOut ? readJsonAnswer<Record<string, unknown>>(sheetOut.result.content) : undefined;
    if (!sheet) {
      records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "degismedi", ...(note ? { not: note } : {}), siparisler: [], sorunlar: ["benzerlik kartı okunamadı; senaryonun kostümü kaldı"] });
      deps.council?.find({ beyin: "kostum", onem: "uyari", baslik: "benzerlik kartı yazılamadı", ayrinti: `${c.ad}: senaryonun kostümü kullanıldı`, tur: "veri", yer: c.id });
      continue;
    }
    const applied = applySheet(c.kostum!, sheet);
    // Catalog refs the sheet named but the wardrobe lacks become orders, like the script normalizer does.
    const rec = applied.kostum as unknown as Record<string, unknown>;
    for (const f of SHEET_PARTS) {
      const v = rec[f];
      if (typeof v === "string" && !v.startsWith("yeni:") && !known.has(v.includes("/") ? v : `${c.kostum_paketi}/${v}`)) rec[f] = `yeni:${wiki}'s ${v.replace(/^.*\//, "").replace(/[-_]+/g, " ")}`.slice(0, 85);
    }
    const next = withCostume(current, c.id, applied.kostum);
    const check = validateEpisode(next);
    if (!check.ok) {
      const why = check.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join("; ");
      records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "degismedi", ...(note ? { not: note } : {}), siparisler: [], sorunlar: [...applied.sorunlar, `kart bölümü bozuyordu (${why}); senaryonun kostümü kaldı`] });
      continue;
    }
    current = next;
    const orders = likenessOrders(applied.kostum);
    const look = applied.kostum.yuz ? toLook(applied.kostum.yuz) : undefined;
    for (const o of orders) {
      // The portrait is the reference for what is on the person (head, hair, beard, chest); a held object is looked
      // up among real museum pieces by the wardrobe as usual.
      const ref: PartReference | undefined =
        portrait && o.slot !== "hand"
          ? { title: portrait.candidate.title, url: portrait.candidate.descriptionUrl, credit: portrait.candidate.credit, description: `${wiki} as in this portrait, drawn as they looked in ${episode.donem}. ${note?.gorunus ?? ""} ${note?.giyim ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 400), imageB64: portrait.preview.toString("base64") }
          : undefined;
      references.set(partKey(o), { ...(ref ? { ref } : {}), ...(look ? { look } : {}) });
    }
    talk.push({ rol: "Tasarımcı", metin: `${applied.tarif || "kart yazıldı"}${orders.length ? ` | gardıroptan: ${orders.map((o) => o.tarif).join("; ")}` : ""}` });
    records.push({
      castId: c.id,
      kisi: wiki,
      donem: episode.donem,
      kaynak: "tasarim",
      ...(note ? { not: note } : {}),
      ...(portrait ? { portre: { baslik: portrait.candidate.title, url: portrait.candidate.descriptionUrl, puan: portrait.secim.puan, ...(portrait.secim.donem !== undefined ? { donemPuani: portrait.secim.donem } : {}) } } : {}),
      tarif: applied.tarif,
      siparisler: orders.map((o) => o.tarif),
      sorunlar: applied.sorunlar,
    });
    log(`  benzerlik: ${c.ad} — ${applied.tarif || "kart yazıldı"}${orders.length ? ` (${orders.length} parça sipariş)` : ""}`);
    deps.council?.debate("kostum", `benzerlik: ${c.ad} (${episode.donem})`, talk);
  }
  return { episode: current, records, references, portraits };
}

/**
 * After the wardrobe made the parts: likenesses whose parts all came out are kept in the people library (append-only:
 * an existing file is never overwritten), so the next episode with this person in this period reuses them.
 */
export async function keepLikenesses(paths: V3Paths, episode: Episode, records: readonly LikenessRecord[], parts: readonly PartRecord[]): Promise<number> {
  let kept = 0;
  await fs.mkdir(peopleDir(paths), { recursive: true });
  for (const r of records.filter((x) => x.kaynak === "tasarim")) {
    if (r.siparisler.some((t) => parts.some((p) => p.tarif === t && p.kaynak === "basarisiz"))) continue;
    const c = episode.oyuncu_kadrosu.find((x) => x.id === r.castId);
    const file = personFile(paths, r.kisi, r.donem);
    if (!c?.kostum || existsSync(file)) continue;
    // The second hand's object belongs to the scene, not to the person.
    const kostum: Record<string, unknown> = { ...c.kostum };
    delete kostum.el_arka;
    await fs.writeFile(file, `${JSON.stringify({ kisi: r.kisi, donem: r.donem, kostum, tarif: r.tarif, not: r.not, portre: r.portre, olusturuldu: new Date().toISOString() }, null, 2)}\n`);
    kept++;
  }
  return kept;
}

/**
 * The art director's last look: each drawn person next to their portrait, scored for how recognisable the cartoon
 * is. Low scores go to AYAS as a finding; nothing is redrawn here.
 */
export async function checkLikenesses(input: {
  readonly paths: V3Paths;
  readonly episode: Episode;
  readonly outcome: LikenessOutcome;
  readonly budget: V3Budget;
  readonly designer: V3ModelChoice;
  readonly workDir: string;
  readonly council?: CouncilLog;
  readonly log: (s: string) => void;
}): Promise<LikenessRecord[]> {
  const { paths, outcome, log } = input;
  const ids = outcome.records.filter((r) => r.kaynak === "tasarim" && outcome.portraits.has(r.castId)).map((r) => r.castId);
  if (!ids.length) return outcome.records;
  const members = toRenderCast(input.episode.oyuncu_kadrosu.filter((c) => ids.includes(c.id)), "kukla");
  const accessories = await loadAccessories(costumeRootsFor(paths), members);
  const crops = await puppetStills(paths, members.map((member) => ({ member, gesture: "konus", crop: "figure" })), accessories, input.workDir);
  const out = [...outcome.records];
  for (const [i, member] of members.entries()) {
    const r = out.findIndex((x) => x.castId === member.id);
    const portrait = outcome.portraits.get(member.id)!;
    const left = path.join(input.workDir, `portre-${member.id}.jpg`);
    const pair = path.join(input.workDir, `benzerlik-${member.id}.jpg`);
    await fs.writeFile(left, portrait.preview);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", left, "-i", crops[i]!, "-filter_complex", "[0]scale=-2:640[a];[1]scale=-2:640[b];[a][b]hstack=inputs=2", "-q:v", "3", pair]);
    const prompt = `LEFT: a portrait of ${outcome.records[r]!.kisi}. RIGHT: our flat cartoon of them as they looked in ${input.episode.donem}, in the style of OverSimplified (simple puppet body, flat colours, bold outlines; a different age than the portrait may be intended).
Would a viewer who knows this person's portraits recognise the cartoon (headwear, hair, beard, face shape, clothes, colours)? "benzerlik" 0–10. List at most 3 concrete differences that matter most.
Return ONLY JSON: {"benzerlik": <0-10>, "farklar": ["…"]}`;
    const res = await input.budget.generate("benzerlik-kontrol", input.designer, prompt, { maxTokens: 250, images: [(await fs.readFile(pair)).toString("base64")] }).catch(() => undefined);
    const v = res ? readJsonAnswer<{ benzerlik?: unknown; farklar?: unknown }>(res.result.content) : undefined;
    const score = typeof v?.benzerlik === "number" ? Math.max(0, Math.min(10, Math.round(v.benzerlik))) : undefined;
    const farklar = Array.isArray(v?.farklar) ? v!.farklar.map(String).slice(0, 3) : [];
    if (score === undefined) continue;
    out[r] = { ...out[r]!, benzerlik: score, farklar };
    log(`  benzerlik: ${member.name} portreyle yan yana ${score}/10${farklar.length ? ` — ${farklar.join("; ")}` : ""}`);
    if (score < 6) input.council?.find({ beyin: "kostum", onem: "uyari", baslik: "benzerlik zayıf", ayrinti: `${member.name}: ${score}/10 — ${farklar.join("; ")}`, oneri: "kişi kütüphanesindeki kaydı silip bu farklarla yeniden tasarlat", tur: "veri", yer: member.id });
  }
  return out;
}
