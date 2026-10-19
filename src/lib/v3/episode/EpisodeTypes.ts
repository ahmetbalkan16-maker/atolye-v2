/**
 * Atölye V3 episode contract (`episode.json`). Keys are Turkish on purpose: the script writer (LLM or human)
 * works in Turkish and the file is meant to be read and edited by the owner. JSON Schema:
 * `docs/v3/episode.schema.json`; validator: `EpisodeValidator.ts`.
 */
import type { V3Effect, V3Emotion, V3Garment, V3Gesture, V3Prop, V3Transition } from "../render/RenderPlanTypes";

export const EPISODE_TONES = ["mizahi", "ciddi", "epik"] as const;
export const SCENE_MOODS = ["gerilim", "komik", "huzun", "zafer", "gizem", "merak"] as const;
export const EMOTIONS: readonly V3Emotion[] = ["notr", "mutlu", "kizgin", "saskin", "korkmus", "uzgun", "kararli", "sinsi"];
export const GESTURES: readonly V3Gesture[] = ["konus", "isaret_et", "el_salla", "sasir", "egil", "kollari_kavustur", "dusun", "omuz_silk", "yumruk_kaldir", "elleri_belde", "yuz_avucla", "kutla"];
export const MOVES = ["yuru", "kos", "dur", "gir", "cik"] as const;
export const EFFECTS: readonly V3Effect[] = ["ter", "unlem", "soru", "ofke", "parilti", "kalp"];
export const GARMENTS: readonly V3Garment[] = ["kaftan", "cubbe", "zirh", "onluk", "bizans", "yeniceri", "sade"];
export const PROP_KINDS: readonly V3Prop["kind"][] = ["taht", "top", "kule_iskelesi", "gemi", "masa", "sancak"];
export const TRANSITIONS: readonly V3Transition[] = ["kes", "kaydir", "murekkep", "beyaz"];
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
}

export interface SceneBackgroundQuery {
  readonly tr: string;
  readonly en: string;
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

export interface SceneMap {
  readonly oklar: readonly { readonly noktalar: readonly [number, number][]; readonly renk?: string; readonly etiket?: string }[];
}

export interface SceneTitleCard {
  readonly metin: string;
  readonly alt_metin?: string;
  readonly stil: "yer_tarih" | "bolum" | "bilgi";
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
