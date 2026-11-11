import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runProcess } from "../util/Proc";
import { readJsonAnswer } from "./Council";
import {
  changedSymbols,
  type CodeExperience,
  codeExperience,
  codeExperienceLines,
  declarationSpans,
  devBrainDir,
  type DevGrade,
  type DevGuess,
  firedInstincts,
  gradedFiles,
  gradeGuess,
  hasSentenceInstincts,
  type Instinct,
  instinctFiles,
  isV3Smoke,
  lastGuess,
  learnInstincts,
  listChanges,
  listCodeExperience,
  listLessons,
  MAX_GUESS_FILES,
  MAX_GUESS_SYMBOLS,
  type PastChange,
  readInstincts,
  rebuildInstincts,
  recordChange,
  recordCodeExperience,
  recordGrade,
  recordGuess,
  recordLesson,
  researchMarkdown,
  researchNote,
  say,
  similarChanges,
  taskWords,
  writeInstincts,
} from "./DevBrain";
import { scopeOf } from "./DevQueue";
import { develop, type DeveloperDeps } from "./Developer";
import type { Embedder } from "./ExperienceMemory";
import { cachedVectors, nearestByMeaning, vectorFile } from "./MeaningCache";
import type { DevProposal } from "./SelfImprovement";

/**
 * The developer brain at work (DevBrain holds what it knows): it researches an approved job in the studio's own git —
 * search words from the task, `git grep` over the V3 code at the right revision, the past changes and instincts that
 * fire on the task — and a cheap model picks the files and writes the plan. It sits the same exam on every new V3 commit
 * (guessing at the commit's parent, never seeing the answer), and after the evening's builds it grades itself against
 * what Claude really changed and writes down what it missed. Runs only in the order watcher's processes (it starts git).
 */
export interface ResearchDeps {
  readonly repoRoot: string;
  readonly workRoot: string;
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  readonly log: (s: string) => void;
  /**
   * The guess's model (choosing files and declarations is where it missed most: on 6 Nov 2026 the right file was among
   * its candidates in 8 of 15 exams but not chosen); the cheap `model` keeps the search words, recipes and lessons.
   */
  readonly guessModel?: V3ModelChoice;
  /**
   * Meaning search over past changes (MeaningCache, qwen3-embedding on the CPU). Replayed on 157 V3 changes (6 Nov
   * 2026): the 5 past changes nearest in meaning held 63 % of a change's files, the 5 sharing most words 17 %.
   */
  readonly meaning?: Embedder;
}

/** Past changes nearest in meaning to a task (before a date, never the task's own), or none without meaning search. */
export const MEANING_NEIGHBOURS = 5;

export async function meaningNeighbours(d: Pick<ResearchDeps, "workRoot" | "meaning" | "log">, task: string, opts: { readonly before?: string; readonly exclude?: string; readonly k?: number } = {}): Promise<(PastChange & { benzerlik: number })[]> {
  if (!d.meaning) return [];
  try {
    const until = opts.before ? Date.parse(opts.before) : Infinity;
    const past = (await listChanges(d.workRoot)).filter((c) => c.dosyalar.length && c.id !== opts.exclude && Date.parse(c.tarih) <= until);
    if (!past.length) return [];
    const vectors = await cachedVectors(vectorFile(devBrainDir(d.workRoot), d.meaning), [task, ...past.map((c) => c.mesaj)], d.meaning);
    return nearestByMeaning(vectors.get(task)!, past.map((c) => ({ item: c, v: vectors.get(c.mesaj) })), opts.k ?? MEANING_NEIGHBOURS).map((x) => ({ ...x.item, benzerlik: Math.round(x.benzerlik * 100) / 100 }));
  } catch (e) {
    d.log(`  geliştirici beyni: anlam araması yapılamadı (${(e as Error).message.slice(0, 120)}), kelime araması kullanıldı`);
    return [];
  }
}

/** Where it searches: the V3 studio's code and data. */
export const SEARCH_PATHS = ["src/lib/v3", "scripts/v3", "remotion-v3/src", "content/v3"] as const;
/** Candidates it looks at closely. */
const CANDIDATES = 20;
/** A commit is an exam question only when it changed this few graded files (a long multi-change commit tells little). */
export const EXAM_MAX_FILES = 8;
/** Commits it sits per learning pass; older unseen ones are read without an exam. */
export const EXAMS_PER_PASS = 4;

const git = (cwd: string, args: readonly string[]) => runProcess("git", ["-c", "core.quotepath=false", ...args], { cwd, timeoutMs: 120_000 });

const modelName = (m: V3ModelChoice) => (m.provider === "openai" ? (m.model ?? "openai") : m.provider);

/** The V3 files at a revision. */
async function filesAt(repoRoot: string, rev: string): Promise<string[]> {
  const r = await git(repoRoot, ["ls-tree", "-r", "--name-only", rev, "--", ...SEARCH_PATHS]);
  return r.code === 0 ? gradedFiles(r.stdout.split(/\r?\n/).filter(Boolean)) : [];
}

/** What a file says it does (the first sentence of its first doc comment) and what it declares at the top level. */
async function fileFacts(repoRoot: string, rev: string, file: string): Promise<{ ozet: string; bildirimler: string[] }> {
  if (file.endsWith(".json")) return { ozet: "veri dosyası", bildirimler: [] };
  const r = await git(repoRoot, ["show", `${rev}:${file}`]);
  const bildirimler = [...new Set(declarationSpans(r.stdout).map((s) => s.ad))];
  const doc = /\/\*\*([\s\S]*?)\*\//.exec(r.stdout.slice(0, 8_000))?.[1];
  if (!doc) return { ozet: "", bildirimler };
  const text = doc.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ").trim();
  return { ozet: (/^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text).slice(0, 180), bildirimler };
}

/** Candidates whose declarations the guess sees (the rest only by path and summary). */
const DECLARED_CANDIDATES = 10;
/** Declarations named per candidate in the guess's prompt. */
const DECLARATIONS_SHOWN = 14;

/**
 * The code of a change at `rev` (a commit, or the tip of a build's branch): its graded files' diff with two lines of
 * context, each code file's post-image for the declaration spans, the V3 smoke suites it touched as its tests.
 */
export async function readCodeExperience(repoRoot: string, rev: string, meta: { readonly id: string; readonly tarih: string; readonly gorev: string }): Promise<CodeExperience> {
  const files = (await commitFiles(repoRoot, rev)).map((f) => f.replace(/\\/g, "/"));
  const wanted = [...gradedFiles(files), ...files.filter(isV3Smoke)];
  if (!wanted.length) return { ...meta, dosyalar: [], testler: [] };
  const diff = await git(repoRoot, ["show", "--format=", "--no-color", "--no-renames", "-U2", rev, "--", ...wanted]);
  const postImages: Record<string, string | undefined> = {};
  for (const f of gradedFiles(files).filter((x) => /\.(?:m?[jt]sx?)$/.test(x))) {
    const r = await git(repoRoot, ["show", `${rev}:${f}`]);
    postImages[f] = r.code === 0 ? r.stdout : undefined;
  }
  return codeExperience({ ...meta, diff: diff.stdout, postImages });
}

/** Recipes written per learning pass (the newest changes without one first; ~0.1 cent each). */
export const RECIPES_PER_PASS = 6;
/** Code shown to the recipe writer, all files together. */
const RECIPE_CODE_CHARS = 5_000;

/** How a change was done, in the apprentice's words (Turkish, 2-4 sentences), from its code; undefined without an answer. */
export async function writeRecipe(x: CodeExperience, d: ResearchDeps): Promise<string | undefined> {
  if (!x.dosyalar.length) return undefined;
  let budget = RECIPE_CODE_CHARS;
  const code: string[] = [];
  for (const t of x.dosyalar) {
    if (budget <= 200 || !t.ornek) break;
    const part = t.ornek.slice(0, Math.min(budget, 1_200));
    code.push(`--- ${t.dosya}\n${part}`);
    budget -= part.length;
  }
  const prompt = `You are the apprentice developer of Atölye V3, a TypeScript studio that makes animated history videos. The senior developer finished a task; learn HOW it was done, so that one day you can make such a change alone.
TASK (Turkish): ${x.gorev}
WHAT CHANGED (file (+added/-removed lines): top-level declarations added or changed):
${codeExperienceLines(x).join("\n")}
ADDED CODE (shortened; "@@" lines name the enclosing code):
${code.join("\n")}
Write in Turkish, 2-4 sentences, how it was done: which file got which function or constant (use the real names), how the pieces connect (who calls what, where a rule or setting lives), and how it was tested. No praise, no generalities. Return ONLY JSON: {"nasil": "..."}`;
  try {
    const out = await d.budget.generate("gelistirici-tarif", d.model, prompt, { maxTokens: 400 });
    const nasil = readJsonAnswer<{ nasil?: unknown }>(out.result.content)?.nasil;
    return typeof nasil === "string" && nasil.trim() ? nasil.replace(/\s+/g, " ").trim().slice(0, 700) : undefined;
  } catch (e) {
    d.log(`  geliştirici beyni: tarif yazılamadı (${(e as Error).message.slice(0, 120)})`);
    return undefined;
  }
}

/** The code experiences of some changes, by id, in the order asked. */
export async function codeOf(workRoot: string, ids: readonly string[]): Promise<CodeExperience[]> {
  const all = new Map((await listCodeExperience(workRoot)).map((x) => [x.id, x]));
  return ids.flatMap((id) => (all.has(id) ? [all.get(id)!] : []));
}

/** Search words for a task: the model's English code words and the task's own words. */
async function searchTerms(task: string, folders: readonly string[], d: ResearchDeps): Promise<string[]> {
  const own = taskWords(task);
  const prompt = `You help find code in a TypeScript studio that makes animated history videos (Atölye V3). Its folders: src/lib/v3/{${folders.join(",")}}, scripts/v3 (command lines), remotion-v3/src (the renderer), content/v3 (data). Code and comments are English; log lines and JSON keys are often Turkish.
TASK (Turkish): ${task}
Give up to 12 search terms that appear in the code that does this or would change for it: identifiers (camelCase/PascalCase), English words from comments, Turkish JSON keys or log words. Return ONLY JSON: {"terimler": ["..."]}`;
  try {
    const out = await d.budget.generate("gelistirici-arama", d.model, prompt, { maxTokens: 300 });
    const raw = readJsonAnswer<{ terimler?: unknown }>(out.result.content);
    const terms = Array.isArray(raw?.terimler) ? raw.terimler.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t.length >= 3 && t.length <= 40) : [];
    return [...new Set([...terms.slice(0, 12), ...own.slice(0, 6)])];
  } catch {
    return own.slice(0, 12);
  }
}

/** Scores files by the search words they contain (rarer words weigh more) and by words in their path. */
async function grepScores(repoRoot: string, rev: string, terms: readonly string[], all: readonly string[]): Promise<Map<string, { puan: number; kelimeler: string[] }>> {
  const scores = new Map<string, { puan: number; kelimeler: string[] }>();
  const known = new Set(all);
  for (const term of terms) {
    const r = await git(repoRoot, ["grep", "-I", "-i", "-c", "-F", "-e", term, rev, "--", ...SEARCH_PATHS]);
    const hits = r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => /^[^:]+:(.+):(\d+)$/.exec(l))
      .flatMap((m) => (m && known.has(m[1]!) ? [{ file: m[1]!, count: Number(m[2]) }] : []));
    const lower = term.toLowerCase();
    const inPath = all.filter((f) => path.posix.basename(f).toLowerCase().includes(lower));
    if (!hits.length && !inPath.length) continue;
    const idf = Math.log(1 + all.length / Math.max(1, hits.length));
    for (const h of hits) {
      const s = scores.get(h.file) ?? { puan: 0, kelimeler: [] };
      scores.set(h.file, { puan: s.puan + idf * (1 + Math.log(h.count)), kelimeler: [...s.kelimeler, term] });
    }
    for (const f of inPath) {
      const s = scores.get(f) ?? { puan: 0, kelimeler: [] };
      scores.set(f, { puan: s.puan + 2 * idf, kelimeler: s.kelimeler.includes(term) ? s.kelimeler : [...s.kelimeler, term] });
    }
  }
  return scores;
}

/**
 * The instinct store as it is used. One still holding the old sentence triggers (before 11 Nov 2026: never confirmed,
 * never dropped) is rebuilt once from the change memory, word by word, and written back.
 */
export async function currentInstincts(workRoot: string): Promise<Instinct[]> {
  const stored = await readInstincts(workRoot);
  if (!hasSentenceInstincts(stored)) return stored;
  const rebuilt = rebuildInstincts(await listChanges(workRoot));
  await writeInstincts(workRoot, rebuilt);
  return rebuilt;
}

/** The brain's guess for a task at a revision, with what it found on the way (for the research note). */
export async function guessTask(
  input: { readonly id: string; readonly kaynak: DevGuess["kaynak"]; readonly gorev: string; readonly rev: string; readonly before?: string },
  d: ResearchDeps,
): Promise<{ guess: DevGuess; benzer: { mesaj: string; dosyalar: readonly string[] }[]; icguduler: Instinct[]; ozetler: Record<string, string>; kod: CodeExperience[] }> {
  const all = await filesAt(d.repoRoot, input.rev);
  const folders = [...new Set(all.filter((f) => f.startsWith("src/lib/v3/")).map((f) => f.split("/")[3]!).filter((x) => !x.includes(".")))];
  const terms = await searchTerms(input.gorev, folders, d);
  const scores = await grepScores(d.repoRoot, input.rev, terms, all);
  const why = new Map<string, string[]>();
  const add = (f: string, puan: number, neden: string) => {
    if (!all.includes(f)) return;
    const s = scores.get(f) ?? { puan: 0, kelimeler: [] };
    scores.set(f, { ...s, puan: s.puan + puan });
    why.set(f, [...(why.get(f) ?? []), neden]);
  };
  const byWords = similarChanges(await listChanges(d.workRoot), input.gorev, { ...(input.before ? { before: input.before } : {}), exclude: input.id });
  const byMeaning = await meaningNeighbours(d, input.gorev, { ...(input.before ? { before: input.before } : {}), exclude: input.id });
  const benzer = [...byMeaning, ...byWords.filter((c) => !byMeaning.some((m) => m.id === c.id))].slice(0, 6);
  for (const c of benzer) for (const f of c.dosyalar) add(f, 6 * c.benzerlik, `benzer değişiklik "${c.mesaj.slice(0, 60)}"`);
  // An exam is taken with what was known then: instincts learned from the answer itself (or later) stay out.
  const known = input.before ? rebuildInstincts((await listChanges(d.workRoot)).filter((c) => c.id !== input.id && Date.parse(c.tarih) < Date.parse(input.before!))) : await currentInstincts(d.workRoot);
  const icguduler = firedInstincts(known, input.gorev).slice(0, 12);
  for (const f of instinctFiles(known, input.gorev).slice(0, 8)) add(f.dosya, Math.min(12, 6 * f.guven), `içgüdü (${f.tetikler.slice(0, 3).join(", ")}) ${f.guven}`);
  const ranked = [...scores.entries()].sort((a, b) => b[1].puan - a[1].puan).slice(0, CANDIDATES).map(([f]) => f);
  const ozetler: Record<string, string> = {};
  const bildirimler: Record<string, string[]> = {};
  for (const f of ranked) {
    const facts = await fileFacts(d.repoRoot, input.rev, f);
    ozetler[f] = facts.ozet;
    bildirimler[f] = facts.bildirimler;
  }
  const lessons = (await listLessons(d.workRoot)).slice(-6).map((l) => l.metin);
  // The code of the most similar past changes (never the task's own: `benzer` already leaves it out).
  const kod = await codeOf(d.workRoot, benzer.map((c) => c.id));
  const codeById = new Map(kod.map((x) => [x.id, x]));
  const similarLine = (c: (typeof benzer)[number], k: number) => {
    const x = codeById.get(c.id);
    return x?.dosyalar.length ? [`- "${c.mesaj}":`, ...codeExperienceLines(x, k === 0 ? { ornek: 500 } : {})].join("\n") : `- "${c.mesaj}" → ${c.dosyalar.slice(0, 6).join(", ")}`;
  };
  const prompt = `You are the apprentice developer of Atölye V3, a TypeScript studio that makes animated history videos. Before the senior developer builds a task you guess where the change goes — which files and which declarations in them; you are graded on it later.
TASK (Turkish): ${input.gorev}

CANDIDATE FILES your search found (path — what the file says it does — why it came up — what it declares):
${ranked.map((f, i) => `${i + 1}. ${f} — ${ozetler[f] || "?"} — ${[...(scores.get(f)?.kelimeler.length ? [`words: ${scores.get(f)!.kelimeler.slice(0, 5).join(", ")}`] : []), ...(why.get(f) ?? []).slice(0, 2)].join("; ")}${i < DECLARED_CANDIDATES && bildirimler[f]?.length ? ` — declares: ${bildirimler[f]!.slice(0, DECLARATIONS_SHOWN).join(", ")}` : ""}`).join("\n") || "(none)"}
${benzer.length ? `\nSIMILAR PAST CHANGES (where and what the senior changed, how it was done):\n${benzer.map(similarLine).join("\n")}\n` : ""}${lessons.length ? `\nYOUR LESSONS FROM EARLIER GUESSES:\n${lessons.map((l) => `- ${l}`).join("\n")}\n` : ""}
Decide which files (at most ${MAX_GUESS_FILES}; usually 1-4) a developer would change for this task, which top-level declarations (functions, constants, types; existing names from "declares" or the new names you would add, at most ${MAX_GUESS_SYMBOLS}) would be added or changed, whether the studio already does it, and how. Name only real paths, preferably from the candidates.
Return ONLY JSON: {"dosyalar": ["path", ...], "semboller": ["name", ...], "karar": "var" | "yapilmali", "plan": "<Turkish, 2-4 sentences: what changes where>", "test": "scripts/smoke-v3-<name>.ts"}`;
  let guess: DevGuess = { id: input.id, kaynak: input.kaynak, tarih: new Date().toISOString(), gorev: input.gorev, dosyalar: ranked.slice(0, 3), karar: "yapilmali", plan: "", adaylar: ranked, model: modelName(d.model) };
  try {
    const out = await d.budget.generate("gelistirici-tahmin", d.guessModel ?? d.model, prompt, { maxTokens: 700 });
    const raw = readJsonAnswer<{ dosyalar?: unknown; semboller?: unknown; karar?: unknown; plan?: unknown; test?: unknown }>(out.result.content);
    if (raw) {
      const named = Array.isArray(raw.dosyalar) ? gradedFiles(raw.dosyalar.filter((f): f is string => typeof f === "string").map((f) => f.trim())).filter((f) => all.includes(f)).slice(0, MAX_GUESS_FILES) : [];
      // Names only ("RetouchBrain.ts#roundImproved" and "roundImproved()" both mean roundImproved).
      const symbols = Array.isArray(raw.semboller)
        ? [...new Set(raw.semboller.filter((s): s is string => typeof s === "string").map((s) => s.trim().replace(/^.*[#:.]/, "").replace(/\(.*$/, "")).filter((s) => /^[A-Za-z_$][\w$]{1,60}$/.test(s)))].slice(0, MAX_GUESS_SYMBOLS)
        : [];
      guess = {
        ...guess,
        ...(symbols.length ? { semboller: symbols } : {}),
        dosyalar: named.length || raw.karar === "var" ? named : guess.dosyalar,
        karar: raw.karar === "var" ? "var" : "yapilmali",
        plan: typeof raw.plan === "string" ? raw.plan.replace(/\s+/g, " ").trim().slice(0, 700) : "",
        ...(typeof raw.test === "string" && /^scripts\/smoke-v3-[\w-]+\.ts$/.test(raw.test.trim()) ? { test: raw.test.trim() } : {}),
        model: modelName(out.used),
      };
    }
  } catch (e) {
    d.log(`  geliştirici beyni: model cevap vermedi, arama sırası kullanıldı (${(e as Error).message.slice(0, 120)})`);
  }
  return { guess, benzer, icguduler, ozetler, kod };
}

/** Whether a job needs (new) research: never researched, or tried again since its last research. */
export async function needsResearch(workRoot: string, p: DevProposal): Promise<boolean> {
  const g = await lastGuess(workRoot, p.id);
  return !g || (!!p.is?.bitis && g.tarih < p.is.bitis);
}

const jobTask = (p: Pick<DevProposal, "baslik" | "neden" | "karar">) => `${p.baslik} — ${p.neden}${p.karar?.not ? ` (owner: ${p.karar.not})` : ""}`.slice(0, 900);

/** Researches one approved job at the checkout's HEAD; the guess is recorded before anyone builds it. */
export async function researchJob(p: DevProposal, d: ResearchDeps): Promise<DevGuess> {
  const { guess, benzer, icguduler, ozetler, kod } = await guessTask({ id: p.id, kaynak: "is", gorev: jobTask(p), rev: "HEAD" }, d);
  await recordGuess(d.workRoot, guess);
  const note = researchNote(d.workRoot, p.id);
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(note, researchMarkdown(guess, { benzer, icguduler, ozetler, kod }));
  await say(d.workRoot, `"${p.baslik.slice(0, 80)}" işini araştırdım: ${guess.karar === "var" ? "stüdyoda zaten var gibi görünüyor, akşam Claude doğrulayacak" : `${guess.dosyalar.length} dosyada değişiklik bekliyorum${guess.dosyalar[0] ? ` (en güçlü aday ${path.posix.basename(guess.dosyalar[0])})` : ""}`}.`);
  return guess;
}

/** The jobs waiting for the evening, researched by day: approved and not yet researched (or tried again since). */
export async function researchQueue(proposals: readonly DevProposal[], d: ResearchDeps, max = 3): Promise<string[]> {
  const done: string[] = [];
  // Only the V3 studio's jobs: the developer brain knows no main-AYAS code (its research would be a paid wrong guess).
  for (const p of proposals.filter((x) => scopeOf(x) === "v3" && (x.durum === "onaylandi" || x.durum === "yapilamadi"))) {
    if (done.length >= max) break;
    if (!(await needsResearch(d.workRoot, p))) continue;
    const g = await researchJob(p, d);
    done.push(`"${p.baslik.slice(0, 60)}": ${g.karar === "var" ? "zaten var gibi" : `${g.dosyalar.length} dosya`}`);
  }
  return done;
}

/** The V3 commits on HEAD, oldest first. */
export async function v3Commits(repoRoot: string, limit = 400): Promise<{ sha: string; tarih: string; konu: string }[]> {
  const r = await git(repoRoot, ["log", "--no-merges", "-n", String(limit), "--format=%H%x09%cI%x09%s", "HEAD", "--", ...SEARCH_PATHS]);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((x) => x.length >= 3)
    .map(([sha, tarih, ...konu]) => ({ sha: sha!, tarih: tarih!, konu: konu.join("\t") }))
    .reverse();
}

export async function commitFiles(repoRoot: string, sha: string): Promise<string[]> {
  // `--root`: a first commit lists its files too (without it, nothing).
  const r = await git(repoRoot, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha]);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

/** A commit subject as a task (the type prefix says nothing about where the change goes). */
export const commitTask = (subject: string) => subject.replace(/^(feat|fix|docs|chore|refactor|perf|test|wip)(\([^)]*\))?!?:\s*/i, "").trim();

/**
 * Learns from the V3 commits it has not seen: the newest few are exam questions (guessed at the parent, graded against
 * the commit's files and declarations, only commits of at most EXAM_MAX_FILES graded files), every one then joins its
 * memory of past changes and its instincts. Every V3 commit's code is read too (where, which declarations, the added
 * code, the tests) — also the ones read before code was kept, so the whole history becomes worked examples — and the
 * newest `recipes` changes without a recipe get one. The first pass reads the whole history this way, oldest first.
 */
export async function learnFromCommits(d: ResearchDeps, exams = EXAMS_PER_PASS, recipes = RECIPES_PER_PASS): Promise<{ okunan: number; sinav: number; kod: number; tarif: number; ozet: string }> {
  const seen = new Set((await listChanges(d.workRoot)).map((c) => c.id));
  const coded = new Set((await listCodeExperience(d.workRoot)).map((x) => x.id));
  const commits = await v3Commits(d.repoRoot);
  const fresh = commits.filter((c) => !seen.has(c.sha));
  let instincts = await currentInstincts(d.workRoot);
  const examFrom = Math.max(0, fresh.length - exams);
  const results: string[] = [];
  let sinav = 0;
  let kod = 0;
  const readCode = async (c: (typeof commits)[number], task: string) => {
    const x = await readCodeExperience(d.repoRoot, c.sha, { id: c.sha, tarih: c.tarih, gorev: task });
    await recordCodeExperience(d.workRoot, x);
    coded.add(c.sha);
    kod++;
    return x;
  };
  for (const [k, c] of fresh.entries()) {
    const files = await commitFiles(d.repoRoot, c.sha);
    const graded = gradedFiles(files);
    const task = commitTask(c.konu);
    if (k >= examFrom && graded.length >= 1 && graded.length <= EXAM_MAX_FILES && task) {
      // The exam comes before the answer joins the memory: the guess is made at the parent, with what was known then.
      const { guess } = await guessTask({ id: c.sha, kaynak: "commit", gorev: task, rev: `${c.sha}^`, before: c.tarih }, d);
      await recordGuess(d.workRoot, guess);
      const code = await readCode(c, task);
      const grade = gradeGuess(guess, files, new Date(), changedSymbols(code));
      await recordGrade(d.workRoot, grade);
      sinav++;
      results.push(`"${task.slice(0, 50)}": %${Math.round(grade.isabet * 100)}${grade.sembolIsabet !== undefined ? ` (fonksiyon %${Math.round(grade.sembolIsabet * 100)})` : ""}`);
      const symbolsFound = grade.sembolIsabet !== undefined ? `; değişen ${Math.min(grade.gercekSemboller!.length, MAX_GUESS_SYMBOLS)} bildirimin ${Math.round(grade.sembolIsabet * Math.min(grade.gercekSemboller!.length, MAX_GUESS_SYMBOLS))} tanesini bildim` : "";
      await say(d.workRoot, `Commit sınavı — "${task.slice(0, 70)}": değişen ${grade.gercek.length} dosyanın ${Math.round(grade.isabet * grade.gercek.length)} tanesini buldum${grade.isabet < 1 && grade.adayIsabet > grade.isabet ? " (kalanlar aramamda vardı, seçemedim)" : ""}${symbolsFound}.`);
      // A missed commit exam teaches too (until 6 Nov 2026 only a job Claude built did, and no job was ever built).
      if (missed(grade)) await writeLesson(d, { id: c.sha, gorev: task, tahmin: guessLine(guess), gercek: grade.gercek, semboller: changedSymbols(code), ozet: code.nasil ?? codeExperienceLines(code, { ornek: 600 }).join("\n") });
    } else if (graded.length) await readCode(c, task);
    // Every commit is recorded, so it is read once (one that changed only notes has no files to learn).
    await recordChange(d.workRoot, { id: c.sha, tarih: c.tarih, mesaj: task, dosyalar: graded });
    if (graded.length) instincts = learnInstincts(instincts, task, graded, c.sha.slice(0, 10));
  }
  // Commits read before the brain kept code: their code now, without an exam (git only, no model).
  const past = new Map((await listChanges(d.workRoot)).map((c) => [c.id, c]));
  for (const c of commits) {
    const p = past.get(c.sha);
    if (!coded.has(c.sha) && p?.dosyalar.length) await readCode(c, p.mesaj);
  }
  if (fresh.length) await writeInstincts(d.workRoot, instincts);
  // Recipes: the newest changes without one first, within this pass's share.
  let tarif = 0;
  const shas = new Set(commits.map((c) => c.sha));
  const waiting = (await listCodeExperience(d.workRoot)).filter((x) => !x.nasil && x.dosyalar.length && shas.has(x.id)).sort((a, b) => Date.parse(b.tarih) - Date.parse(a.tarih));
  for (const x of waiting.slice(0, Math.max(0, recipes))) {
    const nasil = await writeRecipe(x, d);
    if (!nasil) continue;
    await recordCodeExperience(d.workRoot, { ...x, nasil });
    tarif++;
  }
  const okunan = fresh.length;
  if (!okunan && !kod && !tarif) return { okunan: 0, sinav: 0, kod: 0, tarif: 0, ozet: "yeni commit yok" };
  const ozet = `${okunan} commit okundu${sinav ? `, ${sinav} sınav: ${results.join(" · ")}` : ""}${kod ? `; ${kod} değişikliğin kodu okundu` : ""}${tarif ? `, ${tarif} tarif yazıldı` : ""}`;
  if (okunan > sinav) await say(d.workRoot, `${okunan - sinav} değişikliği hafızama ekledim (toplam içgüdü ${instincts.length}).`);
  if (kod || tarif) await say(d.workRoot, `${kod ? `${kod} değişikliğin kodunu okudum (hangi dosyada hangi fonksiyon, eklenen kod, testi)` : ""}${kod && tarif ? "; " : ""}${tarif ? `${tarif} tanesinin nasıl yapıldığını kendi sözlerimle yazdım` : ""}.`);
  return { okunan, sinav, kod, tarif, ozet };
}

/**
 * After the master built a job: the guess is graded against what really changed (nothing changed = "already there"),
 * the instincts learn, and when the guess missed, the model writes one lesson for next time.
 */
export async function learnFromBuild(p: DevProposal, d: ResearchDeps): Promise<string> {
  if (p.durum === "yapilamadi") {
    await say(d.workRoot, `"${p.baslik.slice(0, 70)}" Claude'da da tutmadı: ${(p.is?.sorunlar ?? []).join(" | ").slice(0, 160)}`, "AYAS");
    return "iş tutulmadı, notlanmadı";
  }
  if (p.durum !== "hazir" && p.durum !== "yapildi") return "iş bitmedi";
  const changed = p.is?.dosyalar ?? [];
  const guess = await lastGuess(d.workRoot, p.id);
  const now = new Date().toISOString();
  await recordChange(d.workRoot, { id: p.id, tarih: now, mesaj: p.baslik, dosyalar: gradedFiles(changed) });
  if (gradedFiles(changed).length) await writeInstincts(d.workRoot, learnInstincts(await currentInstincts(d.workRoot), jobTask(p), changed, p.id));
  // What Claude wrote, as code: the kept build is the one commit on its branch.
  let symbols: string[] = [];
  if (p.is?.dal && gradedFiles(changed).length) {
    const x = await readCodeExperience(d.repoRoot, p.is.dal, { id: p.id, tarih: now, gorev: p.baslik }).catch(() => undefined);
    if (x?.dosyalar.length) {
      const nasil = await writeRecipe(x, d);
      await recordCodeExperience(d.workRoot, { ...x, ...(nasil ? { nasil } : {}) });
      symbols = changedSymbols(x);
    }
  }
  if (!guess) return "tahmini yoktu";
  // Its own build is no exam of its guess (it wrote both).
  if (p.is?.yazan === "cirak") return "işi çırak kendisi yazdı; tahmini notlanmadı";
  const grade = gradeGuess(guess, changed, new Date(), symbols);
  await recordGrade(d.workRoot, grade);
  const line = `Claude "${p.baslik.slice(0, 60)}" işini bitirdi (${grade.gercek.length} dosya); tahminim %${Math.round(grade.isabet * 100)} tuttu${grade.kararDogru === false ? ", \"zaten var mı\" kararım yanlıştı" : ""}.`;
  await say(d.workRoot, line);
  if (!missed(grade)) return line;
  await writeLesson(d, { id: p.id, gorev: jobTask(p), tahmin: guessLine(guess), gercek: grade.gercek, semboller: symbols, ozet: p.is?.ozet ?? "" });
  return line;
}

/** A guess that missed a file, a "does it exist" decision, or half the declarations: worth a lesson. */
const missed = (g: Pick<DevGrade, "isabet" | "kararDogru" | "sembolIsabet">) => g.isabet < 1 || g.kararDogru === false || (g.sembolIsabet ?? 1) < 0.5;

const guessLine = (g: DevGuess) => `${g.karar === "var" ? "the studio already does it" : `change ${g.dosyalar.join(", ") || "nothing named"}`}${g.semboller?.length ? ` (declarations: ${g.semboller.join(", ")})` : ""}. Your plan: ${g.plan || "—"}`;

/** One lesson for next time from a miss: what it guessed against what the senior really did (the cheap model). */
async function writeLesson(d: ResearchDeps, x: { readonly id: string; readonly gorev: string; readonly tahmin: string; readonly gercek: readonly string[]; readonly semboller: readonly string[]; readonly ozet: string }): Promise<void> {
  const prompt = `You are the apprentice developer of Atölye V3. Before the senior developer built a task you guessed where the change would go; compare and learn.
TASK: ${x.gorev}
YOUR GUESS: ${x.tahmin}
WHAT THE SENIOR DID: changed ${x.gercek.join(", ") || "nothing (the studio already did it)"}${x.semboller.length ? ` (declarations: ${x.semboller.slice(0, 15).join(", ")})` : ""}. Their summary: ${x.ozet.slice(0, 1200)}
Write ONE lesson for similar tasks next time, general enough to reuse (where such changes go, what to check first), in Turkish, at most 2 sentences. Return ONLY JSON: {"ders": "..."}`;
  try {
    const out = await d.budget.generate("gelistirici-ders", d.model, prompt, { maxTokens: 250 });
    const ders = readJsonAnswer<{ ders?: unknown }>(out.result.content)?.ders;
    if (typeof ders === "string" && ders.trim()) {
      await recordLesson(d.workRoot, { tarih: new Date().toISOString(), id: x.id, metin: ders });
      await say(d.workRoot, `Ders aldım: ${ders.trim().slice(0, 200)}`);
    }
  } catch (e) {
    d.log(`  geliştirici beyni: ders yazılamadı (${(e as Error).message.slice(0, 120)})`);
  }
}

/**
 * One job of the evening: researched first when the day's research missed it (Claude always gets the note), built by
 * the developer (Developer.develop: Claude in its own worktree, the studio's checks), then learned from.
 */
export async function runDevJob(
  p: DevProposal,
  d: ResearchDeps,
  builder: Partial<Pick<DeveloperDeps, "agent" | "checks" | "worktreeRoot">> & {
    /** The apprentice's own agent (DevWriter through scripts/v3/cirak-yaz.ts) and when it builds instead of Claude. */
    readonly cirak?: { readonly agent: readonly string[]; readonly when: "zorla" | "yedek" | "once" };
  } = {},
): Promise<DevProposal> {
  if (scopeOf(p) === "ayas") {
    // A main-AYAS job (owner decision 2026-11-09): Claude writes it. The developer brain and its apprentice know only
    // the V3 studio's code (SEARCH_PATHS), so they neither research, write nor grade it.
    const { cirak: _apprentice, ...rest } = builder;
    void _apprentice;
    await say(d.workRoot, `"${p.baslik.slice(0, 80)}" ana AYAS işini Claude'a veriyorum; kendi kopyasında yazıp test edecek, hazır olunca "ONAYLA VE UYGULA" ile onayına gelecek.`, "Claude");
    return develop(p, { ...rest, repoRoot: d.repoRoot, workRoot: d.workRoot, log: d.log });
  }
  if (await needsResearch(d.workRoot, p)) await researchJob(p, d).catch((e: Error) => d.log(`  geliştirici beyni: araştıramadı (${e.message.slice(0, 160)})`));
  const note = researchNote(d.workRoot, p.id);
  const research = existsSync(note) && (await lastGuess(d.workRoot, p.id)) ? await fs.readFile(note, "utf8") : undefined;
  const { cirak, ...rest } = builder;
  const base = { ...rest, repoRoot: d.repoRoot, workRoot: d.workRoot, log: d.log, ...(research ? { research } : {}) };
  const byApprentice = async (job: DevProposal, why: string) => {
    await say(d.workRoot, `"${job.baslik.slice(0, 80)}" işini ${why} kendim yazıyorum; testlerden geçmezse tutulmaz.`, "AYAS");
    return develop(job, { ...base, agent: cirak!.agent, yazan: "cirak" });
  };
  let done: DevProposal;
  if (cirak && (cirak.when === "zorla" || cirak.when === "once")) {
    done = await byApprentice(p, cirak.when === "zorla" ? "istendiği için" : "önce");
    // Claude is the backup (owner, 9 Nov 2026): what the apprentice could not build, Claude builds the same evening
    // with the same research note; a forced apprentice run stays the apprentice's.
    if (cirak.when === "once" && done.durum === "yapilamadi") {
      await say(d.workRoot, `"${p.baslik.slice(0, 80)}" işini yazamadım; yedek olarak Claude'a veriyorum.`, "Claude");
      done = await develop(done, base);
    }
  } else {
    await say(d.workRoot, `"${p.baslik.slice(0, 80)}" işini araştırma notumla birlikte Claude'a veriyorum.`, "Claude");
    done = await develop(p, base);
    // Claude's usage limit (the evenings of 3 Nov 2026): the apprentice, once its writing exams allow it, builds instead.
    if (cirak?.when === "yedek" && done.durum === "onaylandi" && done.is?.bekle) done = await byApprentice(done, "Claude'un kullanım sınırı dolduğu için");
  }
  await learnFromBuild(done, d).catch((e: Error) => d.log(`  geliştirici beyni: öğrenemedi (${e.message.slice(0, 160)})`));
  return done;
}
