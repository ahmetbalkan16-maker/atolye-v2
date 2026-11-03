import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { improvementDir } from "./SelfImprovement";

/**
 * The studio's own developer brain (owner, 3 Nov 2026: "Claude yerine Atölye kendi geliştirici programını yazsın … gün
 * boyunca biriksin, araştırsın, her akşam Claude işlesin; yapılanları tecrübe edecek, kendini geliştirecek"). An
 * apprentice: during the day it researches every approved job — which files, whether the studio already does it — and
 * writes its guess down BEFORE the master (Claude, in the evening) builds it; afterwards it grades its guess against what
 * really changed and keeps the difference as experience. It learns the same way from every V3 commit a development
 * session makes: the commit's subject is the task, its files the answer, the guess made at the commit's parent.
 *
 * Its knowledge: a memory of past changes (task words → files) and small "instincts" (one trigger, one file, a
 * confidence that rises with each confirmation and falls with each miss: candidate → confirmed → dropped — the
 * continuous-learning and self-improving-agent skills' lifecycle), plus short written lessons. Its report card says how
 * close its guesses came; the owner decides from it when the apprentice may do more. Nothing here changes code, and
 * nothing here starts a process (the live server reads the report card).
 */
export function devBrainDir(workRoot: string): string {
  return path.join(improvementDir(workRoot), "gelistirici");
}

/** The most files a guess names. */
export const MAX_GUESS_FILES = 6;

/** What the brain expects a task to need, written before anyone builds it. */
export interface DevGuess {
  /** The job's proposal id, or the commit's sha. */
  readonly id: string;
  readonly kaynak: "is" | "commit";
  readonly tarih: string;
  readonly gorev: string;
  readonly dosyalar: readonly string[];
  /** var: the studio already does it; yapilmali: it needs a change. */
  readonly karar: "var" | "yapilmali";
  /** Turkish, a few sentences. */
  readonly plan: string;
  /** The smoke suite it would prove the change with. */
  readonly test?: string;
  /** Its search's best candidates before it chose (to tell a bad search from a bad choice). */
  readonly adaylar: readonly string[];
  readonly model: string;
}

/** How close a guess came to what really changed. */
export interface DevGrade {
  readonly id: string;
  readonly kaynak: "is" | "commit";
  readonly tarih: string;
  readonly gorev: string;
  readonly tahmin: readonly string[];
  readonly gercek: readonly string[];
  /** Share of the really changed files it named (0..1). */
  readonly isabet: number;
  /** Share of the files it named that really changed (0..1). */
  readonly kesinlik: number;
  /** Share of the really changed files among its search's candidates (0..1). */
  readonly adayIsabet: number;
  /** Jobs only: whether it was right that the studio already did it (or did not). */
  readonly kararDogru?: boolean;
}

/** One learned association: a task like `tetik` touches `dosya`. */
export interface Instinct {
  readonly tetik: string;
  readonly dosya: string;
  readonly guven: number;
  readonly durum: "aday" | "dogrulandi" | "reddedildi";
  /** Where it was seen (job ids, commit shas), newest last. */
  readonly kanit: readonly string[];
  readonly tarih: string;
}

/** One change the brain has seen made. */
export interface PastChange {
  readonly id: string;
  readonly tarih: string;
  readonly mesaj: string;
  readonly dosyalar: readonly string[];
}

/** One line the brain says (the homepage's council and the Gelişim Merkezi show it). */
export interface DevTalk {
  readonly tarih: string;
  readonly metin: string;
  /** Whom it speaks to, when it is someone ("Claude", "AYAS"). */
  readonly kime?: string;
}

/** The files a change is graded on: the V3 studio's code and data — not its notes, not its tests (chosen apart). */
export function gradedFiles(files: readonly string[]): string[] {
  return [...new Set(files.map((f) => f.replace(/\\/g, "/")))].filter((f) => /^(src\/lib\/v3\/|scripts\/v3\/|remotion-v3\/src\/|content\/v3\/)/.test(f) && !/\.md$/i.test(f)).sort();
}

const STOP = new Set(
  "ve ile icin gibi daha olan olarak artik once sonra kadar her bir bu su da de ki mi ne yok var gore uzerine yerine ayni yeni eski tek iki uc cok az the and with from that this into when then than for not are was were has have its it's also only v3 feat fix wip docs chore"
    .split(" "),
);

/** A text's words as the brain compares them (Turkish letters folded, short and common words dropped). */
export function taskWords(s: string): string[] {
  const folded = s.replace(/ı/g, "i").replace(/İ/g, "I").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return [...new Set(folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

/** How much two tasks share (0..1): the words they share against the shorter one's words. */
export function similarity(a: string, b: string): number {
  const x = new Set(taskWords(a)), y = new Set(taskWords(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size);
}

/** Grades a guess against the files that really changed. */
export function gradeGuess(g: Pick<DevGuess, "id" | "kaynak" | "gorev" | "dosyalar" | "adaylar" | "karar">, changed: readonly string[], now = new Date()): DevGrade {
  const real = gradedFiles(changed);
  const named = gradedFiles(g.dosyalar);
  const hit = named.filter((f) => real.includes(f)).length;
  const cand = new Set(gradedFiles(g.adaylar));
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    id: g.id,
    kaynak: g.kaynak,
    tarih: now.toISOString(),
    gorev: g.gorev,
    tahmin: named,
    gercek: real,
    // Nothing to change and nothing named is a full hit.
    isabet: round(real.length ? hit / real.length : named.length ? 0 : 1),
    kesinlik: round(named.length ? hit / named.length : real.length ? 0 : 1),
    adayIsabet: round(real.length ? real.filter((f) => cand.has(f)).length / real.length : 1),
    ...(g.kaynak === "is" ? { kararDogru: (g.karar === "var") === (real.length === 0) } : {}),
  };
}

/** A trigger fires on a task when they share this much. */
export const FIRE_AT = 0.5;
const CONFIRM_STEP = 0.15;
const MISS_STEP = 0.1;
export const START_CONFIDENCE = 0.4;
const MAX_CONFIDENCE = 0.9;
const DROP_BELOW = 0.2;
const MAX_INSTINCTS = 1_500;

/** The instincts that fire on a task, strongest first. */
export function firedInstincts(list: readonly Instinct[], task: string): Instinct[] {
  return list.filter((i) => i.durum !== "reddedildi" && similarity(i.tetik, task) >= FIRE_AT).sort((a, b) => b.guven - a.guven);
}

/**
 * The instincts after one answer: each file that really changed confirms the instinct that pointed to it (or starts a
 * candidate); each instinct that fired on the task but pointed to a file left alone loses confidence, and is dropped
 * when it falls low enough. Confirmed = confident and seen in at least two places.
 */
export function learnInstincts(list: readonly Instinct[], task: string, changed: readonly string[], source: string, now = new Date()): Instinct[] {
  const real = gradedFiles(changed);
  const trigger = taskWords(task).slice(0, 8).join(" ");
  if (!trigger) return [...list];
  const out = list.map((i) => ({ ...i }));
  const fired = (i: Instinct) => i.durum !== "reddedildi" && similarity(i.tetik, task) >= FIRE_AT;
  const settle = (i: Instinct, guven: number, kanit: readonly string[]): Instinct => {
    const g = Math.round(Math.min(MAX_CONFIDENCE, Math.max(0, guven)) * 100) / 100;
    return { ...i, guven: g, kanit, durum: g < DROP_BELOW ? "reddedildi" : g >= 0.6 && kanit.length >= 2 ? "dogrulandi" : "aday" };
  };
  for (const f of real) {
    const k = out.findIndex((i) => i.dosya === f && fired(i));
    if (k >= 0) {
      const i = out[k]!;
      // The same source twice confirms nothing.
      if (!i.kanit.includes(source)) out[k] = settle(i, i.guven + CONFIRM_STEP, [...i.kanit, source].slice(-6));
    } else out.push({ tetik: trigger, dosya: f, guven: START_CONFIDENCE, durum: "aday", kanit: [source], tarih: now.toISOString() });
  }
  for (let k = 0; k < out.length; k++) {
    const i = out[k]!;
    if (fired(i) && !real.includes(i.dosya) && !i.kanit.includes(source)) out[k] = settle(i, i.guven - MISS_STEP, i.kanit);
  }
  // Too many: the dropped ones go first, then the weakest.
  return out.length <= MAX_INSTINCTS ? out : [...out].sort((a, b) => Number(a.durum === "reddedildi") - Number(b.durum === "reddedildi") || b.guven - a.guven).slice(0, MAX_INSTINCTS);
}

/**
 * Past changes most like a task (only ones made by `before`, never the task's own). Dates are compared as instants: a
 * commit's date carries its offset (+03:00), a job's is UTC, and commits made in one second share theirs.
 */
export function similarChanges(past: readonly PastChange[], task: string, opts: { readonly before?: string; readonly exclude?: string; readonly limit?: number } = {}): (PastChange & { readonly benzerlik: number })[] {
  const until = opts.before ? Date.parse(opts.before) : Infinity;
  return past
    .filter((c) => c.id !== opts.exclude && Date.parse(c.tarih) <= until)
    .map((c) => ({ ...c, benzerlik: similarity(c.mesaj, task) }))
    .filter((c) => c.benzerlik >= 0.25)
    .sort((a, b) => b.benzerlik - a.benzerlik)
    .slice(0, opts.limit ?? 5);
}

/** How ready the apprentice is, from its last grades. */
export interface Readiness {
  readonly n: number;
  readonly isabet: number;
  readonly kesinlik: number;
  readonly adayIsabet: number;
  /** Jobs only. */
  readonly karar?: number;
  readonly seviye: "baslangic" | "ogreniyor" | "yaklasiyor" | "hazir";
  /** Turkish, one line. */
  readonly ozet: string;
}

export const READY_WINDOW = 20;

export function readiness(grades: readonly DevGrade[]): Readiness {
  const last = grades.slice(-READY_WINDOW);
  const mean = (xs: readonly number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : 0);
  const isabet = mean(last.map((g) => g.isabet)), kesinlik = mean(last.map((g) => g.kesinlik)), adayIsabet = mean(last.map((g) => g.adayIsabet));
  const decided = last.filter((g) => g.kararDogru !== undefined);
  const karar = decided.length ? mean(decided.map((g) => (g.kararDogru ? 1 : 0))) : undefined;
  const seviye = last.length < 5 ? "baslangic" : last.length >= READY_WINDOW && isabet >= 80 && kesinlik >= 60 ? "hazir" : isabet >= 60 ? "yaklasiyor" : "ogreniyor";
  const name = { baslangic: "yeni başladı", ogreniyor: "öğreniyor", yaklasiyor: "yaklaşıyor", hazir: "hazır olabilir" }[seviye];
  // (Percentages without a case ending: Turkish picks it by how the number is read.)
  const ozet = last.length
    ? `${name} — son ${last.length} işte: değişen dosyaları bulma %${isabet} · andığı dosyalarda doğruluk %${kesinlik} · arama kapsamı %${adayIsabet}${karar !== undefined ? ` · "zaten var mı" kararı %${karar}` : ""}`
    : "henüz bir tahmini notlanmadı";
  return { n: last.length, isabet, kesinlik, adayIsabet, ...(karar !== undefined ? { karar } : {}), seviye, ozet };
}

const file = (workRoot: string, name: string) => path.join(devBrainDir(workRoot), name);

async function readLines<T>(f: string): Promise<T[]> {
  if (!existsSync(f)) return [];
  return (await fs.readFile(f, "utf8")).split(/\r?\n/).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as T];
    } catch {
      return [];
    }
  });
}

async function append(workRoot: string, name: string, value: unknown): Promise<void> {
  await fs.mkdir(devBrainDir(workRoot), { recursive: true });
  await fs.appendFile(file(workRoot, name), `${JSON.stringify(value)}\n`);
}

export const recordGuess = (workRoot: string, g: DevGuess) => append(workRoot, "tahminler.jsonl", g);
export const recordGrade = (workRoot: string, g: DevGrade) => append(workRoot, "karne.jsonl", g);
export const recordChange = (workRoot: string, c: PastChange) => append(workRoot, "gecmis.jsonl", c);
export const listGuesses = (workRoot: string) => readLines<DevGuess>(file(workRoot, "tahminler.jsonl"));
export const listGrades = (workRoot: string) => readLines<DevGrade>(file(workRoot, "karne.jsonl"));
export const listChanges = (workRoot: string) => readLines<PastChange>(file(workRoot, "gecmis.jsonl"));

/** The latest guess for a job or commit. */
export async function lastGuess(workRoot: string, id: string): Promise<DevGuess | undefined> {
  return (await listGuesses(workRoot)).filter((g) => g.id === id).at(-1);
}

export async function readInstincts(workRoot: string): Promise<Instinct[]> {
  try {
    return JSON.parse(await fs.readFile(file(workRoot, "icguduler.json"), "utf8")) as Instinct[];
  } catch {
    return [];
  }
}

export async function writeInstincts(workRoot: string, list: readonly Instinct[]): Promise<void> {
  await fs.mkdir(devBrainDir(workRoot), { recursive: true });
  const f = file(workRoot, "icguduler.json");
  await fs.writeFile(`${f}.tmp`, `${JSON.stringify(list, null, 1)}\n`);
  await fs.rename(`${f}.tmp`, f);
}

/** A written lesson: what the master did that the apprentice did not see coming. */
export interface DevLesson {
  readonly tarih: string;
  readonly id: string;
  readonly metin: string;
}

export const recordLesson = (workRoot: string, l: DevLesson) => append(workRoot, "dersler.jsonl", { ...l, metin: l.metin.replace(/\s+/g, " ").trim().slice(0, 300) });
export const listLessons = (workRoot: string) => readLines<DevLesson>(file(workRoot, "dersler.jsonl"));

export async function say(workRoot: string, metin: string, kime?: string, now = new Date()): Promise<void> {
  await append(workRoot, "akis.jsonl", { tarih: now.toISOString(), metin: metin.replace(/\s+/g, " ").trim().slice(0, 280), ...(kime ? { kime } : {}) } satisfies DevTalk);
}

export async function recentTalk(workRoot: string, n = 10): Promise<DevTalk[]> {
  return (await readLines<DevTalk>(file(workRoot, "akis.jsonl"))).slice(-n);
}

/** Where a job's research note is kept (Claude reads it in the evening). */
export function researchNote(workRoot: string, id: string): string {
  return path.join(improvementDir(workRoot), "isler", id, "arastirma.md");
}

/** The research note as the brain writes it (Turkish; the paths and the plan are what Claude needs). */
export function researchMarkdown(g: DevGuess, extra: { readonly benzer: readonly { readonly mesaj: string; readonly dosyalar: readonly string[] }[]; readonly icguduler: readonly Instinct[]; readonly ozetler: Readonly<Record<string, string>> }): string {
  const lines = [
    `# Geliştirici beyninin araştırması — ${g.gorev}`,
    "",
    `Tarih: ${g.tarih} · model: ${g.model}`,
    "",
    `**Kararı:** ${g.karar === "var" ? "stüdyo bunu zaten yapıyor olabilir — önce doğrula" : "değişiklik gerekiyor"}`,
    "",
    `**Planı:** ${g.plan}`,
    "",
    "**Değişeceğini düşündüğü dosyalar:**",
    ...g.dosyalar.map((f) => `- ${f}${extra.ozetler[f] ? ` — ${extra.ozetler[f]}` : ""}`),
    ...(g.test ? ["", `**Test:** ${g.test}`] : []),
    "",
    "**Aramasının öbür adayları:**",
    ...g.adaylar.filter((f) => !g.dosyalar.includes(f)).slice(0, 10).map((f) => `- ${f}${extra.ozetler[f] ? ` — ${extra.ozetler[f]}` : ""}`),
  ];
  if (extra.benzer.length) lines.push("", "**Benzer geçmiş değişiklikler:**", ...extra.benzer.map((c) => `- "${c.mesaj}" → ${c.dosyalar.slice(0, 6).join(", ")}`));
  if (extra.icguduler.length) lines.push("", "**İçgüdüleri:**", ...extra.icguduler.slice(0, 6).map((i) => `- "${i.tetik}" → ${i.dosya} (güven ${i.guven})`));
  return `${lines.join("\n")}\n`;
}

/** The brain as the Gelişim Merkezi and the homepage show it. */
export interface DevBrainView {
  readonly hazirlik: Readiness;
  readonly icgudu: { readonly toplam: number; readonly dogrulanan: number; readonly reddedilen: number };
  readonly gecmis: number;
  readonly dersler: readonly string[];
  readonly notlar: readonly { readonly tarih: string; readonly gorev: string; readonly satir: string }[];
  readonly akis: readonly DevTalk[];
}

export async function loadDevBrainView(workRoot: string): Promise<DevBrainView> {
  const [grades, instincts, past, lessons, talk] = await Promise.all([listGrades(workRoot), readInstincts(workRoot), listChanges(workRoot), listLessons(workRoot), recentTalk(workRoot, 12)]);
  return {
    hazirlik: readiness(grades),
    icgudu: { toplam: instincts.length, dogrulanan: instincts.filter((i) => i.durum === "dogrulandi").length, reddedilen: instincts.filter((i) => i.durum === "reddedildi").length },
    gecmis: past.length,
    dersler: lessons.slice(-5).reverse().map((l) => l.metin),
    notlar: grades.slice(-6).reverse().map((g) => ({ tarih: g.tarih, gorev: g.gorev, satir: `${g.kaynak === "is" ? "iş" : "commit"}: ${g.gercek.length} dosyadan ${Math.round(g.isabet * g.gercek.length)} bulundu, ${g.tahmin.length} tahminin ${Math.round(g.kesinlik * g.tahmin.length)} doğru${g.kararDogru === undefined ? "" : g.kararDogru ? ", karar doğru" : ", karar yanlış"}` })),
    akis: talk.reverse(),
  };
}
