import type { AIProvider } from "../../ai/providers/AIProvider";
import { readJsonAnswer } from "./Council";

/**
 * The repair brain (Hata onarım beyni, owner idea 20 Oct 2026): when a production step fails it decides how the
 * production goes on, without a coding agent. Known failures get their remedy straight away (wait out a rate limit,
 * free the GPU, raise the script's output budget, restart a model process, render with fewer workers, go on without
 * an optional feature); an unknown one is shown to a model that may only pick from the same list of actions. It never
 * writes code: a failure that needs a code fix is carried to AYAS as a finding while the production continues the
 * best way it can, or stops with a clear reason.
 */
export type RepairAction =
  | { readonly tur: "bekle_tekrar"; readonly saniye: number; readonly neden: string }
  | { readonly tur: "gpu_bosalt"; readonly neden: string }
  | { readonly tur: "ayar"; readonly anahtar: RepairSetting; readonly deger: string; readonly neden: string }
  | { readonly tur: "atla"; readonly neden: string }
  | { readonly tur: "dur"; readonly neden: string };

/** The only settings the repair brain may change (environment for this production run). */
export const REPAIR_SETTINGS = ["ATOLYE_V3_WRITER_MAX_TOKENS", "ATOLYE_V3_RENDER_CONCURRENCY"] as const;
export type RepairSetting = (typeof REPAIR_SETTINGS)[number];

export interface RepairContext {
  readonly step: string;
  readonly error: string;
  readonly attempt: number;
  /** Steps the production can go on without (a feature is skipped, never the video). */
  readonly optional: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** The remedy for a failure the studio has met before, or undefined. */
export function knownRemedy(c: RepairContext): RepairAction | undefined {
  const e = c.error;
  if (/ENOSPC|no space left/i.test(e)) return { tur: "dur", neden: "disk dolu" };
  if (/V3_GPU_TOO_HOT/.test(e)) return { tur: "bekle_tekrar", saniye: 180, neden: "ekran kartı sıcak; soğuması bekleniyor" };
  if (/CUDA out of memory|OutOfMemoryError|CUBLAS_STATUS_ALLOC|out of memory/i.test(e)) return { tur: "gpu_bosalt", neden: "ekran kartı belleği dolu" };
  // Status codes inside our error codes too ("COMMONS_DOWNLOAD_429": \b would not see the underscore edge).
  if (/(^|[^0-9])(429|503|502|504)([^0-9]|$)|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(e)) return { tur: "bekle_tekrar", saniye: Math.min(240, 30 * c.attempt), neden: "ağ ya da hız sınırı; bekleyip yeniden" };
  if (/ECONNREFUSED.*11434|ollama/i.test(e) && /refused|unavailable|not running/i.test(e)) return { tur: "bekle_tekrar", saniye: 45, neden: "yerel model sunucusu (Ollama) yanıt vermiyor" };
  if (/V3_SCRIPT_JSON_CUT/.test(e)) {
    const now = Number(c.env.ATOLYE_V3_WRITER_MAX_TOKENS) || 10_000;
    return now < 16_000 ? { tur: "ayar", anahtar: "ATOLYE_V3_WRITER_MAX_TOKENS", deger: String(Math.min(16_000, Math.round(now * 1.5))), neden: "senaryo çıktısı sınırda kesildi" } : { tur: "dur", neden: "senaryo en yüksek çıktı sınırında da kesiliyor" };
  }
  // The same search finds the same nothing (22 Oct 2026: four waits on a Turkish topic); too few facts may differ once.
  if (/V3_RESEARCH_NOTHING/.test(e)) return { tur: "dur", neden: "konunun Wikipedia makalesi bulunamadı; aynı arama yine boş döner" };
  if (/V3_RESEARCH_THIN/.test(e)) return c.attempt <= 1 ? { tur: "bekle_tekrar", saniye: 0, neden: "az olgu doğrulandı; yeni çıkarım" } : { tur: "dur", neden: "makalelerden yeterli olgu doğrulanamadı" };
  if (/V3_SCRIPT_INVALID|V3_SCRIPT_NO_JSON|V3_SCRIPT_JSON_SYNTAX/.test(e)) return c.attempt <= 2 ? { tur: "bekle_tekrar", saniye: 0, neden: "senaryo taslağı geçersiz; yeni taslak" } : { tur: "dur", neden: "üç taslak da geçersiz" };
  if (/V3_PYTHON_EXIT|V3_PYTHON_START_TIMEOUT|V3_TTS_START_TIMEOUT|V3_SDXL_FAILED/.test(e)) return { tur: "bekle_tekrar", saniye: 15, neden: "model süreci çöktü; yeniden başlatılıyor" };
  if (c.step === "render" && /Target closed|Protocol error|crash|ERR_|timed out|Timeout/i.test(e)) {
    const now = Number(c.env.ATOLYE_V3_RENDER_CONCURRENCY) || 0;
    return now === 1 ? { tur: "dur", neden: "render tek işçiyle de çöküyor" } : { tur: "ayar", anahtar: "ATOLYE_V3_RENDER_CONCURRENCY", deger: now ? String(Math.max(1, Math.floor(now / 2))) : "2", neden: "render çöktü; daha az işçiyle" };
  }
  if (/V3_BUDGET_EXCEEDED/.test(e)) return c.optional ? { tur: "atla", neden: "bütçe tavanı; bu özellik bu videoda yok" } : { tur: "dur", neden: "video bütçe tavanını aşıyor" };
  return undefined;
}

export function repairPrompt(c: RepairContext): string {
  return `You are the repair brain of an automated video studio. A production step failed. Choose how the production goes on.
STEP: ${c.step} (${c.optional ? "optional: the video can be finished without it" : "required"})
ATTEMPT: ${c.attempt}
ERROR: ${c.error.slice(0, 1200)}

Allowed actions (you cannot change code):
- {"tur": "bekle_tekrar", "saniye": 0-300, "neden": "…"} — a transient failure: wait and run the step again
- {"tur": "gpu_bosalt", "neden": "…"} — GPU memory: unload other models, wait, run again
- {"tur": "ayar", "anahtar": "${REPAIR_SETTINGS.join('" | "')}", "deger": "…", "neden": "…"} — run again with this setting
${c.optional ? '- {"tur": "atla", "neden": "…"} — go on without this optional step\n' : ""}- {"tur": "dur", "neden": "…"} — it cannot be recovered without fixing code
"neden" in Turkish. Return ONLY the JSON object.`;
}

/** A model's action, kept only if it is one of the allowed ones with valid values. */
export function parseRepair(text: string, c: RepairContext): RepairAction | undefined {
  const v = readJsonAnswer<{ tur?: string; saniye?: unknown; anahtar?: string; deger?: unknown; neden?: unknown }>(text);
  const neden = String(v?.neden ?? "").slice(0, 200) || "onarım beyni kararı";
  switch (v?.tur) {
    case "bekle_tekrar":
      return { tur: "bekle_tekrar", saniye: Math.max(0, Math.min(300, Number(v.saniye) || 0)), neden };
    case "gpu_bosalt":
      return { tur: "gpu_bosalt", neden };
    case "ayar":
      return REPAIR_SETTINGS.includes(v.anahtar as RepairSetting) && /^\d{1,5}$/.test(String(v.deger)) ? { tur: "ayar", anahtar: v.anahtar as RepairSetting, deger: String(v.deger), neden } : undefined;
    case "atla":
      return c.optional ? { tur: "atla", neden } : undefined;
    case "dur":
      return { tur: "dur", neden };
    default:
      return undefined;
  }
}

/**
 * Known remedy first; then one that cured the same failure before (the experience memory, `learned`); otherwise the
 * model chooses (free local model is fine); no answer → stop with the error.
 */
export async function decideRepair(c: RepairContext, model?: AIProvider, learned?: RepairAction): Promise<RepairAction & { readonly kaynak: "bilinen" | "hafiza" | "model" | "varsayilan" }> {
  const known = knownRemedy(c);
  if (known) return { ...known, kaynak: "bilinen" };
  if (learned && (learned.tur !== "atla" || c.optional)) return { ...learned, kaynak: "hafiza" };
  if (model) {
    try {
      const out = await model.generate(repairPrompt(c), { maxTokens: 200 });
      const action = parseRepair(typeof out === "string" ? out : out.content, c);
      if (action) return { ...action, kaynak: "model" };
    } catch {
      // A repair brain that cannot think falls back to the safe default below.
    }
  }
  return c.optional ? { tur: "atla", neden: "tanınmayan hata; isteğe bağlı adım atlandı", kaynak: "varsayilan" } : { tur: "dur", neden: "tanınmayan hata", kaynak: "varsayilan" };
}

export function describeRepair(a: RepairAction): string {
  switch (a.tur) {
    case "bekle_tekrar":
      return `${a.saniye} sn bekleyip yeniden — ${a.neden}`;
    case "gpu_bosalt":
      return `ekran kartı boşaltılıp yeniden — ${a.neden}`;
    case "ayar":
      return `${a.anahtar}=${a.deger} ile yeniden — ${a.neden}`;
    case "atla":
      return `adım atlandı, üretim sürüyor — ${a.neden}`;
    case "dur":
      return `üretim durdu — ${a.neden}`;
  }
}
