import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import { ARCH_STYLES, EMOTIONS, GARMENTS, GESTURES, LANDSCAPES, SCENE_MOODS, SET_LIGHTS, TIMES_OF_DAY, WEATHERS } from "../episode/EpisodeTypes";
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

/**
 * A set's and a scene's values outside their lists, by the words models use (the 1456 Belgrade run, 23 Oct 2026: three
 * length rounds were lost over "ortam" and "duygu" values, so the map repairs were never asked). Checked in order; an
 * unknown value takes the field's first fallback.
 */
const SET_ALIASES: Readonly<Record<string, { readonly list: readonly string[]; readonly words: readonly [RegExp, string][]; readonly fallback: string }>> = {
  zaman: { list: TIMES_OF_DAY, words: [[/dawn|sunrise|morning twilight|şafak|safak/i, "safak"], [/even|dusk|sunset|twilight|akşam|aksam/i, "aksam"], [/night|midnight|gece/i, "gece"], [/day|noon|morning|afternoon|gün|gun/i, "gun"]], fallback: "gun" },
  manzara: {
    list: LANDSCAPES,
    words: [[/ford|crossing|geçit|gecit/i, "nehir_gecidi"], [/river|bank|kıyı|kiyi/i, "nehir_kiyisi"], [/wall|rampart|fortress|castle|citadel|gate|siege|bastion|sur|kale/i, "sur_onu"], [/camp|tent|bivouac|ordu/i, "ordugah"], [/palace|throne|court|saray/i, "saray_ici"], [/council|hall|senate|chamber|assembly|meclis/i, "meclis"], [/square|forum|market|meydan/i, "meydan"], [/street|city|town|alley|sokak/i, "sokak"], [/beach|coast|shore|harbou?r|port|sea|sahil/i, "sahil"], [/forest|wood|orman/i, "orman"], [/hill|mountain|pass|valley|tepe/i, "tepeler"], [/plain|field|steppe|battle|ova/i, "ova"]],
    fallback: "ova",
  },
  uslup: { list: ARCH_STYLES, words: [[/roman|roma/i, "roma"], [/greek|yunan/i, "yunan"], [/egypt|mısır|misir/i, "misir"], [/persia|pers/i, "pers"], [/byzant|bizans/i, "bizans"], [/ottoman|osman|turk/i, "osmanli"], [/china|chinese|çin|cin/i, "cin"], [/japan|japon/i, "japon"], [/renaiss|early.?modern|baroque|17|18/i, "erken_modern"], [/modern|19|20|21/i, "modern"], [/medieval|gothic|crusad|hungar|europe|ortaçağ|ortacag/i, "ortacag"]], fallback: "ortacag" },
  hava: { list: WEATHERS, words: [[/snow|kar/i, "kar"], [/rain|storm|yağmur|yagmur/i, "yagmur"], [/fog|mist|smok|haz|sis/i, "sis"], [/cloud|overcast|grey|gray|bulut/i, "bulutlu"], [/clear|sun|fair|açık|acik/i, "acik"]], fallback: "acik" },
  isik: { list: SET_LIGHTS, words: [[/camp.?fire|bonfire|fire|kamp/i, "kamp_atesi"], [/torch|lamp|candle|lantern|meşale|mesale/i, "mesale"]], fallback: "yok" },
};
const MOOD_ALIASES: readonly [RegExp, string][] = [[/tens|suspens|danger|war|battle|siege|fear|dark|dramatic|gerilim/i, "gerilim"], [/funny|humou?r|comic|comedy|playful|silly|komik/i, "komik"], [/sad|grief|tragic|loss|melanchol|hüzün|huzun/i, "huzun"], [/victor|triumph|celebrat|glory|hope|joy|zafer/i, "zafer"], [/myster|secret|unknown|gizem/i, "gizem"], [/curio|wonder|intrigu|merak/i, "merak"]];

/** The formation keys of a side's tokens, which belong inside each of its "yerler". */
const FORMATION_KEYS = ["cephe", "kume", "kusatma"] as const;

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
    if (typeof s.duygu === "string" && !(SCENE_MOODS as readonly string[]).includes(s.duygu)) {
      const mapped = MOOD_ALIASES.find(([re]) => re.test(s.duygu as string))?.[1] ?? "merak";
      fixes.push(`sahneler[${si}].duygu "${s.duygu}" → ${mapped}`);
      s.duygu = mapped;
    }
    if (isObj(s.ortam))
      for (const [field, rule] of Object.entries(SET_ALIASES)) {
        const v = s.ortam[field];
        if (typeof v !== "string" || rule.list.includes(v)) continue;
        const mapped = rule.words.find(([re]) => re.test(v))?.[1] ?? rule.fallback;
        fixes.push(`sahneler[${si}].ortam.${field} "${v}" → ${mapped}`);
        s.ortam[field] = mapped;
      }
    // Tokens whose formation was written on the side instead of in its "yerler" (the Belgrade run: "kusatma", "km"
    // and "kayip" beside "yerler", so the siege had no ring and no losses): moved into the formations that lack one,
    // the losses to the last formation.
    const sides = isObj(s.harita) && Array.isArray(s.harita.birlikler) ? (s.harita.birlikler as unknown[]) : [];
    for (const [ui, u] of sides.entries()) {
      if (!isObj(u)) continue;
      const where = `sahneler[${si}].harita.birlikler[${ui}]`;
      const yerler = Array.isArray(u.yerler) ? (u.yerler as unknown[]).filter(isObj) : [];
      const onSide = FORMATION_KEYS.find((key) => u[key] !== undefined);
      if (onSide && !yerler.length) yerler.push({ satir: 0 });
      for (const y of yerler) {
        if (FORMATION_KEYS.some((key) => y[key] !== undefined)) continue;
        if (onSide) {
          y[onSide] = u[onSide];
          if (u.km !== undefined && y.km === undefined && onSide !== "cephe") y.km = u.km;
          fixes.push(`${where}: "${onSide}" yerler içine taşındı`);
        } else if (Array.isArray(y.konum)) {
          // A place without a formation is a cluster there.
          y.kume = y.konum;
          fixes.push(`${where}: "konum" → "kume"`);
        }
        delete y.konum;
      }
      if (typeof u.kayip === "number" && !yerler.some((y) => typeof y.kayip === "number") && yerler.length) {
        yerler[yerler.length - 1]!.kayip = u.kayip;
        fixes.push(`${where}: "kayip" son yere taşındı`);
      }
      // Lines deep belong to a front only; a side cannot break where it first stands.
      for (const y of yerler)
        if (y.hatlar !== undefined && y.cephe === undefined) {
          delete y.hatlar;
          fixes.push(`${where}: cephesiz "hatlar" silindi`);
        }
      if (yerler[0]?.bozgun !== undefined) {
        delete yerler[0].bozgun;
        fixes.push(`${where}: ilk yerdeki "bozgun" silindi`);
      }
      for (const key of [...FORMATION_KEYS, "km", "kayip", "konum"]) delete u[key];
      if (yerler.length) u.yerler = yerler;
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
