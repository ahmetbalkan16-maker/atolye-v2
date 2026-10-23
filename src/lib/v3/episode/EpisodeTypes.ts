/**
 * Atölye V3 episode contract (`episode.json`). Keys are Turkish on purpose: the script writer (LLM or human)
 * works in Turkish and the file is meant to be read and edited by the owner. JSON Schema:
 * `docs/v3/episode.schema.json`; validator: `EpisodeValidator.ts`.
 */
import type { V3Age, V3ArchStyle, V3Effect, V3Emotion, V3EyeStyle, V3FaceShape, V3Garment, V3Gesture, V3HairStyle, V3Landscape, V3Nose, V3Prop, V3SetLight, V3TimeOfDay, V3Transition, V3Weather } from "../render/RenderPlanTypes";

export const EPISODE_TONES = ["mizahi", "ciddi", "epik"] as const;
export const SCENE_MOODS = ["gerilim", "komik", "huzun", "zafer", "gizem", "merak"] as const;
export const EMOTIONS: readonly V3Emotion[] = ["notr", "mutlu", "kizgin", "saskin", "korkmus", "uzgun", "kararli", "sinsi"];
export const GESTURES: readonly V3Gesture[] = ["konus", "isaret_et", "el_salla", "sasir", "egil", "kollari_kavustur", "dusun", "omuz_silk", "yumruk_kaldir", "elleri_belde", "yuz_avucla", "kutla"];
export const MOVES = ["yuru", "kos", "dur", "gir", "cik"] as const;
export const EFFECTS: readonly V3Effect[] = ["ter", "unlem", "soru", "ofke", "parilti", "kalp"];
export const GARMENTS: readonly V3Garment[] = ["kaftan", "cubbe", "zirh", "onluk", "bizans", "yeniceri", "sade", "tunik", "toga", "ceket", "uniforma", "takim", "elbise"];
export const PROP_KINDS: readonly V3Prop["kind"][] = ["taht", "top", "kule_iskelesi", "gemi", "masa", "sancak"];
export const TRANSITIONS: readonly V3Transition[] = ["kes", "kaydir", "murekkep", "beyaz"];
export const TIMES_OF_DAY: readonly V3TimeOfDay[] = ["gun", "aksam", "gece", "safak"];
export const LANDSCAPES: readonly V3Landscape[] = ["nehir_kiyisi", "nehir_gecidi", "ova", "tepeler", "orman", "sahil", "sokak", "meydan", "saray_ici", "meclis", "ordugah", "sur_onu"];
export const ARCH_STYLES: readonly V3ArchStyle[] = ["roma", "yunan", "misir", "pers", "bizans", "osmanli", "ortacag", "cin", "japon", "erken_modern", "modern"];
export const WEATHERS: readonly V3Weather[] = ["acik", "bulutlu", "sis", "yagmur", "kar"];
export const SET_LIGHTS: readonly V3SetLight[] = ["yok", "mesale", "kamp_atesi"];
export const HAIR_STYLES: readonly V3HairStyle[] = ["kisa", "dalgali", "yan_ayrik", "uzun", "topuz", "orgu", "kel", "kivircik", "kakul", "geriye", "seyrek"];
export const FACE_SHAPES: readonly V3FaceShape[] = ["yuvarlak", "oval", "uzun", "genis", "kare"];
export const NOSES: readonly V3Nose[] = ["yok", "kucuk", "duz", "iri", "kemerli", "kalkik"];
export const EYE_STYLES: readonly V3EyeStyle[] = ["nokta", "detayli"];
export const AGES: readonly V3Age[] = ["genc", "orta", "yasli"];
export const SFX_IDS = ["whoosh", "pop", "boing", "kilic", "top_atisi", "davul", "kalabalik", "cekic", "dalga", "zil", "yumruk", "dusus", "adim", "kapi", "para", "kagit", "basari", "hata", "su"] as const;

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
  /** A cloak or cape over the shoulders (a Roman general's paludamentum, a mantle), in this colour (#RRGGBB). */
  readonly pelerin?: string;
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
  /** `bitis_satir`: the line it disappears with (a border change: the old outline goes as the new one comes). */
  /**
   * `yayilma`: a conquest — from line `satir` the state spreads over its land from `kaynak` ([lon, lat], where the
   * army came from), province after province like a front, instead of appearing whole (owner, 22 Oct 2026).
   */
  readonly bolgeler?: readonly { readonly ad: string; readonly renk: string; readonly ulkeler?: readonly string[]; readonly noktalar?: readonly [number, number][]; readonly etiket_konum?: readonly [number, number]; readonly satir?: number; readonly bitis_satir?: number; readonly tarihi?: { readonly ad: string; readonly yil: number }; readonly yayilma?: { readonly satir: number; readonly kaynak: readonly [number, number] } }[];
  readonly sehirler?: readonly { readonly ad: string; readonly konum: readonly [number, number] }[];
  /** An army; with `yol` it marches that route from line `yol_satir` (else at once), leaving a dotted trail. */
  readonly ordular?: readonly { readonly ad: string; readonly konum: readonly [number, number]; readonly renk: string; readonly satir?: number; readonly yol?: readonly [number, number][]; readonly yol_satir?: number }[];
  /** A line the story is about (a border river like the Rubicon, a wall, a frontier): drawn glowing with its name. */
  /** `stil` zincir: an iron chain on floats across the water (the Golden Horn's), instead of a glowing line. */
  readonly cizgiler?: readonly { readonly ad: string; readonly noktalar: readonly [number, number][]; readonly renk?: string; readonly satir?: number; readonly stil?: "zincir" }[];
  /**
   * Map narration (owner, 21 Oct 2026, like the reference channel Hayalhanem Ankara): the camera moves to a new
   * centre and width with a line, so one map follows the story across regions.
   */
  readonly kamera?: readonly { readonly satir: number; readonly merkez: readonly [number, number]; readonly genislik_km: number }[];
  /**
   * A ruler's portrait badge (a cast member's head) at a place from a line; `yol`: the route it travels, leaving a
   * dotted trail; `yol_satir`: the line it sets off with ("Bayezid marched north", owner 21 Oct 2026), else at once.
   */
  readonly rozetler?: readonly { readonly karakter: string; readonly konum: readonly [number, number]; readonly satir?: number; readonly bitis_satir?: number; readonly yol?: readonly [number, number][]; readonly yol_satir?: number }[];
  /** A battle at a place from a line (crossed swords). */
  readonly savaslar?: readonly { readonly ad: string; readonly konum: readonly [number, number]; readonly satir?: number }[];
  /**
   * Unit tokens (owner, 22 Oct 2026, after the reference channel's WW2 map): a side's round tokens with its emblem,
   * standing where its forces are and moving line by line — along a front, in a cluster, or ringing a besieged place.
   * Each `yer` is the tokens' formation from its line on; the tokens slide from one formation to the next.
   */
  readonly birlikler?: readonly MapUnits[];
  /**
   * Vehicles (owner, 22 Oct 2026, after the reference channel): a side's ships, galleys, cavalry, elephants, cannons,
   * tanks or planes, appearing with a line, travelling their route from `yol_satir`, and with `hedef` firing at a place
   * from `ates_satir` (cannons and ships pound walls, planes bomb). Only what the period had (VEHICLES).
   */
  readonly araclar?: readonly MapVehicle[];
  /**
   * The close battle map (genislik_km ≤ 120; owner, 22 Oct 2026, after DFT Tarih's Osman Bey documentary): the ground
   * of the place painted — its real coast, hills, woods and fields — with the walls, buildings and settlements of the
   * story on it, and the tokens, cannons and ships moving over it. `surlar`: a wall line with towers and gates, which
   * with `gedik` breaks open at that place from that line. `yerlesimler`: a city's houses, a village, an army camp's
   * tents, round a place (`km`) or in an outline; `yanma_satir` sets it on fire. `yapilar`: single buildings.
   */
  readonly surlar?: readonly MapWall[];
  readonly yapilar?: readonly { readonly tur: BuildingKind; readonly konum: readonly [number, number]; readonly ad?: string; readonly satir?: number }[];
  readonly yerlesimler?: readonly MapSettlement[];
  /** `ad`: the road's name, written along it ("Road to Edirne"). */
  readonly yollar?: readonly { readonly noktalar: readonly [number, number][]; readonly ad?: string }[];
  readonly arazi?: readonly { readonly tur: GroundKind; readonly konum: readonly [number, number]; readonly km?: number }[];
}

/** A map this narrow (km across) is the close battle map: its own coast, painted ground, walls and buildings. */
export const CLOSE_MAP_MAX_KM = 120;

export const BUILDING_KINDS = ["kale", "saray", "kilise", "cami", "kule", "otag"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
export const SETTLEMENT_KINDS = ["sehir", "koy", "ordugah"] as const;
export const GROUND_KINDS = ["tepe", "orman", "tarla"] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export interface MapWall {
  readonly ad?: string;
  /** The wall's line, end to end. */
  readonly noktalar: readonly [number, number][];
  readonly kapilar?: readonly (readonly [number, number])[];
  readonly gedik?: { readonly konum: readonly [number, number]; readonly satir: number };
}

export interface MapSettlement {
  readonly tur: (typeof SETTLEMENT_KINDS)[number];
  readonly ad?: string;
  /** Round a place (`km` across, default by kind), or inside an outline. */
  readonly konum?: readonly [number, number];
  readonly km?: number;
  readonly noktalar?: readonly [number, number][];
  readonly satir?: number;
  readonly yanma_satir?: number;
}

/**
 * Vehicles and the years they belong to: the episode's last year must fall in the range. `gemi` is any ship, drawn as
 * its period's (a galley before 1600, a sailing ship before 1860, a steel warship after); `kadirga` and `yelkenli`
 * name the oared galley and the sailing ship outright.
 */
export const VEHICLES = {
  gemi: [-3000, 2100],
  kadirga: [-3000, 1720],
  yelkenli: [1400, 1890],
  denizalti: [1900, 2100],
  suvari: [-900, 1945],
  fil: [-1100, 1600],
  top: [1340, 2100],
  tank: [1916, 2100],
  ucak: [1914, 2100],
} as const satisfies Record<string, readonly [number, number]>;
export type VehicleKind = keyof typeof VEHICLES;
export const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[];

export interface MapVehicle {
  readonly tur: VehicleKind;
  /** The side's colour (sail, flag, hull band). */
  readonly renk: string;
  /** How many travel together (1–6). */
  readonly sayi?: number;
  readonly konum: readonly [number, number];
  /** It appears with this line; with `bitis_satir` it goes. */
  readonly satir: number;
  readonly bitis_satir?: number;
  /** Its route after `konum`, travelled from `yol_satir` (default `satir`). */
  readonly yol?: readonly [number, number][];
  readonly yol_satir?: number;
  /** Where it fires at, from `ates_satir` (default: once it is there). */
  readonly hedef?: readonly [number, number];
  readonly ates_satir?: number;
}

/** Emblems a side's tokens can carry (drawn in the studio's flat style; no real flags of ancient states exist). */
export const UNIT_EMBLEMS = ["kartal", "hilal", "hac", "yildiz", "aslan", "tac", "kalkan", "kilic", "gunes", "orak_cekic", "harf"] as const;
export type UnitEmblem = (typeof UNIT_EMBLEMS)[number];

/** Where a side's tokens stand: along a front line, in a cluster round a point, or in a ring round a besieged place. */
export type UnitFormation =
  | { readonly cephe: readonly [number, number][] }
  | { readonly kume: readonly [number, number]; readonly km?: number }
  | { readonly kusatma: readonly [number, number]; readonly km?: number };

export interface MapUnits {
  /** The side (for the log and the legend): "Ottomans", "Byzantium". */
  readonly taraf: string;
  readonly renk: string;
  readonly amblem: UnitEmblem;
  /** With amblem "harf": 1–3 letters on the token ("SPQR" is too long; "R"). */
  readonly harf?: string;
  /** How many tokens (2–24). */
  readonly sayi: number;
  /** The formation from line `satir` on; the tokens slide to each next one with its line. */
  readonly yerler: readonly ({ readonly satir: number; readonly kayip?: number } & UnitFormation)[];
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
  /** The character rides in this scene (owner, 22 Oct 2026: horses): a general, a messenger, a cavalryman. */
  readonly binek?: "at";
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
  /**
   * What the crowd does with a line (owner, 22 Oct 2026: the legion stood still while Caesar crossed the Rubicon):
   * yuru/kos — march or run, the whole formation, toward `hedef` (stage x; by default off the far side); hucum — charge,
   * running and cheering; kac — flee off the near side, scared. The front sets off first, so a column moves.
   */
  readonly hareket?: { readonly tur: (typeof CROWD_MOVES)[number]; readonly satir: number; readonly hedef?: number };
}

export const CROWD_MOVES = ["yuru", "kos", "hucum", "kac"] as const;

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

/**
 * The scene's drawn living set (owner, 22 Oct 2026, "the viewer must live the moment"): when it happens, what kind of
 * place, the period's building style, the weather and the light — drawn and animated in the renderer.
 * `nehir`: for a crossing, the river's left and right bank across the stage (0..1).
 */
export interface SceneSetting {
  readonly zaman: V3TimeOfDay;
  readonly manzara: V3Landscape;
  readonly uslup: V3ArchStyle;
  readonly hava?: V3Weather;
  readonly isik?: V3SetLight;
  readonly nehir?: readonly [number, number];
}

export interface EpisodeScene {
  readonly id: string;
  readonly sure_hedef: number;
  readonly mekan: string;
  readonly arka_plan_sorgusu: SceneBackgroundQuery;
  readonly ortam?: SceneSetting;
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
