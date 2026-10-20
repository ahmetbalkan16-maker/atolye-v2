import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CandidateVerdict, passes, pickBackground } from "../backgrounds/BackgroundJudge";
import type { CastCostume, Episode } from "../episode/EpisodeTypes";
import type { V3Accessory, V3CastMember, V3Costume, V3FaceShape, V3Gesture, V3Look, V3RenderPlan } from "../render/RenderPlanTypes";
import { renderWithRemotion } from "../render/RemotionRunner";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import type { DebateEntry } from "../council/Council";
import { recall, remember } from "../council/ExperienceMemory";
import { type BrainDeps, chiefOnPart, findPartReference, historianOnPart, type PartReference } from "../wardrobe/WardrobeBrain";
import { type CostumePackManifest, costumesRoot, svgBody } from "./CostumePackLoader";

/**
 * Layer 2 of the period wardrobe (docs/v3/05_DONEM_TASARIM_MOTORU.md): when the script asks for a costume part the
 * catalog does not have ("bas": "yeni:Roman legionary helmet with a red crest"), a model draws it as SVG under a
 * strict part contract; the safety filter and geometry checks run; the part is put on a puppet and rendered; the
 * vision judge must recognise it, see it sitting right and in the house style. A passing part is added to the
 * wardrobe library in runtime storage (outside git, append-only, with provenance) and reused for free by every later
 * episode — the wardrobe grows by itself. A part that fails three rounds is left off; production never stops.
 */
export const WARDROBE_PACK = "gardirop";
export const NEW_PART = /^yeni:\s*(.{3,80})$/;
const MAX_ROUNDS = 3;
const MAX_ELEMENTS = 45;

export type PartSlot = V3Accessory["slot"];
const FIELD_SLOT: Readonly<Record<string, PartSlot>> = { bas: "head", sakal: "beard", biyik: "mustache", el_on: "hand", el_arka: "hand", sirt: "back", sac_parca: "hair", gogus: "chest" };

/** Root that holds the generated pack (`<root>/gardirop/pack.json`); packs are looked up in the repo first, then here. */
export function wardrobeRoot(paths: V3Paths): string {
  return path.join(paths.workRoot, "_kutuphane", "kostum");
}

export function costumeRootsFor(paths: V3Paths): string[] {
  return [costumesRoot(paths.repoRoot), wardrobeRoot(paths)];
}

export interface PartOrder {
  readonly slot: PartSlot;
  readonly tarif: string;
}

/** One key per ordered part (slot + description), shared by the orders, the library and the likeness references. */
export const partKey = (o: PartOrder) => `${o.slot}:${o.tarif.toLowerCase().replace(/\s+/g, " ").trim()}`;
const key = partKey;

/** Every "yeni:" request in the cast's and the crowds' costumes, once each. */
export function partOrders(episode: Episode): PartOrder[] {
  const costumes: CastCostume[] = [...episode.oyuncu_kadrosu.flatMap((c) => (c.kostum ? [c.kostum] : [])), ...episode.sahneler.flatMap((s) => (s.kalabalik ?? []).map((g) => g.kostum))];
  const out = new Map<string, PartOrder>();
  for (const k of costumes) {
    for (const [field, slot] of Object.entries(FIELD_SLOT)) {
      const m = NEW_PART.exec(String((k as unknown as Record<string, unknown>)[field] ?? ""));
      if (m) out.set(key({ slot, tarif: m[1]! }), { slot, tarif: m[1]!.trim() });
    }
  }
  return [...out.values()];
}

/** The episode with every "yeni:" ref replaced by its library item ("gardirop/<id>"), or removed when it failed. */
export function applyParts(episode: Episode, made: ReadonlyMap<string, string | undefined>): Episode {
  const fix = (k: CastCostume): CastCostume => {
    const copy: Record<string, unknown> = { ...k };
    for (const [field, slot] of Object.entries(FIELD_SLOT)) {
      const m = NEW_PART.exec(String(copy[field] ?? ""));
      if (!m) continue;
      const id = made.get(key({ slot, tarif: m[1]! }));
      if (id) copy[field] = `${WARDROBE_PACK}/${id}`;
      else delete copy[field];
    }
    return copy as unknown as CastCostume;
  };
  return {
    ...episode,
    oyuncu_kadrosu: episode.oyuncu_kadrosu.map((c) => (c.kostum ? { ...c, kostum: fix(c.kostum) } : c)),
    sahneler: episode.sahneler.map((s) => (s.kalabalik ? { ...s, kalabalik: s.kalabalik.map((g) => ({ ...g, kostum: fix(g.kostum) })) } : s)),
  };
}

/** The puppet's face, measured on the rig (remotion-v3/src/character/Face.tsx): every head-slot rule is told this. */
const FACE_FRAME = `Coordinates are centred on the puppet's head: radius 100 at (0,0); y grows downwards; the face looks slightly
towards +x: eyes at (-21,-4) and (41,-4), brows at about y = -45, nose near (22,20), mouth at (8,46), the face's
middle line at x = 10.`;

/** Chin height of each likeness face shape (Face.tsx FACE_PATHS); the plain puppet head is round (chin at y = 98). */
const CHIN_Y: Readonly<Record<V3FaceShape, number>> = { yuvarlak: 98, oval: 114, uzun: 128, genis: 124, kare: 118 };

const SLOT_RULES: Readonly<Record<PartSlot, string>> = {
  head: `HEADWEAR. ${FACE_FRAME} The headwear sits ON the head: its lower rim wraps the head at about y = -40…-60 (the
rim may be a band of height 20–30), the crown rises above (top no higher than y = -290), width at most ±150 (brims,
plumes, crests). It may cover the top of the head but never the eyes or the face (nothing in x -45…75, y -35…75).
Cheek guards may hang at the sides (x < -60).`,
  beard: `BEARD. ${FACE_FRAME} The beard grows from the jaw and cheeks: its upper edge rises from the chin to the cheeks
(about y = 30 at x = -70 and x = 90) and passes BELOW the mouth in the middle (about y = 66 under x = 8), so the
mouth (x -22…38, y 34…62) stays visible; it hangs down to at most y = 190, x within -80…100.`,
  mustache: `MOUSTACHE. ${FACE_FRAME} It sits between the nose and the mouth, centred at about (10,34), at most 100 wide
and 30 tall, not covering the mouth opening below y = 44.`,
  hair: `HAIRCUT (the person's own hair; headwear, if any, is a separate part drawn over it). ${FACE_FRAME} The hair
covers the skull from the back of the head (x ≈ -105) over the crown (top no higher than y = -150, for volume) to a
hairline above the forehead (above y = -55 for x > -40, so the eyes and brows stay visible). Short hair ends at the
back of the neck (y ≈ 10, x ≈ -100); long hair may fall at the back and side down to y = 200 (x < -40); sideburns at
x ≈ -80…-55 may reach y = 40. Nothing over the eyes, brows or face (x -40…80, y -50…80). A balding person: only the
fringe around the back and sides, a bare crown.`,
  chest: `ON THE CHEST, over the garment (chain of office, pendant, order sash, medals, breastplate decoration).
Coordinates are centred between the shoulders at (0,0); the neckline is at y ≈ -16, the shoulders at x ±88, the belt
at y ≈ 114, the hips at y ≈ 168. Keep within x -95…95, y -20…170.`,
  hand: `HELD OBJECT. Coordinates are centred on the closed fist at (0,0). Draw the object inside <g transform="rotate(-40)">
with its handle through the fist (handle from about y = -45 to y = 35) and its long axis along +y (a sword blade from
y = 35 to about y = 215, a staff or spear from y = -200 to y = 260, a flag pole with the flag near the top). Small
objects (scroll, book, cup, letter, pistol) sit around the fist within ±70.`,
  back: `ON THE BACK (cape, quiver, shield, wings). Coordinates are centred between the shoulders at (0,0); the body
hangs down to about y = 330, shoulders at x ±88. Keep within x -150…150, y -60…340.`,
};

export function partPrompt(o: PartOrder, donem: string, reference: string, feedback?: string, realExample?: string, faceShape?: V3FaceShape, lessons?: readonly string[]): string {
  const learned = lessons?.length ? `\nSIMILAR PARTS FAILED BEFORE (the costume team's experience — avoid these faults): ${lessons.join(" | ")}\n` : "";
  const face = faceShape && faceShape !== "yuvarlak" && ["head", "beard", "mustache", "hair"].includes(o.slot) ? `\nTHIS CHARACTER'S FACE is ${faceShape === "genis" ? "wide with heavy jowls" : faceShape === "uzun" ? "long" : faceShape === "kare" ? "square-jawed" : "oval"}: the chin is at y = ${CHIN_Y[faceShape]} (not 98); fit the part to it.\n` : "";
  return `You draw costume parts for a flat cartoon puppet in an animated history show. Draw ONE part as SVG.

PART: ${o.tarif}
PERIOD: ${donem}

${SLOT_RULES[o.slot]}
${face}
STYLE (the house style, see the reference part below): flat fills, every shape outlined with stroke #1d1b26,
stroke-width 4–6.5, stroke-linejoin round; simple, bold, readable at small size; 2–4 colours true to the period; one
optional highlight stroke (#ffffff, opacity 0.5). Historically accurate shape for ${donem}.
ALLOWED: <svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -300 340 380"> with path, rect, circle, ellipse,
polygon, polyline, line, g (transform translate/rotate/scale only); colours via style="fill:…;stroke:…" or fill/stroke
attributes. FORBIDDEN: text, image, use, style elements, gradients, filters, href, url(), scripts. At most ${MAX_ELEMENTS} elements.
${learned}${realExample ? `\nREAL HISTORICAL EXAMPLE (photo attached when available): ${realExample}\nDraw your part to match its shape, proportions, colours and decoration, simplified to the house style.\n` : ""}${feedback ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${feedback}\nFix exactly that.\n` : ""}
REFERENCE PART of the same kind from the house wardrobe (style and coordinate frame):
${reference}

Return ONLY JSON: {"svg": "<svg …>…</svg>", "behind": <true if it hangs behind the head, like a long veil>, "grip": <true for a held object the fist closes around (sword, staff, pole)>}`;
}

/** Problems that keep a drawn part from being tried on: empty when it is safe and in its frame. */
export function partProblems(svg: string, slot: PartSlot): string[] {
  const problems: string[] = [];
  let body = "";
  try {
    body = svgBody(svg, "yeni parça");
  } catch (e) {
    return [`SVG refused: ${(e as Error).message}`];
  }
  if (/<(text|image|use|style|linearGradient|radialGradient|filter|mask|pattern)\b/i.test(body)) problems.push("uses a forbidden element");
  const elements = (body.match(/<(path|rect|circle|ellipse|polygon|polyline|line)\b/gi) ?? []).length;
  if (elements === 0) problems.push("draws nothing");
  if (elements > MAX_ELEMENTS) problems.push(`${elements} elements (at most ${MAX_ELEMENTS})`);
  if (!/#1d1b26/i.test(body)) problems.push("no #1d1b26 outline");
  // Colours (#b8862f) and stroke widths are not coordinates.
  const geometry = body.replace(/#[0-9a-f]{3,8}\b/gi, "").replace(/(stroke-width|opacity|stroke-opacity|fill-opacity)\s*[:=]\s*"?[\d.]+/gi, "");
  const numbers = (geometry.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (numbers.some((n) => Math.abs(n) > 400)) problems.push("coordinates outside the part frame (|n| > 400)");
  if (slot === "head" && !numbers.some((n) => n <= -100)) problems.push("headwear does not rise above the head (no y ≤ -100)");
  if (slot === "hair" && !numbers.some((n) => n <= -90)) problems.push("the haircut does not reach the crown (no y ≤ -90)");
  return problems;
}

function readJsonAnswer(text: string): { svg?: string; behind?: boolean; grip?: boolean } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1)) as { svg?: string; behind?: boolean; grip?: boolean };
  } catch {
    return {};
  }
}

interface LibraryItem {
  readonly slot: PartSlot;
  readonly behind?: boolean;
  readonly grip?: boolean;
  readonly not: string;
}

async function readLibrary(root: string): Promise<CostumePackManifest> {
  const file = path.join(root, WARDROBE_PACK, "pack.json");
  if (existsSync(file)) return JSON.parse(await fs.readFile(file, "utf8")) as CostumePackManifest;
  return { schema: 1, id: WARDROBE_PACK, title: "Atölye gardırobu (yapay zekâ tasarımı, hakem onaylı)", items: {} };
}

/** A sample part of the same slot from the hand-drawn packs, as the style and frame reference. */
async function referencePart(paths: V3Paths, slot: PartSlot): Promise<string> {
  const prefer: Readonly<Record<PartSlot, string>> = { head: "ottoman-1453/zaganos-migferi", beard: "ottoman-1453/sakal-genc", mustache: "ottoman-1453/biyik-pala", hand: "ottoman-1453/kilic", back: "ottoman-1453/zaganos-migferi", hair: "ortak/sac-kisa-yan", chest: "ortak/altin-zincir" };
  const [pack, id] = prefer[slot].split("/") as [string, string];
  return (await fs.readFile(path.join(costumesRoot(paths.repoRoot), pack, `${id}.svg`), "utf8")).trim();
}

/** One puppet of a still row: who, in what pose, and which crop the judge gets. */
export interface StillPuppet {
  readonly member: V3CastMember;
  readonly gesture: V3Gesture;
  /** "head": a close square on the head; "figure": the whole body. */
  readonly crop: "head" | "figure";
}

/**
 * Puppets in a row on a plain backdrop, rendered in one still; each one's region is cropped to a JPEG for a judge.
 * Used by the part fittings and the likeness check.
 */
export async function puppetStills(paths: V3Paths, puppets: readonly StillPuppet[], accessories: readonly V3Accessory[], workDir: string): Promise<string[]> {
  const pub = path.join(workDir, "public");
  await fs.mkdir(path.join(pub, "bg"), { recursive: true });
  const bg = path.join(pub, "bg", "duz.png");
  if (!existsSync(bg)) await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xd9d4c7:s=1920x1080", "-frames:v", "1", bg]);
  const n = puppets.length;
  const cast = puppets.map((p) => p.member);
  const fps = 30;
  const plan: V3RenderPlan = {
    version: 1,
    episodeId: "prova",
    title: "prova",
    fps,
    width: 1920,
    height: 1080,
    durationInFrames: 30,
    cast,
    accessories,
    captions: [],
    showCaptions: false,
    shots: [
      {
        id: "prova",
        sceneId: "prova",
        start: 0,
        duration: 30,
        background: { src: "bg/duz.png", kind: "set" },
        performers: puppets.map((p, i) => ({ castId: p.member.id, x: (i + 0.5) / n, depth: 0, facing: "right", moves: [], gestures: [{ gesture: p.gesture, start: 0, end: 30 }], faces: [{ start: 0, emotion: "notr" }], visemes: [], effects: [], speaking: [] })),
        props: [],
        camera: [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }],
        shakes: [],
        titleCards: [],
        mapArrows: [],
        transitionIn: "kes",
        dramatized: false,
      },
    ],
  };
  await fs.mkdir(workDir, { recursive: true });
  const planFile = path.join(workDir, "prova-plan.json");
  await fs.writeFile(planFile, JSON.stringify({ plan }));
  const still = path.join(workDir, "prova.png");
  await renderWithRemotion(paths, { planFile, publicDir: pub, out: still, kind: "still", frame: 20 });
  const cell = Math.floor(1920 / n);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const crop = path.join(workDir, `aday-${i}.jpg`);
    const cx = Math.round((i + 0.5) * cell);
    // Head parts: a close square on the head (the judge must see the part, not a small figure); others: the figure.
    const head = puppets[i]!.crop === "head";
    const w = head ? Math.min(cell, 500) : Math.min(cell, 640);
    // The head square ends just below the longest likeness chin (y ≈ 846) and reaches up as far as its width allows.
    const box = head ? `crop=${w}:${w}:${Math.max(0, cx - Math.round(w / 2))}:${846 - w},scale=640:640` : `crop=${w}:820:${Math.max(0, cx - Math.round(w / 2))}:200,scale=-2:640`;
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", still, "-vf", box, "-q:v", "3", crop]);
    out.push(crop);
  }
  return out;
}

const SLOT_FIELD: Readonly<Record<PartSlot, keyof V3Costume>> = { head: "head", beard: "beard", mustache: "mustache", hand: "handFront", back: "back", hair: "hairPart", chest: "chest" };

/** Puppets wearing the candidates (with the character's own face shape when it has a likeness), in one still. */
async function fittingStills(paths: V3Paths, candidates: readonly { order: PartOrder; svg: string; behind: boolean; grip: boolean; look?: V3Look }[], workDir: string): Promise<string[]> {
  const accessories: V3Accessory[] = candidates.map((c, i) => ({ id: `${WARDROBE_PACK}/aday-${i}`, slot: c.order.slot, markup: svgBody(c.svg, `aday-${i}`), ...(c.behind ? { behind: true } : {}), ...(c.grip ? { grip: true } : {}) }));
  const puppets: StillPuppet[] = candidates.map((c, i) => {
    const costume: V3Costume = { pack: WARDROBE_PACK, garment: "tunik", colors: { main: "#8c8f99", second: "#5d6170", inner: "#d8d2c4", trim: "#b59a5a" }, shoes: "kahve-cizme", collar: "yok", [SLOT_FIELD[c.order.slot]]: `aday-${i}`, ...(c.look ? { look: c.look } : {}) };
    return { member: { id: `p${i}`, name: c.order.tarif, scale: 1, style: "kukla", costume }, gesture: c.order.slot === "hand" ? "yumruk_kaldir" : "konus", crop: c.order.slot === "hand" || c.order.slot === "back" || c.order.slot === "chest" ? "figure" : "head" };
  });
  return puppetStills(paths, puppets, accessories, workDir);
}

export interface PartRecord {
  readonly tarif: string;
  readonly slot: PartSlot;
  readonly id?: string;
  readonly kaynak: "kutuphane" | "tasarim" | "basarisiz";
  readonly denemeler: number;
  readonly secim?: CandidateVerdict;
  readonly sorunlar?: readonly string[];
}

/**
 * Designs every ordered part (library first), returns the id per order key (undefined = left off) and a record per
 * order for the QC. `workDir` holds the fitting renders.
 */
export async function designParts(input: {
  readonly paths: V3Paths;
  readonly orders: readonly PartOrder[];
  readonly donem: string;
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  readonly judge: AIProvider;
  readonly workDir: string;
  readonly log: (s: string) => void;
  /** The costume brain: real references before drawing, historian and chief after (none = the judge alone). */
  readonly brain?: BrainDeps;
  /**
   * Parts of a real person's likeness, by part key: their portrait as the reference (instead of a museum search) and
   * their face, so the part is drawn and tried on for that face.
   */
  readonly likeness?: ReadonlyMap<string, { readonly ref?: PartReference; readonly look?: V3Look }>;
}): Promise<{ made: Map<string, string | undefined>; records: PartRecord[] }> {
  const { paths, log } = input;
  const root = wardrobeRoot(paths);
  const dir = path.join(root, WARDROBE_PACK);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(input.workDir, { recursive: true });
  const library = await readLibrary(root);
  const made = new Map<string, string | undefined>();
  const records: PartRecord[] = [];
  const byTarif = new Map(Object.entries(library.items).map(([id, it]) => [key({ slot: it.slot, tarif: it.not ?? "" }), id]));
  let pending: { order: PartOrder; feedback?: string; tries: number; problems: string[]; ref?: PartReference; look?: V3Look; lessons?: string[]; talk: DebateEntry[] }[] = [];
  const talks: { order: PartOrder; talk: DebateEntry[] }[] = [];
  for (const o of input.orders) {
    const found = byTarif.get(key(o));
    if (found) {
      made.set(key(o), found);
      records.push({ tarif: o.tarif, slot: o.slot, id: found, kaynak: "kutuphane", denemeler: 0 });
      log(`  gardırop: "${o.tarif}" kütüphanede (${found})`);
    } else {
      const talk: DebateEntry[] = [];
      const person = input.likeness?.get(key(o));
      pending.push({ order: o, tries: 0, problems: [], talk, ...(person?.ref ? { ref: person.ref } : {}), ...(person?.look ? { look: person.look } : {}) });
      if (person?.ref) talk.push({ rol: "Araştırmacı", metin: `kişinin portresi örnek: ${person.ref.title.replace(/^File:/, "")} — ${person.ref.description}` });
      talks.push({ order: o, talk });
    }
  }
  if (input.brain) {
    for (const p of pending.filter((x) => !x.ref)) {
      const ref = await findPartReference(p.order, input.donem, input.brain).catch(() => undefined);
      if (ref) p.ref = ref;
      p.talk.push({ rol: "Araştırmacı", metin: ref ? `gerçek örnek bulundu: ${ref.title.replace(/^File:/, "")} — ${ref.description}` : "gerçek örnek bulunamadı; tariften çizilecek" });
    }
  }
  // The costume brain's experience: why similar parts could not be drawn before.
  for (const p of pending) {
    const lessons = (await recall(paths.workRoot, "kostum", { konu: p.order.tarif, tur: "ders", limit: 3 }).catch(() => [])).map((l) => l.metin);
    if (lessons.length) {
      p.lessons = lessons;
      p.talk.push({ rol: "Hafıza", metin: `benzer parçalardan dersler: ${lessons.join(" | ")}` });
    }
  }
  const items: Record<string, LibraryItem> = { ...(library.items as Record<string, LibraryItem>) };
  for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
    const drawn: { p: (typeof pending)[number]; svg: string; behind: boolean; grip: boolean }[] = [];
    for (const p of pending) {
      p.tries++;
      const out = await input.budget.generate(`parca-${round}`, input.model, partPrompt(p.order, input.donem, await referencePart(paths, p.order.slot), p.feedback, p.ref?.description, p.look?.faceShape, p.lessons), { maxTokens: 3_000, ...(p.ref ? { images: [p.ref.imageB64] } : {}) });
      const ans = readJsonAnswer(out.result.content);
      const problems = ans.svg ? partProblems(ans.svg, p.order.slot) : ["no svg in the answer"];
      if (problems.length) {
        p.feedback = problems.join("; ");
        p.problems.push(`tur ${round}: ${p.feedback}`);
        p.talk.push({ rol: "Tasarımcı", metin: `tur ${round}: çizim kapılardan geçmedi (${p.feedback})` });
        log(`  gardırop: "${p.order.tarif}" tur ${round} geçersiz — ${p.feedback}`);
        continue;
      }
      drawn.push({ p, svg: ans.svg!.trim(), behind: ans.behind === true, grip: ans.grip === true || p.order.slot === "hand" });
    }
    if (drawn.length) {
      const crops = await fittingStills(paths, drawn.map((d) => ({ order: d.p.order, svg: d.svg, behind: d.behind, grip: d.grip, ...(d.p.look ? { look: d.p.look } : {}) })), path.join(input.workDir, `tur-${round}`));
      for (const [i, d] of drawn.entries()) {
        const slotName = { head: "headwear", beard: "beard", mustache: "moustache", hand: "held object", back: "worn on the back", hair: "haircut", chest: "worn on the chest" }[d.p.order.slot];
        const pick = await pickBackground([{ title: d.p.order.tarif, crop: crops[i]! }], { konu: d.p.order.tarif, donem: input.donem, mekan: slotName, tr: d.p.order.tarif, en: d.p.order.tarif, anlatim: "" }, input.judge, (c) => fs.readFile(c.crop), log, { mode: "parca", max: 1 });
        const v = pick.verdicts[0];
        d.p.talk.push({ rol: "Sanat yönetmeni", metin: v ? `tur ${round}: ${v.puan}/10 — ${v.gosterilen}; ${v.sorun}` : `tur ${round}: okunamadı` });
        // The brain's second opinion: the historian names the errors, the chief accepts or sends it back once more.
        let chiefSays: { karar: "kabul" | "revize"; talimat: string } = { karar: "kabul", talimat: "" };
        if (v && passes(v) && input.brain) {
          const historian = await historianOnPart(d.p.order, input.donem, `${v.gosterilen}; ${v.sorun}`, d.p.ref, input.brain);
          d.p.talk.push({ rol: "Tarihçi", metin: historian.onem === "yok" ? "dönem hatası görmedi" : `(${historian.onem}) ${historian.sorunlar.join("; ")}` });
          chiefSays = await chiefOnPart(d.p.order, round, round === MAX_ROUNDS, v.puan, historian, input.brain);
          d.p.talk.push({ rol: "Şef", metin: chiefSays.karar === "kabul" ? `kabul${chiefSays.talimat ? ` (${chiefSays.talimat})` : ""}` : `revize: ${chiefSays.talimat}` });
        }
        if (v && passes(v) && chiefSays.karar === "revize") {
          d.p.feedback = `the team leader sent it back: ${chiefSays.talimat}`;
          d.p.problems.push(`tur ${round}: ${d.p.feedback}`);
          log(`  gardırop: "${d.p.order.tarif}" tur ${round} şef revize istedi — ${chiefSays.talimat}`);
        } else if (v && passes(v)) {
          const id = `${d.p.order.tarif.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${createHash("sha256").update(d.svg).digest("hex").slice(0, 6)}`;
          // Append-only: an existing file is never overwritten.
          const file = path.join(dir, `${id}.svg`);
          if (!existsSync(file)) await fs.writeFile(file, `${d.svg}\n`);
          await fs.writeFile(path.join(dir, `${id}.json`), `${JSON.stringify({ tarif: d.p.order.tarif, slot: d.p.order.slot, donem: input.donem, model: input.model.model ?? input.model.provider, denemeler: d.p.tries, hakem: v, ...(d.p.ref ? { referans: { baslik: d.p.ref.title, url: d.p.ref.url, tarif: d.p.ref.description } } : {}), tartisma: d.p.talk, olusturuldu: new Date().toISOString() }, null, 2)}\n`);
          items[id] = { slot: d.p.order.slot, ...(d.behind ? { behind: true } : {}), ...(d.grip ? { grip: true } : {}), not: d.p.order.tarif };
          made.set(key(d.p.order), id);
          records.push({ tarif: d.p.order.tarif, slot: d.p.order.slot, id, kaynak: "tasarim", denemeler: d.p.tries, secim: v });
          log(`  gardırop: "${d.p.order.tarif}" kabul (${v.puan}/10) → ${WARDROBE_PACK}/${id}`);
          d.p.tries = -1;
        } else {
          d.p.feedback = v ? `the art director scored it ${v.puan}/10: ${v.sorun} (seen: ${v.gosterilen})` : "the judge could not read it";
          d.p.problems.push(`tur ${round}: ${d.p.feedback}`);
          log(`  gardırop: "${d.p.order.tarif}" tur ${round} ret — ${d.p.feedback}`);
        }
      }
    }
    pending = pending.filter((p) => p.tries >= 0);
  }
  for (const p of pending) {
    made.set(key(p.order), undefined);
    records.push({ tarif: p.order.tarif, slot: p.order.slot, kaynak: "basarisiz", denemeler: p.tries, sorunlar: p.problems });
    await remember(paths.workRoot, { bolum: input.donem, beyin: "kostum", tur: "ders", konu: p.order.tarif, metin: `"${p.order.tarif}" was not accepted in ${MAX_ROUNDS} rounds; last problem: ${p.problems[p.problems.length - 1] ?? "unknown"}` }).catch(() => undefined);
    log(`⚠ gardırop: "${p.order.tarif}" ${MAX_ROUNDS} turda kabul edilmedi; bu parça kostümden çıkarıldı`);
  }
  if (input.brain) {
    for (const t of talks) input.brain.council.debate("kostum", `parça: ${t.order.tarif}`, t.talk);
    for (const p of pending) input.brain.council.find({ beyin: "kostum", onem: "eksik", baslik: "parça tasarlanamadı", ayrinti: `"${p.order.tarif}" ${MAX_ROUNDS} turda kabul edilmedi, kostümden çıkarıldı`, oneri: "tarifi sadeleştir ya da benzer bir kütüphane parçası kullan", tur: "veri", yer: p.order.tarif });
  }
  const manifest: CostumePackManifest = { ...library, items };
  await fs.writeFile(path.join(dir, "pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { made, records };
}
