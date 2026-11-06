import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import { ARCH_STYLES, BUILDING_KINDS, type BuildingKind, EFFECTS, EMOTIONS, GARMENTS, GESTURES, LANDSCAPES, SCENE_MOODS, SET_LIGHTS, SFX_IDS, type SfxId, TIMES_OF_DAY, WEATHERS } from "../episode/EpisodeTypes";
import { PART_FIELDS } from "../episode/EpisodeValidator";
import { periodEndYear } from "../episode/Period";
import { capUnitBlocks, clearBattleCards, fitBattleMap, narrateMoves, resolveTactics } from "../maps/Tactics";
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
 * Sound effects outside the library, by the words models use (the Caesar Short remake, 2 Nov 2026: all three length
 * rounds were dropped over seven such names, and the video stayed at 36.9 s of 60). An unknown one is left out.
 */
const SFX_ALIASES: readonly [RegExp, SfxId][] = [
  [/swoosh|whoosh|swish|fast|zoom|wind/i, "whoosh"],
  [/pop|plop|blip/i, "pop"],
  [/boing|spring|bounce|cartoon/i, "boing"],
  [/sword|blade|kilic|kılıç|unsheath|slash/i, "kilic"],
  [/cannon|top_?at|explo|boom|blast|gun/i, "top_atisi"],
  [/drum|davul|war_?drum/i, "davul"],
  [/crowd|kalabal|cheer|laugh|murmur|applause|gasp|people/i, "kalabalik"],
  [/hammer|anvil|cekic|çekiç|chain|metal|clank/i, "cekic"],
  [/wave|sea|ocean|dalga|splash_?sea|ship|creak/i, "dalga"],
  [/bell|zil|chime|ding/i, "zil"],
  [/punch|yumruk|hit|slap|smack|thump/i, "yumruk"],
  [/fall|thud|d[üu][şs]|collapse|drop/i, "dusus"],
  [/step|foot|adim|adım|march|walk/i, "adim"],
  [/door|kap[ıi]|gate|knock/i, "kapi"],
  [/coin|money|para|gold|cash|jingle|dice|talent/i, "para"],
  [/paper|scroll|book|ka[gğ][ıi]t|letter|quill|page/i, "kagit"],
  [/success|ba[şs]ar|win|tada|fanfare|triumph/i, "basari"],
  [/fail|hata|wah|sad_?trombone|oops|buzz/i, "hata"],
  [/water|splash|su\b|river|wade/i, "su"],
];

const SHIP = /\bships?\b|galley|trireme|bireme|\bboat\b|vessel|frigate|caravel|galleon|\bgemi|kadırga|kadirga/i;
const ON_SHORE = /harbou?r|\bport\b|\bdocks?\b|quay|wharf|\bpier\b|shore|beach|liman|rıhtım|rihtim|iskele|kıyı|kiyi|sahil/i;

/**
 * The ship set a scene's place names: its cabin (a cabin or hold of a ship, below deck), its deck (on deck, aboard, or
 * a ship named with no harbour or shore beside it), else undefined. A log cabin or a harbour full of ships stays ashore.
 */
export function shipboardSet(mekan: string): "gemi_guvertesi" | "gemi_kamarasi" | undefined {
  if (/below.?decks?/i.test(mekan) || (/\bcabin\b|\bhold\b|kamara|ambar/i.test(mekan) && SHIP.test(mekan))) return "gemi_kamarasi";
  if (/\bdeck\b|aboard|on board|güverte|guverte|gemide/i.test(mekan) || (SHIP.test(mekan) && !ON_SHORE.test(mekan))) return "gemi_guvertesi";
  return undefined;
}

/**
 * A set's and a scene's values outside their lists, by the words models use (the 1456 Belgrade run, 23 Oct 2026: three
 * length rounds were lost over "ortam" and "duygu" values, so the map repairs were never asked). Checked in order; an
 * unknown value takes the field's first fallback.
 */
const SET_ALIASES: Readonly<Record<string, { readonly list: readonly string[]; readonly words: readonly [RegExp, string][]; readonly fallback: string }>> = {
  zaman: { list: TIMES_OF_DAY, words: [[/dawn|sunrise|morning twilight|şafak|safak/i, "safak"], [/even|dusk|sunset|twilight|akşam|aksam/i, "aksam"], [/night|midnight|gece/i, "gece"], [/day|noon|morning|afternoon|gün|gun/i, "gun"]], fallback: "gun" },
  manzara: {
    list: LANDSCAPES,
    words: [[/cabin|below.?decks?|kamara/i, "gemi_kamarasi"], [/deck|ship|galley|trireme|aboard|güverte|guverte|gemi/i, "gemi_guvertesi"], [/ford|crossing|geçit|gecit/i, "nehir_gecidi"], [/river|bank|kıyı|kiyi/i, "nehir_kiyisi"], [/wall|rampart|fortress|castle|citadel|gate|siege|bastion|sur|kale/i, "sur_onu"], [/inside.{0,20}tent|tent.{0,10}(interior|inside)|pavilion|otağ|otag|çadır içi|cadir ici|sultan.{0,3}s tent|commander.{0,3}s tent|war tent/i, "cadir_ici"], [/camp|tent|bivouac|ordu/i, "ordugah"], [/palace|throne|court|saray/i, "saray_ici"], [/council|hall|senate|chamber|assembly|meclis/i, "meclis"], [/square|forum|market|meydan/i, "meydan"], [/street|city|town|alley|sokak/i, "sokak"], [/beach|coast|shore|harbou?r|port|sea|sahil/i, "sahil"], [/forest|wood|orman/i, "orman"], [/hill|mountain|pass|valley|tepe/i, "tepeler"], [/plain|field|steppe|battle|ova/i, "ova"]],
    fallback: "ova",
  },
  uslup: { list: ARCH_STYLES, words: [[/roman|roma/i, "roma"], [/greek|yunan/i, "yunan"], [/egypt|mısır|misir/i, "misir"], [/persia|pers/i, "pers"], [/byzant|bizans/i, "bizans"], [/ottoman|osman|turk/i, "osmanli"], [/china|chinese|çin|cin/i, "cin"], [/japan|japon/i, "japon"], [/renaiss|early.?modern|baroque|17|18/i, "erken_modern"], [/modern|19|20|21/i, "modern"], [/medieval|gothic|crusad|hungar|europe|ortaçağ|ortacag/i, "ortacag"]], fallback: "ortacag" },
  hava: { list: WEATHERS, words: [[/snow|kar/i, "kar"], [/rain|storm|yağmur|yagmur/i, "yagmur"], [/fog|mist|smok|haz|sis/i, "sis"], [/cloud|overcast|grey|gray|bulut/i, "bulutlu"], [/clear|sun|fair|açık|acik/i, "acik"]], fallback: "acik" },
  isik: { list: SET_LIGHTS, words: [[/camp.?fire|bonfire|fire|kamp/i, "kamp_atesi"], [/torch|lamp|candle|lantern|meşale|mesale/i, "mesale"]], fallback: "yok" },
};
const MOOD_ALIASES: readonly [RegExp, string][] = [[/tens|suspens|danger|war|battle|siege|fear|dark|dramatic|gerilim/i, "gerilim"], [/funny|humou?r|comic|comedy|playful|silly|komik/i, "komik"], [/sad|grief|tragic|loss|melanchol|hüzün|huzun/i, "huzun"], [/victor|triumph|celebrat|glory|hope|joy|zafer/i, "zafer"], [/myster|secret|unknown|gizem/i, "gizem"], [/curio|wonder|intrigu|merak/i, "merak"]];

/**
 * A close map's building kinds by the words models use (the first Zanzibar Short, 3 Nov 2026: one building's "tur"
 * outside the list failed three repair rounds and threw the whole draft away). A kind with no near word is left out
 * of the map — one building less, never a lost script.
 */
const BUILDING_ALIASES: readonly [RegExp, BuildingKind][] = [
  [/tent|pavilion|yurt|camp|otağ|otag|çadır|cadir/i, "otag"],
  [/mosque|minaret|masjid|cami|mescit/i, "cami"],
  [/church|cathedral|basilica|abbey|monaster|chapel|temple|kilise|katedral|manast/i, "kilise"],
  [/tower|lighthouse|belfry|keep|kule|fener/i, "kule"],
  [/palace|harem|residence|court|villa|mansion|consulate|embassy|saray|konak/i, "saray"],
  [/fort|castle|citadel|stronghold|bastion|battery|barracks|wall|kale|hisar|sur\b/i, "kale"],
];

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
      // A line's acts: only drawn characters act; a gesture or face by its near word, an unknown effect left out.
      if (Array.isArray(l.oyun)) {
        const drawn = new Set((Array.isArray(draft.oyuncu_kadrosu) ? (draft.oyuncu_kadrosu as unknown[]) : []).filter(isObj).filter((c) => c.gorunur !== false && c.id !== "anlatici").map((c) => c.id));
        const acts = (l.oyun as unknown[]).filter((a): a is Obj => isObj(a) && typeof a.karakter === "string" && drawn.has(a.karakter));
        for (const a of acts) {
          if (typeof a.jest === "string" && !GESTURES.includes(a.jest as V3Gesture)) a.jest = GESTURE_ALIASES.find(([re]) => re.test(a.jest as string))?.[1];
          if (typeof a.duygu === "string" && !EMOTIONS.includes(a.duygu as V3Emotion)) a.duygu = EMOTION_ALIASES.find(([re]) => re.test(a.duygu as string))?.[1];
          if (typeof a.efekt === "string" && !(EFFECTS as readonly string[]).includes(a.efekt)) a.efekt = undefined;
          for (const k of ["jest", "duygu", "efekt"]) if (a[k] === undefined) delete a[k];
        }
        if (acts.length !== l.oyun.length) fixes.push(`${where}.oyun: ${l.oyun.length - acts.length} oyun çıkarıldı (görünür karakter değil)`);
        l.oyun = acts;
      }
      if (typeof l.sfx === "string" && !(SFX_IDS as readonly string[]).includes(l.sfx)) {
        const mapped = SFX_ALIASES.find(([re]) => re.test(l.sfx as string))?.[1];
        fixes.push(`${where}.sfx "${l.sfx}" → ${mapped ?? "silindi"}`);
        if (mapped) l.sfx = mapped;
        else delete l.sfx;
      }
    }
    if (typeof s.duygu === "string" && !(SCENE_MOODS as readonly string[]).includes(s.duygu)) {
      const mapped = MOOD_ALIASES.find(([re]) => re.test(s.duygu as string))?.[1] ?? "merak";
      fixes.push(`sahneler[${si}].duygu "${s.duygu}" → ${mapped}`);
      s.duygu = mapped;
    }
    // A scene inside a tent the writer set in the camp outside (Kosovo 1389: "Murad's tent, midday" drawn as a sunny camp).
    if (isObj(s.ortam) && s.ortam.manzara === "ordugah" && typeof s.mekan === "string" && /\btent\b|\bpavilion\b|otağ|otag|çadır|cadir/i.test(s.mekan) && !/\bcamp\b|ordugâh|ordugah/i.test(s.mekan)) {
      fixes.push(`sahneler[${si}].ortam.manzara ordugah → cadir_ici ("${s.mekan}")`);
      s.ortam.manzara = "cadir_ici";
    }
    if (isObj(s.ortam))
      for (const [field, rule] of Object.entries(SET_ALIASES)) {
        const v = s.ortam[field];
        if (typeof v !== "string" || rule.list.includes(v)) continue;
        const mapped = rule.words.find(([re]) => re.test(v))?.[1] ?? rule.fallback;
        fixes.push(`sahneler[${si}].ortam.${field} "${v}" → ${mapped}`);
        s.ortam[field] = mapped;
      }
    // A scene aboard a ship the writer set on land (Caesar and the pirates, 2 Nov 2026: "Pirate ship cabin" drawn as a
    // plain with a village). A ship set the writer chose stays.
    const aboard = isObj(s.ortam) && typeof s.mekan === "string" ? shipboardSet(s.mekan) : undefined;
    if (aboard && isObj(s.ortam) && !String(s.ortam.manzara).startsWith("gemi_")) {
      fixes.push(`sahneler[${si}].ortam.manzara ${String(s.ortam.manzara)} → ${aboard} ("${String(s.mekan)}")`);
      s.ortam.manzara = aboard;
    }
    if (isObj(s.harita) && Array.isArray(s.harita.yapilar)) {
      const kept: unknown[] = [];
      for (const [yi, y] of (s.harita.yapilar as unknown[]).entries()) {
        if (!isObj(y) || typeof y.tur !== "string" || (BUILDING_KINDS as readonly string[]).includes(y.tur)) {
          kept.push(y);
          continue;
        }
        const mapped = BUILDING_ALIASES.find(([re]) => re.test(y.tur as string))?.[1];
        fixes.push(`sahneler[${si}].harita.yapilar[${yi}].tur "${y.tur}" → ${mapped ?? "silindi"}`);
        if (mapped) kept.push({ ...y, tur: mapped });
      }
      s.harita.yapilar = kept;
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
      // Lines deep belong to a front only (a unit placed by its wing or its move gets one); a side cannot break where
      // it first stands.
      for (const y of yerler)
        if (y.hatlar !== undefined && (y.kume !== undefined || y.kusatma !== undefined)) {
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
    // The close battle's order and moves: wings and screens round each side's center, charges and sweeps where the
    // narration takes them (Tactics.resolveTactics); a formation the writer gave is kept.
    if (isObj(s.harita)) {
      const where = `sahneler[${si}].harita`;
      const written = typeof s.harita.genislik_km === "number" ? s.harita.genislik_km : undefined;
      fixes.push(...capUnitBlocks(s.harita, where), ...narrateMoves(s, where), ...clearBattleCards(s, `sahneler[${si}]`), ...fitBattleMap(s.harita, where));
      fixes.push(...resolveTactics(s.harita, where, typeof draft.donem === "string" ? periodEndYear(draft.donem) : undefined));
      fixes.push(...fitBattleMap(s.harita, where, written));
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
