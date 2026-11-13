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
  /** The declarations (functions, constants, types) it expects to be added or changed — where in the files. */
  readonly semboller?: readonly string[];
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
  /** When the real declarations are known (commits): the share of them it named (0..1). */
  readonly sembolIsabet?: number;
  readonly gercekSemboller?: readonly string[];
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

/** The most declarations a guess names (and the most a grade asks it to find). */
export const MAX_GUESS_SYMBOLS = 10;

/**
 * Grades a guess against the files that really changed and, when known, the declarations that really changed (the
 * share it named of them, out of at most MAX_GUESS_SYMBOLS: a commit that touched thirty functions asks for ten).
 */
export function gradeGuess(
  g: Pick<DevGuess, "id" | "kaynak" | "gorev" | "dosyalar" | "adaylar" | "karar" | "semboller">,
  changed: readonly string[],
  now = new Date(),
  realSymbols: readonly string[] = [],
): DevGrade {
  const real = gradedFiles(changed);
  const named = gradedFiles(g.dosyalar);
  const hit = named.filter((f) => real.includes(f)).length;
  const cand = new Set(gradedFiles(g.adaylar));
  const round = (x: number) => Math.round(x * 100) / 100;
  const symbols = [...new Set(realSymbols)];
  const guessed = new Set(g.semboller ?? []);
  const symbolHit = symbols.filter((s) => guessed.has(s)).length;
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
    ...(symbols.length ? { sembolIsabet: round(Math.min(1, symbolHit / Math.min(symbols.length, MAX_GUESS_SYMBOLS))), gercekSemboller: symbols.slice(0, 40) } : {}),
  };
}

/** A trigger fires on a task when they share this much. */
export const FIRE_AT = 0.5;
const CONFIRM_STEP = 0.15;
const MISS_STEP = 0.1;
export const START_CONFIDENCE = 0.4;
const MAX_CONFIDENCE = 0.9;
const DROP_BELOW = 0.2;
const MAX_INSTINCTS = 4_000;
/** A change this wide (a sweep, a rename) says nothing about which word belongs to which file. */
const INSTINCT_MAX_FILES = 8;
/** Letters of a word an instinct keeps: "harita", "haritada" and "haritanin" are one trigger. */
const STEM_LENGTH = 5;

/**
 * The triggers a task holds: its words cut to their stem. Until 11 Nov 2026 a trigger was the whole task sentence, and
 * two tasks almost never share half their words (3 of 21 115 pairs in 211 changes): 996 instincts, none ever confirmed
 * or dropped, 2 % of the changed files found. One word meets its file again and again.
 */
export function instinctTriggers(task: string): string[] {
  return [...new Set(taskWords(task).map((w) => w.slice(0, STEM_LENGTH)))];
}

/** Whether a store still holds the old sentence triggers (it is then rebuilt from the change memory). */
export function hasSentenceInstincts(list: readonly Instinct[]): boolean {
  return list.some((i) => i.tetik.includes(" "));
}

/**
 * The instincts that fire on a task, strongest first: those whose trigger word the task holds. One seen in a single
 * change is a coincidence, not an instinct yet, so it stays silent until a second change confirms it.
 */
export function firedInstincts(list: readonly Instinct[], task: string): Instinct[] {
  const triggers = new Set(instinctTriggers(task));
  return list.filter((i) => i.durum !== "reddedildi" && i.kanit.length >= 2 && triggers.has(i.tetik)).sort((a, b) => b.guven - a.guven);
}

/** The files the fired instincts point to, strongest first: a file several words point to adds up. */
export function instinctFiles(list: readonly Instinct[], task: string): { dosya: string; guven: number; tetikler: string[] }[] {
  const byFile = new Map<string, { dosya: string; guven: number; tetikler: string[] }>();
  for (const i of firedInstincts(list, task)) {
    const f = byFile.get(i.dosya) ?? { dosya: i.dosya, guven: 0, tetikler: [] };
    byFile.set(i.dosya, { dosya: i.dosya, guven: Math.round((f.guven + i.guven) * 100) / 100, tetikler: [...f.tetikler, i.tetik] });
  }
  return [...byFile.values()].sort((a, b) => b.guven - a.guven);
}

/**
 * The instincts after one answer: each word of the task with each file that really changed confirms the instinct
 * joining them (or starts a candidate); each instinct whose word is in the task but whose file was left alone loses
 * confidence, and is dropped when it falls low enough. Confirmed = confident and seen in at least two changes.
 */
export function learnInstincts(list: readonly Instinct[], task: string, changed: readonly string[], source: string, now = new Date()): Instinct[] {
  const real = gradedFiles(changed);
  const triggers = instinctTriggers(task);
  if (!triggers.length || real.length > INSTINCT_MAX_FILES) return [...list];
  const out = list.map((i) => ({ ...i }));
  const at = new Map(out.map((i, k) => [`${i.tetik}\n${i.dosya}`, k]));
  const settle = (i: Instinct, guven: number, kanit: readonly string[]): Instinct => {
    const g = Math.round(Math.min(MAX_CONFIDENCE, Math.max(0, guven)) * 100) / 100;
    return { ...i, guven: g, kanit, durum: g < DROP_BELOW ? "reddedildi" : g >= 0.6 && kanit.length >= 2 ? "dogrulandi" : "aday" };
  };
  for (const tetik of triggers) {
    for (const f of real) {
      const k = at.get(`${tetik}\n${f}`);
      if (k === undefined) {
        at.set(`${tetik}\n${f}`, out.length);
        out.push({ tetik, dosya: f, guven: START_CONFIDENCE, durum: "aday", kanit: [source], tarih: now.toISOString() });
        continue;
      }
      const i = out[k]!;
      // The same source twice confirms nothing; a dropped one that meets its file again starts over.
      if (i.kanit.includes(source)) continue;
      out[k] = i.durum === "reddedildi" ? { ...i, guven: START_CONFIDENCE, durum: "aday", kanit: [source], tarih: now.toISOString() } : settle(i, i.guven + CONFIRM_STEP, [...i.kanit, source].slice(-6));
    }
  }
  const held = new Set(triggers);
  for (let k = 0; k < out.length; k++) {
    const i = out[k]!;
    if (i.durum !== "reddedildi" && held.has(i.tetik) && !real.includes(i.dosya) && !i.kanit.includes(source)) out[k] = settle(i, i.guven - MISS_STEP, i.kanit);
  }
  // Too many: the dropped ones go first, then the weakest.
  return out.length <= MAX_INSTINCTS ? out : [...out].sort((a, b) => Number(a.durum === "reddedildi") - Number(b.durum === "reddedildi") || b.guven - a.guven).slice(0, MAX_INSTINCTS);
}

/** The instincts a change memory teaches, replayed oldest first (how a store of old sentence triggers is rebuilt). */
export function rebuildInstincts(changes: readonly PastChange[]): Instinct[] {
  let list: Instinct[] = [];
  for (const c of [...changes].sort((a, b) => Date.parse(a.tarih) - Date.parse(b.tarih))) {
    if (c.dosyalar.length) list = learnInstincts(list, c.mesaj, c.dosyalar, c.id.slice(0, 10), new Date(c.tarih));
  }
  return list;
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

/** What one file's change was in code: the declarations it added or changed and the lines it added (shortened). */
export interface CodeTouch {
  readonly dosya: string;
  /** Top-level declarations (functions, constants, types, classes; JSON: keys) the change added or changed. */
  readonly semboller: readonly string[];
  readonly eklenen: number;
  readonly silinen: number;
  /** The added lines, hunk by hunk (`@@ <enclosing line>` then the code), at most EXCERPT_CHARS. */
  readonly ornek: string;
}

/**
 * One change as code (owner, 3 Nov 2026: "nereye ne kod değişikliği yaptığını öğrensin, ilerde Claude yokken kendisi
 * kod yazabilmeli"): per file the declarations it added or changed and an excerpt of the code it added, the smoke suites
 * that proved it, and — when a pass had budget for it — how it was done, in a few Turkish sentences. The brain's worked
 * examples: a guess sees the code of the past changes most like its task, and Claude's evening packet carries them.
 */
export interface CodeExperience {
  readonly id: string;
  readonly tarih: string;
  readonly gorev: string;
  readonly dosyalar: readonly CodeTouch[];
  readonly testler: readonly string[];
  /** Turkish, 2-4 sentences: which file got which function, how they connect, how it was tested. */
  readonly nasil?: string;
}

export const MAX_SYMBOLS_PER_FILE = 12;
export const EXCERPT_CHARS = 1_200;
const MAX_TOUCHED_FILES = 12;

const DECL = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const JSON_KEY = /^\s*"([^"\\]{2,40})"\s*:/;

/** The declaration a line opens at the top level of a file (no indentation), if any. */
export function declaredName(line: string): string | undefined {
  return DECL.exec(line)?.[1];
}

/** The top-level declarations of a source file and the lines (1-based, inclusive) each spans, its doc comment included. */
export function declarationSpans(source: string): { ad: string; bas: number; son: number }[] {
  const lines = source.split(/\r?\n/);
  const heads: { ad: string; bas: number }[] = [];
  for (let k = 0; k < lines.length; k++) {
    const name = declaredName(lines[k]!);
    if (!name) continue;
    // The comment right above a declaration is its own (`/** … */` or `//` lines).
    let start = k;
    while (start > 0 && /^\s*(?:\/\*\*|\*|\*\/|\/\/)/.test(lines[start - 1]!)) start--;
    heads.push({ ad: name, bas: start + 1 });
  }
  return heads.map((h, i) => ({ ...h, son: (heads[i + 1]?.bas ?? lines.length + 1) - 1 }));
}

/** One file's part of a unified diff: where it added and deleted (post-image line numbers), counts, the added text. */
export interface FileDiff {
  readonly dosya: string;
  /** Post-image line numbers of the added lines that carry code (blank ones say nothing about where). */
  readonly eklenenSatirlar: readonly number[];
  /**
   * Post-image line numbers where code lines were deleted (the line now standing there) — not the lines of a declaration
   * removed outright, which belong to it and would otherwise be blamed on the declaration that follows.
   */
  readonly silinenYerler: readonly number[];
  readonly eklenen: number;
  readonly silinen: number;
  /** The declarations seen on added or deleted lines themselves (enough when the post-image is not at hand). */
  readonly satirSembolleri: readonly string[];
  readonly ornek: string;
}

/** Splits `git show --format= -U<n>` output into files (a cut-off diff simply ends early). */
export function parseDiff(diff: string): FileDiff[] {
  type Cur = { dosya: string; add: number[]; delAt: number[]; added: number; del: number; sym: string[]; ex: string[]; at: number; removing: boolean };
  const out: Cur[] = [];
  let cur: Cur | undefined;
  for (const line of diff.split(/\r?\n/)) {
    const head = /^diff --git a\/.+? b\/(.+)$/.exec(line);
    if (head) {
      cur = { dosya: head[1]!, add: [], delAt: [], added: 0, del: 0, sym: [], ex: [], at: 0, removing: false };
      out.push(cur);
      continue;
    }
    if (!cur || /^(?:\+\+\+ |--- |index |new file|deleted file|similarity|rename |old mode|new mode|Binary )/.test(line)) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (hunk) {
      cur.at = Number(hunk[1]);
      cur.removing = false;
      cur.ex.push(`@@ ${hunk[2]!.trim()}`.trim());
      continue;
    }
    const body = line.slice(1);
    const named = (s: string) => {
      const n = declaredName(s) ?? (cur!.dosya.endsWith(".json") ? JSON_KEY.exec(s)?.[1] : undefined);
      if (n && !cur!.sym.includes(n)) cur!.sym.push(n);
      return n;
    };
    if (line.startsWith("+")) {
      cur.removing = false;
      cur.added++;
      named(body);
      if (body.trim()) {
        cur.add.push(cur.at);
        cur.ex.push(body);
      }
      cur.at++;
    } else if (line.startsWith("-")) {
      cur.del++;
      // A deleted line opening a top-level declaration starts a removed block: the lines after it are its own.
      if (declaredName(body)) cur.removing = true;
      named(body);
      if (!cur.removing && body.trim()) cur.delAt.push(cur.at);
    } else if (line.startsWith(" ")) {
      cur.removing = false;
      cur.at++;
    }
  }
  return out.map((c) => {
    let ornek = c.ex.filter((l, i, a) => !(l.startsWith("@@") && (a[i + 1] === undefined || a[i + 1]!.startsWith("@@")))).join("\n");
    if (ornek.length > EXCERPT_CHARS) ornek = `${ornek.slice(0, EXCERPT_CHARS)}\n…`;
    return { dosya: c.dosya, eklenenSatirlar: c.add, silinenYerler: c.delAt, eklenen: c.added, silinen: c.del, satirSembolleri: c.sym, ornek };
  });
}

/**
 * The declarations a file's change touched: every top-level declaration whose span holds an added line or a deletion,
 * in file order; without the post-image (a deleted file, a JSON file), the declarations on the changed lines.
 */
export function touchedDeclarations(fd: FileDiff, postImage?: string): string[] {
  if (postImage === undefined || !/\.(?:m?[jt]sx?)$/.test(fd.dosya)) return fd.satirSembolleri.slice(0, MAX_SYMBOLS_PER_FILE);
  const spans = declarationSpans(postImage);
  const lines = [...fd.eklenenSatirlar, ...fd.silinenYerler];
  const hit = spans.filter((s) => lines.some((n) => n >= s.bas && n <= s.son)).map((s) => s.ad);
  // A declaration removed outright no longer has a span; its deleted line still names it.
  const gone = fd.satirSembolleri.filter((n) => !spans.some((s) => s.ad === n));
  return [...new Set([...hit, ...gone])].slice(0, MAX_SYMBOLS_PER_FILE);
}

/** A smoke suite of the V3 studio (what proved a change). */
export const isV3Smoke = (f: string) => /^scripts\/smoke-v3-[\w-]+\.ts$/.test(f.replace(/\\/g, "/"));

/** Which files a change's code experience keeps (its graded code) and which prove it (its tests). */
export interface CodeScope {
  readonly graded: (files: readonly string[]) => string[];
  readonly isTest: (f: string) => boolean;
}
export const V3_CODE_SCOPE: CodeScope = { graded: gradedFiles, isTest: isV3Smoke };

/**
 * Main AYAS's code (owner, 12 Nov 2026: "burda yapılan her şeyi gerekli beyinler öğrensin", "maliyetsiz olsun"): the
 * developer brain reads these changes too — files, declarations, added code, tests, from Git alone, no model — into its
 * own store (`kod-ayas.jsonl`), never into the V3 memory its exams and instincts are graded on.
 */
export const AYAS_CODE_PATHS = ["src/lib/ayas", "src/lib/brain", "app", "src/components"] as const;
export function ayasGradedFiles(files: readonly string[]): string[] {
  return [...new Set(files.map((f) => f.replace(/\\/g, "/")))].filter((f) => /^(src\/lib\/ayas\/|src\/lib\/brain\/|app\/|src\/components\/)/.test(f) && !/\.md$/i.test(f)).sort();
}
/** A main-AYAS smoke suite (every smoke suite that is not V3's). */
export const isAyasSmoke = (f: string) => /^scripts\/smoke-(?!v3-)[\w.-]+\.ts$/.test(f.replace(/\\/g, "/"));
export const AYAS_CODE_SCOPE: CodeScope = { graded: ayasGradedFiles, isTest: isAyasSmoke };

/** A change's code experience from its diff and the post-images of its files (graded files only; suites as tests). */
export function codeExperience(input: { readonly id: string; readonly tarih: string; readonly gorev: string; readonly diff: string; readonly postImages: Readonly<Record<string, string | undefined>> }, scope: CodeScope = V3_CODE_SCOPE): CodeExperience {
  const files = parseDiff(input.diff);
  const graded = new Set(scope.graded(files.map((f) => f.dosya)));
  const touches = files
    .filter((f) => graded.has(f.dosya))
    .map((f) => ({ dosya: f.dosya, semboller: touchedDeclarations(f, input.postImages[f.dosya]), eklenen: f.eklenen, silinen: f.silinen, ornek: f.ornek }))
    // The biggest changes first: they say most about how it was done.
    .sort((a, b) => b.eklenen + b.silinen - (a.eklenen + a.silinen))
    .slice(0, MAX_TOUCHED_FILES);
  return { id: input.id, tarih: input.tarih, gorev: input.gorev, dosyalar: touches, testler: [...new Set(files.map((f) => f.dosya).filter(scope.isTest))].sort() };
}

/** All the declarations a change touched, its biggest files first. */
export const changedSymbols = (x: Pick<CodeExperience, "dosyalar">): string[] => [...new Set(x.dosyalar.flatMap((t) => t.semboller))];

/** The code experience as a guess's prompt and the research note show it: files with their declarations, then the recipe. */
export function codeExperienceLines(x: CodeExperience, opts: { readonly ornek?: number } = {}): string[] {
  const lines = x.dosyalar.slice(0, 6).map((t) => `  ${t.dosya} (+${t.eklenen}/-${t.silinen})${t.semboller.length ? `: ${t.semboller.slice(0, 8).join(", ")}` : ""}`);
  if (x.testler.length) lines.push(`  test: ${x.testler.slice(0, 4).join(", ")}`);
  if (x.nasil) lines.push(`  nasıl: ${x.nasil}`);
  const top = x.dosyalar[0];
  if (opts.ornek && top?.ornek) lines.push(`  kod (${top.dosya}):`, ...top.ornek.slice(0, opts.ornek).split("\n").map((l) => `    ${l}`));
  return lines;
}

/** How ready the apprentice is, from its last grades. */
export interface Readiness {
  readonly n: number;
  readonly isabet: number;
  readonly kesinlik: number;
  readonly adayIsabet: number;
  /** Jobs only. */
  readonly karar?: number;
  /** Grades that knew the real declarations: how many of them it named (the step before writing the code itself). */
  readonly sembol?: number;
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
  const withSymbols = last.filter((g) => g.sembolIsabet !== undefined);
  const sembol = withSymbols.length ? mean(withSymbols.map((g) => g.sembolIsabet!)) : undefined;
  const seviye = last.length < 5 ? "baslangic" : last.length >= READY_WINDOW && isabet >= 80 && kesinlik >= 60 ? "hazir" : isabet >= 60 ? "yaklasiyor" : "ogreniyor";
  const name = { baslangic: "yeni başladı", ogreniyor: "öğreniyor", yaklasiyor: "yaklaşıyor", hazir: "hazır olabilir" }[seviye];
  // (Percentages without a case ending: Turkish picks it by how the number is read.)
  const ozet = last.length
    ? `${name} — son ${last.length} işte: değişen dosyaları bulma %${isabet} · andığı dosyalarda doğruluk %${kesinlik} · arama kapsamı %${adayIsabet}${sembol !== undefined ? ` · değişen fonksiyonları bulma %${sembol}` : ""}${karar !== undefined ? ` · "zaten var mı" kararı %${karar}` : ""}`
    : "henüz bir tahmini notlanmadı";
  return { n: last.length, isabet, kesinlik, adayIsabet, ...(karar !== undefined ? { karar } : {}), ...(sembol !== undefined ? { sembol } : {}), seviye, ozet };
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

export const recordCodeExperience = (workRoot: string, x: CodeExperience) => append(workRoot, "kod.jsonl", x);
export const recordAyasCodeExperience = (workRoot: string, x: CodeExperience) => append(workRoot, "kod-ayas.jsonl", x);
export const listAyasCodeExperience = (workRoot: string) => readLines<CodeExperience>(file(workRoot, "kod-ayas.jsonl"));

/** Past main-AYAS changes nearest to a task, as a job packet section (empty when none is close): Git-made, no model. */
export async function ayasPastChanges(workRoot: string, task: string, limit = 3): Promise<string> {
  const all = (await listAyasCodeExperience(workRoot)).filter((x) => x.dosyalar.length);
  const byId = new Map(all.map((x) => [x.id, x]));
  const near = similarChanges(all.map((x) => ({ id: x.id, tarih: x.tarih, mesaj: x.gorev, dosyalar: x.dosyalar.map((t) => t.dosya) })), task, { limit });
  if (!near.length) return "";
  const lines = near.flatMap((c, k) => [`- "${c.mesaj}" (${c.id.slice(0, 10)})`, ...codeExperienceLines(byId.get(c.id)!, k === 0 ? { ornek: 500 } : {})]);
  return `\n\nSIMILAR PAST AYAS CHANGES (how such work was done before — reuse their places and style):\n${lines.join("\n")}`;
}

/** The code experiences, one per change: a later line for the same change (its recipe written afterwards) wins. */
export async function listCodeExperience(workRoot: string): Promise<CodeExperience[]> {
  const byId = new Map<string, CodeExperience>();
  for (const x of await readLines<CodeExperience>(file(workRoot, "kod.jsonl"))) byId.set(x.id, { ...byId.get(x.id), ...x });
  return [...byId.values()];
}

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

/**
 * A whole case the brains keep (owner, 13 Nov 2026, "kesin emir": "claude'da yapılan her düzeltme, iyileştirme, hata
 * beyinlere aktarılsın; nasıl olduğu, nasıl çözüldüğü, bütün gerekli bilgiler; ileride böyle sorunları kendileri
 * yapabilsin; her çıkan sorunda otomatik"). A one-line lesson says what to do; a case says what was seen, why it happened,
 * how it was solved and proven, and how to catch it next time — so a brain meeting a similar problem can follow the same
 * path. From a commit's `Vaka` block (CommitLessons), derived from a `fix(...)` commit that has none, or written by hand
 * for a fix with no commit (`scripts/v3/vaka.ts ekle`: a patched episode, a stopped and resumed order).
 */
export interface DevCase {
  /** `<sha>#<n>` for a commit's block, `<sha>#t` for a derived one, `el-<time>` for a hand-written one. */
  readonly id: string;
  readonly tarih: string;
  /** commit: written in a commit's Vaka block; turetilmis: made from a fix commit's subject and body; el: by hand. */
  readonly kaynak: "commit" | "turetilmis" | "el";
  readonly konu: string;
  /** What was seen, where (which video, which scene). */
  readonly belirti: string;
  readonly neden?: string;
  /** How it was solved: files, functions, data. */
  readonly cozum?: string;
  readonly kanit?: string;
  /** How to catch it next time. */
  readonly yakala?: string;
  /** The brains it concerns (CommitLessons.LESSON_BRAINS names). */
  readonly beyinler: readonly string[];
  readonly commit?: string;
  /** The commit's changed files. */
  readonly dosyalar?: readonly string[];
  /** The video it was seen in. */
  readonly bolum?: string;
}

/** Longest text of one case field. */
export const MAX_CASE_FIELD = 600;

const caseField = (s: string | undefined) => {
  const t = s?.replace(/\s+/g, " ").trim().slice(0, MAX_CASE_FIELD);
  return t || undefined;
};

/** Appends one case to the library (`gelistirici/vakalar.jsonl`, one JSON per line); empty fields are left out. */
export async function recordCase(workRoot: string, c: DevCase): Promise<DevCase> {
  const clean = Object.fromEntries(
    Object.entries({ ...c, konu: c.konu.replace(/\s+/g, " ").trim().slice(0, 160), belirti: caseField(c.belirti) ?? c.konu, neden: caseField(c.neden), cozum: caseField(c.cozum), kanit: caseField(c.kanit), yakala: caseField(c.yakala), dosyalar: c.dosyalar?.slice(0, 40) }).filter(([, v]) => v !== undefined),
  ) as unknown as DevCase;
  await append(workRoot, "vakalar.jsonl", clean);
  return clean;
}

export const listCases = (workRoot: string) => readLines<DevCase>(file(workRoot, "vakalar.jsonl"));

/** How alike a problem text and a case are (0..1): shared words against both sizes; a derived case counts a little less. */
export function caseScore(text: string, c: DevCase): number {
  const q = new Set(taskWords(text)), w = new Set(taskWords([c.konu, c.belirti, c.neden, c.yakala, c.cozum].filter(Boolean).join(" ")));
  if (!q.size || !w.size) return 0;
  let common = 0;
  for (const x of q) if (w.has(x)) common++;
  if (common < 2) return 0;
  return (common / Math.sqrt(q.size * w.size)) * (c.kaynak === "turetilmis" ? 0.85 : 1);
}

/** A case closer than this to a new problem is handed to the brain meeting it. */
export const MIN_CASE_SCORE = 0.12;

/**
 * The past cases most like a new problem (a failed step's error, a development job's fault): word overlap, Turkish
 * letters folded, no model and no cost, so it runs on every failure; ties go to the newer case. `beyin` keeps only
 * the cases that concern that brain.
 */
export async function similarCases(workRoot: string, text: string, n = 3, opts: { readonly beyin?: string; readonly exclude?: string } = {}): Promise<(DevCase & { readonly benzerlik: number })[]> {
  const all = await listCases(workRoot);
  return all
    .map((c, i) => ({ c, i, s: c.id === opts.exclude || (opts.beyin && !c.beyinler.includes(opts.beyin)) ? 0 : caseScore(text, c) }))
    .filter((x) => x.s >= MIN_CASE_SCORE)
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, Math.max(0, n))
    .map((x) => ({ ...x.c, benzerlik: Math.round(x.s * 100) / 100 }));
}

/** One case as a prompt line (symptom → cause → fix → files → proof → catch), at most `max` characters. */
export function caseLine(c: DevCase, max = 900): string {
  const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const parts = [
    `seen: ${cut(c.belirti, 260)}${c.bolum ? ` (video ${c.bolum})` : ""}`,
    c.neden ? `cause: ${cut(c.neden, 220)}` : "",
    c.cozum ? `fix: ${cut(c.cozum, 260)}` : "",
    c.dosyalar?.length ? `files: ${c.dosyalar.slice(0, 6).join(", ")}${c.dosyalar.length > 6 ? ` +${c.dosyalar.length - 6}` : ""}` : "",
    c.kanit ? `proven: ${cut(c.kanit, 160)}` : "",
    c.yakala ? `catch: ${cut(c.yakala, 160)}` : "",
  ].filter(Boolean);
  return cut(`- [${c.konu.slice(0, 80)}] (${c.commit ? c.commit.slice(0, 10) : c.id}, ${c.tarih.slice(0, 10)}${c.kaynak === "turetilmis" ? ", derived from the commit" : ""}) ${parts.join(" | ")}`, max)!;
}

/**
 * One case as a content brain's short prompt line (13 Nov 2026): only what was seen, why and how to catch it — the
 * files and the proof are a developer's business, and a writer or a critic must not pay for them in every prompt. No
 * leading "- ": the brains' prompts put their own bullet before each lesson.
 */
export function briefCaseLine(c: DevCase, max = 400): string {
  const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const parts = [`seen: ${cut(c.belirti, 200)}`, c.neden ? `cause: ${cut(c.neden, 140)}` : "", c.yakala ? `catch: ${cut(c.yakala, 140)}` : ""].filter(Boolean);
  return cut(`past case [${c.konu.slice(0, 60)}] ${parts.join(" | ")}`, max)!;
}

/**
 * The nearest past cases as prompt lines (a few, each bounded); none when nothing is close or the library is unreadable.
 * `beyin` keeps only the cases that concern that brain (Vaka-beyin); `brief` gives briefCaseLine's short form.
 */
export async function similarCaseLines(workRoot: string, text: string, n = 3, max = 900, opts: { readonly beyin?: string; readonly brief?: boolean } = {}): Promise<string[]> {
  return (await similarCases(workRoot, text, n, opts.beyin ? { beyin: opts.beyin } : {}).catch(() => [])).map((c) => (opts.brief ? briefCaseLine(c, max) : caseLine(c, max)));
}

/**
 * The developer brain's written lessons most relevant to a task (shared words), the newer first on a tie and when
 * nothing is shared (13 Nov 2026: the newest six were handed whatever the task was).
 */
export function relevantLessons(lessons: readonly DevLesson[], text: string, n: number): DevLesson[] {
  return lessons
    .map((l, i) => ({ l, i, s: similarity(text, l.metin) }))
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, Math.max(0, n))
    .map((x) => x.l);
}

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
export function researchMarkdown(
  g: DevGuess,
  extra: {
    readonly benzer: readonly { readonly mesaj: string; readonly dosyalar: readonly string[] }[];
    readonly icguduler: readonly Instinct[];
    readonly ozetler: Readonly<Record<string, string>>;
    /** The code of the most similar past changes (how they were done). */
    readonly kod?: readonly CodeExperience[];
  },
): string {
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
    ...(g.semboller?.length ? ["", `**Ekleneceğini/değişeceğini düşündüğü bildirimler:** ${g.semboller.join(", ")}`] : []),
    ...(g.test ? ["", `**Test:** ${g.test}`] : []),
    "",
    "**Aramasının öbür adayları:**",
    ...g.adaylar.filter((f) => !g.dosyalar.includes(f)).slice(0, 10).map((f) => `- ${f}${extra.ozetler[f] ? ` — ${extra.ozetler[f]}` : ""}`),
  ];
  if (extra.benzer.length) lines.push("", "**Benzer geçmiş değişiklikler:**", ...extra.benzer.map((c) => `- "${c.mesaj}" → ${c.dosyalar.slice(0, 6).join(", ")}`));
  if (extra.icguduler.length) lines.push("", "**İçgüdüleri:**", ...extra.icguduler.slice(0, 6).map((i) => `- "${i.tetik}" → ${i.dosya} (güven ${i.guven})`));
  if (extra.kod?.length) {
    lines.push("", "**Benzer geçmiş değişikliklerin kodu (nerede, ne, nasıl):**");
    for (const [k, x] of extra.kod.slice(0, 3).entries()) lines.push(`- "${x.gorev}" (${x.id.slice(0, 10)})`, ...codeExperienceLines(x, k === 0 ? { ornek: 700 } : {}));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * One writing exam (owner, 6 Nov 2026: "Claude olmadan yazabilecek duruma gelsin"): the apprentice writes a past V3
 * commit's change itself, at the commit's parent, with that commit's new smoke scenarios as the spec; it passes when
 * the type check and those scenarios pass. `gecersiz`: the scenarios did not pass even with the real change here (the
 * environment), or already passed before it — not counted either way.
 */
export interface WriteExam {
  /** The commit's sha (or a job id when it built a job). */
  readonly id: string;
  readonly tarih: string;
  readonly gorev: string;
  readonly sonuc: "gecti" | "kaldi" | "gecersiz";
  /** Model rounds it used (reading files counts too). */
  readonly turlar: number;
  readonly maliyetUsd: number;
  /** The files it changed / the commit really changed (code and data, tests apart). */
  readonly dosyalar: readonly string[];
  readonly gercek: readonly string[];
  readonly testler: readonly string[];
  /** Why it failed (the last check's words), or why the exam did not count. */
  readonly neden?: string;
  readonly model: string;
}

/** Writing exams that count towards readiness. */
export const WRITE_WINDOW = 10;
/** Counted exams before the apprentice may build a job on its own, and the share it must pass. */
export const WRITE_MIN_EXAMS = 6;
export const WRITE_PASS_SHARE = 0.5;

export interface WriteReadiness {
  readonly sayilan: number;
  readonly gecen: number;
  /** 0..100 over the last WRITE_WINDOW counted exams. */
  readonly oran: number;
  /** Whether it may build an approved job itself when Claude cannot (its builds still pass every check). */
  readonly yazabilir: boolean;
  readonly ozet: string;
}

export function writeReadiness(exams: readonly WriteExam[]): WriteReadiness {
  const counted = exams.filter((e) => e.sonuc !== "gecersiz").slice(-WRITE_WINDOW);
  const gecen = counted.filter((e) => e.sonuc === "gecti").length;
  const oran = counted.length ? Math.round((gecen / counted.length) * 100) : 0;
  const yazabilir = counted.length >= WRITE_MIN_EXAMS && gecen / counted.length >= WRITE_PASS_SHARE;
  const ozet = counted.length
    ? `kendi yazdığı kod: son ${counted.length} yazma sınavının ${gecen} tanesini geçti (%${oran})${yazabilir ? " — Claude yokken onaylı işi kendisi yazabilir" : ` — kendi başına yazması için en az ${WRITE_MIN_EXAMS} sınavda %${Math.round(WRITE_PASS_SHARE * 100)} gerekir`}`
    : "henüz yazma sınavına girmedi";
  return { sayilan: counted.length, gecen, oran, yazabilir, ozet };
}

export const recordWriteExam = (workRoot: string, x: WriteExam) => append(workRoot, "yazma.jsonl", { ...x, neden: x.neden?.replace(/\s+/g, " ").slice(0, 600) });
export const listWriteExams = (workRoot: string) => readLines<WriteExam>(file(workRoot, "yazma.jsonl"));

/** The brain as the Gelişim Merkezi and the homepage show it. */
export interface DevBrainView {
  readonly hazirlik: Readiness;
  readonly icgudu: { readonly toplam: number; readonly dogrulanan: number; readonly reddedilen: number };
  readonly gecmis: number;
  /** Changes whose code it read (where, what), how many of them with a written recipe, and the newest one's recipe. */
  readonly kod?: { readonly toplam: number; readonly tarifli: number; readonly sonTarif?: { readonly gorev: string; readonly nasil: string } };
  readonly dersler: readonly string[];
  readonly notlar: readonly { readonly tarih: string; readonly gorev: string; readonly satir: string }[];
  readonly akis: readonly DevTalk[];
  /** Its own code: the writing exams' report card and the latest ones. */
  readonly yazma?: WriteReadiness & { readonly son: readonly { readonly tarih: string; readonly gorev: string; readonly sonuc: WriteExam["sonuc"]; readonly turlar: number }[] };
}

export async function loadDevBrainView(workRoot: string): Promise<DevBrainView> {
  const [grades, instincts, past, lessons, talk, code, writes] = await Promise.all([listGrades(workRoot), readInstincts(workRoot), listChanges(workRoot), listLessons(workRoot), recentTalk(workRoot, 12), listCodeExperience(workRoot), listWriteExams(workRoot)]);
  const recipes = code.filter((x) => x.nasil).sort((a, b) => Date.parse(a.tarih) - Date.parse(b.tarih));
  const last = recipes.at(-1);
  return {
    hazirlik: readiness(grades),
    icgudu: { toplam: instincts.length, dogrulanan: instincts.filter((i) => i.durum === "dogrulandi").length, reddedilen: instincts.filter((i) => i.durum === "reddedildi").length },
    gecmis: past.length,
    kod: { toplam: code.length, tarifli: recipes.length, ...(last ? { sonTarif: { gorev: last.gorev, nasil: last.nasil! } } : {}) },
    dersler: lessons.slice(-5).reverse().map((l) => l.metin),
    notlar: grades.slice(-6).reverse().map((g) => ({ tarih: g.tarih, gorev: g.gorev, satir: `${g.kaynak === "is" ? "iş" : "commit"}: ${g.gercek.length} dosyadan ${Math.round(g.isabet * g.gercek.length)} bulundu, ${g.tahmin.length} tahminin ${Math.round(g.kesinlik * g.tahmin.length)} doğru${g.kararDogru === undefined ? "" : g.kararDogru ? ", karar doğru" : ", karar yanlış"}` })),
    akis: talk.reverse(),
    ...(writes.length ? { yazma: { ...writeReadiness(writes), son: writes.slice(-5).reverse().map((w) => ({ tarih: w.tarih, gorev: w.gorev, sonuc: w.sonuc, turlar: w.turlar })) } } : {}),
  };
}
