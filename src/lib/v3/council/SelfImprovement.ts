import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type BrainId, BRAIN_NAMES, type Finding } from "./Council";
import type { DevJob } from "./DevQueue";
import { overlap } from "./TextOverlap";

/**
 * The brains' self-improvement while no video is being made (owner approval, 2 Nov 2026): they study the videos the
 * owner linked and videos similar to the studio's own, compare their own delivered videos with those references and
 * write lessons, sit their exams, and change their own prompt additions and settings — a change is kept only when the
 * exam measures it better, otherwise it is taken back and never tried again. A change to code is never made here: it
 * becomes a proposal in the Gelişim Merkezi, and only the owner's approval puts it in the development queue (DevQueue),
 * where the studio's developer builds it in a worktree of its own (Developer).
 * Everything lives under `<workRoot>/_kutuphane/gelisim/`.
 */
export function improvementDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "gelisim");
}

/** The idle loop's tasks, in the order a cycle runs them. */
export const CYCLE_TASKS = ["istekler", "karsilastir", "oneriler", "benzer", "pekistir", "sinav", "ayar", "gelistir"] as const;
export type CycleTask = (typeof CYCLE_TASKS)[number];

export const TASK_NAMES: Readonly<Record<CycleTask, string>> = {
  istekler: "owner'ın verdiği videoları inceleme",
  karsilastir: "kendi videolarını referanslarla karşılaştırma",
  oneriler: "kod önerilerini Gelişim Merkezi'ne toplama",
  benzer: "ilgili videoları kendi arayıp inceleme",
  pekistir: "öğrenilenleri pekiştirme",
  sinav: "kalite beyninin sınavı",
  ayar: "istem eki ve ayar denemesi",
  gelistir: "onaylanan bir öneriyi geliştirme (kuyruk)",
};

/**
 * How often a task may run (hours). The search runs every cycle (owner, 2 Nov 2026: "don't wait for my links — study
 * related videos on the internet by yourself"); the exam and the tuning use the GPU for minutes, so once a day.
 */
export const TASK_EVERY_H: Readonly<Record<CycleTask, number>> = { istekler: 0, karsilastir: 0, oneriler: 0, benzer: 0, pekistir: 24, sinav: 24, ayar: 24, gelistir: 0 };

/** The pause between two full cycles of the idle loop (owner, 2 Nov 2026: "4 hours"; `ATOLYE_V3_GELISIM_ARALIK_SA` overrides). */
export const CYCLE_EVERY_H = 4;

/** Videos the loop studies on its own per cycle and per day (each ~1.5 cents and ~2 minutes of the eye). */
export const STUDIES_PER_CYCLE = 2;
export const STUDIES_PER_DAY = 10;

export interface TaskResult {
  readonly gorev: CycleTask;
  readonly sonuc: "tamam" | "atlandi" | "hata";
  /** Turkish, for the owner's report. */
  readonly ayrinti: string;
  readonly bitis: string;
}

export interface CycleRecord {
  readonly basla: string;
  readonly bitis: string;
  readonly gorevler: readonly TaskResult[];
  /** Why the cycle stopped early (an order came in). */
  readonly durdu?: string;
  readonly maliyetUsd: number;
}

const readLines = async <T>(file: string): Promise<T[]> =>
  existsSync(file)
    ? (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l) as T];
        } catch {
          return [];
        }
      })
    : [];

export async function recordCycle(workRoot: string, c: CycleRecord): Promise<void> {
  const dir = improvementDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, "donguler.jsonl"), `${JSON.stringify(c)}\n`);
}

export async function listCycles(workRoot: string): Promise<CycleRecord[]> {
  return readLines<CycleRecord>(path.join(improvementDir(workRoot), "donguler.jsonl"));
}

/** When a task last finished "tamam" (an "atlandi" pass does not count: nothing was done). */
export function lastDone(cycles: readonly CycleRecord[], task: CycleTask): number | undefined {
  let last: number | undefined;
  for (const c of cycles) for (const t of c.gorevler) if (t.gorev === task && t.sonuc === "tamam") last = Math.max(last ?? 0, Date.parse(t.bitis));
  return last;
}

export function taskDue(cycles: readonly CycleRecord[], task: CycleTask, now = Date.now()): boolean {
  const last = lastDone(cycles, task);
  return last === undefined || now - last >= TASK_EVERY_H[task] * 3_600_000;
}

/** Whether the idle loop should run a cycle now: the pause since the last one is over, or a study request waits. */
export function cycleDue(cycles: readonly CycleRecord[], opts: { readonly everyH?: number; readonly requestsWaiting?: boolean; readonly now?: number } = {}): boolean {
  if (opts.requestsWaiting) return true;
  const last = cycles.at(-1);
  return !last || (opts.now ?? Date.now()) - Date.parse(last.bitis) >= (opts.everyH ?? CYCLE_EVERY_H) * 3_600_000;
}

/**
 * A development proposal for the owner (Gelişim Merkezi): something only a code change can fix. The brains only ever
 * write it; the owner approves or rejects it, and an approved one waits in the development queue for the developer.
 */
export interface DevProposal {
  readonly id: string;
  readonly tarih: string;
  readonly beyin: BrainId;
  readonly baslik: string;
  readonly neden: string;
  /** The productions that raised it (an order id or an episode title). */
  readonly kaynaklar: readonly string[];
  /** How many times it was raised. */
  readonly sayi: number;
  /**
   * olcum: a brain measured a fault only code can fix (a whine in the mix); fikir: the manager's idea for a development.
   * The first Caesar harvest (2 Nov 2026) gave 19 proposals, most of them generic ideas, one for a composer the studio
   * already has: an idea asks for the owner only once it comes back from another production.
   */
  readonly kaynakTuru?: "olcum" | "fikir";
  /**
   * onaylandi: in the development queue (DevQueue); yapiliyor: the developer is building it; hazir: built and checked on
   * its own branch, waiting to be applied; yapilamadi: the build was thrown away (why in `is`); yapildi: in the studio.
   */
  durum: "bekliyor" | "onaylandi" | "reddedildi" | "yapiliyor" | "hazir" | "yapilamadi" | "yapildi";
  karar?: { readonly tarih: string; readonly not?: string };
  /** The developer's work on it. */
  is?: DevJob;
}

/** Rewrites one proposal (the developer's progress, a closing note); the change is atomic like every proposal write. */
export async function updateProposal(workRoot: string, id: string, change: (p: DevProposal) => DevProposal): Promise<DevProposal> {
  const hit = (await listProposals(workRoot)).find((x) => x.proposal.id === id);
  if (!hit) throw new Error(`V3_PROPOSAL_NOT_FOUND: ${id}`);
  const next = change(hit.proposal);
  await writeProposal(hit.file, next);
  return next;
}

/** An idea needs the owner once this many productions raised it; a measured fault at once. */
export const IDEA_REPEATS = 2;

/** Whether a waiting proposal is put before the owner (the rest wait as ideas until they come back). */
export function needsOwner(p: Pick<DevProposal, "durum" | "kaynakTuru" | "sayi">): boolean {
  return p.durum === "bekliyor" && (p.kaynakTuru === "olcum" || p.sayi >= IDEA_REPEATS);
}

export function proposalDir(workRoot: string): string {
  return path.join(improvementDir(workRoot), "oneriler");
}

export async function listProposals(workRoot: string): Promise<{ file: string; proposal: DevProposal }[]> {
  const dir = proposalDir(workRoot);
  if (!existsSync(dir)) return [];
  const out: { file: string; proposal: DevProposal }[] = [];
  for (const n of (await fs.readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    try {
      out.push({ file: path.join(dir, n), proposal: JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as DevProposal });
    } catch {
      // Read next time.
    }
  }
  return out;
}

async function writeProposal(file: string, p: DevProposal): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(p, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/** A proposal counts as the same one when its title shares this much with an earlier one of the same brain. */
export const SAME_PROPOSAL = 0.45;

/**
 * Adds a proposal, or counts it again on the one it repeats (same brain, similar title): the owner sees how often a
 * want came back instead of the same thing ten times. A rejected want is counted, never reopened.
 */
export async function proposeDevelopment(workRoot: string, p: { readonly beyin: BrainId; readonly baslik: string; readonly neden: string; readonly kaynak: string; readonly kaynakTuru?: DevProposal["kaynakTuru"] }, now = new Date()): Promise<"yeni" | "tekrar"> {
  const all = await listProposals(workRoot);
  const same = all.find((x) => x.proposal.beyin === p.beyin && overlap(x.proposal.baslik, p.baslik) >= SAME_PROPOSAL);
  if (same) {
    const q = same.proposal;
    // Raised again by the same production counts nothing; by another, once more. A measured repeat makes it measured.
    const again = !q.kaynaklar.includes(p.kaynak);
    await writeProposal(same.file, { ...q, sayi: q.sayi + (again ? 1 : 0), kaynaklar: [...new Set([...q.kaynaklar, p.kaynak])].slice(-10), ...(p.kaynakTuru === "olcum" ? { kaynakTuru: "olcum" as const } : {}) });
    return "tekrar";
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const id = `${stamp}-${p.beyin}-${all.length + 1}`;
  await writeProposal(path.join(proposalDir(workRoot), `${id}.json`), { id, tarih: now.toISOString(), beyin: p.beyin, baslik: p.baslik.slice(0, 200), neden: p.neden.slice(0, 600), kaynaklar: [p.kaynak], sayi: 1, kaynakTuru: p.kaynakTuru ?? "fikir", durum: "bekliyor" });
  return "yeni";
}

/** The owner's decision on a proposal (the Gelişim Merkezi's buttons or `gelisim.ts onayla|reddet`). Nothing is built here. */
export async function decideProposal(workRoot: string, id: string, durum: "onaylandi" | "reddedildi", not?: string, now = new Date()): Promise<DevProposal> {
  const hit = (await listProposals(workRoot)).find((x) => x.proposal.id === id);
  if (!hit) throw new Error(`V3_PROPOSAL_NOT_FOUND: ${id}`);
  if (hit.proposal.durum !== "bekliyor") throw new Error(`V3_PROPOSAL_DECIDED: ${id} zaten "${hit.proposal.durum}"`);
  const next: DevProposal = { ...hit.proposal, durum, karar: { tarih: now.toISOString(), ...(not?.trim() ? { not: not.trim().slice(0, 300) } : {}) } };
  await writeProposal(hit.file, next);
  return next;
}

/**
 * The code wants of one production's report: the manager's development proposals and the findings that only code
 * can fix ("kod"); a finding about one repair the repair brain made up itself is left out (it is not a want).
 */
export function wantsOf(report: { readonly sef?: { readonly gelistirmeler?: readonly { readonly baslik?: string; readonly neden?: string; readonly beyin?: BrainId }[] } | null; readonly bulgular?: readonly Finding[] }): { beyin: BrainId; baslik: string; neden: string; kaynakTuru: "olcum" | "fikir" }[] {
  const chief = (report.sef?.gelistirmeler ?? []).flatMap((g) => (g?.baslik ? [{ beyin: g.beyin && g.beyin in BRAIN_NAMES ? g.beyin : ("sef" as BrainId), baslik: g.baslik, neden: g.neden ?? "", kaynakTuru: "fikir" as const }] : []));
  const code = (report.bulgular ?? []).filter((f) => f.tur === "kod" && f.beyin !== "onarim").map((f) => ({ beyin: f.beyin, baslik: f.baslik, neden: `${f.ayrinti}${f.oneri ? ` → ${f.oneri}` : ""}`, kaynakTuru: "olcum" as const }));
  return [...chief, ...code];
}

/**
 * Turns one production report's code wants into proposals, once per report (the production does it as it delivers;
 * the idle loop catches reports delivered before). Returns how many were new and how many repeated an earlier want.
 */
export async function harvestReport(workRoot: string, reportFile: string, kaynak: string): Promise<{ yeni: number; tekrar: number } | undefined> {
  const seenFile = path.join(improvementDir(workRoot), "toplanan-raporlar.json");
  const seen: string[] = existsSync(seenFile) ? (JSON.parse(await fs.readFile(seenFile, "utf8")) as string[]) : [];
  // (Never lower-cased: "İ" in D:\ÜRETİM lower-cases to two characters.)
  const key = path.resolve(reportFile);
  if (seen.includes(key) || !existsSync(reportFile)) return undefined;
  const wants = wantsOf(JSON.parse(await fs.readFile(reportFile, "utf8")) as Parameters<typeof wantsOf>[0]);
  let yeni = 0, tekrar = 0;
  for (const w of wants) {
    if ((await proposeDevelopment(workRoot, { ...w, kaynak })) === "yeni") yeni++;
    else tekrar++;
  }
  await fs.mkdir(improvementDir(workRoot), { recursive: true });
  await fs.writeFile(`${seenFile}.tmp`, JSON.stringify([...seen, key].slice(-500)));
  await fs.rename(`${seenFile}.tmp`, seenFile);
  return { yeni, tekrar };
}

/**
 * A brain's own prompt additions and settings, each tried before it is kept: "deneniyor" while its exam runs,
 * "kalici" when the exam measured it better, "geri_alindi" when not (never tried again).
 */
export interface PromptAddition {
  readonly metin: string;
  readonly tarih: string;
  durum: "deneniyor" | "kalici" | "geri_alindi";
  /** The exam's balanced accuracy (%) without and with it. */
  olcumOnce?: number;
  olcumSonra?: number;
  readonly neden?: string;
}

export interface BrainTuning {
  readonly ekler: Partial<Record<BrainId, PromptAddition[]>>;
  /** Settings the brain chose by measure (only the allowed keys of TUNABLE_SETTINGS). */
  readonly ayarlar: Partial<Record<BrainId, Record<string, boolean>>>;
  readonly ayarGecmisi: readonly { readonly tarih: string; readonly beyin: BrainId; readonly anahtar: string; readonly deger: boolean; readonly once: number; readonly sonra: number; readonly kalici: boolean }[];
}

/** What a brain may change of itself; anything else is a code proposal. */
export const TUNABLE_SETTINGS: Readonly<Partial<Record<BrainId, readonly string[]>>> = { kalite: ["ornekler", "sabit"] };

/** How many exam runs each side of the steady-judge trial gets, and how often that trial is repeated. */
export const STEADY_TRIAL_RUNS = 3;
export const STEADY_TRIAL_EVERY_DAYS = 7;

/**
 * The steady judge's trial (owner's rule, 2 Nov 2026: "kept if accuracy does not drop, taken back if it does"): three
 * runs each way; kept when its mean is not below the noisy judge's mean. Its own runs should agree (it has no chance);
 * when they do not, the seed is not honoured and it is not kept.
 */
export function steadyVerdict(base: readonly number[], steady: readonly number[]): { readonly once: number; readonly sonra: number; readonly kalici: boolean; readonly tutarli: boolean } {
  const mean = (xs: readonly number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
  const tutarli = steady.length > 0 && Math.max(...steady) - Math.min(...steady) === 0;
  const once = mean(base), sonra = mean(steady);
  return { once, sonra, tutarli, kalici: base.length >= STEADY_TRIAL_RUNS && steady.length >= STEADY_TRIAL_RUNS && tutarli && sonra >= once };
}

/** Whether a setting was tried within the last `days` (its trial is not repeated sooner). */
export function settingTriedWithin(t: BrainTuning, beyin: BrainId, key: string, days: number, now = Date.now()): boolean {
  return t.ayarGecmisi.some((h) => h.beyin === beyin && h.anahtar === key && now - Date.parse(h.tarih) < days * 86_400_000);
}
/** At most this many kept prompt additions per brain (the oldest goes when a new one is kept). */
export const MAX_ADDITIONS = 5;
/** An addition or setting is kept only when it raises the exam's balanced accuracy by at least this many points. */
export const MIN_GAIN = 5;

const tuningFile = (workRoot: string) => path.join(improvementDir(workRoot), "beyin-ayarlari.json");

export async function readTuning(workRoot: string): Promise<BrainTuning> {
  try {
    const t = JSON.parse(await fs.readFile(tuningFile(workRoot), "utf8")) as Partial<BrainTuning>;
    return { ekler: t.ekler ?? {}, ayarlar: t.ayarlar ?? {}, ayarGecmisi: t.ayarGecmisi ?? [] };
  } catch {
    return { ekler: {}, ayarlar: {}, ayarGecmisi: [] };
  }
}

export async function writeTuning(workRoot: string, t: BrainTuning): Promise<void> {
  await fs.mkdir(improvementDir(workRoot), { recursive: true });
  await fs.writeFile(`${tuningFile(workRoot)}.tmp`, `${JSON.stringify(t, null, 2)}\n`);
  await fs.rename(`${tuningFile(workRoot)}.tmp`, tuningFile(workRoot));
}

/** A brain's kept prompt additions (production and exam read them with the owner's rules). */
export async function activeAdditions(workRoot: string, beyin: BrainId): Promise<string[]> {
  return ((await readTuning(workRoot)).ekler[beyin] ?? []).filter((a) => a.durum === "kalici").map((a) => a.metin);
}

/** A setting the brain chose by measure, if any (the environment still overrides it where the code reads both). */
export async function tunedSetting(workRoot: string, beyin: BrainId, key: string): Promise<boolean | undefined> {
  return (await readTuning(workRoot)).ayarlar[beyin]?.[key];
}

/** Whether an addition was already tried (kept or taken back): the same text is never tried twice. */
export function triedBefore(t: BrainTuning, beyin: BrainId, metin: string): boolean {
  return (t.ekler[beyin] ?? []).some((a) => overlap(a.metin, metin) >= 0.7);
}

/**
 * Whether a change measured better beyond the exam's own noise: the same quality exam gave 90 % and 73 % a few
 * minutes apart (2 Nov 2026; one of its 8 answers moves the balanced score by ~12 points). With one run each a change
 * is kept on no evidence; a promising change is measured twice, and kept only when both of its runs beat both runs
 * without it and the means differ by MIN_GAIN.
 */
export function confirmedGain(base: readonly number[], cand: readonly number[]): { readonly once: number; readonly sonra: number; readonly kalici: boolean } {
  const mean = (xs: readonly number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
  const once = mean(base), sonra = mean(cand);
  return { once, sonra, kalici: base.length >= 2 && cand.length >= 2 && sonra - once >= MIN_GAIN && Math.min(...cand) > Math.max(...base) };
}

/** The exam's verdict on a tried addition: kept with at least MIN_GAIN points more (or as `keep` says), taken back otherwise. */
export function settleAddition(t: BrainTuning, beyin: BrainId, add: Omit<PromptAddition, "durum" | "olcumOnce" | "olcumSonra">, once: number, sonra: number, keep = sonra - once >= MIN_GAIN): BrainTuning {
  const tried: PromptAddition = { ...add, durum: keep ? "kalici" : "geri_alindi", olcumOnce: once, olcumSonra: sonra };
  const list = [...(t.ekler[beyin] ?? []), tried];
  const kept = list.filter((a) => a.durum === "kalici");
  // Too many kept: the oldest kept one is taken back (its text stays in the list, so it is not tried again).
  const trimmed = kept.length > MAX_ADDITIONS ? list.map((a) => (a === kept[0] ? { ...a, durum: "geri_alindi" as const } : a)) : list;
  return { ...t, ekler: { ...t.ekler, [beyin]: trimmed } };
}

export function settleSetting(t: BrainTuning, beyin: BrainId, key: string, value: boolean, once: number, sonra: number, now = new Date(), keep = sonra - once >= MIN_GAIN): BrainTuning {
  if (!TUNABLE_SETTINGS[beyin]?.includes(key)) throw new Error(`V3_SETTING_NOT_TUNABLE: ${beyin}.${key}`);
  return {
    ...t,
    ayarlar: keep ? { ...t.ayarlar, [beyin]: { ...(t.ayarlar[beyin] ?? {}), [key]: value } } : t.ayarlar,
    ayarGecmisi: [...t.ayarGecmisi, { tarih: now.toISOString(), beyin, anahtar: key, deger: value, once, sonra, kalici: keep }].slice(-50),
  };
}

/** The tuner's prompt: one short rule for the quality judge from the exam's wrong answers. */
export function additionPrompt(wrong: readonly { readonly tur: string; readonly kusurlu: boolean; readonly beklenen: string; readonly cevap: string }[], current: readonly string[], tried: readonly string[]): string {
  return `You tune the instructions of a vision model that checks frames of animated history videos for faults. In its exam it judged these frames wrongly:
${wrong.map((w) => `- a ${w.tur} frame that is ${w.kusurlu ? `FAULTY (${w.beklenen})` : `CLEAN (${w.beklenen})`}; the model said: ${w.cevap}`).join("\n")}
Its current extra rules: ${current.length ? current.map((r) => `"${r}"`).join("; ") : "none"}.
Rules tried before that did not help (do not repeat them): ${tried.length ? tried.map((r) => `"${r}"`).join("; ") : "none"}.
Write ONE new short rule (at most 200 characters, English) that would help the model judge such frames correctly, general enough for any video (never name a person, place or episode). Return ONLY JSON: {"kural": "...", "neden": "<one Turkish sentence>"}`;
}

/** The cycle as a Turkish summary line (AYAS's inbox, the Gelişim Merkezi). */
export function cycleLine(c: CycleRecord): string {
  const done = c.gorevler.filter((t) => t.sonuc !== "atlandi");
  return `${done.length ? done.map((t) => `${TASK_NAMES[t.gorev]}: ${t.ayrinti}`).join(" · ") : "yapılacak iş yoktu"}${c.durdu ? ` (durdu: ${c.durdu})` : ""}`;
}
