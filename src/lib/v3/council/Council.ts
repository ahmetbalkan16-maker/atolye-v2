import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";

/**
 * The production council (owner idea, 20 Oct 2026): AYAS manages, Atölye's specialist brains do the work and argue
 * about it. Each brain proposes, a critic of another discipline finds the faults, a chief decides. What a brain cannot
 * fix by itself is reported to AYAS as a finding: a "data" or "setting" finding is a measure Atölye may take on its
 * own next time; a "code" finding is only ever a proposal for the owner-approved development lane — no brain and no
 * report here changes code. Every debate is kept as a transcript.
 */
export type BrainId = "arastirma" | "kurgu" | "kostum" | "ortam" | "ses" | "kalite" | "onarim" | "sef";

export const BRAIN_NAMES: Readonly<Record<BrainId, string>> = {
  arastirma: "Araştırma beyni",
  kurgu: "Kurgu beyni",
  kostum: "Kostüm beyni",
  ortam: "Ortam beyni",
  ses: "Ses beyni",
  kalite: "Kalite beyni",
  onarim: "Hata onarım beyni",
  sef: "Şef (AYAS adına)",
};

export interface DebateEntry {
  readonly rol: string;
  readonly metin: string;
}

export interface Finding {
  readonly beyin: BrainId;
  readonly onem: "bilgi" | "uyari" | "eksik";
  readonly baslik: string;
  readonly ayrinti: string;
  /** What would fix it, in plain words. */
  readonly oneri?: string;
  /** veri/ayar: a measure Atölye can take itself; kod: a proposal for the owner-approved development lane. */
  readonly tur: "veri" | "ayar" | "kod";
  /** Scene or part it is about, when there is one. */
  readonly yer?: string;
}

/** Collects one production's findings and debates; written as `yapim-raporu.json` and sent to AYAS's inbox. */
export class CouncilLog {
  readonly findings: Finding[] = [];
  readonly debates: { readonly konu: string; readonly beyin: BrainId; readonly kayit: readonly DebateEntry[] }[] = [];

  find(f: Finding): void {
    this.findings.push(f);
  }

  debate(beyin: BrainId, konu: string, kayit: readonly DebateEntry[]): void {
    if (kayit.length) this.debates.push({ beyin, konu, kayit });
  }
}

export function readJsonAnswer<T>(text: string): T | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

export interface ChiefItem {
  readonly baslik: string;
  readonly neden: string;
  readonly beyin?: BrainId;
}

export interface ChiefPlan {
  readonly ozet: string;
  readonly onlemler: readonly ChiefItem[];
  readonly gelistirmeler: readonly ChiefItem[];
}

/**
 * The chief's list as the report needs it. The model sometimes answers a measure as a bare sentence instead of
 * {baslik, neden, beyin} (Rome, 21 Oct 2026: six "undefined — undefined" lines in KURUL.md); a sentence is kept as the
 * title, anything else unreadable is dropped.
 */
export function chiefItems(value: unknown): ChiefItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((x): ChiefItem[] => {
    if (typeof x === "string") return x.trim() ? [{ baslik: x.trim(), neden: "" }] : [];
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    const baslik = typeof o.baslik === "string" ? o.baslik.trim() : "";
    const neden = typeof o.neden === "string" ? o.neden.trim() : "";
    if (!baslik && !neden) return [];
    return [{ baslik: baslik || neden, neden: baslik ? neden : "", ...(typeof o.beyin === "string" && o.beyin in BRAIN_NAMES ? { beyin: o.beyin as BrainId } : {}) }];
  });
}

/**
 * The chief's reading of a production (AYAS's role until the live AYAS takes the report itself): a short verdict, the
 * measures Atölye can take on its own (data, settings) and the developments to propose (code), each tied to a brain.
 */
export async function chiefReview(input: { readonly budget: V3Budget; readonly model: V3ModelChoice; readonly konu: string; readonly log: CouncilLog }): Promise<ChiefPlan | undefined> {
  const { log } = input;
  if (!log.findings.length) return { ozet: "Eksik bildirilmedi.", onlemler: [], gelistirmeler: [] };
  const prompt = `You are AYAS, the manager of an automated history-video studio. Your specialist brains (research, script, costume, setting, sound, quality) report what went wrong or is missing in this production of "${input.konu}".

FINDINGS (JSON):
${JSON.stringify(log.findings.slice(0, 60), null, 1)}

Decide, in Turkish:
- "ozet": two sentences on the production's state.
- "onlemler": up to 6 measures the studio can take by itself next time WITHOUT changing code (library data, search words, settings, regenerating a scene), most useful first.
- "gelistirmeler": up to 5 code developments to PROPOSE to the owner (they are approved by the owner before anyone builds them), most valuable first.
Each item: {"baslik": "...", "neden": "...", "beyin": "arastirma|kurgu|kostum|ortam|ses|kalite"}.
Return ONLY JSON: {"ozet": "...", "onlemler": [...], "gelistirmeler": [...]}`;
  const out = await input.budget.generate("sef-degerlendirme", input.model, prompt, { maxTokens: 1_500 });
  const raw = readJsonAnswer<{ ozet?: unknown; onlemler?: unknown; gelistirmeler?: unknown }>(out.result.content);
  if (!raw) return undefined;
  return { ozet: typeof raw.ozet === "string" ? raw.ozet : "", onlemler: chiefItems(raw.onlemler), gelistirmeler: chiefItems(raw.gelistirmeler) };
}

/**
 * Writes the production report next to the episode and appends a summary line to AYAS's inbox
 * (`<workRoot>/_kutuphane/ayas-gelen-kutusu.jsonl`, append-only). AYAS reads the inbox; nothing here acts on it.
 */
export async function writeCouncilReport(input: { readonly workDir: string; readonly workRoot: string; readonly bolum: string; readonly log: CouncilLog; readonly plan?: ChiefPlan }): Promise<string> {
  const file = path.join(input.workDir, "yapim-raporu.json");
  const report = { bolum: input.bolum, tarih: new Date().toISOString(), sef: input.plan ?? null, bulgular: input.log.findings, tartismalar: input.log.debates };
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  const inbox = path.join(input.workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl");
  await fs.mkdir(path.dirname(inbox), { recursive: true });
  const line = {
    tarih: report.tarih,
    kaynak: "atolye-v3",
    bolum: input.bolum,
    rapor: file,
    eksik: input.log.findings.filter((f) => f.onem === "eksik").length,
    uyari: input.log.findings.filter((f) => f.onem === "uyari").length,
    onlemler: input.plan?.onlemler.length ?? 0,
    gelistirmeler: input.plan?.gelistirmeler.length ?? 0,
    ozet: input.plan?.ozet ?? "",
  };
  await fs.appendFile(inbox, `${JSON.stringify(line)}\n`);
  return file;
}

/** A markdown view of the report for the owner (Turkish). */
export function councilMarkdown(bolum: string, log: CouncilLog, plan?: ChiefPlan): string {
  const by = (o: Finding["onem"]) => log.findings.filter((f) => f.onem === o);
  const line = (f: Finding) => `- **${BRAIN_NAMES[f.beyin]}** — ${f.baslik}${f.yer ? ` (${f.yer})` : ""}: ${f.ayrinti}${f.oneri ? ` → ${f.oneri}` : ""} _[${f.tur}]_`;
  const parts = [`# Yapım kurulu raporu — ${bolum}`, ""];
  if (plan) {
    parts.push("## Şef (AYAS adına)", "", plan.ozet, "");
    const item = (o: ChiefItem) => `- ${o.baslik}${o.neden ? ` — ${o.neden}` : ""}${o.beyin ? ` _(${BRAIN_NAMES[o.beyin]})_` : ""}`;
    const onlemler = chiefItems(plan.onlemler);
    const gelistirmeler = chiefItems(plan.gelistirmeler);
    if (onlemler.length) parts.push("**Önlemler (Atölye kendisi alır, kod değişmez):**", ...onlemler.map(item), "");
    if (gelistirmeler.length) parts.push("**Geliştirme önerileri (owner onayı gerekir):**", ...gelistirmeler.map(item), "");
  }
  for (const [o, title] of [["eksik", "Eksikler"], ["uyari", "Uyarılar"], ["bilgi", "Bilgi"]] as const) {
    const list = by(o);
    if (list.length) parts.push(`## ${title}`, "", ...list.map(line), "");
  }
  if (log.debates.length) {
    parts.push("## Tartışmalar", "");
    for (const d of log.debates) parts.push(`### ${BRAIN_NAMES[d.beyin]}: ${d.konu}`, "", ...d.kayit.map((e) => `- **${e.rol}:** ${e.metin}`), "");
  }
  return `${parts.join("\n")}\n`;
}

export async function readInbox(workRoot: string): Promise<unknown[]> {
  const inbox = path.join(workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl");
  if (!existsSync(inbox)) return [];
  return (await fs.readFile(inbox, "utf8")).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as unknown);
}
