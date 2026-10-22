import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import { EMOTIONS, GARMENTS, GESTURES } from "../episode/EpisodeTypes";
import { PART_FIELDS } from "../episode/EpisodeValidator";
import type { V3Emotion, V3Garment, V3Gesture } from "../render/RenderPlanTypes";

/**
 * Mechanical fixes to a script draft before validation, for slips a model repeats even when told (the Rubicon run
 * failed three repair rounds on them): the narrator made visible and dressed, garment names in English ("tunic"),
 * "none" in part fields, catalog items that do not exist ("sakal-gri"). A made-up part becomes an order for the
 * part designer instead of a broken reference. Content is never changed.
 */
const GARMENT_ALIASES: Readonly<Record<string, V3Garment>> = {
  tunic: "tunik",
  chiton: "tunik",
  toga: "toga",
  robe: "cubbe",
  gown: "elbise",
  dress: "elbise",
  armor: "zirh",
  armour: "zirh",
  apron: "onluk",
  plain: "sade",
  shirt: "sade",
  peasant: "sade",
  suit: "takim",
  uniform: "uniforma",
  "military uniform": "uniforma",
  coat: "ceket",
  jacket: "ceket",
  caftan: "kaftan",
  janissary: "yeniceri",
  "byzantine robe": "bizans",
};

/**
 * Emotions and gestures outside the rig's lists, by the words models use (the first AYAS order's three length rounds,
 * 22 Oct 2026, were all dropped over 13 such values on new lines: 249 of 423 words stayed). Turkish with its letters,
 * English, and common near-words; an unknown emotion is neutral, an unknown gesture is left out.
 */
const EMOTION_ALIASES: readonly [RegExp, V3Emotion][] = [
  [/^n[oö]tr|neutral|calm|plain/i, "notr"],
  [/mutlu|happy|amused|cheer|joy|glad|smug|proud|excit|delight|laugh/i, "mutlu"],
  [/k[ıi]zg[ıi]n|angry|anger|furious|mad|annoy|irritat|outrag/i, "kizgin"],
  [/[şs]a[şs]k[ıi]n|surpris|shock|astonish|amaz|confus|puzzl/i, "saskin"],
  [/korkmu[şs]|scared|afraid|fear|nervous|anxious|panic|worr/i, "korkmus"],
  [/[üu]zg[üu]n|sad|sorrow|gloom|disappoint|tired|weary/i, "uzgun"],
  [/karar|determin|confident|resolute|bold|serious|firm|stern/i, "kararli"],
  [/sinsi|sly|cunning|sneaky|scheming|sarcas|mischiev|smirk/i, "sinsi"],
];
const GESTURE_ALIASES: readonly [RegExp, V3Gesture][] = [
  [/isaret|point/i, "isaret_et"],
  [/el_?salla|wave/i, "el_salla"],
  [/omuz|shrug/i, "omuz_silk"],
  [/d[üu][şs][üu]n|think|ponder|chin/i, "dusun"],
  [/y[üu]z_?avu|facepalm|face_?palm/i, "yuz_avucla"],
  [/kutla|celebrat|cheer|triumph/i, "kutla"],
  [/yumruk|fist/i, "yumruk_kaldir"],
  [/e[ğg]il|bow/i, "egil"],
  [/kollar|cross|fold/i, "kollari_kavustur"],
  [/belde|hips/i, "elleri_belde"],
  [/sas[ıi]r|surpris|gasp|shock/i, "sasir"],
  [/konu[şs]|talk|speak|explain|gesture/i, "konus"],
];

const EMPTY = /^(none|no|null|yok|-|n\/a)?$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface NormalizedDraft {
  readonly value: unknown;
  readonly fixes: readonly string[];
}

export function normalizeDraft(raw: unknown, catalog: readonly PackCatalogEntry[]): NormalizedDraft {
  if (!isObj(raw)) return { value: raw, fixes: [] };
  const draft = JSON.parse(JSON.stringify(raw)) as Obj;
  const fixes: string[] = [];
  const known = new Set<string>();
  for (const p of catalog) for (const ids of Object.values(p.items)) for (const id of ids ?? []) known.add(`${p.pack}/${id}`);
  const defaultPack = catalog[0]?.pack ?? "";

  const fixCostume = (k: Obj, pack: string, where: string) => {
    const g = typeof k.giysi === "string" ? k.giysi.trim().toLowerCase() : "";
    if (g && !GARMENTS.includes(g as V3Garment)) {
      const mapped = GARMENT_ALIASES[g] ?? Object.entries(GARMENT_ALIASES).find(([alias]) => g.includes(alias))?.[1] ?? "sade";
      fixes.push(`${where}.giysi "${k.giysi}" → ${mapped}`);
      k.giysi = mapped;
    }
    for (const field of PART_FIELDS) {
      const v = k[field];
      if (v === undefined) continue;
      if (typeof v !== "string" || EMPTY.test(v.trim())) {
        fixes.push(`${where}.${field} boş değer silindi`);
        delete k[field];
        continue;
      }
      if (v.startsWith("yeni:")) continue;
      const ref = v.includes("/") ? v : `${pack}/${v}`;
      // An item of another pack written without its pack name.
      const elsewhere = v.includes("/") ? undefined : [...known].find((r) => r.endsWith(`/${v}`));
      if (!known.has(ref) && elsewhere) {
        fixes.push(`${where}.${field} "${v}" → ${elsewhere}`);
        k[field] = elsewhere;
      } else if (!known.has(ref)) {
        const order = `yeni:${v.replace(/^.*\//, "").replace(/[-_]+/g, " ").trim()}`;
        fixes.push(`${where}.${field} "${v}" katalogda yok → ${order}`);
        k[field] = order;
      }
    }
  };

  const cast = Array.isArray(draft.oyuncu_kadrosu) ? (draft.oyuncu_kadrosu as unknown[]) : [];
  for (const [i, c] of cast.entries()) {
    if (!isObj(c)) continue;
    const where = `oyuncu_kadrosu[${i}]`;
    const narrator = c.id === "anlatici" || /narrator|anlat/i.test(String(c.id ?? ""));
    if (narrator) {
      if (c.gorunur !== false || c.kostum !== undefined || c.portre !== undefined) fixes.push(`${where} anlatıcı görünmez yapıldı`);
      c.gorunur = false;
      c.kostum_paketi = "";
      delete c.kostum;
      delete c.portre;
      continue;
    }
    if (c.gorunur === true && (typeof c.kostum_paketi !== "string" || !c.kostum_paketi.trim())) {
      c.kostum_paketi = defaultPack;
      fixes.push(`${where}.kostum_paketi → ${defaultPack}`);
    }
    if (isObj(c.kostum)) fixCostume(c.kostum, String(c.kostum_paketi ?? defaultPack), `${where}.kostum`);
  }
  const visible = new Set(cast.filter((c) => isObj(c) && c.gorunur === true).map((c) => String((c as Obj).id)));
  const scenes = Array.isArray(draft.sahneler) ? (draft.sahneler as unknown[]) : [];
  for (const [si, s] of scenes.entries()) {
    if (!isObj(s)) continue;
    for (const [li, l] of (Array.isArray(s.satirlar) ? (s.satirlar as unknown[]) : []).entries()) {
      if (!isObj(l)) continue;
      const where = `sahneler[${si}].satirlar[${li}]`;
      if (typeof l.duygu === "string" && !EMOTIONS.includes(l.duygu as V3Emotion)) {
        const mapped = EMOTION_ALIASES.find(([re]) => re.test(l.duygu as string))?.[1] ?? "notr";
        fixes.push(`${where}.duygu "${l.duygu}" → ${mapped}`);
        l.duygu = mapped;
      }
      if (typeof l.jest === "string" && !GESTURES.includes(l.jest as V3Gesture)) {
        const mapped = GESTURE_ALIASES.find(([re]) => re.test(l.jest as string))?.[1];
        fixes.push(`${where}.jest "${l.jest}" → ${mapped ?? "silindi"}`);
        if (mapped) l.jest = mapped;
        else delete l.jest;
      }
    }
    if (Array.isArray(s.sahne_duzeni)) {
      const before = s.sahne_duzeni.length;
      s.sahne_duzeni = (s.sahne_duzeni as unknown[]).filter((b) => isObj(b) && visible.has(String(b.karakter)));
      if ((s.sahne_duzeni as unknown[]).length !== before) fixes.push(`sahneler[${si}].sahne_duzeni görünmeyen karakter silindi`);
    }
    if (!Array.isArray(s.kalabalik)) continue;
    for (const [gi, g] of (s.kalabalik as unknown[]).entries()) {
      if (!isObj(g)) continue;
      if (typeof g.kostum_paketi !== "string" || !g.kostum_paketi.trim()) g.kostum_paketi = defaultPack;
      if (isObj(g.kostum)) fixCostume(g.kostum, String(g.kostum_paketi), `sahneler[${si}].kalabalik[${gi}].kostum`);
    }
  }
  return { value: draft, fixes };
}
