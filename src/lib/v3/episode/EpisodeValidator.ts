import {
  AGES,
  EFFECTS,
  EMOTIONS,
  EPISODE_TONES,
  EYE_STYLES,
  FACE_SHAPES,
  GARMENTS,
  HAIR_STYLES,
  NOSES,
  GESTURES,
  MOVES,
  PROP_KINDS,
  SCENE_MOODS,
  SFX_IDS,
  TRANSITIONS,
  type Episode,
} from "./EpisodeTypes";

export interface EpisodeIssue {
  readonly level: "hata" | "uyari";
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface EpisodeValidation {
  readonly ok: boolean;
  readonly errors: readonly EpisodeIssue[];
  readonly warnings: readonly EpisodeIssue[];
  readonly metrics: {
    readonly sceneCount: number;
    readonly lineCount: number;
    readonly dialogueSceneRatio: number;
    readonly averageWordsPerLine: number;
    readonly narratorClaimsWithoutSource: number;
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** A costume part: "item" or "pack/item" from the catalog, or "yeni:<description>" for the part designer to draw. */
const ITEM_REF = /^(([a-z0-9-]+\/)?[a-z0-9-]+|yeni:.{3,80})$/;
/** Costume fields that hold a part reference. */
export const PART_FIELDS = ["bas", "sakal", "biyik", "el_on", "el_arka", "sirt", "sac_parca", "gogus"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** Slang/insults the house style forbids (the reference channel's "lan/ulan" included). Whole words only. */
const FORBIDDEN_WORDS = ["lan", "ulan", "amk", "siktir", "piç", "yavşak", "gavur", "salak", "gerizekalı"];
const RIVAYET_MARKERS = /rivayet|anlatılır|söylenir|denir ki|iddiaya göre|bazı kaynaklar/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateEpisode(input: unknown): EpisodeValidation {
  const errors: EpisodeIssue[] = [];
  const warnings: EpisodeIssue[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ level: "hata", code, path, message });
  const warn = (code: string, path: string, message: string) => warnings.push({ level: "uyari", code, path, message });
  const str = (o: Obj, key: string, path: string, opts: { optional?: boolean; max?: number; pattern?: RegExp } = {}): string | undefined => {
    const v = o[key];
    if (v === undefined && opts.optional) return undefined;
    if (typeof v !== "string" || !v.trim()) return void err("ALAN_METIN", `${path}.${key}`, "boş olmayan metin bekleniyor");
    if (opts.max && v.length > opts.max) err("ALAN_UZUN", `${path}.${key}`, `en fazla ${opts.max} karakter`);
    if (opts.pattern && !opts.pattern.test(v)) err("ALAN_BICIM", `${path}.${key}`, `biçim uygun değil: ${v}`);
    return v;
  };
  const num = (o: Obj, key: string, path: string, min: number, max: number, optional = false): number | undefined => {
    const v = o[key];
    if (v === undefined && optional) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return void err("ALAN_SAYI", `${path}.${key}`, `${min}..${max} arası sayı bekleniyor`);
    return v;
  };
  const oneOf = <T extends string>(o: Obj, key: string, path: string, values: readonly T[], optional = false): T | undefined => {
    const v = o[key];
    if (v === undefined && optional) return undefined;
    if (typeof v !== "string" || !values.includes(v as T)) return void err("ALAN_SECENEK", `${path}.${key}`, `şunlardan biri olmalı: ${values.join(", ")}`);
    return v as T;
  };
  const arr = (o: Obj, key: string, path: string, optional = false): unknown[] | undefined => {
    const v = o[key];
    if (v === undefined && optional) return undefined;
    if (!Array.isArray(v)) return void err("ALAN_LISTE", `${path}.${key}`, "liste bekleniyor");
    return v;
  };

  const empty = { sceneCount: 0, lineCount: 0, dialogueSceneRatio: 0, averageWordsPerLine: 0, narratorClaimsWithoutSource: 0 };
  if (!isObj(input)) {
    err("KOK", "$", "episode bir nesne olmalı");
    return { ok: false, errors, warnings, metrics: empty };
  }
  const ep = input;
  str(ep, "id", "$", { pattern: SLUG });
  str(ep, "baslik", "$", { max: 120 });
  str(ep, "konu", "$", { max: 300 });
  str(ep, "donem", "$", { max: 120 });
  num(ep, "hedef_sure_sn", "$", 20, 1800);
  oneOf(ep, "ton", "$", EPISODE_TONES);

  const sourceIds = new Set<string>();
  (arr(ep, "kaynaklar", "$") ?? []).forEach((s, i) => {
    const p = `$.kaynaklar[${i}]`;
    if (!isObj(s)) return err("KAYNAK", p, "nesne bekleniyor");
    const id = str(s, "id", p, { pattern: SLUG });
    str(s, "kunye", p, { max: 400 });
    str(s, "url", p, { optional: true, pattern: /^https:\/\// });
    if (id && sourceIds.has(id)) err("KAYNAK_TEKRAR", p, `yinelenen kaynak id: ${id}`);
    if (id) sourceIds.add(id);
  });

  const castIds = new Set<string>();
  const visible = new Set<string>();
  (arr(ep, "oyuncu_kadrosu", "$") ?? []).forEach((c, i) => {
    const p = `$.oyuncu_kadrosu[${i}]`;
    if (!isObj(c)) return err("KADRO", p, "nesne bekleniyor");
    const id = str(c, "id", p, { pattern: SLUG });
    str(c, "ad", p, { max: 80 });
    str(c, "rol", p, { max: 120 });
    str(c, "renk", p, { pattern: HEX });
    str(c, "ses_id", p, { pattern: SLUG });
    str(c, "konusma_tarzi", p, { max: 300 });
    num(c, "olcek", p, 0.5, 1.5, true);
    if (typeof c.gorunur !== "boolean") err("ALAN_MANTIK", `${p}.gorunur`, "true/false bekleniyor");
    if (c.portre !== undefined) {
      if (!isObj(c.portre) || c.gorunur !== true) err("PORTRE", `${p}.portre`, "portre yalnız görünür karakterde ve {wiki} nesnesi olarak");
      else str(c.portre, "wiki", `${p}.portre`, { max: 120 });
    }
    if (id && castIds.has(id)) err("KADRO_TEKRAR", p, `yinelenen oyuncu id: ${id}`);
    if (id) castIds.add(id);
    if (c.gorunur === true) {
      if (id) visible.add(id);
      str(c, "kostum_paketi", p, { pattern: SLUG });
      const k = c.kostum;
      if (!isObj(k)) return err("KOSTUM", `${p}.kostum`, "görünür oyuncunun kostümü olmalı");
      oneOf(k, "giysi", `${p}.kostum`, GARMENTS);
      str(k, "ayakkabi", `${p}.kostum`);
      if (!isObj(k.renkler)) err("KOSTUM_RENK", `${p}.kostum.renkler`, "ana/ikincil/ic/sus renkleri gerekli");
      else for (const key of ["ana", "ikincil", "ic", "sus"]) str(k.renkler, key, `${p}.kostum.renkler`, { pattern: HEX });
      for (const key of PART_FIELDS) str(k, key, `${p}.kostum`, { optional: true, pattern: ITEM_REF });
      str(k, "pelerin", `${p}.kostum`, { optional: true, pattern: HEX });
      if (k.sac !== undefined) {
        if (!isObj(k.sac)) err("KOSTUM_SAC", `${p}.kostum.sac`, "stil ve renk gerekli");
        else {
          oneOf(k.sac, "stil", `${p}.kostum.sac`, HAIR_STYLES);
          str(k.sac, "renk", `${p}.kostum.sac`, { pattern: HEX });
        }
      }
      if (k.yuz !== undefined) {
        const y = k.yuz;
        const yp = `${p}.kostum.yuz`;
        if (!isObj(y)) err("KOSTUM_YUZ", yp, "nesne bekleniyor");
        else {
          oneOf(y, "sekil", yp, FACE_SHAPES, true);
          oneOf(y, "burun", yp, NOSES, true);
          oneOf(y, "goz", yp, EYE_STYLES, true);
          oneOf(y, "yas", yp, AGES, true);
          str(y, "ten", yp, { optional: true, pattern: HEX });
          str(y, "kas_renk", yp, { optional: true, pattern: HEX });
        }
      }
    }
  });

  let lineCount = 0, words = 0, dialogueScenes = 0, unsourced = 0;
  const scenes = arr(ep, "sahneler", "$") ?? [];
  if (scenes.length === 0) err("SAHNE_YOK", "$.sahneler", "en az bir sahne gerekli");
  const sceneIds = new Set<string>();
  scenes.forEach((s, si) => {
    const p = `$.sahneler[${si}]`;
    if (!isObj(s)) return err("SAHNE", p, "nesne bekleniyor");
    const id = str(s, "id", p, { pattern: SLUG });
    if (id && sceneIds.has(id)) err("SAHNE_TEKRAR", p, `yinelenen sahne id: ${id}`);
    if (id) sceneIds.add(id);
    num(s, "sure_hedef", p, 2, 600);
    str(s, "mekan", p, { max: 160 });
    oneOf(s, "duygu", p, SCENE_MOODS);
    str(s, "muzik_ruh_hali", p, { max: 40 });
    oneOf(s, "gecis", p, TRANSITIONS, true);
    if (!isObj(s.arka_plan_sorgusu)) err("ARKA_PLAN", `${p}.arka_plan_sorgusu`, "tr/en sorgusu gerekli");
    else {
      str(s.arka_plan_sorgusu, "tr", `${p}.arka_plan_sorgusu`);
      str(s.arka_plan_sorgusu, "en", `${p}.arka_plan_sorgusu`);
      str(s.arka_plan_sorgusu, "wiki", `${p}.arka_plan_sorgusu`, { optional: true, max: 120 });
      const extra = s.arka_plan_sorgusu.ara;
      if (extra !== undefined && (!Array.isArray(extra) || extra.length > 3 || extra.some((x) => typeof x !== "string" || !x.trim() || x.length > 80))) err("ARKA_PLAN_ARA", `${p}.arka_plan_sorgusu.ara`, "en fazla 3 arama metni (her biri ≤ 80 karakter)");
      str(s.arka_plan_sorgusu, "tasarim", `${p}.arka_plan_sorgusu`, { optional: true, max: 700 });
      oneOf(s.arka_plan_sorgusu, "tur", `${p}.arka_plan_sorgusu`, ["set", "archival"] as const, true);
    }
    (arr(s, "sahne_duzeni", p, true) ?? []).forEach((b, bi) => {
      const bp = `${p}.sahne_duzeni[${bi}]`;
      if (!isObj(b)) return err("DUZEN", bp, "nesne bekleniyor");
      const who = str(b, "karakter", bp);
      if (who && !visible.has(who)) err("DUZEN_KARAKTER", bp, `görünür kadroda yok: ${who}`);
      num(b, "x", bp, 0, 1);
      num(b, "derinlik", bp, 0, 1, true);
    });
    (arr(s, "dekor", p, true) ?? []).forEach((d, di) => {
      const dp = `${p}.dekor[${di}]`;
      if (!isObj(d)) return err("DEKOR", dp, "nesne bekleniyor");
      oneOf(d, "tur", dp, PROP_KINDS);
      num(d, "x", dp, -0.2, 1.2);
    });
    if (isObj(s.harita) && s.harita.merkez !== undefined) {
      const h = s.harita;
      const hp = `${p}.harita`;
      const lonLat = (v: unknown, where: string) => {
        if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number" || Math.abs(v[0]) > 180 || Math.abs(v[1]) > 85) err("HARITA_KONUM", where, "[boylam, enlem] bekleniyor (-180..180, -85..85)");
      };
      lonLat(h.merkez, `${hp}.merkez`);
      num(h, "genislik_km", hp, 20, 40_000);
      (arr(h, "bolgeler", hp, true) ?? []).forEach((b, bi) => {
        const bp = `${hp}.bolgeler[${bi}]`;
        if (!isObj(b)) return err("HARITA_BOLGE", bp, "nesne bekleniyor");
        str(b, "ad", bp, { max: 60 });
        str(b, "renk", bp, { pattern: HEX });
        const iso = Array.isArray(b.ulkeler) ? b.ulkeler : [];
        if (iso.some((c) => typeof c !== "string" || !/^[A-Za-z]{3}$/.test(c))) err("HARITA_ULKE", `${bp}.ulkeler`, "ISO 3166 alfa-3 kodları bekleniyor (ITA, FRA…)");
        const pts = Array.isArray(b.noktalar) ? b.noktalar : [];
        pts.forEach((pt, k) => lonLat(pt, `${bp}.noktalar[${k}]`));
        const tarihi = b.tarihi;
        if (tarihi !== undefined) {
          if (!isObj(tarihi)) err("HARITA_TARIHI", `${bp}.tarihi`, "{ad, yil} bekleniyor");
          else {
            str(tarihi, "ad", `${bp}.tarihi`, { max: 80 });
            num(tarihi, "yil", `${bp}.tarihi`, -123_000, 2_100);
          }
        }
        if (!iso.length && pts.length < 3 && tarihi === undefined) err("HARITA_BOLGE", bp, "tarihi, ulkeler ya da en az 3 noktalı noktalar gerekli");
      });
      (arr(h, "sehirler", hp, true) ?? []).forEach((c, ci) => (isObj(c) ? (str(c, "ad", `${hp}.sehirler[${ci}]`, { max: 40 }), lonLat(c.konum, `${hp}.sehirler[${ci}].konum`)) : err("HARITA", `${hp}.sehirler[${ci}]`, "nesne bekleniyor")));
      (arr(h, "ordular", hp, true) ?? []).forEach((o, oi) => (isObj(o) ? (str(o, "ad", `${hp}.ordular[${oi}]`, { max: 40 }), str(o, "renk", `${hp}.ordular[${oi}]`, { pattern: HEX }), lonLat(o.konum, `${hp}.ordular[${oi}].konum`)) : err("HARITA", `${hp}.ordular[${oi}]`, "nesne bekleniyor")));
      (arr(h, "oklar", hp, true) ?? []).forEach((o, oi) => {
        const pts = isObj(o) && Array.isArray(o.noktalar) ? o.noktalar : [];
        if (pts.length < 2) err("HARITA_OK", `${hp}.oklar[${oi}]`, "en az 2 nokta");
        pts.forEach((pt, k) => lonLat(pt, `${hp}.oklar[${oi}].noktalar[${k}]`));
      });
      const lines = Array.isArray(s.satirlar) ? s.satirlar.length : 0;
      const lineIndex = (o: Record<string, unknown>, key: string, where: string) => {
        if (o[key] === undefined) return;
        if (typeof o[key] !== "number" || !Number.isInteger(o[key]) || (o[key] as number) < 0 || (o[key] as number) >= Math.max(1, lines)) err("HARITA_SATIR", `${where}.${key}`, `0..${Math.max(0, lines - 1)} arası satır numarası bekleniyor`);
      };
      (arr(h, "bolgeler", hp, true) ?? []).forEach((b, bi) => (isObj(b) ? lineIndex(b, "bitis_satir", `${hp}.bolgeler[${bi}]`) : undefined));
      (arr(h, "kamera", hp, true) ?? []).forEach((c, ci) => {
        const cp = `${hp}.kamera[${ci}]`;
        if (!isObj(c)) return err("HARITA_KAMERA", cp, "nesne bekleniyor");
        if (c.satir === undefined) err("HARITA_KAMERA", cp, "satir gerekli");
        lineIndex(c, "satir", cp);
        lonLat(c.merkez, `${cp}.merkez`);
        num(c, "genislik_km", cp, 20, 40_000);
      });
      (arr(h, "rozetler", hp, true) ?? []).forEach((r, ri) => {
        const rp = `${hp}.rozetler[${ri}]`;
        if (!isObj(r)) return err("HARITA_ROZET", rp, "nesne bekleniyor");
        const who = typeof r.karakter === "string" ? r.karakter : "";
        if (!castIds.has(who)) err("HARITA_ROZET", `${rp}.karakter`, `kadroda yok: ${who}`);
        lonLat(r.konum, `${rp}.konum`);
        lineIndex(r, "satir", rp);
        lineIndex(r, "bitis_satir", rp);
        lineIndex(r, "yol_satir", rp);
        (Array.isArray(r.yol) ? r.yol : []).forEach((pt, k) => lonLat(pt, `${rp}.yol[${k}]`));
      });
      (arr(h, "savaslar", hp, true) ?? []).forEach((w, wi) => {
        const wp = `${hp}.savaslar[${wi}]`;
        if (!isObj(w)) return err("HARITA_SAVAS", wp, "nesne bekleniyor");
        str(w, "ad", wp, { max: 50 });
        lonLat(w.konum, `${wp}.konum`);
        lineIndex(w, "satir", wp);
      });
    }
    (arr(s, "kalabalik", p, true) ?? []).forEach((c, ci) => {
      const cp = `${p}.kalabalik[${ci}]`;
      if (!isObj(c)) return err("KALABALIK", cp, "nesne bekleniyor");
      str(c, "ad", cp, { max: 80 });
      str(c, "kostum_paketi", cp, { pattern: SLUG });
      num(c, "sayi", cp, 2, 40);
      oneOf(c, "duzen", cp, ["sira", "meclis", "ordu"] as const);
      oneOf(c, "taraf", cp, ["sol", "sag", "tum"] as const, true);
      oneOf(c, "ruh_hali", cp, ["notr", "coskulu", "korkmus"] as const, true);
      const k = c.kostum;
      if (!isObj(k)) return err("KOSTUM", `${cp}.kostum`, "kalabalığın kostümü olmalı");
      oneOf(k, "giysi", `${cp}.kostum`, GARMENTS);
      str(k, "ayakkabi", `${cp}.kostum`);
      if (!isObj(k.renkler)) err("KOSTUM_RENK", `${cp}.kostum.renkler`, "ana/ikincil/ic/sus renkleri gerekli");
      else for (const key of ["ana", "ikincil", "ic", "sus"]) str(k.renkler, key, `${cp}.kostum.renkler`, { pattern: HEX });
      for (const key of PART_FIELDS) str(k, key, `${cp}.kostum`, { optional: true, pattern: ITEM_REF });
    });
    const speakers = new Set<string>();
    const lines = arr(s, "satirlar", p) ?? [];
    if (lines.length === 0) err("SATIR_YOK", `${p}.satirlar`, "en az bir satır gerekli");
    lines.forEach((l, li) => {
      const lp = `${p}.satirlar[${li}]`;
      if (!isObj(l)) return err("SATIR", lp, "nesne bekleniyor");
      const who = str(l, "karakter", lp);
      const text = str(l, "metin", lp, { max: 240 });
      oneOf(l, "duygu", lp, EMOTIONS);
      oneOf(l, "jest", lp, GESTURES, true);
      oneOf(l, "hareket", lp, MOVES, true);
      oneOf(l, "sfx", lp, SFX_IDS, true);
      oneOf(l, "efekt", lp, EFFECTS, true);
      const bubble = str(l, "balon", lp, { optional: true, max: 70 });
      if (bubble !== undefined && who && !visible.has(who)) err("BALON_ANLATICI", `${lp}.balon`, "konuşma balonu yalnız görünür karakterin satırında olur");
      if (bubble !== undefined && countWords(bubble) > 8) warn("BALON_UZUN", `${lp}.balon`, `${countWords(bubble)} kelime; balon en fazla 8 kelime`);
      if (who && !castIds.has(who)) err("SATIR_KARAKTER", lp, `kadroda yok: ${who}`);
      if (who && visible.has(who)) speakers.add(who);
      const target = l.hedef;
      if (typeof target === "string" && !castIds.has(target)) err("SATIR_HEDEF", `${lp}.hedef`, `kadroda yok: ${target}`);
      if (typeof target === "number" && (target < 0 || target > 1)) err("SATIR_HEDEF", `${lp}.hedef`, "0..1 arası olmalı");
      for (const ref of (Array.isArray(l.kaynak) ? l.kaynak : []) as unknown[]) {
        if (typeof ref !== "string" || !sourceIds.has(ref)) err("SATIR_KAYNAK", `${lp}.kaynak`, `bilinmeyen kaynak: ${String(ref)}`);
      }
      if (!text) return;
      lineCount++;
      const w = countWords(text);
      words += w;
      if (w > 22) warn("SATIR_UZUN", lp, `${w} kelime; hedef ortalama ≤14, satır başı ≤22`);
      const lower = text.toLocaleLowerCase("tr-TR");
      for (const bad of FORBIDDEN_WORDS) {
        if (new RegExp(`(^|[^\\p{L}])${bad}([^\\p{L}]|$)`, "u").test(lower)) err("USLUP_ARGO", lp, `ev üslubu dışı kelime: ${bad}`);
      }
      if (l.rivayet === true && !RIVAYET_MARKERS.test(text)) warn("RIVAYET_IFADESI", lp, "tartışmalı bilgi metinde 'rivayete göre' vb. ile belirtilmeli");
      const narrator = who !== undefined && !visible.has(who);
      const hasSource = Array.isArray(l.kaynak) && l.kaynak.length > 0;
      if (narrator && l.kurgu !== true && !hasSource) {
        unsourced++;
        warn("KAYNAK_YOK", lp, "anlatıcı iddiası için kaynak notu yok");
      }
    });
    if (speakers.size >= 1 && lines.length >= 2) dialogueScenes++;
  });

  const metrics = {
    sceneCount: scenes.length,
    lineCount,
    dialogueSceneRatio: scenes.length ? dialogueScenes / scenes.length : 0,
    averageWordsPerLine: lineCount ? words / lineCount : 0,
    narratorClaimsWithoutSource: unsourced,
  };
  if (scenes.length && metrics.dialogueSceneRatio < 0.3) warn("DIYALOG_AZ", "$.sahneler", `diyaloglu sahne oranı %${Math.round(metrics.dialogueSceneRatio * 100)} (hedef ≥%30)`);
  if (lineCount && metrics.averageWordsPerLine > 14) warn("CUMLE_UZUN", "$.sahneler", `ortalama ${metrics.averageWordsPerLine.toFixed(1)} kelime/satır (hedef ≤14)`);
  return { ok: errors.length === 0, errors, warnings, metrics };
}

export function assertEpisode(input: unknown): Episode {
  const v = validateEpisode(input);
  if (!v.ok) throw new Error(`EPISODE_INVALID: ${v.errors.map((e) => `${e.path} ${e.code} ${e.message}`).join("; ")}`);
  return input as Episode;
}
