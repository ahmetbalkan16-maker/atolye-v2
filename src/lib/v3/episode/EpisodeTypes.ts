/**
 * Atölye V3 episode contract (`episode.json`). Keys are Turkish on purpose: the script writer (LLM or human)
 * works in Turkish and the file is meant to be read and edited by the owner. JSON Schema:
 * `docs/v3/episode.schema.json`; validator: `EpisodeValidator.ts`.
 */
import type { V3Age, V3Effect, V3Emotion, V3EyeStyle, V3FaceShape, V3Garment, V3Gesture, V3HairStyle, V3Nose, V3Prop, V3Transition } from "../render/RenderPlanTypes";

export const EPISODE_TONES = ["mizahi", "ciddi", "epik"] as const;
export const SCENE_MOODS = ["gerilim", "komik", "huzun", "zafer", "gizem", "merak"] as const;
export const EMOTIONS: readonly V3Emotion[] = ["notr", "mutlu", "kizgin", "saskin", "korkmus", "uzgun", "kararli", "sinsi"];
export const GESTURES: readonly V3Gesture[] = ["konus", "isaret_et", "el_salla", "sasir", "egil", "kollari_kavustur", "dusun", "omuz_silk", "yumruk_kaldir", "elleri_belde", "yuz_avucla", "kutla"];
export const MOVES = ["yuru", "kos", "dur", "gir", "cik"] as const;
export const EFFECTS: readonly V3Effect[] = ["ter", "unlem", "soru", "ofke", "parilti", "kalp"];
export const GARMENTS: readonly V3Garment[] = ["kaftan", "cubbe", "zirh", "onluk", "bizans", "yeniceri", "sade", "tunik", "toga", "ceket", "uniforma", "takim", "elbise"];
export const PROP_KINDS: readonly V3Prop["kind"][] = ["taht", "top", "kule_iskelesi", "gemi", "masa", "sancak"];
export const TRANSITIONS: readonly V3Transition[] = ["kes", "kaydir", "murekkep", "beyaz"];
export const HAIR_STYLES: readonly V3HairStyle[] = ["kisa", "dalgali", "yan_ayrik", "uzun", "topuz", "orgu", "kel", "kivircik", "kakul", "geriye", "seyrek"];
export const FACE_SHAPES: readonly V3FaceShape[] = ["yuvarlak", "oval", "uzun", "genis", "kare"];
export const NOSES: readonly V3Nose[] = ["yok", "kucuk", "duz", "iri", "kemerli", "kalkik"];
export const EYE_STYLES: readonly V3EyeStyle[] = ["nokta", "detayli"];
export const AGES: readonly V3Age[] = ["genc", "orta", "yasli"];
export const SFX_IDS = ["whoosh", "pop", "boing", "kilic", "top_atisi", "davul", "kalabalik", "cekic", "dalga", "zil"] as const;

export type EpisodeTone = (typeof EPISODE_TONES)[number];
export type SceneMood = (typeof SCENE_MOODS)[number];
export type LineMove = (typeof MOVES)[number];
export type SfxId = (typeof SFX_IDS)[number];

export interface EpisodeSource {
  readonly id: string;
  readonly kunye: string;
  readonly url?: string;
}

export interface CastCostume {
  readonly giysi: V3Garment;
  readonly renkler: { readonly ana: string; readonly ikincil: string; readonly ic: string; readonly sus: string };
  readonly bas?: string;
  readonly sakal?: string;
  readonly biyik?: string;
  readonly el_on?: string;
  readonly el_arka?: string;
  readonly sirt?: string;
  readonly yaka?: "kurk" | "yok";
  readonly ayakkabi: string;
  readonly sac?: { readonly stil: V3HairStyle; readonly renk: string };
  /** A drawn haircut (catalog item or "yeni:<description>") instead of the parametric "sac". */
  readonly sac_parca?: string;
  /** Worn on the chest: chain of office, sash, medals, pendant (catalog item or "yeni:<description>"). */
  readonly gogus?: string;
  /** The drawn likeness of a real person, read from their portrait (see LikenessDesigner). */
  readonly yuz?: CastFace;
}

export interface CastFace {
  readonly sekil?: V3FaceShape;
  readonly ten?: string;
  readonly burun?: V3Nose;
  readonly goz?: V3EyeStyle;
  readonly kas_renk?: string;
  readonly yas?: V3Age;
}

export interface CastEntry {
  readonly id: string;
  readonly ad: string;
  readonly rol: string;
  /** Costume pack folder; empty for the off-screen narrator. */
  readonly kostum_paketi: string;
  readonly renk: string;
  readonly ses_id: string;
  readonly konusma_tarzi: string;
  /** false for the narrator, who is heard but never drawn. */
  readonly gorunur: boolean;
  readonly kostum?: CastCostume;
  readonly olcek?: number;
  /**
   * A real historical person: their portrait (English Wikipedia article) is looked at, and their head and clothes are
   * drawn after it in the house style (face shape, hair, beard, headwear, garment) — never a photo on the puppet.
   */
  readonly portre?: { readonly wiki: string };
}

export interface SceneBackgroundQuery {
  readonly tr: string;
  /** Search for a period image (artwork, engraving, map, period photo) of the scene's place or subject. */
  readonly en: string;
  /** Exact English Wikipedia article title of the place/subject: its images are searched first. */
  readonly wiki?: string;
  /** 1–3 more searches: historical spellings and the names travellers and artists used ("Roumeli Hissar"). */
  readonly ara?: readonly string[];
  /**
   * The drawn set as it looked in the period, in English (for the background designer when no period image
   * exists): place, time of day, period architecture/vessels/objects, and what must not appear.
   */
  readonly tasarim?: string;
  readonly commons_kategori?: string;
  /** Existing local SDXL theme (cache) or a new prompt theme id. */
  readonly yerel_tema?: string;
  /** Explicit asset already resolved (relative to the episode work dir), e.g. a Commons map. */
  readonly dosya?: string;
  readonly tur?: "set" | "archival";
}

export interface SceneCameraCue {
  readonly tip: "zoom" | "pan" | "shake" | "cut";
  /** Seconds from the scene start. */
  readonly t: number;
  readonly hedef?: string;
}

/**
 * Arrows over an archival map image (points 0..1 in the image), or — with `merkez` and `genislik_km` — a drawn
 * geographic map (Natural Earth): points are [lon, lat]; territories, cities and armies are drawn on it, each appearing
 * with line `satir` of the scene.
 */
export interface SceneMap {
  readonly oklar?: readonly { readonly noktalar: readonly [number, number][]; readonly renk?: string; readonly etiket?: string; readonly satir?: number }[];
  /** Centre of the view, [lon, lat]. */
  readonly merkez?: readonly [number, number];
  /** Width of the view in km (city ~150, region ~800, Mediterranean ~3500, world ~30000). */
  readonly genislik_km?: number;
  /** Territories: modern countries by ISO 3166 alpha-3 code and/or a rough [lon, lat] outline (clipped to the coast). */
  readonly bolgeler?: readonly { readonly ad: string; readonly renk: string; readonly ulkeler?: readonly string[]; readonly noktalar?: readonly [number, number][]; readonly etiket_konum?: readonly [number, number]; readonly satir?: number }[];
  readonly sehirler?: readonly { readonly ad: string; readonly konum: readonly [number, number] }[];
  readonly ordular?: readonly { readonly ad: string; readonly konum: readonly [number, number]; readonly renk: string; readonly satir?: number }[];
}

export interface SceneTitleCard {
  readonly metin: string;
  readonly alt_metin?: string;
  /** kelime: one big word full screen on black ("CRISIS"), the hard-cut emphasis of the reference channel. */
  readonly stil: "yer_tarih" | "bolum" | "bilgi" | "kelime";
  /** Index of the line the card appears with (default 0). */
  readonly satir?: number;
}

export interface SceneBlocking {
  readonly karakter: string;
  readonly x: number;
  readonly derinlik?: number;
  readonly yon?: "sol" | "sag";
  readonly oturuyor?: boolean;
}

export interface SceneProp {
  readonly tur: V3Prop["kind"];
  readonly x: number;
  readonly derinlik?: number;
  readonly olcek?: number;
  readonly ters?: boolean;
}

/**
 * Extras that make a scene feel big (an army, a council, a work crew): one costume, many copies standing in rows
 * behind the actors. They never speak.
 */
export interface SceneCrowd {
  /** What they are, e.g. "Ottoman workers" (for the log). */
  readonly ad: string;
  readonly kostum_paketi: string;
  readonly kostum: CastCostume;
  /** 2–40. */
  readonly sayi: number;
  /** sira: one or two rows; meclis: benches of a council; ordu: a dense block of soldiers. */
  readonly duzen: "sira" | "meclis" | "ordu";
  readonly taraf?: "sol" | "sag" | "tum";
  readonly ruh_hali?: "notr" | "coskulu" | "korkmus";
}

export interface SceneLine {
  readonly karakter: string;
  readonly metin: string;
  readonly duygu: V3Emotion;
  readonly jest?: V3Gesture;
  readonly hareket?: LineMove;
  /** Target x (0..1) for yuru/kos/gir, or a cast id to walk to / point at. */
  readonly hedef?: string | number;
  readonly sfx?: SfxId;
  readonly efekt?: V3Effect;
  /** Source ids from `kaynaklar` that support a factual claim in this line. */
  readonly kaynak?: readonly string[];
  /** Dramatised dialogue (not a historical quotation). */
  readonly kurgu?: boolean;
  /** Disputed or traditional account: the line says so ("rivayete göre"). */
  readonly rivayet?: boolean;
  /** Words to tint in captions. */
  readonly vurgu?: readonly string[];
  /**
   * Speech bubble over a visible character while the line is spoken: the joke's punchline or the line's key
   * phrase, at most 8 words. Burned-in captions are gone, so only these lines show text on screen.
   */
  readonly balon?: string;
}

export interface EpisodeScene {
  readonly id: string;
  readonly sure_hedef: number;
  readonly mekan: string;
  readonly arka_plan_sorgusu: SceneBackgroundQuery;
  readonly duygu: SceneMood;
  readonly muzik_ruh_hali: string;
  readonly kamera?: readonly SceneCameraCue[];
  readonly harita?: SceneMap;
  readonly yazi_karti?: readonly SceneTitleCard[];
  readonly sahne_duzeni?: readonly SceneBlocking[];
  readonly dekor?: readonly SceneProp[];
  readonly kalabalik?: readonly SceneCrowd[];
  readonly gecis?: V3Transition;
  readonly satirlar: readonly SceneLine[];
}

export interface Episode {
  readonly id: string;
  readonly baslik: string;
  readonly konu: string;
  readonly donem: string;
  readonly hedef_sure_sn: number;
  readonly ton: EpisodeTone;
  readonly kaynaklar: readonly EpisodeSource[];
  readonly oyuncu_kadrosu: readonly CastEntry[];
  readonly sahneler: readonly EpisodeScene[];
}
